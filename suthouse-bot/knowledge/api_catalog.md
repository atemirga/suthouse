# Каталог API Suthouse — для бота (через `use_api`)

База: `APP_BASE_URL` + `/api/<endpoint>`. Все эндпойнты — GET (бот read-only).
Авторизация — cookie `suthouse_auth`, подписывается автоматически модулем `core/api.py`.

Если в колонке «Параметры» написано «—», endpoint без параметров.

---

## Главные дашборды и сводки

| endpoint | Параметры | Что возвращает (ключевые поля) |
|---|---|---|
| `dashboard` | `from`, `to`, `granularity` (day/week/month) | KPI: revenue, profit, cashFlow, deltas, серии по периодам, topCustomers, topProducts, receivablesAging, cashPositions |
| `opiu` | `from`, `to`, `granularity`, `drill` (категория ОПиУ) | `columns[]`, `rows[]` (см. коды ниже), `totals[period]`, `grandTotal`, `columnsMeta`. С drill — список документов категории |
| `dds` | `from`, `to`, `granularity`, `kassa`, `account`, `article`, `kontragent`, `q` | `columns[]`, `rows[]` (section, direction, articleName, values{}, total). Кассовый метод |
| `dds/by-kassa` | `from`, `to` | По каждой кассе/счёту: opening, inflow, outflow, closing |
| `balance` | `asOf` | Управленческий баланс: assets (cash, inventory, receivables, ОС) и liabilities (payables, авансы) |

### Структура `/api/opiu` — ключевые коды строк

В `rows[*].code` встречаются следующие строки (по этим именам LLM находит нужный показатель):

| code | label | смысл |
|---|---|---|
| `fin_revenue_net` | Выручка нетто | revenue − скидка |
| `fin_revenue_gross` | Выручка | gross sales |
| `fin_revenue_discount` | Скидка | скидки в реализациях |
| `fin_var_cogs` | Себестоимость | COGS (factCost) |
| `fin_var_total` | Переменные | сумма переменных расходов |
| `fin_marginal` | Маржинальный доход | revenue − var |
| `fin_marginal_pct` | Рентабельность по марже, % | |
| `fin_direct_fixed_total` | Прямые постоянные | |
| `fin_gross_dir` | Валовая прибыль по направлениям | marg − direct fixed |
| `fin_overhead_total` | Общепроизводственные | |
| **`fin_gross`** | **Валовая прибыль** | grossDir − overhead |
| `fin_admin_total` | Административные | |
| `fin_commercial_total` | Коммерческие | |
| `fin_indirect_total` | Косвенные расходы | admin + comm |
| **`fin_ebitda`** | **Операционная прибыль (EBITDA)** | |
| `fin_ebitda_pct` | Рентабельность по EBITDA, % | |
| `fin_amortization` | Амортизация | |
| **`fin_net`** | **Чистая прибыль** | |
| `fin_net_pct` | Рентабельность по ЧП, % | |
| `fin_tax_plan`/`fin_tax_fact` | Налог на прибыль (план / факт) | |
| `fin_charity_plan`/`fin_charity_fact` | Благотворительность (план / факт) | |

Плюс детальные строки с префиксами `article:<id>` (статья ДДС), `writeoff:<id>` (списания).

Также есть `totals[period]` с компактными ключами: `revenue`, `cogs`, **`grossProfit`**, `grossMargin`, `marginalProfit`, `payroll`, `rent`, `marketing`, `admin`, `logistics`, `amortization`, `ebitda`, `netProfit` и т.д.

> Когда пользователь спрашивает один показатель — берёшь его из `totals[period]` или из соответствующей строки `rows[]`. Не вываливай всю таблицу.

## Деньги — детально

| endpoint | Параметры | Что возвращает |
|---|---|---|
| `payments` | `from`, `to`, `direction` (all/in/out), `kassaId`, `accountId`, `kontragentId`, `q`, `limit` | Список платежей DdsDocument с фильтрами и итогами |
| `receivables` | `asOf`, `limit`, `minDebt` | Дебиторка: контрагенты + долг + aging (0-7, 8-14, 15-30, 31-60, 61+) |
| `payables` | `asOf`, `minDebt`, `limit` | Кредиторка (то же, для поставщиков) |
| `expenses` | `from`, `to`, `drill` (категория), `article` | Расходы по категориям ОПиУ (ФОТ, аренда, налоги и т.п.), кассовым методом |

