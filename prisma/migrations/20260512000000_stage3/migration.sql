-- AttractionSource catalog
CREATE TABLE "AttractionSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttractionSource_pkey" PRIMARY KEY ("id")
);

-- Add field to Kontragent
ALTER TABLE "Kontragent" ADD COLUMN "attractionSourceId" TEXT;
CREATE INDEX "Kontragent_attractionSourceId_idx" ON "Kontragent"("attractionSourceId");

-- Inventory balance snapshot
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "warehouseName" TEXT,
    "nomenclatureId" TEXT NOT NULL,
    "nomenclatureName" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InventoryBalance_warehouseId_idx" ON "InventoryBalance"("warehouseId");
CREATE INDEX "InventoryBalance_nomenclatureId_idx" ON "InventoryBalance"("nomenclatureId");
CREATE INDEX "InventoryBalance_asOfDate_idx" ON "InventoryBalance"("asOfDate");

-- Sales plans (managed in our app)
CREATE TABLE "SalesPlan" (
    "id" TEXT NOT NULL,
    "scenarioName" TEXT NOT NULL DEFAULT 'Основной',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'category',
    "scopeId" TEXT,
    "scopeName" TEXT,
    "amountPlan" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityPlan" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "responsible" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesPlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalesPlan_startDate_endDate_idx" ON "SalesPlan"("startDate", "endDate");
CREATE INDEX "SalesPlan_scope_scopeId_idx" ON "SalesPlan"("scope", "scopeId");
