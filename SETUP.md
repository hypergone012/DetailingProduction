# SETUP

Белая платформа онлайн-записи для студий детейлинга: **один код → одна сборка фронтенда → один проект Supabase → много студий**. Студия — это данные (`tenants/<slug>/business.json` → публикация → БД), а не код.

```
apps/web                 React 19 PWA: клиент /s/:slug/*, кабинет /s/:slug/owner/*
packages/core            общие типы, Zod-схемы, темы, crypto, Web Push, ICS, ИИ-роутер
supabase/migrations      схема, RLS, движок записи, API-функции (SQL)
supabase/functions       Edge Functions: public-api, owner-api, notify-dispatcher, assistant
scripts/tenant           tenant:new | validate | publish | verify | shells
scripts/local            локальный стек без Docker, ключи и env
tenants/                 конфигурации студий (graphite, verde — демо; _template — шаблон)
tests/                   unit (vitest), db (SQL), api (HTTP), e2e (Playwright)
```

---

## 1. Требования

| Что | Версия | Зачем |
|---|---|---|
| Node.js | ≥ 22 (`.nvmrc`) | сборка, скрипты, тесты |
| pnpm | 10.28 (`packageManager`) | монорепозиторий |
| PostgreSQL | 16 + contrib (`btree_gist`, `pgcrypto`) | локальный стек |
| Go | любая (используется `GOTOOLCHAIN=auto`) | сборка Supabase Auth (GoTrue) из исходников |
| git, curl, openssl | — | стек и тесты |
| Deno | ставится как npm-пакет `deno@2.9.6` | Edge Functions локально |
| Chromium | Playwright 1.56.1 | e2e |

Node 24 для Supabase Storage скачивается скриптом стека сам (npm-пакет `node-linux-x64`).

Docker не нужен: локальный стек собирается из тех же компонентов, что и Supabase (Postgres, GoTrue, PostgREST 13.0.8, Storage API) и закреплён на конкретных коммитах/версиях в `scripts/local/stack.sh`. Миграции хранятся в формате Supabase CLI (`supabase_migrations.schema_migrations`), поэтому `supabase start` / `supabase db push` тоже применимы — **в этом окружении путь через Supabase CLI не проверялся** (Docker недоступен).

---

## 2. Локальный запуск

```bash
pnpm install
pnpm stack init          # один раз: GoTrue, PostgREST, Storage, кластер Postgres, база dp_dev
pnpm stack start         # Postgres :54322, Auth :54324, PostgREST :54325, Storage :54326
pnpm db:migrate          # миграции supabase/migrations/*.sql
pnpm stack:env           # .local/functions.env (секреты функций) + apps/web/.env.local (VITE_*)
pnpm tenant:publish      # публикует tenants/* (демо-студии graphite и verde)
pnpm functions:serve     # шлюз :54321 = /auth/v1, /rest/v1, /storage/v1, /functions/v1
pnpm dev                 # http://127.0.0.1:5173
```

Открыть:

- клиент: `http://127.0.0.1:5173/s/graphite/` и `http://127.0.0.1:5173/s/verde/`
- кабинет: `http://127.0.0.1:5173/s/graphite/owner/` — email владельца из `tenants/graphite/business.json` (`owners[0].email`), пароль демо-владельца в **локальном** стеке `demo-owner-2026` (в не-локальной среде берётся из `TENANT_DEMO_OWNER_PASSWORD`).

Полезное:

```bash
pnpm stack status        # что запущено
pnpm stack stop
pnpm stack reset         # пустая база dp_dev (затем db:migrate и tenant:publish)
pnpm stack psql          # psql к dp_dev
```

`pnpm db:migrate` откажется работать, если уже применённая миграция была изменена: изменения схемы — только новыми миграциями.

**Демо-данные (seed).** У демо-студии рядом с конфигом лежит `tenants/<slug>/demo-seed.json`: клиенты, их автомобили и визиты, заданные относительно сегодняшнего дня. `tenant:publish` применяет его **один раз** и только к студии в статусе `demo`. Все такие строки помечены `is_demo`, уведомлений по ним не бывает. Пересоздать демо-данные — `pnpm tenant:publish <slug> --reseed-demo`. Live-студия seed не получает.

---

## 3. Переменные окружения

Полный список — `.env.example`. Главное правило: **в браузер попадают только `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`** (anon-ключ публичен по устройству Supabase; данные защищают RLS и функции).

