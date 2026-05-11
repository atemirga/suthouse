-- AlterTable
ALTER TABLE "DdsDocument" ADD COLUMN     "commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "paymentPurpose" TEXT;

-- AlterTable
ALTER TABLE "Zakupka" ADD COLUMN     "isReturn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "operationType" TEXT;

-- CreateIndex
CREATE INDEX "DdsDocument_direction_idx" ON "DdsDocument"("direction");

-- CreateIndex
CREATE INDEX "Zakupka_isReturn_idx" ON "Zakupka"("isReturn");
