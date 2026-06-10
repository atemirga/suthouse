# Postgres `suthouse_finance` — для `query_db`

Имена таблиц/колонок в `"DoubleQuotes"` (PascalCase). SELECT/WITH only, без `;`.

## Таблицы и ключевые колонки

- **Kontragent** (id, name, attractionSourceId, isFolder)
- **AttractionSource** (id, name)
- **DdsArticle** (id, name, opiuCategory, ddsSection, isFolder)
- **Nomenclature** (id, name, categoryId, isFolder)
- **NomenclatureCategory** (id, name, parentId)
- **Kassa** (id, name)  |  **BankAccount** (id, name)
- **Employee** (id, name, isFolder)
- **DdsDocument** (id, docType, direction `inflow|outflow|transfer`, date, amount,
  commission, articleId, kassaId, accountId, kontragentId, accrualPeriod)
- **Realizacia** (id, date, kontragentId, responsibleName, totalAmount,
  itemsAmount, totalCost, **factCost**)
- **RealizaciaItem** (id, realizaciaId, nomenclatureId, quantity, price,
  amount, discount, costPrice, costAmount)
- **Zakupka** (id, date, kontragentId, totalAmount, isReturn)
- **ZakupkaItem** (id, zakupkaId, nomenclatureId, quantity, price, amount)
- **OrderBuyer** (id, date, kontragentId, responsibleName, courierId, packerId,
  packerName, totalAmount, paidAmount, status, **stateName**, shipmentDate, posted)
  - `stateName` — РЕАЛЬНЫЙ статус заказа из 1С:
    - `'Завершен'` — отгружен/закрыт
    - `'В работе'`, `'ОТК Менеджер'`, `'ОТК Зав Склад'` — в работе (pending)
    - `'Проблема'` — проблемные
    - `NULL` — старые записи (как правило тоже отгружены, до внедрения статусов)
  - НЕ используй `shipmentDate IS NULL` как маркер «не отгружено» — это поле
    заполняется не всегда корректно.
- **OrderBuyerItem** (id, orderBuyerId, **nomenclatureName** ← используй ЭТО,
  nomenclatureId часто NULL, quantity, price, amount)
- **WriteOff** (id, date, totalAmount, correspondenceId, factCost)
- **WriteOffItem** (id, writeOffId, nomenclatureId, quantity, amount)
- **OpeningBalance** (kind cash/ar/ap, refId, refType, amount)
- **InventoryBalance** (asOfDate, warehouseId, nomenclatureId, quantity)
- **AccrualRule** (articleId, months, method equal/front)
- **FixedAsset** (id, name, cost, usefulMonths, startDate, method linear)
- **SalesPlan** (id, startDate, endDate, scope, scopeId, amountPlan, quantityPlan)
- **ManualAdjustment** (month, category, amount, comment)
- **MonthClose** (yearMonth, hasActualCost, hasFinancialResult)

## Готовые SQL-сниппеты

Выручка за период:
```sql
SELECT COALESCE(SUM("totalAmount"),0)::numeric AS revenue
FROM "Realizacia" WHERE "date">=%(f)s AND "date"<%(t)s
```

Топ-10 клиентов:
```sql
SELECT k.name, SUM(r."totalAmount")::numeric AS revenue
FROM "Realizacia" r JOIN "Kontragent" k ON k.id=r."kontragentId"
WHERE r."date">=%(f)s AND r."date"<%(t)s
GROUP BY k.name ORDER BY revenue DESC LIMIT 10
```

Сумма по статье ДДС за период:
```sql
SELECT a.name, SUM(d.amount)::numeric AS total
FROM "DdsDocument" d JOIN "DdsArticle" a ON a.id=d."articleId"
WHERE d.direction='outflow' AND d."date">=%(f)s AND d."date"<%(t)s
GROUP BY a.name ORDER BY total DESC
```

⚠ ОГРАНИЧЕНИЕ: `OrderBuyerItem.nomenclatureName/Id` НЕ заполнены синком (все NULL),
только `quantity` и `amount`. По SKU-разрезу неотгруженных заказов из Postgres
ответить **нельзя** — можно только агрегатом по заказам ИЛИ через 1С OData.

Неотгруженные заказы СЕЙЧАС (агрегат + килограммы):
```sql
SELECT COUNT(*) AS orders,
       SUM("totalAmount")::numeric AS sum,
       (SELECT SUM(i.quantity)::numeric
        FROM "OrderBuyerItem" i WHERE i."orderBuyerId" IN (
          SELECT id FROM "OrderBuyer"
          WHERE posted=true AND "stateName" IN ('В работе','ОТК Менеджер','ОТК Зав Склад')
        )) AS kg
FROM "OrderBuyer"
WHERE posted=true AND "stateName" IN ('В работе','ОТК Менеджер','ОТК Зав Склад')
```

Список заказов (топ по сумме):
```sql
SELECT o.number, o.date, o."kontragentName", o."packerName",
       o."stateName", o."totalAmount"
FROM "OrderBuyer" o
WHERE posted=true AND "stateName" IN ('В работе','ОТК Менеджер','ОТК Зав Склад')
ORDER BY o."totalAmount" DESC LIMIT 20
```

По SKU — пользователю честно сказать: «по товарам неотгруженных не могу,
позиции в Postgres не синкаются. По заказам: …»

Проблемные заказы (с ошибками):
```sql
SELECT o.number, o.date, o."kontragentName", o."totalAmount", o."packerName"
FROM "OrderBuyer" o
WHERE posted=true AND "stateName"='Проблема'
ORDER BY o.date DESC LIMIT 50
```

Продажи SKU за период:
```sql
SELECT n.name, SUM(i.quantity)::numeric qty, SUM(i.amount)::numeric revenue
FROM "RealizaciaItem" i
JOIN "Realizacia" r ON r.id=i."realizaciaId"
JOIN "Nomenclature" n ON n.id=i."nomenclatureId"
WHERE r."date">=%(f)s AND r."date"<%(t)s AND n.name ILIKE %(n)s
GROUP BY n.name
```

Правила:
- Даты как `[from, to_excl)` — полуинтервал.
- `direction='transfer'` ИСКЛЮЧАЙ из выручки/расходов.
- `Realizacia.responsibleName` — строка ФИО (не FK).
- Сомневаешься в колонке → `describe_db(table='X')` один раз.
