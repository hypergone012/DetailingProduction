# ACCEPTANCE

Только фактические результаты. Тест считается пройденным, только если он был реально выполнен в этой среде; всё остальное помечено явно.

| | |
|---|---|
| Дата прогона | 2026-10-02 |
| Коммит | ветка `claude/determined-darwin-bj0fq7`, коммит с этим файлом |
| Среда | облачный Linux-контейнер; локальный стек без Docker (SETUP.md §2): Postgres 16, GoTrue, PostgREST 13.0.8, Storage API, Deno-шлюз вместо Kong; Chromium 1194 (Playwright 1.56.1) |
| Нет в среде | Docker, `pg_cron` / `pg_net`, доступ к `api.supabase.com` и хостингам, ключ LLM, VAPID-ключи реального проекта, физические устройства |

---

## 1. Passed

### 1.1 Финальный gate

| Команда | Результат |
|---|---|
| `pnpm typecheck` (TS strict, 4 проекта) | ✅ exit 0 |
| `pnpm lint` | ✅ exit 0 |
| `pnpm test` — unit | ✅ 95 passed (11 файлов) |
| `pnpm test:db` — SQL против настоящего Postgres 16 | ✅ 82 passed (8 файлов) |
| `pnpm test:api` — HTTP: шлюз → Deno-функции → PostgREST → Postgres / GoTrue / Storage | ✅ 23 passed (3 файла) |
| `pnpm functions:check` — `deno check` всех Edge Functions | ✅ exit 0 |
| `pnpm build` — production-сборка | ✅ exit 0 |
| `pnpm tenant:shells` | ✅ 1 студия (GRAPHITE; VERDE удалена 2026-10-02) + `_redirects` |
| `actionlint .github/workflows/deploy.yml` | ✅ без ошибок |
| `pnpm security:scan-bundle` | ✅ нет секретов в 203 файлах сборки (оболочки `dist/s/` собраны из публичного API и в проверку секретов не входят); нет названий студий в 299 файлах кода и сборки |
| `pnpm tenant:verify --all --app-url=http://127.0.0.1:4173` (vite preview) | ✅ 11 passed, 0 failed, 0 warnings, 0 skipped (одна студия) |
| `pnpm test:e2e` — Playwright, Pixel 7 / Chromium | ✅ 1 passed |

### 1.2 Требования → проверки

Файлы тестов: `tests/db/*.test.ts`, `tests/api/*.test.ts`, `tests/e2e/booking.spec.ts`, `packages/core/src/**/*.test.ts`.

