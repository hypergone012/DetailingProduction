import { createHash } from 'node:crypto'
import { canonicalJson, toPublishConfig, type PublishMember } from '@dp/core'
import { processImages, stripFiles, uploadImages } from './images.ts'
import type { LoadedTenant } from './load.ts'
import { createUser, findUserByEmail, recoveryLink, rpc, setPassword, type Env } from './supabase.ts'

export interface PublishOptions {
  overwrite: boolean
  reseedDemo: boolean
  dryRun: boolean
  /** Password for owners of DEMO studios (never used for live/draft studios). */
  demoOwnerPassword: string | null
  resetDemoPassword: boolean
  log: (line: string) => void
}

export interface PublishReport {
  slug: string
  tenant_id: string
  status: string
  created: string[]
  updated: string[]
  kept_owner_edits: string[]
  deactivated: string[]
  deleted: string[]
  unchanged: number
  images: { uploaded: number; existing: number }
  owners: { email: string; created: boolean; link?: string }[]
  seed: unknown
  configHash: string
}

async function resolveMembers(env: Env, t: LoadedTenant, o: PublishOptions) {
  const b = t.business!
  const members: PublishMember[] = []
  const owners: PublishReport['owners'] = []
  for (const owner of b.owners) {
    const demo = b.status === 'demo' && o.demoOwnerPassword
    let user = await findUserByEmail(env, owner.email)
    let created = false
    if (!user) {
      if (o.dryRun) {
        owners.push({ email: owner.email, created: true })
        continue
      }
      user = await createUser(env, owner.email, demo ? o.demoOwnerPassword : null)
      created = true
    } else if (demo && o.resetDemoPassword && !o.dryRun) {
      await setPassword(env, user.id, o.demoOwnerPassword!)
    }
    let link: string | undefined
    if (!demo && created && !o.dryRun) {
      // A real studio's owner sets their own password through a one-time link.
      link = await recoveryLink(env, owner.email, `${env.appUrl}/s/${b.slug}/owner/`)
    }
    members.push({ user_id: user.id, role: owner.role })
    owners.push({ email: owner.email, created, link })
  }
  return { members, owners }
}

/**
 * config -> images in Storage -> owners in Auth -> api_admin_publish_tenant -> demo seed.
 * Every step is idempotent: images are content-addressed, users are looked up by email,
 * the SQL publish matches entities by stable keys and the seed runs once.
 */
export async function publishTenant(env: Env, t: LoadedTenant, o: PublishOptions): Promise<PublishReport> {
  const b = t.business
  if (!b) throw new Error(`${t.slug}: config is invalid`)
  o.log(`• ${b.slug}: processing images`)
  const images = await processImages(b, t.dir)
  const imageStats = o.dryRun ? { uploaded: 0, existing: 0 } : await uploadImages(env, images)
  o.log(`  images: ${imageStats.uploaded} uploaded, ${imageStats.existing} already present`)
  const { members, owners } = await resolveMembers(env, t, o)
  const config = toPublishConfig(b, stripFiles(images), members)
  const configHash = createHash('sha256').update(canonicalJson(config)).digest('hex')
  if (o.dryRun) {
    return { slug: b.slug, tenant_id: b.id, status: b.status, created: [], updated: [], kept_owner_edits: [], deactivated: [], deleted: [], unchanged: 0, images: imageStats, owners, seed: null, configHash }
  }
  const report = await rpc<Omit<PublishReport, 'images' | 'owners' | 'seed' | 'configHash'>>(env, 'api_admin_publish_tenant', {
    p_config: config,
    p_config_hash: configHash,
    p_overwrite: o.overwrite,
  })
  let seed: unknown = null
  if (t.seed && report.status === 'demo') {
    seed = await rpc(env, 'api_admin_seed_demo', { p_tenant: b.id, p_seed: t.seed, p_reset: o.reseedDemo })
  }
  return { ...report, images: imageStats, owners, seed, configHash }
}
