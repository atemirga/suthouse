# SUT HOUSE — Финансовая аналитика (`suthouse-finance`)

Веб-платформа управленческого учёта и аналитики для SUT HOUSE: подтягивает данные из
**1С:УНФ для Казахстана (1.6)** по OData, хранит их в PostgreSQL и строит поверх них
отчёты — ОПиУ (P&L), ДДС, баланс, дебиторка/кредиторка, продажи (ABC/XYZ/воронка),
остатки, сверка банковской выписки и др. Дополнительно есть Telegram-бот и MCP-сервер
для доступа из claude.ai.

> Учёт ведётся с 2026-01 (нижняя граница синка), таймзона данных — **Asia/Almaty (UTC+5)**.

---

## 1. Назначение (ТЗ)

Дать собственнику и менеджменту единую панель с «живыми» цифрами из 1С без ручного
Excel: прибыль по методу начисления, движение денег, задолженности, аналитика продаж и
запасов, а также сверку фактических поступлений Kaspi с проведёнными в 1С оплатами.

Ключевые принципы:
- **Источник истины — 1С** (OData), приложение только читает и агрегирует; записи в 1С нет.
- **Себестоимость — фактическая, по FIFO** из регистра запасов 1С (не по платежам поставщикам).
- **ОПиУ в двух видах**: внутренний («стандартный») и «финансистский» (сверен с эталоном финансиста).
- **Метод начисления** для ФОТ (по `ПериодРегистрации`) и амортизации (из Google Sheets).
- Все суммы и даты приводятся к **Asia/Almaty**.

---

## 2. Технологии

| Слой | Технология |
|---|---|
| Фронтенд/SSR | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Recharts |
| Бэкенд | Next.js API Routes (Node), Prisma 5 ORM |
| БД | PostgreSQL |
| Интеграции | 1С OData (`standard.odata`), Google Sheets API (`googleapis`), SheetJS (`xlsx`) |
| Фон | `node-cron` (синхронизация), `tsx` (запуск TS без сборки) |
| Среда | Node.js 20 |

---

## 3. Архитектура

```
                ┌──────────────────────────────────────────────┐
   1С:УНФ KZ ──▶│  OData (Basic Auth)  ─── src/lib/odata.ts     │
   (standard.   │                                              │
    odata)      │   cron-воркер (suthouse-cron, */30 9–23 ALA) │
                │   src/lib/cron.ts → src/lib/sync/* (upsert)  │
                └───────────────┬──────────────────────────────┘
                                ▼
                        PostgreSQL (Prisma)
                                ▲
   Google Sheets ─▶ src/lib/sync/{amortization,fixed-assets-sheet}.ts
                                ▼
        ┌───────────────────────────────────────────────┐
        │ Next.js (suthouse-app, :3007)                  │
        │  src/lib/reports/*  →  API /api/*  →  app/*/page│
        └───────────────────────────────────────────────┘
                                ▲
        Telegram-бот (suthouse-bot)   MCP-сервер (suthouse-mcp → claude.ai)
        источники: API → БД → 1С      read-only 1С OData
```

Поток данных: **1С OData → sync (upsert в Postgres) → reports (агрегация) → API → страницы**.
Каталоги/документы синкаются по окну `SYNC_DAYS_BACK` (по умолч. 60 дней) с нижней границей
`SYNC_SINCE_DATE`. Удалённые/распроведённые в 1С документы **удаляются** из БД (purge stale).

---

## 4. Функционал (разделы)

Навигация (`src/components/Sidebar.tsx`) сгруппирована:

### Деньги
- **Дашборд** (`/`) — сводка KPI, спарклайны, календарь продаж, авто-обновление 60с.
- **ДДС-Отчёт** (`/dds`) — операционная/инвестиционная/финансовая деятельность.
- **ДДС по кассам** (`/dds/by-kassa`) — остатки и обороты по кассам/счетам (учёт перемещений с обеих сторон).
- **Платежи** (`/payments`) — реестр банковских и кассовых платежей.
- **Сверка выписки** (`/vypiska`) — загрузка Excel/CSV выписки Kaspi, дневная сверка «Продажи с Kaspi.kz» с оплатами в 1С, drill-down, CSV.

### Прибыль
- **ОПиУ (P&L)** (`/opiu`) — отчёт о прибылях и убытках по методу начисления; вид «финансист».
- **Структура расходов** (`/expenses`) — расходы по категориям.
- **Скидки** (`/discounts`) — предоставленные скидки, подсветка > 1.1%.

### Продажи
- **ABC** (`/sales/abc`), **XYZ** (`/sales/xyz`) — A/B/C по выручке/марже, стабильность спроса по CV.
- **По категориям** (`/sales/by-category`), **По SKU и менеджерам** (`/sales/by-sku`).
- **Воронка** (`/sales/funnel`) — по источникам привлечения.
- **Заказы менеджеров** (`/sales/by-manager`), **Упаковщики** (`/packers`).
- **Планы продаж** (`/sales/plans`), **План-факт** (`/sales/plan-fact`).