| Требование | Чем проверено |
|---|---|
| Миграции применяются | `pnpm db:migrate` на dev-базе; `test:db` создаёт отдельную базу и применяет все миграции с нуля. Изменённая уже применённая миграция → `db:migrate` падает. |
| Seed работает | `money-stats` › «completed work, payments and averages come from SQL…»: история через `api_admin_seed_demo`, повторный вызов → `already_seeded`. Dev-база после `tenant:publish`: GRAPHITE — 10 демо-клиентов и 26 демо-записей (VERDE до удаления — 6 и 13); `tenant:verify`: 209 свободных слотов на 14 дней, владелец есть, демо ничего не отправляло. |
| Конкуренция за слот | `booking-engine` › «two clients racing for the last slot: exactly one wins»; «a burst of 12 parallel requests for one slot creates one booking per free resource»; «the exclusion constraint holds even for direct inserts that bypass the engine» |
| Два ресурса | `booking-engine` › «two compatible resources serve the same slot; the third request fails» |
| Многодневная занятость | `booking-engine` › «spreads work over working days and occupies the bay continuously»; «skips closed days inside a multi-day job» |
| Буфер | `booking-engine` › «blocks the resource until end + buffer»; «applies the buffer before the work as well» |
| Рабочие часы, ночные окна | `booking-engine` › «offers slots only inside working hours and refuses bookings outside them»; «supports split shifts and overnight windows»; «respects minimum notice and booking horizon» |
| Исключения (выходной, короткий день) | `booking-engine` › «a closed day offers nothing and refuses bookings»; «a short day uses the exception hours» |
| Часовой пояс и DST | `booking-engine` › «computes availability in the tenant timezone»; «stays on local wall-clock time across a DST change»; `zoned.test` (сверено с `AT TIME ZONE` PostgreSQL) |
| Блокировка ресурса | `booking-engine` › «a manual block conflicts with bookings in both directions»; `owner-reads` › блоки в календаре |
| Перенос атомарен | `lifecycle` › «moves atomically: new occupancy active, old released, history and outbox written»; «can shift by 30 minutes into its own previous interval» |
| Неудачный перенос сохраняет запись | `lifecycle` › «a failed move keeps the original booking and occupancy untouched»; «a move outside working hours fails and keeps the booking» |
| Идемпотентность | создание: `lifecycle` › «a retried request returns the same booking…», «the same key with a different payload is rejected», «concurrent duplicates with one key create one booking», «a failed attempt does not burn the key»; перенос: «reschedule is idempotent per key…»; отмена: «…is idempotent»; выдача доступа: `webpush.test` › «capability tokens are deterministic per scope»; создание из кабинета: `owner-reads` › «owner_create_booking idempotency»; уведомления: `outbox` › «deliveries are never duplicated»; публикация: `publish` › «republishing the same config changes nothing»; HTTP: `public-api` › «create -> retry -> view -> reschedule -> calendar -> cancel» |
| Историческая цена | `lifecycle` › «changing the service price never rewrites existing bookings»; «an owner price adjustment is recorded as a separate line»; «reschedule options use the booking snapshot» |
| Клиент не управляет ценой, тенантом, ресурсом | `booking-engine` › «prices by body type and add-ons on the server», «rejects add-ons of another tenant», «never accepts a service id from another tenant»; `public-api` › «rejects bad input with precise codes» (Zod strict) |
| Платежи: будущие деньги ≠ выручка | `money-stats` › «future booking value is never counted as received revenue»; «completed work, payments and averages come from SQL»; staff не видит денег: `security` › «staff cannot read payments; managers can», `owner-reads` › «staff see no money» |
| Изоляция тенантов (RLS) | `security` › «owner of A sees only A in every table», «owner of A cannot act on B through owner RPCs», «a user with no membership sees nothing», «anon can read no table and execute no function», «privileges match the declared model exactly», «RLS is enabled on every public table…», «every tenant-owned table carries tenant_id»; `owner-reads` › «is tenant-isolated»; `publish` › «publishing tenant B leaves tenant A byte-for-byte unchanged»; `tenant:verify` › cross-studio isolation |
| Токен доступа: в БД нет plaintext | `security` › «no plaintext token or device key is stored anywhere»; «a token works only for its booking and its tenant»; `public-api` › «a token never opens another booking or another studio» |
| Удаление студии | `security` › «every tenant-owned table references its tenant with on delete cascade»; «deleting a studio removes all of its rows… and nothing of other studios» |
| Outbox: создание, lease, без дублей | `outbox` › все 6 тестов (lease эксклюзивен и истекает, просроченный lease забирает другой воркер, max attempts, недоставляемые задания не прячут доставляемые); `dispatcher` › реальная доставка зашифрованного Web Push по HTTPS на локальный push-сервис, 410 → подписка отключается, повторно не отправляется |
| Demo никогда не уведомляет | `outbox` › «…demo tenants suppress all»; `dispatcher` › «a demo studio never delivers anything»; `tenant:verify` › «demo never notifies» |
| Rate limit и бюджет ИИ атомарны в БД | `limits` › «a burst of parallel requests never exceeds the daily request limit» (24 параллельных при лимите 5 → ровно 5; до миграции `…015` проходило 8), «stops when the token budget is spent, and studios do not share budgets», «only the service role can reserve or record»; «count hits atomically per bucket and key»; HTTP: `public-api` › «rate-limits booking creation per IP with Retry-After» |
| ИИ: области client / owner | `tools.test` › «client and owner scopes are disjoint where it matters», «an owner tool requested in the client scope is refused before validation», «inputs are validated strictly: no extra fields (tenant, price, resource)»; `assistant` (HTTP) › «runs the tool loop inside the client scope and refuses owner tools», «validates requests and keeps owner data behind sign-in and membership», «owner scope reads the schedule of its own studio» |
| ИИ: ограниченный цикл, fallback, JSON-intent роутер | `assistant` › «stops after a bounded number of model calls», «falls back honestly when the LLM fails, and when the daily budget is spent», «a proposed booking is checked against real availability…»; режим без LLM: «turns a booking request into real free slots…», «answers prices, hours and unknown questions without inventing anything»; роутер отдельно: `intent.test`, `dates.test` |
| Сценарий Playwright | `tests/e2e/booking.spec.ts`: открыть студию → услуга → авто → слот → подтвердить → «Вы записаны» и номер → карточка записи → **отдельный браузерный профиль**: вход владельца → клиенты → карточка → лист записи (номер, статус, авто) → запись на своём дне в календаре |
| Конвейер студий | `tenant:new` → правка конфига → `validate` → `publish` (дважды: второй раз `no changes`) → `verify` 11/11 → вход владельца в Chromium → удаление студии. Замер в CLONE-IN-6-MINUTES.md. Республикация не трогает данные: `publish` › «republishing never destroys runtime data and keeps owner edits» |
| Правки владельца переживают Deploy | `publish` › «republishing never destroys runtime data and keeps owner edits» (изменённая услуга не перезаписывается); «a photo or day off the owner deleted stays deleted after republishing» — без миграции …017 тест падал (фото и выходной возвращались); `--overwrite` возвращает конфигурацию. Режим работы публикация не понижает (`api_admin_publish_tenant`, только draft→demo/live и demo→live). |
| Удаление ненужной студии | `publish` › «removes a demo studio with everything it holds and leaves other studios unchanged» (другая студия — побайтно без изменений; повтор — `found: false`), «a studio that is or ever was live is never removed», «a member who also belongs to another studio is not an orphan». На локальном стеке с настоящими Storage и GoTrue: `tenant:remove verde` — 13 записей, 6 клиентов, 30 файлов, 1 вход удалены; повтор — «удалять нечего»; GRAPHITE — 35 файлов, 27 записей на месте; `/s/verde/` показывает «Студия не найдена». |
| Второй тенант не ломает первый | `publish` › «publishing tenant B leaves tenant A byte-for-byte unchanged»; `tenant:verify --all` по обеим демо-студиям |
| Нет секретов во фронтенде | `security:scan-bundle`: значения серверных секретов, JWT с ролью ≠ anon, приватные ключи, ключи API во всех файлах сборки, включая source maps. Отдельно проверено, что подложенный service-role ключ даёт exit 1. |
| White-label: нет названий студий в коде | `security:scan-bundle` (названия и slug всех студий в общем коде и сборке); eslint-правило против сравнений со slug |
| Темы: 7 семейств, контраст | `presets.test`: WCAG-контраст текста, акцентов, фокуса и статусов (в т. ч. статус на собственном фоне бейджа поверх каждого слоя) для всех 7 тем; без «кислотных» цветов; бренд-акцент меняет только акцентные токены |
| PWA и манифесты на студию | `tenant:verify`: манифесты client и owner (`id`, `scope`, `start_url`, иконки 192/512/maskable, apple-touch-icon), статические оболочки на студию |