| Переменная | Где | Секрет |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | сборка фронтенда | нет |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions (в hosted Supabase подставляются автоматически) | service role — **да** |
| `APP_URL` | функции, `tenant:shells` | нет |
| `ALLOWED_ORIGINS` | функции (CORS, точный список) | нет |
| `ACCESS_TOKEN_SECRET` (≥ 32 символов) | функции: детерминированные токены доступа к записи | **да** |
| `TRUSTED_PROXY_HOPS` | функции: сколько прокси перед функцией (для IP в rate limit) | нет |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | функции: Web Push | приватный — **да** |
| `DISPATCHER_SECRET` | функции + Vault: вызов диспетчера уведомлений из Cron | **да** |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | только функция `assistant` | ключ — **да** |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `TENANT_DEMO_OWNER_PASSWORD` | машина оператора / CI: `tenant:*` | **да** |

VAPID-ключи: `pnpm push:vapid`.

Проверка перед выкладкой: `pnpm build && pnpm security:scan-bundle` — ищет в сборке значения серверных секретов, JWT с ролью не `anon`, приватные ключи, ключи API и названия студий в общем коде.

---

## 4. Выкладка (hosted Supabase + статический хостинг)

> Отсюда (облачная среда разработки) выкладка не выполнялась: `api.supabase.com` и хостинги закрыты сетевой политикой. Шаги ниже — инструкция, а не отчёт о выполнении; см. ACCEPTANCE.md.

### 4.1 База

1. Создайте проект Supabase. В **Database → Extensions** включите `pg_cron` и `pg_net` **до** применения миграций (иначе расписания Cron не создадутся, см. 4.4).
2. `supabase link --project-ref <ref>` и `supabase db push` (или `DATABASE_URL=postgres://… pnpm db:migrate`).
3. Бакеты Storage `public-media` / `private-media` и политики создаёт миграция `…010_ops`.

### 4.2 Auth

- **Site URL** = `APP_URL`; в **Redirect URLs** добавьте `APP_URL/s/*/owner/` (ссылки восстановления пароля и приглашений).
- Настройте SMTP — без него «Забыли пароль?» в кабинете честно сообщит, что письмо не отправлено; ссылку можно выдать вручную: `tenant:publish` печатает одноразовую ссылку установки пароля для нового владельца live-студии.
- Публичная регистрация не нужна (владельцы создаются `tenant:publish`).

### 4.3 Edge Functions

```bash
supabase secrets set ACCESS_TOKEN_SECRET=… APP_URL=https://app.example.com \
  ALLOWED_ORIGINS=https://app.example.com TRUSTED_PROXY_HOPS=1 \
  VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:ops@example.com \
  DISPATCHER_SECRET=… LLM_API_KEY=… LLM_MODEL=claude-opus-5-5
pnpm functions:vendor            # копирует packages/core в supabase/functions/_vendor
supabase functions deploy public-api owner-api notify-dispatcher assistant
```

`verify_jwt` задан в `supabase/config.toml` (owner-api — JWT обязателен; public-api, assistant, notify-dispatcher проверяют доступ сами).

### 4.4 Cron (уведомления)

Миграция создаёт задания `notify-dispatch` (каждую минуту) и `housekeeping` (ежедневно), если `pg_cron` и `pg_net` уже включены. Задание читает URL и секрет из Vault:

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url');
select vault.create_secret('<DISPATCHER_SECRET>', 'dispatcher_secret');
```

Если расширения включили после миграций — выполните блок «Scheduled jobs» из `supabase/migrations/20261001000010_ops.sql` вручную в SQL Editor.

### 4.5 Фронтенд

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co VITE_SUPABASE_ANON_KEY=<anon> pnpm build
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… APP_URL=https://app.example.com pnpm tenant:shells
pnpm security:scan-bundle
```

Выложите `apps/web/dist` на статический хостинг с поддержкой `_redirects` (Netlify, Cloudflare Pages). `tenant:shells` пишет для каждой опубликованной студии свой `index.html` (title, description, theme-color, иконки, OG) и манифесты client/owner, а `_redirects` направляет `/s/<slug>/*` в оболочку студии. На других хостингах настройте те же правила перезаписи (файл `_redirects` — образец).

