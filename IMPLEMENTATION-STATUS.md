# IMPLEMENTATION-STATUS

Рабочий контрольный список. Обновляется после каждого этапа. Фиксирует только факты.

## 0. Аудит перед началом (2026-10-01)

| Что проверено | Результат |
|---|---|
| `IMPLEMENTATION-PLAN.md` | **Отсутствует.** Репозиторий `hypergone012/DetailingProduction` был пустым (ни одного коммита). Соседний `hypergone012/DetailingProduct` тоже пустой. В `hypergone012/DETAILFLOW` (предыдущий проект владельца) лежит `docs/PLAN.md` другого формата, файла `IMPLEMENTATION-PLAN.md` нет ни в одном доступном репозитории. |
| `AGENTS.md`, `package.json`, lockfile, tsconfig, vite config, Supabase config, migrations, functions, tests, assets | Отсутствуют: проект создаётся с нуля, ломать нечего. |
| Решение | Этапы 1–8 восстановлены из мастер-промпта (разделы 1–40) в порядке архитектурных зависимостей (см. ниже). Данные демо-тенанта GRAPHITE Detailing (Москва, услуги, ресурсы, часы) взяты из `tenants/graphite/business.json` проекта DETAILFLOW того же владельца. Код DETAILFLOW не копировался; оттуда заимствованы проверенные решения по инфраструктуре: локальный стек без Docker, pinned-версии TS 6 и Playwright 1.56. **Если `IMPLEMENTATION-PLAN.md` существует, его нужно добавить в репозиторий, и этапы будут сверены с ним.** |

### Окружение

| Инструмент | Статус | Следствие |
|---|---|---|
| Node 22.22 / pnpm 10.28 | есть | pnpm workspace |
| PostgreSQL 16 (+ `btree_gist`, `pgcrypto`) | есть | SQL-тесты против настоящего Postgres |
| `pg_cron` / `pg_net` | нет локально | Cron-миграция условная (`if exists extension`); dispatcher тестируется прямым вызовом |
| Docker daemon | не запущен | `supabase start` невозможен → локальный стек из настоящих компонентов: GoTrue (из исходников, pinned commit), PostgREST 13.0.8 (официальный бинарник), Storage API (из исходников, Node 24 из npm-пакета `node-linux-x64`) |
| Deno | нет в системе | npm-пакет `deno@2.9.6` (бинарник) |
| `api.supabase.com`, Cloudflare | заблокированы сетевой политикой | деплой отсюда невозможен → `NOT RUN — credentials/network` в ACCEPTANCE |
| Хостинги фото (unsplash, pexels, wikimedia) | заблокированы | реальные фото скачать нельзя → демо-тенанты получают сгенерированные иллюстрации с пометкой `demoArtwork: true`; pipeline поддерживает замену на реальные фото |
| npm registry, GitHub (git/releases), jsr.io, Google Fonts | доступны | |
| Playwright Chromium 1194 | предустановлен | `@playwright/test@1.56.1` (новее не совпадёт с браузером) |
| LLM credentials | нет | AI тестируется на уровне router/tools/fallback; живой вызов `NOT RUN — missing LLM_API_KEY` |

### Версии (npm, 2026-10-01)

react 19.3 · vite 8.3 · react-router 8.4 · @tanstack/react-query 5.104 · zod 4.6.5 · @supabase/supabase-js 2.117 · tailwindcss 4.3 · shadcn 4.21 · @astryxdesign/core 0.6.3 · vite-plugin-pwa 1.3 · vitest 5.0 · **typescript 6.0.3** (typescript-eslint 8.71 требует TS < 6.1, поэтому TS 7 не берём).

## Этапы (восстановлены)