### 1.3 Ручные проверки в браузере (Chromium, Playwright-скрипты вне репозитория, 2026-10-02)

| Сценарий | Результат |
|---|---|
| Клиент: записался → карточка записи → **перенёс** (на 5-й день с местами) → «Запись перенесена» → **отменил** → «Отменена» → история показывает отменённую запись → повторная запись с сохранёнными контактами и авто | пройдено, ошибок консоли нет |
| Перенос или отмена меньше чем за 24 ч | кнопок нет, показано «…можно по телефону студии» (корректно) |
| Владелец: вход → «Сегодня» → календарь дня → лист записи (клиент, авто) → **перенос** на другое время (изменение `starts_at` проверено в БД) → **блокировка бокса** из календаря (появилась в дорожке) → статистика на «Сегодня» → клиенты → карточка → авто | пройдено, ошибок консоли нет |
| Клавиатура: главная → «Выбрать услугу и время» → услуга → марка и модель → тип кузова → время → подтверждение; рамка фокуса видна на каждом шаге; Escape закрывает лист; фокус возвращается на кнопку, открывшую лист (клиент, помощник, кабинет) | пройдено (после исправления возврата фокуса, см. 1.4) |
| axe-core 4.13 (WCAG 2.0/2.1/2.2 A/AA + best-practice), по 17 экранов в GRAPHITE (тёмная тема) и VERDE (светлая): главная, услуги, карточка услуги, гараж, история, профиль, 3 шага записи, вход в кабинет, «Сегодня», календарь, лист записи, клиенты, услуги, расписание, студия | **0 нарушений** (после исправлений из 1.4) |
| Ранее (этапы 5–8): обе студии на 390×844; кабинет на 390×844 и 1280; чат помощника в клиенте и кабинете в режиме без LLM | пройдено, см. IMPLEMENTATION-STATUS.md |
| Клиентская часть на ПК и планшете: 1440×900, 1024×768, 820×1180 (меню сверху, две колонки на главной с 1024 px), 390×844 без изменений | пройдено; axe-core: **0 нарушений** на 20 страницах (5 экранов × 2 студии × ПК/планшет) |
| «Ссылка для клиентов» в кабинете: QR-код **декодирован независимым декодером** (jsQR) и с экрана, и из скачанного PNG — ровно адрес студии; «Скопировать» кладёт адрес в буфер (проверено чтением буфера); телефон и ПК | пройдено, ошибок консоли нет |
| Карточка «Установить приложение» у клиента: кнопка браузера, где он её даёт; иначе шаги для iPhone / Android / ПК (раньше на Android без системного запроса и на ПК карточка пропадала) | проверено в Chromium (эмуляция телефона и ПК); установка на реальных устройствах — §6 |

