-- Добавляем СостояниеЗаказа из 1С на OrderBuyer.
-- Используется отчётом по упаковщикам: «Завершен» = отгружено, остальное = в работе/проблема.
ALTER TABLE "OrderBuyer" ADD COLUMN "stateId" TEXT;
ALTER TABLE "OrderBuyer" ADD COLUMN "stateName" TEXT;
CREATE INDEX "OrderBuyer_stateName_idx" ON "OrderBuyer"("stateName");