- `sw.js` отдавайте с `Cache-Control: no-cache` (иначе обновления приложения задерживаются).
- После публикации новой студии повторите `tenant:shells` (или примите, что до следующей выкладки манифест берётся из API — приложение делает это само).

Проверка: `pnpm tenant:verify --all --app-url=https://app.example.com`.

#### Cloudflare Pages

```bash
pnpm build && pnpm tenant:shells && pnpm security:scan-bundle
npx wrangler pages deploy apps/web/dist --project-name <project>   # или Git-интеграция Pages
```

- **Build output directory:** `apps/web/dist`. Переменные `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` задаются в окружении сборки. **Серверные секреты в Pages не нужны и не должны туда попадать.**
- `_redirects` пишется в синтаксисе Netlify / Cloudflare Pages (`/s/<slug>/* /s/<slug>/index.html 200`). Для `sw.js` добавьте файл `apps/web/dist/_headers`:

  ```
  /sw.js
    Cache-Control: no-cache
  ```
- **Ограничение Cloudflare Pages** (по документации Cloudflare на момент написания): не больше 100 «динамических» правил с `*`. `tenant:shells` создаёт два таких правила на студию, то есть примерно 49 студий. Студии сверх лимита продолжают работать через общий `index.html`: название, тема и манифест подставляются при загрузке. Пропадают только статические превью ссылок для этих студий. Для большего числа студий нужен Worker / Pages Function с той же логикой перезаписи — **не реализовано**.
- **Не проверено из этой среды** (сеть закрыта): поведение `_redirects` и `_headers` на настоящих Netlify / Cloudflare Pages. Локально те же правила применяет `vite preview`: плагин `studioShells` в `apps/web/vite.config.ts`. На нём `tenant:verify --app-url` проверяет страницы и оболочки.

---

## 5. Студии: конфигурация и публикация

```bash
pnpm tenant:new <slug> --name "Название" [--timezone Europe/Moscow]   # из tenants/_template, статус draft
pnpm tenant:validate [<slug>…|--all]                                  # Zod-схема + ассеты + перекрёстные проверки
pnpm tenant:publish  [<slug>…|--all] [--overwrite] [--reseed-demo] [--reset-demo-password] [--dry-run]
pnpm tenant:verify   [<slug>…|--all] [--app-url=…]                    # реальные запросы к API, медиа, манифестам, страницам
pnpm tenant:shells   [--dist=apps/web/dist]
pnpm tenant:schema                                                    # tenants/business.schema.json для редактора
```

Публикация идемпотентна и не разрушает данные: сущности сопоставляются по стабильным ключам; записи, клиенты, оплаты и загруженные владельцем фото не трогаются; услуги/ресурсы, исчезнувшие из конфига, деактивируются; правки, сделанные владельцем в кабинете, сохраняются (перезаписать — `--overwrite`). Повторная публикация того же конфига ничего не меняет.

Статусы студии: `draft` (не публична), `demo` (публична, записи помечены, **уведомления не отправляются никому**), `live` (рабочая; переход только при выполненных проверках готовности — их же показывает кабинет), `suspended`.

**Удаление студии:** `delete from public.tenants where id = '…'` удаляет все её строки (все таблицы ссылаются на `tenants` с `on delete cascade`, проверено тестом), а объекты Storage под префиксом `<tenant_id>/` удаляются через Storage API (прямое удаление из `storage.objects` Supabase запрещает).

---

## 6. ИИ-помощник

- Работает только в Edge Function `assistant`; ключ и модель — серверные секреты. Без `LLM_API_KEY` помощник отвечает детерминированным роутером намерений (цены, свободное время с кнопками записи, часы, адрес; в кабинете — расписание, окна, клиенты, статистика) и показывает это в интерфейсе.
- `LLM_BASE_URL` — endpoint Anthropic Messages API (по умолчанию `https://api.anthropic.com/v1`) или шлюз перед ним. Модель по умолчанию `claude-opus-5-5`. На первом-стороннем API включён серверный fallback при отказе модели по политике (`fallbacks: "default"`).
- Модель не выбирает студию, SQL, ресурсы, цены и права: у инструментов нет таких параметров; область (клиент / сотрудник) определяется сервером; каждый вызов инструмента проходит Zod-проверку; не больше 6 обращений к модели на вопрос.
- Бюджет на студию в сутки (`tenant_settings.ai_daily_request_limit`, `ai_daily_token_budget`) резервируется атомарно в БД; при исчерпании — шаблонные ответы.
- Запись помощник не создаёт: он показывает кнопку со свободным временем, проверенным сервером; подтверждает человек.

