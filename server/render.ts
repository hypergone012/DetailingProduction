/**
 * The server's service configuration, rendered from two sources (pure; server/configure.ts
 * does the I/O and the tests call it directly):
 *   - secrets.env: generated on the server once (server/secrets-plan.ts), never shown;
 *   - config.env:  what the deploy sets — the domain, optional LLM and SMTP settings.
 *
 * Output: one systemd EnvironmentFile per service and the Caddyfile. Every service listens on
 * 127.0.0.1 only; Caddy alone faces the internet (80/443) and proxies everything to the
 * gateway, so the site, the API, auth and storage share one origin.
 */
import type { SecretKey } from './secrets-plan.ts'

export const PORTS = { gateway: 54321, auth: 54324, rest: 54325, restAdmin: 54425, storage: 54326, storageAdmin: 54426, postgres: 5432 } as const
export const PATHS = {
  platform: '/opt/dp/platform/current',
  app: '/opt/dp/app/current',
  web: '/opt/dp/web/current',
  storageData: '/var/lib/dp/storage',
  caddyData: '/var/lib/dp/caddy',
} as const
export const DB_NAME = 'dp'

export interface ServerConfig {
  /** The site's host name (app.example.ru). `localhost` or an IP: a self-signed certificate. */
  domain: string
  acmeEmail?: string
  llm?: { apiKey: string; model?: string; baseUrl?: string }
  smtp?: { host: string; port: string; user: string; pass: string; sender: string; senderName?: string }
}

