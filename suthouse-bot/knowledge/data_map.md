# Карта данных Suthouse — основной источник правды

Бот ходит за данными в 3 источника, в порядке приоритета:

1. **Готовые API Suthouse** (`use_api`) — см. [`api_catalog.md`](api_catalog.md).
   Все управленческие отчёты уже посчитаны: ДДС, ОПиУ, баланс, дебиторка,
   продажи и т.д. Это самый быстрый и точный путь.

2. **Postgres `suthouse_finance`** (`query_db`) — см. [`db_schema.md`](db_schema.md).
   Синхронизированные из 1С документы и справочники. Используем, когда
   готового endpoint нет или нужна нестандартная агрегация.

3. **OData 1С УНФ** (`query_1c`) — см. секцию ниже. Fallback на случай,
   если данные не доехали до Postgres, либо нужны самые свежие записи.

## Страницы UI (чтобы понимать контекст пользователя)

См. [`pages_catalog.md`](pages_catalog.md) — соответствие URL ↔ endpoint.

## Базовые правила работы с 1С (для `query_1c`)

- `$orderby=Ref_Key`, `$format=json`, пагинация `$top/$skip` (стандарт 1000).
- Документы: фильтр `DeletionMark eq false and Posted eq true`.
- Регистры (движения): фильтр `Active eq true` (Posted у движений нет).
- Даты: `Date ge datetime'YYYY-MM-DDTHH:MM:SS' and Date lt datetime'...'` в TZ Asia/Almaty.
- Внутренние переводы (`ПеремещениеДС`) — исключать из поступлений.

## Поддерживаемые сущности 1С (для `query_1c`)

- **Документы**: `Document_ПоступлениеВКассу`, `Document_ПоступлениеНаСчет`,
  `Document_РасходИзКассы`, `Document_РасходСоСчета`,
  `Document_ПеремещениеДС`, `Document_РасходнаяНакладная`,
  `Document_ПриходнаяНакладная`.
- **Регистры (остатки)**: `AccumulationRegister_ДенежныеСредства`,
  `AccumulationRegister_РасчетыСПокупателями`,
  `AccumulationRegister_РасчетыСПоставщиками`.
