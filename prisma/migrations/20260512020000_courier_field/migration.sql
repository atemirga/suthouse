ALTER TABLE "OrderBuyer" ADD COLUMN "courierId" TEXT;
ALTER TABLE "OrderBuyer" ADD COLUMN "courierName" TEXT;
CREATE INDEX "OrderBuyer_courierId_idx" ON "OrderBuyer"("courierId");