---

## 7. Тесты

```bash
pnpm typecheck && pnpm lint && pnpm test   # unit: core (темы, схема, crypto/Web Push, ICS, ИИ-роутер, время)
pnpm test:db      # SQL-тесты: создают отдельную базу в локальном Postgres
pnpm test:api     # HTTP-тесты через шлюз (нужен запущенный стек); поднимают свои шлюзы :54331/:54332
pnpm test:e2e     # Playwright: клиент записывается → владелец видит запись (нужны стек и шлюз :54321)
pnpm functions:check   # deno check всех функций
```

Тесты ИИ в `test:api` работают против **тестового дублёра** Messages API (`tests/api/fake-llm.ts`): он проверяет логику помощника (цикл инструментов, области, валидацию, бюджет, fallback), но не качество ответов реальной модели.

---

## 8. Устройства и уведомления

- PWA ставится отдельно для каждой студии (свой `id`/`scope`/иконки) и отдельно для кабинета.
- Web Push: Android/десктоп — из браузера; **iPhone — только в установленном приложении** («Поделиться» → «На экран „Домой“», iOS 16.4+), интерфейс говорит это прямо. Статус «уведомления включены» показывается только после реальной подписки, принятой сервером.
- Выход из кабинета очищает кэш кабинета и приватные кэши Service Worker; «Забыть устройство» у клиента удаляет ключ устройства, токены записей, контакты, черновик и историю чата.

---

## 9. Чек-лист перед запуском (production)

**Секреты и доступы**

- [ ] `ACCESS_TOKEN_SECRET`, `DISPATCHER_SECRET`, `VAPID_PRIVATE_KEY`, `LLM_API_KEY` заданы только через `supabase secrets set`, нигде больше.
- [ ] Service role key есть только у функций и у машины оператора.
- [ ] `pnpm security:scan-bundle` прошёл на той сборке, которая выкладывается.
- [ ] `ALLOWED_ORIGINS` содержит точно `APP_URL`: без `*` и без localhost.
- [ ] `TRUSTED_PROXY_HOPS` соответствует реальной цепочке прокси. Иначе rate limit по IP либо считает всех одним клиентом, либо обходится подделкой `X-Forwarded-For`.

**База и Cron**

- [ ] Миграции применены; `select count(*) from supabase_migrations.schema_migrations` совпадает с числом файлов.
- [ ] `pg_cron` и `pg_net` включены. Задания `notify-dispatch` и `housekeeping` видны в `cron.job`. В Vault лежат `project_url` и `dispatcher_secret`.
- [ ] После первой записи в live-студии в `cron.job_run_details` нет ошибок, а в `notification_jobs` статусы уходят из `pending`.

**Auth**

- [ ] Site URL и Redirect URLs указаны (§4.2).
- [ ] SMTP настроен; восстановление пароля проверено на реальном адресе.
- [ ] Публичная регистрация выключена.

**Фронтенд**

- [ ] `tenant:shells` выполнен после последней публикации. `sw.js` отдаётся с `no-cache`.
- [ ] HTTPS включён: без него не работают Service Worker и Web Push.
- [ ] Source maps (`*.map`) публикуются вместе со сборкой. Секретов в них нет (это проверяет scan), но если исходники публиковать не нужно, удалите их перед выкладкой.

**Каждая студия**

- [ ] `tenant:verify <slug> --app-url=<APP_URL>`: 0 failed.
- [ ] Перед переводом в live демо-иллюстрации заменены реальными фото (`demoArtwork: false`); телефон, адрес и часы проверены владельцем.
- [ ] Владелец вошёл в кабинет и сам включил push на своём устройстве. На iPhone — только после «На экран „Домой“».
- [ ] Пробная запись с телефона клиента → уведомление владельцу → отмена.

**ИИ (если включён)**

- [ ] `LLM_API_KEY` и `LLM_MODEL` заданы.
- [ ] Один реальный вопрос в клиенте и один в кабинете получают ответ **без** пометки «Быстрые ответы».
- [ ] Лимиты `ai_daily_request_limit` и `ai_daily_token_budget` выставлены под бюджет студии.