### Запасы
- **Остатки товаров** (`/inventory/balances`) — на дату, по складам.

### Расчёты
- **Баланс** (`/balance`) — активы/пассивы/капитал на дату.
- **Дебиторка** (`/receivables`) — AR aging (FIFO-погашение отгрузок платежами).
- **Кредиторка** (`/payables`).

### Операционные / Настройки
- **Аномалии** (`/anomalies`) — ошибки данных, подозрительные документы.
- **Настройки** (`/settings/*`) — маппинг статей ДДС→категории ОПиУ, accrual-правила, основные средства, ручные корректировки, статус синка.

---

## 5. Структура проекта

```
src/
├── app/                         # Next.js App Router
│   ├── <раздел>/page.tsx        # ~28 страниц (SSR + клиент)
│   ├── api/<endpoint>/route.ts  # ~40 API-роутов (GET-отчёты, POST-действия, export, auth)
│   ├── layout.tsx, globals.css
│   └── login/
├── components/                  # *Client.tsx, OpiuTable, PeriodPicker, Sidebar, Modal, Icons…
├── lib/
│   ├── reports/                 # бизнес-логика отчётов (см. §7)
│   ├── sync/                    # синхронизация с 1С/Sheets (см. §6)
│   ├── odata.ts                 # OData-клиент (fetchAllOData, dateFilter, POSTED_FILTER)
│   ├── db.ts                    # singleton PrismaClient
│   ├── dates.ts                 # парсинг периода как Asia/Almaty (+05:00)
│   └── auth.ts, csv.ts, presentation.ts, cron.ts
prisma/
├── schema.prisma                # ~30 моделей
└── migrations/
scripts/                         # утилиты: sync-*, audit-*, compare-financist, probe-*, verify-sync
suthouse-bot/                    # Telegram-бот (Python, отдельный процесс)
```

---

## 6. Синхронизация с 1С (`src/lib/sync/`)

Оркестратор — `index.ts` (логирует в `SyncLog`, `Promise.allSettled`). Запуск:
- **Постоянно**: `suthouse-cron` → `cron.ts`, расписание `*/30 9-23 * * *` (Asia/Almaty).
- **Вручную**: `npm run sync [-- --days=30] [--skip-catalogs]`, `npm run sync:catalogs`.

| Модуль | Что синкает |
|---|---|
| `catalogs.ts` | справочники: контрагенты, статьи ДДС, номенклатура, кассы, счета, сотрудники, источники |
| `realizacii.ts` | реализации (продажи) + позиции |
| `zakupki.ts` | закупки (поступления товаров) + позиции; карта последних закуп. цен |
| `dds.ts` | денежные документы (поступления/расходы по кассе/счёту, перемещения) |
| `orders.ts` | заказы покупателей + позиции + состояния |
| `inventory.ts` / `inventory-balances.ts` | движения и остатки запасов |
| `fact-cost.ts` / `fifo.ts` | фактическая себестоимость из регистра запасов, FIFO-расчёт |
| `openings.ts` | входящие остатки (дебиторка/запасы) на дату начала учёта |
| `amortization.ts` / `fixed-assets-sheet.ts` | амортизация и ОС из Google Sheets («Ведомость») |
| `sales-plans.ts`, `month-close.ts` | планы продаж, закрытие месяцев |

**Purge stale**: после загрузки `realizacii/zakupki/dds` документы, которых больше нет
среди проведённых в 1С (распроведены/удалены), удаляются из БД — иначе завышали отчёты
(`utils.ts: computeStaleIds`).

---

## 7. Отчёты (`src/lib/reports/`)

`dashboard`, `opiu`, `dds`, `dds-by-kassa`, `payments`, `expenses`, `discounts`, `abc`,
`xyz`, `sales-by-category`, `sales-by-sku`, `funnel`, `orders-by-manager`, `packers`,
`plan-fact`, `inventory`, `balance`, `cash-balances`, `receivables`, `payables`,
`anomalies`, `vypiska-recon`. Общие хелперы периода — `period.ts`.

### Ключевая бизнес-логика
- **Себестоимость (COGS)** — фактическая FIFO из регистра запасов 1С (не из платежей; статья
  «1.03 Оплата поставщикам» в расчёт не идёт).
- **ОПиУ — два вида** (`opiu.ts`): «стандартный» (наши категории) и «финансистский» (7 групп
  статей, accrual ФОТ, благотворительность; сверен с эталоном финансиста). Дашборд и страница
  ОПиУ могут расходиться, т.к. используют разные методики.
- **Дебиторка** (`receivables.ts`) — AR aging: FIFO-погашение отгрузок поступлениями по
  контрагенту + входящие остатки; корзины 0–7/8–14/15–30/31–60/61+ дней.
- **Сверка выписки** (`vypiska-recon.ts`) — парсинг Excel/CSV выписки Kaspi (SheetJS, сырые
  числа US-формата), матчинг по **бизнес-дате «за DD/MM»** против оплат на счёте «Kaspi PAY (KZT)».
