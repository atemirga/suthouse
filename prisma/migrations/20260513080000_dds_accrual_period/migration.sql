-- ПериодРегистрации + Выдать из 1С на DDS-документах. Используется для ЗП:
-- платёж от 5 марта с accrualPeriod = 1 февраля → начислен за февраль.
ALTER TABLE "DdsDocument"
  ADD COLUMN "accrualPeriod" TIMESTAMP(3),
  ADD COLUMN "recipientName" TEXT;

CREATE INDEX "DdsDocument_accrualPeriod_idx" ON "DdsDocument"("accrualPeriod");
