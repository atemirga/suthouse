-- CreateTable
CREATE TABLE "OpeningBalance" (
    "id" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "refName" TEXT,
    "refType" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpeningBalance_kind_refId_key" ON "OpeningBalance"("kind", "refId");

-- CreateIndex
CREATE INDEX "OpeningBalance_kind_idx" ON "OpeningBalance"("kind");