- **Метод начисления** — ФОТ по `accrualPeriod` (ПериодРегистрации), амортизация помесячно из Sheets.

---

## 8. Модель данных (Prisma, ~30 моделей)

- **Справочники**: `Kontragent`, `AttractionSource`, `DdsArticle`, `Nomenclature`,
  `NomenclatureCategory`, `Kassa`, `BankAccount`, `User1C`, `Employee`.
- **Документы**: `DdsDocument` (ДДС), `Realizacia`/`RealizaciaItem` (продажи),
  `Zakupka`/`ZakupkaItem` (закупки), `OrderBuyer`/`OrderBuyerItem` (заказы),
  `WriteOff`/`WriteOffItem`/`Correspondence` (списания), `Capitalization`/`CapitalizationItem`.
- **Учётные/настроечные**: `AccrualRule`, `FixedAsset`, `ManualAdjustment`, `OpeningBalance`,
  `InventoryBalance`, `InventoryOpening`, `SalesPlan`, `MonthClose`, `SyncLog`.

`DdsDocument` ключевые поля: `docType`, `direction` (inflow/outflow/transfer), `date`,
`amount`, `kontragentName`, `accountName`/`kassaName`, `articleId`, `accrualPeriod`, `posted`.

---

## 9. Сервисы (systemd)

| Сервис | Что | Запуск |
|---|---|---|
| `suthouse-app` | Next.js (web + API), порт **3007** | `next start -p 3007` |
| `suthouse-cron` | фоновая синхронизация с 1С | `node --import tsx src/lib/cron.ts` |
| `suthouse-mcp` | MCP-сервер (read-only 1С OData) для claude.ai | `/opt/suthouse-mcp/.venv/bin/python server.py` |
| `suthouse-bot` | Telegram-бот (aiogram + Qwen) | `suthouse-bot/.venv/bin/python bot.py` |

Перед приложением — обратный прокси (nginx, HTTPS). Управление:
`sudo systemctl restart suthouse-app` (после `npm run build`).

---

## 10. Переменные окружения (`.env`, не в git)

| Переменная | Назначение |
|---|---|
| `ODATA_URL`, `ODATA_LOGIN`, `ODATA_PASSWORD` | доступ к 1С OData |
| `DATABASE_URL` | строка подключения PostgreSQL (Prisma) |
| `SYNC_DAYS_BACK` (60), `SYNC_SINCE_DATE`, `SYNC_INTERVAL_MINUTES`, `TIMEZONE` | параметры синка |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`, `AMORTIZATION_SHEET_ID` | Google Sheets (амортизация/ОС) |
| `ADMIN_USER`, `ADMIN_PASSWORD_HASH`, `AUTH_SECRET`, `SESSION_DAYS` | авторизация |
| `NEXT_PUBLIC_PRESENTATION_MODE` | режим презентации — маскирует видимые цифры на 9 |
| `NODE_TLS_REJECT_UNAUTHORIZED` | для self-signed 1С |

Секреты в репозиторий **не коммитятся** (`.env`, `.env.local`, `.gcp-amort-sa.json`,
файлы выписок, `.claude/` — в `.gitignore`).

---

## 11. Команды

```bash
npm install                 # зависимости (+ prisma generate)
npm run dev                 # дев-сервер (PORT по умолч. 3000)
npm run build && npm start  # прод-сборка/запуск (heap: NODE_OPTIONS=--max-old-space-size=4096)
npm run sync                # ручная синхронизация (60 дней)
npm run sync -- --days=30   # за N дней
npm run sync:catalogs       # только справочники
npm run cron                # запуск cron-воркера локально
npx prisma migrate deploy   # применить миграции
```

---

## 12. Сопутствующие проекты

- **`suthouse-bot/`** — Telegram-бот (Python, aiogram + Qwen LLM/ASR). Источники данных в
  приоритете: готовые отчёты API → прямой SQL к Postgres → 1С OData (fallback).
- **`/opt/suthouse-mcp/`** — MCP-сервер (Python) для claude.ai: read-only инструменты к 1С
  (финансы, продажи, запасы, долги). Живёт вне этого репозитория.

---

## 13. Особенности и важные нюансы

- **Таймзона**: 1С отдаёт наивные даты — трактуем как Asia/Almaty (+05:00) и храним в UTC
  (`utils.ts: parseDate`, `dates.ts`). Группировки по дню — по Almaty.
- **Себестоимость** берётся из регистра запасов (factCost), а не из FIFO-приближения по
  закупочным ценам — после синка вызывается пересчёт.
- **Режим презентации**: `NEXT_PUBLIC_PRESENTATION_MODE=1` маскирует цифры на экране (payload
  и БД остаются реальными); требует пересборки.
- **Известные расхождения методик**: дашборд (стандартный ОПиУ) и страница ОПиУ
  (финансистский вид) считают прибыль по-разному; «1.05 Таможенные расходы» в финансистском
  виде/эталоне не учитывается (вычитается только в стандартном).
