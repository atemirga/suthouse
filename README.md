# SUT HOUSE — Финансовая отчётность

Веб-приложение для просмотра ОПиУ, ДДС и РНП по данным из 1С:УНФ KZ 1.6.
Данные забираются из 1С OData в собственный PostgreSQL и собираются в управленческие отчёты.

## Стек

- **Frontend / Backend:** Next.js 14 (App Router) + React + Tailwind
- **БД:** PostgreSQL 16
- **ORM:** Prisma 5
- **Расписание:** node-cron (отдельный воркер)
- **Источник:** 1С УНФ OData REST

## Структура

```
suthouse-finance/
├── prisma/schema.prisma          # схема БД
├── src/
│   ├── app/                      # страницы и API routes
│   │   ├── page.tsx              # дашборд
│   │   ├── opiu/                 # ОПиУ
│   │   ├── dds/                  # ДДС
│   │   ├── rnp/                  # РНП
│   │   ├── settings/             # маппинг, accruals, ОС, корректировки, синк
│   │   └── api/                  # /api/sync, /api/opiu, /api/dds, ...
│   ├── lib/
│   │   ├── odata.ts              # OData клиент с пагинацией
│   │   ├── sync/                 # модули синхронизации
│   │   ├── reports/              # генераторы ОПиУ, ДДС, РНП
│   │   ├── cron.ts               # node-cron воркер
│   │   └── db.ts                 # Prisma client
│   └── components/               # UI компоненты
├── docker-compose.yml
├── Dockerfile
└── .env
```

## Запуск локально (без Docker)

Требуется Node 20+ и PostgreSQL 14+.

```bash
# 1. Создать БД
sudo -u postgres psql -c "CREATE USER suthouse WITH PASSWORD 'pwd' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE suthouse_finance OWNER suthouse;"

# 2. Установить и мигрировать
npm install
npx prisma migrate deploy   # или migrate dev для разработки

# 3. Первичная синхронизация (займёт несколько минут на полный объём)
npm run sync -- --days=365

# 4. Запустить веб
npm run dev
# → http://localhost:3000

# 5. Запустить cron-воркер в отдельном терминале
npm run cron
```

## Запуск через Docker

```bash
# В .env должны быть заданы ODATA_*. Остальное возьмётся по умолчанию.
docker compose up -d --build
```

Поднимутся 4 сервиса:
- `db` — PostgreSQL
- `migrate` — одноразово применяет миграции и завершается
- `app` — Next.js на http://localhost:3000
- `cron` — воркер синхронизации (каждые `SYNC_INTERVAL_MINUTES` минут)

## Настройка

После первой синхронизации:

1. Откройте **Настройки → Маппинг статей ДДС** и проставьте категорию ОПиУ
   у статей, которые автомаппинг не угадал.
2. По желанию — добавьте правила распределения (Accrual), основные средства,
   ручные корректировки.

## Полезные команды

```bash
npm run sync                       # полный синк за SYNC_DAYS_BACK дней
npm run sync -- --days=7           # за 7 дней
npm run sync -- --skip-catalogs    # пропустить справочники
npm run sync:catalogs              # только справочники

npx prisma studio                  # просмотр БД в браузере
npx prisma migrate dev             # новая миграция (только в dev)
```

## Критичные моменты при работе с 1С OData

- **`$orderby=Ref_Key`** — обязателен для пагинации (баг 1С: без него теряются записи)
- **`NODE_TLS_REJECT_UNAUTHORIZED=0`** — для self-signed сертификатов
- **Без `$select`** для документов с переменным составом полей (ДДС, заказы, инвентарь)
- **Перемещения денег** не учитываются в ДДС-отчёте (внутреннее движение)
- **Себестоимость** считается по последней закупочной цене (приближение, не FIFO)

## Переменные окружения

| Имя | Назначение | По умолчанию |
|---|---|---|
| `DATABASE_URL` | PostgreSQL DSN | — |
| `ODATA_URL` | URL 1С OData | — |
| `ODATA_LOGIN` | Логин | — |
| `ODATA_PASSWORD` | Пароль | — |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Игнорировать SSL | `0` |
| `SYNC_INTERVAL_MINUTES` | Период cron'а | `15` |
| `SYNC_DAYS_BACK` | Окно инкрементальной синхронизации | `60` |
| `TIMEZONE` | Таймзона | `Asia/Almaty` |
