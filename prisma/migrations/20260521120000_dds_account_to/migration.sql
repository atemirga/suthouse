-- Поля «второй стороны» для transfer-документов ДДС (банк-получатель)
ALTER TABLE "DdsDocument" ADD COLUMN "accountToId" TEXT;
ALTER TABLE "DdsDocument" ADD COLUMN "accountToName" TEXT;
