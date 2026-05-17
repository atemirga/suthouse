-- Фактическая себестоимость продаж — из AccumulationRegister_Запасы_RecordType
-- (записи RecordType='Expense', Recorder_Type='Document_РасходнаяНакладная').
-- Это «настоящая» себестоимость после расчёта 1С (включая закрытие месяца),
-- которая сходится с финансистом 1:1. Наш totalCost (FIFO) остаётся как
-- запасной механизм для месяцев без factCost.
ALTER TABLE "Realizacia" ADD COLUMN "factCost" DOUBLE PRECISION;
ALTER TABLE "Realizacia" ADD COLUMN "factCostSyncedAt" TIMESTAMP(3);

CREATE INDEX "Realizacia_factCostSyncedAt_idx" ON "Realizacia"("factCostSyncedAt");
