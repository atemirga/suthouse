-- Закрытие месяца в 1С. Один ряд на yearMonth, агрегирует все стадии закрытия
-- (РасчетПрямыхЗатрат, РаспределениеЗатрат, РасчетФактическойСебестоимости,
-- РасчетФинансовогоРезультата). Используется как индикатор статуса месяца
-- в отчётах (открыт / закрыт).
CREATE TABLE "MonthClose" (
  "yearMonth"           TEXT      NOT NULL,
  "closedAt"            TIMESTAMP(3) NOT NULL,
  "hasDirectCostCalc"   BOOLEAN   NOT NULL DEFAULT false,
  "hasCostDistribution" BOOLEAN   NOT NULL DEFAULT false,
  "hasActualCost"       BOOLEAN   NOT NULL DEFAULT false,
  "hasFinancialResult"  BOOLEAN   NOT NULL DEFAULT false,
  "docRefs"             TEXT,
  "syncedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonthClose_pkey" PRIMARY KEY ("yearMonth")
);