| # | Этап | Зависит от | Проверки, которые должны пройти |
|---|---|---|---|
| 1 | Foundation: монорепо, TS strict, lint, тест-раннеры, локальный стек, `.env.example` | – | `pnpm typecheck`, `pnpm lint`, `stack.sh init/start/status` |
| 2 | БД: схема, RLS, tenant isolation, booking engine (occupancy + EXCLUDE), availability, reschedule/cancel/block, idempotency, payments, stats, outbox, rate limits | 1 | `pnpm test:db`: concurrency, two resources, multi-day, buffer, working hours, exceptions, timezone, blocking, reschedule ok/fail, idempotency, isolation, historical price, payments, outbox, token hash, grants |
| 3 | Tenant pipeline: `business.json` (Zod), темы, `tenant:new/validate/publish/verify`, GRAPHITE + второй тенант, идемпотентная републикация | 2 | unit-тесты схемы, db-тест «republish не трогает runtime data», «publish B не ломает A» |
| 4 | Edge Functions: public-api (каталог, availability, booking, garage, ICS, push), owner-api (ссылки доступа, медиа, приглашения), notify-dispatcher (outbox, lease, VAPID) | 2, 3 | `pnpm test:api` против PostgREST + handlers; `pnpm functions:check` (deno check) |
| 5 | Frontend foundation: Vite/React 19/Router/Query, Tailwind 4 + Astryx + shadcn, 7 тем на семантических токенах, appearance ≠ branding, motion, PWA (injectManifest), per-tenant shell/manifest | 3, 4 | `pnpm build`, unit-тесты токенов/контраста, typecheck |
| 6 | Client app: home, услуги, booking sheet, garage, история, повторная запись, доступ к записи, перенос/отмена, ICS, профиль/тема, push | 5 | Playwright-сценарии клиента |
| 7 | Owner app: вход, dashboard (SQL stats), календарь по ресурсам, действия с записями, блоки, клиенты/авто, услуги/цены, часы/исключения, платежи, медиа, настройки/брендинг, demo/live | 5 | Playwright owner-сценарии, db-тесты RPC |
| 8 | AI (client/owner scopes, tool loop, Zod, JSON-intent fallback, бюджеты), E2E полный, документация, ACCEPTANCE | 4–7 | unit AI router, db AI scopes, Playwright E2E client→owner, финальный gate |

## Ход работ

### Этап 1 — готово
- [x] pnpm workspace, pinned devDependencies, lockfile
- [x] локальный стек `scripts/local/stack.sh`: Postgres 16 :54322, GoTrue :54324, PostgREST 13.0.8 :54325, Storage API :54326 (Node 24.21 из npm-пакета `node-linux-x64`, т.к. storage-api требует node ≥ 24)
- [x] tsconfig (strict, `noUncheckedIndexedAccess`), eslint (typescript-eslint strict + запрет ветвлений по slug тенанта), vitest projects (unit/db/api), migration runner в формате ledger Supabase CLI
- [ ] `.env.example` — переносится в этап 4 (переменные появляются вместе с Edge Functions)

### Этап 2 — готово
Миграции `supabase/migrations/20261001000001..11`:
- tenancy (tenants/settings/members, role rank, RLS через `private.my_tenant_ids()` как InitPlan);
- catalog (resources, services, variants по типу кузова, add-ons, hours с ночными окнами, exceptions, media);
- customers / client_profiles (ключ устройства, хранится только SHA-256) / customer_vehicles;
- bookings со снимком цены и длительности, booking_items, **единый журнал `resource_occupancies` с `EXCLUDE USING gist`** для записей и блоков, booking_events, booking_access_tokens (только hash), payments;
- notifications outbox (dedupe, lease, deliveries, demo-подавление);
- engine: working windows (TZ/DST, слияние окон), compute_end (multi-day по рабочим окнам, непрерывная занятость), availability, place/move/cancel/transition/block — каждая операция одна транзакция;
- public API (`api_public_*`, только service_role), owner API (`owner_*`, проверка роли), SQL-статистика, live-readiness, публикация конфигурации, демо-сид, бакеты Storage + RLS, условный Cron;
- финальные grants (anon — ничего, authenticated — SELECT под RLS + owner_*).

Проверки: `pnpm test:db` — **64 passed** (booking-engine 20, lifecycle 15, security 15, money-stats 3, outbox 5, publish 6).
Решение: availability и размещение — в SQL (а не в TS), чтобы авторитетная проверка шла в той же транзакции, что и запись в журнал занятости.

