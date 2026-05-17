-- Фактическая стоимость списания из AccumulationRegister_Запасы_RecordType
-- (Recorder_Type='Document_СписаниеЗапасов', RecordType='Expense', поле Сумма).
-- Это с/с по 1С — точнее нашего FIFO в WriteOff.totalAmount.
ALTER TABLE "WriteOff" ADD COLUMN "factCost" DOUBLE PRECISION;
ALTER TABLE "WriteOff" ADD COLUMN "factCostSyncedAt" TIMESTAMP(3);

CREATE INDEX "WriteOff_factCostSyncedAt_idx" ON "WriteOff"("factCostSyncedAt");
