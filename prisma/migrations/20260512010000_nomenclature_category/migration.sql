-- NomenclatureCategory catalog
CREATE TABLE "NomenclatureCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NomenclatureCategory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NomenclatureCategory_name_idx" ON "NomenclatureCategory"("name");

-- Add categoryId to Nomenclature
ALTER TABLE "Nomenclature" ADD COLUMN "categoryId" TEXT;
CREATE INDEX "Nomenclature_categoryId_idx" ON "Nomenclature"("categoryId");
