-- Сдвиг дат документов на -5 часов (Asia/Almaty).
--
-- До этого фикса parseDate() в src/lib/sync/utils.ts добавлял к ISO-строке
-- из 1С суффикс Z, интерпретируя локальное Almaty (UTC+5) как UTC.
-- В итоге все даты документов, синканых из 1С, оказались сдвинуты на +5 часов
-- вперёд. Документы созданные после 19:00 Almaty показывались как следующий день.
--
-- После фикса parseDate работает корректно (приписывает +05:00).
-- Эта миграция приводит уже сохранённые данные к правильному UTC-моменту.
--
-- Затрагиваются только бизнес-даты документов, проходящие через parseDate.
-- Служебные DateTime (syncedAt, createdAt, factCostSyncedAt) — НЕ трогаем,
-- они всегда были честным UTC через @default(now()).

BEGIN;

UPDATE "DdsDocument"
  SET date = date - INTERVAL '5 hours',
      "accrualPeriod" = "accrualPeriod" - INTERVAL '5 hours'
  WHERE date IS NOT NULL;

UPDATE "Realizacia"
  SET date = date - INTERVAL '5 hours'
  WHERE date IS NOT NULL;

UPDATE "Zakupka"
  SET date = date - INTERVAL '5 hours'
  WHERE date IS NOT NULL;

UPDATE "OrderBuyer"
  SET date = date - INTERVAL '5 hours',
      "shipmentDate" = "shipmentDate" - INTERVAL '5 hours'
  WHERE date IS NOT NULL;

UPDATE "WriteOff"
  SET date = date - INTERVAL '5 hours'
  WHERE date IS NOT NULL;

UPDATE "Capitalization"
  SET date = date - INTERVAL '5 hours'
  WHERE date IS NOT NULL;

UPDATE "MonthClose"
  SET "closedAt" = "closedAt" - INTERVAL '5 hours'
  WHERE "closedAt" IS NOT NULL;

UPDATE "SalesPlan"
  SET "startDate" = "startDate" - INTERVAL '5 hours',
      "endDate"   = "endDate"   - INTERVAL '5 hours'
  WHERE "startDate" IS NOT NULL;

COMMIT;
