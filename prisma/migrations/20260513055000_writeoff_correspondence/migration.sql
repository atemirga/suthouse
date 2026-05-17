-- Справочник корреспонденций = План счетов «Управленческий» из 1С.
-- Используется на списаниях, чтобы различать типы потерь: Артык салу,
-- Недостачи, Усушка, Прочие расходы и т.п.
CREATE TABLE "Correspondence" (
  "id" TEXT NOT NULL,
  "code" TEXT,
  "description" TEXT NOT NULL,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Correspondence_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WriteOff"
  ADD COLUMN "correspondenceId" TEXT,
  ADD COLUMN "correspondenceName" TEXT;

ALTER TABLE "WriteOff"
  ADD CONSTRAINT "WriteOff_correspondenceId_fkey"
    FOREIGN KEY ("correspondenceId") REFERENCES "Correspondence"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WriteOff_correspondenceId_idx" ON "WriteOff"("correspondenceId");