const HOST_RE = /^(?=.{1,253}$)(localhost|(\d{1,3}\.){3}\d{1,3}|([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62})$/

export function readConfig(env: Record<string, string>): ServerConfig {
  const domain = (env.DP_DOMAIN ?? '').trim().toLowerCase()
  if (!HOST_RE.test(domain)) throw new Error(`DP_DOMAIN must be a host name like app.example.ru (got "${domain}")`)
  const cfg: ServerConfig = { domain }
  const email = env.DP_ACME_EMAIL?.trim()
  if (email) {
    if (!/^[^\s@{}"]+@[^\s@{}"]+\.[^\s@{}"]+$/.test(email)) throw new Error(`DP_ACME_EMAIL is not an e-mail address`)
    cfg.acmeEmail = email
  }
  if (env.LLM_API_KEY?.trim()) {
    cfg.llm = { apiKey: env.LLM_API_KEY.trim() }
    if (env.LLM_MODEL?.trim()) cfg.llm.model = env.LLM_MODEL.trim()
    if (env.LLM_BASE_URL?.trim()) cfg.llm.baseUrl = env.LLM_BASE_URL.trim()
  }
  if (env.SMTP_HOST?.trim()) {
    const need = (k: string) => {
      const v = env[k]?.trim()
      if (!v) throw new Error(`${k} is required when SMTP_HOST is set`)
      return v
    }
    cfg.smtp = { host: env.SMTP_HOST.trim(), port: env.SMTP_PORT?.trim() || '465', user: need('SMTP_USER'), pass: need('SMTP_PASS'), sender: need('SMTP_SENDER') }
    if (env.SMTP_SENDER_NAME?.trim()) cfg.smtp.senderName = env.SMTP_SENDER_NAME.trim()
  }
  return cfg
}

/** localhost and bare IPs cannot get a public certificate: Caddy's own CA signs them. */
export function selfSigned(domain: string): boolean {
  return domain === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(domain)
}

/** systemd EnvironmentFile: every value double-quoted, `\` and `"` escaped, no expansion. */
export function envFile(vars: Record<string, string>): string {
  return (
    Object.entries(vars)
      .map(([k, v]) => {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) throw new Error(`bad variable name ${k}`)
        if (/[\r\n\0]/.test(v)) throw new Error(`${k}: multi-line values are not supported`)
        return `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      })
      .join('\n') + '\n'
  )
}

const pg = (user: string, password: string) => `postgres://${user}:${encodeURIComponent(password)}@127.0.0.1:${PORTS.postgres}/${DB_NAME}`

export function renderServer(secrets: Record<SecretKey, string>, cfg: ServerConfig): Record<string, string> {
  const origin = `https://${cfg.domain}`
  const internal = `http://127.0.0.1:${PORTS.gateway}`

  const auth: Record<string, string> = {
    GOTRUE_DB_DRIVER: 'postgres',
    DATABASE_URL: `${pg('supabase_auth_admin', secrets.DP_AUTH_ADMIN_PASSWORD)}?sslmode=disable`,
    GOTRUE_DB_MIGRATIONS_PATH: `${PATHS.platform}/auth-migrations`,
    API_EXTERNAL_URL: `${origin}/auth/v1`,
    GOTRUE_SITE_URL: origin,
    GOTRUE_URI_ALLOW_LIST: `${origin}/**`,
    // Links in e-mails use the site's address that Caddy forwards.
    GOTRUE_MAILER_EXTERNAL_HOSTS: cfg.domain,
    GOTRUE_API_HOST: '127.0.0.1',
    PORT: String(PORTS.auth),
    GOTRUE_JWT_SECRET: secrets.DP_JWT_SECRET,
    GOTRUE_JWT_EXP: '3600',
    GOTRUE_JWT_ISSUER: `${origin}/auth/v1`,
    GOTRUE_JWT_AUD: 'authenticated',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
    GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    // Accounts are created by the studio pipeline only (as on the hosted project).
    GOTRUE_DISABLE_SIGNUP: 'true',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
    GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false',
    GOTRUE_LOG_LEVEL: 'warn',
    // Per-visitor limits (sign-in attempts included) need the visitor's address: Caddy
    // replaces X-Forwarded-For with it, so it cannot be forged. Without this header GoTrue
    // applies no per-IP limit at all. 30 sign-ins per 5 minutes per address, as hosted.
    GOTRUE_RATE_LIMIT_HEADER: 'X-Forwarded-For',
    GOTRUE_RATE_LIMIT_TOKEN_REFRESH: '30',
  }
  if (cfg.smtp) {
    Object.assign(auth, {
      GOTRUE_SMTP_HOST: cfg.smtp.host,
      GOTRUE_SMTP_PORT: cfg.smtp.port,
      GOTRUE_SMTP_USER: cfg.smtp.user,
      GOTRUE_SMTP_PASS: cfg.smtp.pass,
      GOTRUE_SMTP_ADMIN_EMAIL: cfg.smtp.sender,
      GOTRUE_SMTP_SENDER_NAME: cfg.smtp.senderName ?? cfg.domain,
      GOTRUE_MAILER_AUTOCONFIRM: 'false',
    })
  } else {
    // No mail server: nothing can be confirmed by e-mail (owners get their password from the
    // operator; «Забыли пароль?» needs SMTP — DEPLOY-RU.md).
    auth.GOTRUE_MAILER_AUTOCONFIRM = 'true'
  }

  const rest = {
    PGRST_DB_URI: pg('authenticator', secrets.DP_AUTHENTICATOR_PASSWORD),
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions',
    PGRST_JWT_SECRET: secrets.DP_JWT_SECRET,
    PGRST_SERVER_HOST: '127.0.0.1',
    PGRST_SERVER_PORT: String(PORTS.rest),
    PGRST_ADMIN_SERVER_PORT: String(PORTS.restAdmin),
    PGRST_DB_MAX_ROWS: '1000',
    PGRST_DB_POOL: '20',
    PGRST_DB_CHANNEL_ENABLED: 'true',
    PGRST_LOG_LEVEL: 'warn',
  }

  const storage = {
    SERVER_HOST: '127.0.0.1',
    SERVER_PORT: String(PORTS.storage),
    SERVER_ADMIN_PORT: String(PORTS.storageAdmin),
    SERVER_REGION: 'local',
    AUTH_JWT_SECRET: secrets.DP_JWT_SECRET,
    AUTH_JWT_ALGORITHM: 'HS256',
    ANON_KEY: secrets.DP_ANON_KEY,
    SERVICE_KEY: secrets.DP_SERVICE_ROLE_KEY,
    DATABASE_URL: pg('supabase_storage_admin', secrets.DP_STORAGE_ADMIN_PASSWORD),
    DB_INSTALL_ROLES: 'false',
    DB_ANON_ROLE: 'anon',
    DB_SERVICE_ROLE: 'service_role',
    DB_AUTHENTICATED_ROLE: 'authenticated',
    DB_SUPER_USER: 'postgres',
    DB_ALLOW_MIGRATION_REFRESH: 'false',
    STORAGE_BACKEND: 'file',
    STORAGE_FILE_BACKEND_PATH: PATHS.storageData,
    STORAGE_FILE_ETAG_ALGORITHM: 'md5',
    GLOBAL_S3_BUCKET: 'dp',
    TENANT_ID: 'dp',
    UPLOAD_FILE_SIZE_LIMIT: '52428800',
    UPLOAD_FILE_SIZE_LIMIT_STANDARD: '52428800',
    IMAGE_TRANSFORMATION_ENABLED: 'false',
    RATE_LIMITER_ENABLED: 'false',
    PG_QUEUE_ENABLE: 'false',
    OTEL_METRICS_ENABLED: 'false',
    PROMETHEUS_METRICS_ENABLED: 'false',
    LOGFLARE_ENABLED: 'false',
    LOG_LEVEL: 'warn',
    NODE_ENV: 'production',
  }

  const gateway: Record<string, string> = {
    DP_GATEWAY_HOST: '127.0.0.1',
    DP_GATEWAY_PORT: String(PORTS.gateway),
    DP_AUTH_PORT: String(PORTS.auth),
    DP_REST_PORT: String(PORTS.rest),
    DP_STORAGE_PORT: String(PORTS.storage),
    DP_WEB_ROOT: PATHS.web,
    DP_ANON_KEY: secrets.DP_ANON_KEY,
    DP_SERVICE_ROLE_KEY: secrets.DP_SERVICE_ROLE_KEY,
    DP_JWT_SECRET: secrets.DP_JWT_SECRET,
    // Functions reach the database API inside the server; browsers get public URLs.
    SUPABASE_URL: internal,
    PUBLIC_STORAGE_URL: origin,
    SUPABASE_JWT_ISSUER: `${origin}/auth/v1`,
    APP_URL: origin,
    ALLOWED_ORIGINS: origin,
    // Caddy appends the visitor's address to X-Forwarded-For: one trusted hop.
    TRUSTED_PROXY_HOPS: '1',
    VAPID_SUBJECT: origin,
    ACCESS_TOKEN_SECRET: secrets.ACCESS_TOKEN_SECRET,
    DISPATCHER_SECRET: secrets.DISPATCHER_SECRET,
    VAPID_PUBLIC_KEY: secrets.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: secrets.VAPID_PRIVATE_KEY,
  }
  if (cfg.llm) {
    gateway.LLM_API_KEY = cfg.llm.apiKey
    if (cfg.llm.model) gateway.LLM_MODEL = cfg.llm.model
    if (cfg.llm.baseUrl) gateway.LLM_BASE_URL = cfg.llm.baseUrl
  }

  // Database maintenance scripts (backup, housekeeping) connect over the local socket as the
  // postgres OS user and need no password; the deploy reaches PostgreSQL through SSH only.
  const caddy = [
    '{',
    ...(cfg.acmeEmail ? [`\temail ${cfg.acmeEmail}`] : []),
    '\tadmin off',
    ...(selfSigned(cfg.domain) ? ['\tskip_install_trust'] : []),
    // HTTP/1.1 and HTTP/2 over TCP only: QUIC (HTTP/3, UDP) is filtered by some networks and
    // would only add a fallback delay there.
    '\tservers {',
    '\t\tprotocols h1 h2',
    '\t}',
    '}',
    '',
    `${cfg.domain} {`,
    ...(selfSigned(cfg.domain) ? ['\ttls internal'] : []),
    '\tencode zstd gzip',
    '\theader {',
    '\t\tStrict-Transport-Security "max-age=31536000"',
    '\t\t-Server',
    '\t}',
    `\treverse_proxy 127.0.0.1:${PORTS.gateway} {`,
    // Streamed answers (the assistant) go out as they are produced.
    '\t\tflush_interval -1',
    '\t}',
    '}',
    '',
  ].join('\n')

  return {
    'auth.env': envFile(auth),
    'rest.env': envFile(rest),
    'storage.env': envFile(storage),
    'gateway.env': envFile(gateway),
    Caddyfile: caddy,
  }
}
