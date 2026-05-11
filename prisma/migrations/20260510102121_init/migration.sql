-- CreateTable
CREATE TABLE "Kontragent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "responsible" TEXT,
    "isFolder" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kontragent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DdsArticle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isFolder" BOOLEAN NOT NULL DEFAULT false,
    "opiuCategory" TEXT,
    "ddsSection" TEXT DEFAULT 'operating',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DdsArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nomenclature" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isFolder" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Nomenclature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kassa" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Kassa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User1C" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User1C_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DdsDocument" (
    "id" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "number" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "kontragentId" TEXT,
    "kontragentName" TEXT,
    "operationType" TEXT,
    "articleId" TEXT,
    "articleName" TEXT,
    "kassaId" TEXT,
    "kassaName" TEXT,
    "kassaToId" TEXT,
    "kassaToName" TEXT,
    "accountId" TEXT,
    "accountName" TEXT,
    "comment" TEXT,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DdsDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Realizacia" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "number" TEXT NOT NULL,
    "kontragentId" TEXT,
    "kontragentName" TEXT,
    "responsibleId" TEXT,
    "responsibleName" TEXT,
    "operationType" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comment" TEXT,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Realizacia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RealizaciaItem" (
    "id" TEXT NOT NULL,
    "realizaciaId" TEXT NOT NULL,
    "nomenclatureId" TEXT,
    "nomenclatureName" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "RealizaciaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zakupka" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "number" TEXT NOT NULL,
    "kontragentId" TEXT,
    "kontragentName" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Zakupka_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZakupkaItem" (
    "id" TEXT NOT NULL,
    "zakupkaId" TEXT NOT NULL,
    "nomenclatureId" TEXT,
    "nomenclatureName" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "ZakupkaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderBuyer" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "number" TEXT NOT NULL,
    "kontragentId" TEXT,
    "kontragentName" TEXT,
    "responsibleId" TEXT,
    "responsibleName" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT,
    "shipmentDate" TIMESTAMP(3),
    "comment" TEXT,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderBuyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WriteOff" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "number" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "responsibleName" TEXT,
    "comment" TEXT,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WriteOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WriteOffItem" (
    "id" TEXT NOT NULL,
    "writeOffId" TEXT NOT NULL,
    "nomenclatureId" TEXT,
    "nomenclatureName" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "WriteOffItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Capitalization" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "number" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "responsibleName" TEXT,
    "comment" TEXT,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Capitalization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapitalizationItem" (
    "id" TEXT NOT NULL,
    "capitalizationId" TEXT NOT NULL,
    "nomenclatureId" TEXT,
    "nomenclatureName" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "CapitalizationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccrualRule" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'equal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccrualRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost" DOUBLE PRECISION NOT NULL,
    "usefulMonths" INTEGER NOT NULL DEFAULT 60,
    "startDate" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'linear',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualAdjustment" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "details" TEXT,
    "error" TEXT,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Kontragent_name_idx" ON "Kontragent"("name");

-- CreateIndex
CREATE INDEX "DdsArticle_name_idx" ON "DdsArticle"("name");

-- CreateIndex
CREATE INDEX "DdsDocument_date_idx" ON "DdsDocument"("date");

-- CreateIndex
CREATE INDEX "DdsDocument_articleId_idx" ON "DdsDocument"("articleId");

-- CreateIndex
CREATE INDEX "DdsDocument_kontragentId_idx" ON "DdsDocument"("kontragentId");

-- CreateIndex
CREATE INDEX "DdsDocument_docType_idx" ON "DdsDocument"("docType");

-- CreateIndex
CREATE INDEX "Realizacia_date_idx" ON "Realizacia"("date");

-- CreateIndex
CREATE INDEX "Realizacia_kontragentId_idx" ON "Realizacia"("kontragentId");

-- CreateIndex
CREATE INDEX "RealizaciaItem_realizaciaId_idx" ON "RealizaciaItem"("realizaciaId");

-- CreateIndex
CREATE INDEX "RealizaciaItem_nomenclatureId_idx" ON "RealizaciaItem"("nomenclatureId");

-- CreateIndex
CREATE INDEX "Zakupka_date_idx" ON "Zakupka"("date");

-- CreateIndex
CREATE INDEX "ZakupkaItem_zakupkaId_idx" ON "ZakupkaItem"("zakupkaId");

-- CreateIndex
CREATE INDEX "ZakupkaItem_nomenclatureId_idx" ON "ZakupkaItem"("nomenclatureId");

-- CreateIndex
CREATE INDEX "OrderBuyer_date_idx" ON "OrderBuyer"("date");

-- CreateIndex
CREATE INDEX "OrderBuyer_status_idx" ON "OrderBuyer"("status");

-- CreateIndex
CREATE INDEX "OrderBuyer_kontragentId_idx" ON "OrderBuyer"("kontragentId");

-- CreateIndex
CREATE INDEX "WriteOff_date_idx" ON "WriteOff"("date");

-- CreateIndex
CREATE INDEX "Capitalization_date_idx" ON "Capitalization"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AccrualRule_articleId_key" ON "AccrualRule"("articleId");

-- CreateIndex
CREATE INDEX "ManualAdjustment_month_idx" ON "ManualAdjustment"("month");

-- AddForeignKey
ALTER TABLE "RealizaciaItem" ADD CONSTRAINT "RealizaciaItem_realizaciaId_fkey" FOREIGN KEY ("realizaciaId") REFERENCES "Realizacia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZakupkaItem" ADD CONSTRAINT "ZakupkaItem_zakupkaId_fkey" FOREIGN KEY ("zakupkaId") REFERENCES "Zakupka"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WriteOffItem" ADD CONSTRAINT "WriteOffItem_writeOffId_fkey" FOREIGN KEY ("writeOffId") REFERENCES "WriteOff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapitalizationItem" ADD CONSTRAINT "CapitalizationItem_capitalizationId_fkey" FOREIGN KEY ("capitalizationId") REFERENCES "Capitalization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