## Продажи

| endpoint | Параметры | Что возвращает |
|---|---|---|
| `sales/abc` | `from`, `to`, `param` (revenue/profit/quantity) | ABC-анализ: rows с abcClass A/B/C, share, cumShare |
| `sales/by-sku` | `from`, `to`, `limit`, `manager`, `drill` (SKU) | Pivot SKU × менеджер из реализаций; drill — детали по одному SKU |
| `sales/by-category` | `from`, `to`, `drill` (категория) | Иерархия номенклатурных категорий: qty (кг), revenue, cost, margin |
| `sales/by-manager` | `from`, `to` | По менеджерам: заказы, отгрузки, выручка, прибыль, средний чек, план |
| `sales/by-manager/details` | `from`, `to`, **`name`** | topClients, topSkus, recentOrders, recentSales для одного менеджера |
| `sales/funnel` | `from`, `to` | По источникам привлечения: contractors → withOrder → withSale, newClients |
| `sales/funnel/details` | **`sourceId`**, `from`, `to` | bought / ordered / lost / new клиенты по источнику |
| `sales/plans` | — | Список планов продаж |
| `sales/plan-fact` | — | План vs Факт + линейный прогноз |
| `discounts` | `from`, `to` | Скидки: byContractor, byItem, byManager + %, выручка |

## Склад и логистика

| endpoint | Параметры | Что возвращает |
|---|---|---|
| `inventory/balances` | `warehouseId`, `coverDays` | Остатки ТМЦ: qty, costAmount, sold30/90, daysCover, reorderQty |
| `packers` | `from`, `to` | По упаковщикам: заказы, отгружено кг, в работе, проблемные |
| `packers/pending` | **`packer` (ОБЯЗАТЕЛЕН — иначе 400)**, `from`, `to`, `bucket` (working/problem/all) | Заказы КОНКРЕТНОГО упаковщика, не отгруженные. Для «все неотгруженные» — query_db по `stateName` (см. db_schema.md) |
| `anomalies` | — | Аномалии данных: будущие даты, убыточные продажи, zero-cost, unmapped, дубли |

## Справочники и настройки

| endpoint | Параметры | Что возвращает |
|---|---|---|
| `articles` | — | Список статей ДДС: id, name, opiuCategory, ddsSection |
| `accruals` | — | Правила распределения (Accrual) для статей |
| `fixed-assets` | — | ОС: name, cost, usefulMonths, startDate, method |
| `adjustments` | — | Ручные корректировки ОПиУ |

## Состояние системы

| endpoint | Параметры | Что возвращает |
|---|---|---|
| `sync/status` | — | counts{}, последние логи синхронизации |
| `sync/cron-status` | — | active, enabled, lastStarted, pid, intervalMinutes, daysBack |

---

## Подсказки по выбору endpoint

| Запрос пользователя | Endpoint | query |
|---|---|---|
| «сколько денег на кассах сейчас» | `balance` | — (или `asOf=today`) |
| «остатки касс на дату X» | `dds/by-kassa` | `from=X, to=X` или `balance?asOf=X` |
| «ОПиУ за май» | `opiu` | `from=2026-05-01, to=2026-05-31, granularity=month` |
| «ДДС за период по статьям» | `dds` | `from, to, granularity=month` |
| «выручка за период» | `opiu` (берём строку revenue) или `dashboard` | `from, to` |
| «дебиторка / кто должен» | `receivables` | `asOf=today` |
| «кому должны» | `payables` | `asOf=today` |
| «продажи по менеджеру X» | `sales/by-manager/details` | `from, to, name=X` |
| «топ товаров по прибыли» | `sales/abc` | `from, to, param=profit` |
| «остатки товара на складе» | `inventory/balances` | `coverDays=30` |
| «план vs факт» | `sales/plan-fact` | — |
| «скидки за период» | `discounts` | `from, to` |
| «расходы по статьям» | `expenses` | `from, to` |
| «аномалии в данных» | `anomalies` | — |

Если запрос пользователя нельзя свести к одному endpoint (например, «дай мне выручку конкретного SKU за конкретного клиента») — переходи к `query_db`.
