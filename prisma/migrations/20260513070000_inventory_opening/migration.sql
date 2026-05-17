-- Вступительные FIFO-лоты на дату начала учёта (qty + cost).
-- Используется FIFO-движком как «история закупок до этой даты».
CREATE TABLE "InventoryOpening" (
  "id"               TEXT NOT NULL,
  "asOfDate"         TIMESTAMP(3) NOT NULL,
  "nomenclatureId"   TEXT NOT NULL,
  "nomenclatureName" TEXT,
  "qty"              DOUBLE PRECISION NOT NULL,
  "costPrice"        DOUBLE PRECISION NOT NULL,
  "syncedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryOpening_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryOpening_asOfDate_nomenclatureId_key" ON "InventoryOpening"("asOfDate", "nomenclatureId");
CREATE INDEX "InventoryOpening_nomenclatureId_idx" ON "InventoryOpening"("nomenclatureId");
