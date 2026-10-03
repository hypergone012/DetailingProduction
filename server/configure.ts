/**
 * Server configuration step of deploy/server/install.sh (run as root):
 *   deno run --allow-read=/etc/dp --allow-write=/etc/dp server/configure.ts /etc/dp
 *
 * Keeps /etc/dp/secrets.env (generating only what is missing — server/secrets-plan.ts), reads
 * /etc/dp/config.env (written by the deploy) and writes every service's environment file and
 * the Caddyfile (server/render.ts). Prints the names of newly generated secrets, never values.
 */
import { parseEnvFile, planServerSecrets, SECRET_KEYS } from './secrets-plan.ts'
import { readConfig, renderServer } from './render.ts'

const dir = Deno.args[0] ?? '/etc/dp'
const read = async (name: string) => {
  try {
    return await Deno.readTextFile(`${dir}/${name}`)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return ''
    throw e
  }
}
const write = (name: string, text: string) => Deno.writeTextFile(`${dir}/${name}`, text, { mode: 0o600 })

const existing = parseEnvFile(await read('secrets.env'))
const { values, created } = await planServerSecrets(existing)
if (created.length > 0) {
  const kept = Object.entries(existing).filter(([k]) => !(SECRET_KEYS as readonly string[]).includes(k))
  await write(
    'secrets.env',
    '# Generated on this server. Never edit, share or lose: booking links, push and sign-in depend on it.\n' +
      [...SECRET_KEYS.map((k) => `${k}=${values[k]}`), ...kept.map(([k, v]) => `${k}=${v}`)].join('\n') +
      '\n',
  )
  console.log(`secrets generated: ${created.join(', ')}`)
}

const config = readConfig(parseEnvFile(await read('config.env')))
for (const [name, text] of Object.entries(renderServer(values, config))) await write(name, text)
console.log(`configured for https://${config.domain}`)
