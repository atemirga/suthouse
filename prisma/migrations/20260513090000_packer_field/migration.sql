-- Packer (fact-сборщик заказа) — берётся из доп.реквизита Упаковщик
-- (ChartOfCharacteristicTypes_ДополнительныеРеквизитыИСведения,
-- Свойство_Key=d64eea4f-f086-11f0-ae70-c81f66edd58d).
ALTER TABLE "OrderBuyer" ADD COLUMN "packerId" TEXT;
ALTER TABLE "OrderBuyer" ADD COLUMN "packerName" TEXT;
CREATE INDEX "OrderBuyer_packerId_idx" ON "OrderBuyer"("packerId");
