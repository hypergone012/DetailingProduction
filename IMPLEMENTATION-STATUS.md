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