### Этап 3 — готово (кроме `verify`/`shells`, которым нужны этапы 4–5)
- `packages/core`: Zod-схема `business.json` (строгая, с перекрёстными проверками: типы ресурсов, рекомендации, пересечения часов, дубли ключей, «кислотные» акценты, требования к live), нормализация в копейки/ISO-дни, стабильные ключи медиа, canonical JSON для хеша.
- 7 тем-пресетов (`soft-white`, `graphite`, `burgundy`, `cobalt`, `forest`, `amber`, `plum`) на семантических токенах; бренд-акцент тенанта подменяет только акцентные токены и автоматически подбирает контрастные `accent-contrast`/`accent-text`.
- `scripts/tenant`: `tenant:new` (из `_template`, новый uuid, статус draft), `tenant:validate` (схема + ассеты через sharp + демо-сид + уникальность id/slug), `tenant:publish` (адаптивные WebP-варианты, иконки any/maskable/apple/favicon, контент-адресуемая загрузка в Storage, владельцы через GoTrue Admin API, `api_admin_publish_tenant`, демо-сид), `tenant:schema`.
- Тенанты: `graphite` (тёмный премиум, Москва, 4 ресурса, 7 услуг) и `verde` (светлая тема + лесной акцент, Екатеринбург UTC+5, шаг 15 мин, 3 ресурса других типов, 6 услуг).
- Демо-иллюстрации генерируются `pnpm tenant:art` из `tenants/<slug>/art.json` (реальные фото недоступны в сети окружения) — помечены `demoArtwork: true`, live без замены запрещён.

Проверки: `pnpm test` — **37 passed** (контраст WCAG всех тем, схема, нормализация); локальная публикация обоих тенантов прошла, повторная публикация — `no changes (idempotent republish)`, 0 загрузок; `pnpm test:db` (publish.test) — republish не трогает runtime-данные, публикация B не меняет A побайтно.
Решение: SVG не хранится в Storage (риск XSS на origin хранилища) — логотип растеризуется в PNG.

### Этап 4 — готово
- `packages/core`: WebCrypto-хелперы (HMAC-деривация токенов, SHA-256 → bytea), контракты API (Zod-запросы, типы ответов), коды ошибок → HTTP, ICS (RFC 5545, UTC, SEQUENCE = версия записи), **Web Push без сторонних библиотек** (RFC 8291 aes128gcm + RFC 8292 VAPID ES256), тексты уведомлений в timezone тенанта, генератор PWA-манифеста.
- `supabase/functions`: `public-api` (каталог, availability, создание записи с Idempotency-Key и детерминированным токеном доступа, просмотр/перенос/отмена по токену или ключу устройства, ICS, гараж, фото авто в private-бакет с подписанными URL, push-подписка, динамический манифест), `owner-api` (ссылка для клиента, роль проверяется SQL под JWT пользователя), `notify-dispatcher` (lease → рендер → VAPID-отправка → отчёт по каждой подписке).
- Общий слой: CORS по точному allowlist, лимит размера тела (в т.ч. chunked), Zod strict (клиент не может передать цену/tenant), rate limit в БД с хешем IP (`TRUSTED_PROXY_HOPS`), нормализация телефона libphonenumber, без утечки внутренних ошибок.
- Локальный шлюз повторяет hosted-поведение: публичные/подписанные URL Storage без apikey, verify_jwt по config.toml.
- `.env.example`: browser-safe (`VITE_*`) отдельно от server-only.

Проверки: `pnpm test` — **46 passed** (+ расшифровка push ключом подписчика, VAPID-подпись, ICS, тексты, токены); `pnpm test:api` — **15 passed** через реальный HTTP (gateway → Deno handler → PostgREST → Postgres/GoTrue/Storage), включая **реальную доставку зашифрованного Web Push по HTTPS** на локальный push-сервис (расшифровка, 410 → отключение подписки, без повторной отправки, demo — ничего не отправляет); `pnpm functions:check` (deno check) — OK.
Решение: Web Push реализован на WebCrypto (а не `web-push` из npm), чтобы один и тот же код работал в Edge Runtime и в Node-тестах и проверялся расшифровкой.
