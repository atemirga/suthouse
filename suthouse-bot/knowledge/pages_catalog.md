# Страницы UI ↔ endpoint (для контекста)

`/` → dashboard | `/opiu` → opiu | `/dds` → dds | `/dds/by-kassa` → dds/by-kassa
`/balance` → balance | `/receivables` → receivables | `/payables` → payables
`/payments` → payments | `/expenses` → expenses | `/discounts` → discounts
`/sales/abc` → sales/abc | `/sales/by-sku` → sales/by-sku | `/sales/by-category` → sales/by-category
`/sales/by-manager` → sales/by-manager | `/sales/plan-fact` → sales/plan-fact
`/sales/funnel` → sales/funnel | `/inventory` → inventory/balances
`/packers` → packers | `/anomalies` → anomalies

Период: `from`/`to` (YYYY-MM-DD) + `granularity` (day/week/month). Балансы — `asOf`.