### 1.4 Найдено при приёмке и исправлено (с проверкой)

| Проблема | Исправление | Проверка |
|---|---|---|
| Гонка бюджета ИИ: 8 из 24 параллельных запросов проходили при лимите 5 | `…015_ai_budget_lock`: advisory-lock на студию | `limits` › «is atomic…» |
| Статусный текст на собственном фоне бейджа ниже 4.5:1 в 5 из 7 тем (например, «Демо» в VERDE — 4.27:1) | `buildTokens` подстраивает цвет статуса под каждый слой фона | новый тест в `presets.test` (падал на старых токенах), axe |
| Дорожка календаря `role=button` содержала кнопки записей (вложенные интерактивные элементы) | дорожка — только указательный жест; с клавиатуры есть кнопка «Запись» | axe |
| Мелкий текст карточки календаря 3.29:1; подписи дней на выбранной дате 4.48:1 | более контрастные токены | axe |
| Ленты фото прокручивались, но были недоступны с клавиатуры | `role=region`, `aria-label`, `tabIndex=0`, рамка фокуса | axe |
| Скрытые поля загрузки файлов без подписи | `aria-label` | axe |
| Не было landmark `<main>` | основной контент клиента и кабинета обёрнут в `<main>` | axe, Playwright |
| После закрытия листа фокус уходил в `<body>` | `useReturnFocus` | клавиатурный скрипт |
| `tenant:shells` оставлял в `dist` оболочку удалённой студии | удаляет оболочки неопубликованных slug | повторный `tenant:shells` после удаления |
| Кабинет предлагал «Начать работу», «Завершить» и «Не приехал» для записи, до которой больше 12 ч: SQL всегда отвечал `TOO_EARLY` (мёртвые кнопки) | действия показываются по тому же правилу, что в SQL | `labels.test` (граница 12 ч), скриншот листа записи |

---

## 2. Failed

Нет: на момент прогона (2026-10-02) ни одна выполненная проверка не падает. Всё, что падало в ходе приёмки, исправлено и перепроверено (§1.4).

---

## 3. Skipped

| Что | Почему |
|---|---|
| Lighthouse / Web Vitals | не запускался. Размеры начальной загрузки измерены по сборке (IMPLEMENTATION-STATUS.md, этапы 5–6), но это не замер производительности на устройстве. |
| `supabase start` / `supabase db push` (Supabase CLI) | **NOT RUN — Docker недоступен.** Миграции хранятся в формате CLI; применялись `pnpm db:migrate` к локальному Postgres. |
| Ручная проверка скринридерами (VoiceOver, TalkBack) | **NOT RUN.** Автоматический axe покрывает только часть WCAG; семантика (роли, подписи, live-регионы) используется Playwright-локаторами, но реальным скринридером не прослушана. |

---

## 4. External dependency

| Что | Статус |
|---|---|
| Выкладка в hosted Supabase (миграции, секреты, функции) | ✅ выполнена кнопкой Deploy (строка ниже); из среды разработки напрямую — по-прежнему закрыто сетью. |
| Кнопка выкладки GitHub Actions **Deploy** (`.github/workflows/deploy.yml`) на аккаунтах владельца | ✅ **PASSED — запуск 6, 2026-10-02** ([run 37039517466](https://github.com/hypergone012/DetailingProduction/actions/runs/37039517466)). Сайт: `https://detailing-studio-6wl.pages.dev` (имя занято — Cloudflare добавил суффикс, кнопка прочитала его сама). Выполнено: проверка секретов и подключения к базе; `pg_cron` и `pg_net`; 16 миграций (в запуске 5; в 6 — «up to date»); секреты сохранены в Vault и при повторном запуске не перегенерированы; Cron `notify-dispatch` (каждую минуту) и `housekeeping` (ежедневно); 4 Edge Functions; Auth (site URL, redirect, регистрация выключена); публикация GRAPHITE и VERDE; сборка, оболочки, проверка сборки на секреты; Cloudflare Pages; `tenant:verify --all --app-url` против живого сайта — **23 passed, 0 failed**. Найдено по ходу запусков 1–5 и исправлено: Account ID с лишними символами, пароль с `@` и `/` в строке подключения, ручная подстановка пароля (теперь отдельный секрет `SUPABASE_DB_PASSWORD`), кратковременные отказы пулера после смены пароля (повторы). |
| Доступность `supabase.co` / `pages.dev` из российских сетей | **NOT RUN — проверить отсюда нельзя.** В 2025 году сообщалось о блокировках и замедлениях у части провайдеров; проверка с мобильного интернета без VPN — в DEPLOY-IN-BROWSER.md, часть 7. |
| Cloudflare Pages / Netlify: `_redirects`, `_headers`, оболочки студий | **NOT RUN — хостинги закрыты сетевой политикой.** Те же правила локально применяет `vite preview` (`studioShells`), проверено `tenant:verify --app-url`. |
| Удаление VERDE из продакшена (Deploy с `remove_studios = verde`) и миграции …017–018 на проекте владельца | **NOT RUN — ждёт запуска Deploy владельцем.** Локально проверено (строки «Удаление ненужной студии» и «Правки владельца переживают Deploy» выше). |
| Supabase Cron (`pg_cron` + `pg_net`) → диспетчер уведомлений | ✅ расширения включены и задания созданы на проекте владельца (запуск 6). **NOT RUN:** реальная доставка push на устройство (нужен телефон с установленным приложением). Сам диспетчер проверен прямым HTTP-вызовом (`dispatcher` › 3 теста). |
| Реальные фото студий | **NOT RUN — фотохостинги закрыты сетью.** Демо-студии на сгенерированных иллюстрациях с `demoArtwork: true`; live с ними запрещён схемой и SQL. |
| Push-сервисы браузеров (FCM, Mozilla autopush, Apple) | **NOT RUN — сеть.** Шифрование (RFC 8291) и VAPID (RFC 8292) проверены расшифровкой ключом подписчика и доставкой на локальный HTTPS push-сервис. |

---

## 5. Credentials required

| Что | Статус |
|---|---|
| Живой вызов LLM (Anthropic Messages API через официальный SDK) | **NOT RUN — missing LLM_API_KEY.** Цикл инструментов, области, Zod-валидация, лимит шагов, бюджет и fallback проверены против **тестового дублёра** Messages API (`tests/api/fake-llm.ts`). Это **не интеграционный тест** с реальной моделью: качество ответов и совместимость с текущим API модели не проверены. Режим без LLM (детерминированный роутер) проверен полностью. |
| VAPID-ключи и `DISPATCHER_SECRET` боевого проекта | **NOT RUN — нет проекта.** Локально ключи генерируются `pnpm stack:env` / `pnpm push:vapid`. |
| SMTP (письма восстановления пароля и приглашения) | **NOT RUN — нет SMTP.** Кабинет честно сообщает, если письмо не отправлено. `tenant:publish` для не-демо студии печатает одноразовую ссылку владельцу. Её генерация через GoTrue Admin API (`generate_link`, type `recovery`, `redirect_to` на кабинет студии) выполнена вручную на локальном стеке; переход по ссылке и установка пароля в браузере не проверялись. |

---

## 6. Device-only checks

| Что | Статус |
|---|---|
| Установка PWA на iPhone («На экран „Домой“») и Web Push в standalone-режиме (iOS 16.4+) | **NOT RUN — physical iPhone standalone verification unavailable.** |
| Установка PWA и push на Android (Chrome) | **NOT RUN — нет физического устройства.** В эмуляции Chromium (Pixel 7) проверены интерфейс и сценарии, но не установка и не системные уведомления. |
| Безопасные зоны (вырез, home indicator), жесты «назад» на iOS / Android | **NOT RUN — нужны устройства.** Отступы заданы через `env(safe-area-inset-*)`; системная «Назад» проверена в Chromium через history. |
| Офлайн-поведение установленного приложения | **NOT RUN на устройстве.** Стратегия кеша Service Worker проверена по коду и сборке (приватные API — NetworkOnly). |

---

## 7. Unresolved issues

| Что | Влияние |
|---|---|
| iOS splash-экраны (`apple-touch-startup-image`) не генерируются | при запуске установленного приложения на iPhone — фон без заставки студии. Иконки, манифест и `theme-color` на студию есть. |
| Cloudflare Pages: глубокие ссылки (`/s/<slug>/services/…`) отдаются общим `index.html` | название, тема и манифест подставляются, когда приложение загрузится; превью ссылки в мессенджере для таких адресов — общее. Главная студии и кабинет (`/s/<slug>/`, `/s/<slug>/owner/`) получают свою оболочку (SETUP.md §4.5). |
| Канал уведомлений — только Web Push | SMS и email клиентам не отправляются: не реализовано. Клиент без push видит изменения в карточке записи и в ICS. |
| Перенос клиентом на время ближе срока отмены | разрешён, если время свободно и проходит минимальный запас, но после этого запись нельзя изменить онлайн. Поведение корректно по правилам, однако интерфейс переноса заранее об этом не предупреждает. |
| `IMPLEMENTATION-PLAN.md` | отсутствует во всех доступных репозиториях; этапы 1–8 восстановлены из мастер-промпта (IMPLEMENTATION-STATUS.md §0). Если план существует — этапы нужно сверить с ним. |
