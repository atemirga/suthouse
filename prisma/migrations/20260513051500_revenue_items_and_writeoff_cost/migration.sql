-- Денормализованная сумма позиций реализации (без услуг типа доставки).
-- Используется для выручки в ОПиУ/дашборде — сходится с «В/С Выручка» 1С.
-- totalAmount (= СуммаДокумента) остаётся как полный долг покупателя.
ALTER TABLE "Realizacia" ADD COLUMN "itemsAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: суммируем items.amount по каждой реализации.
UPDATE "Realizacia" r
SET "itemsAmount" = COALESCE(s.sum_amt, 0)
FROM (
  SELECT "realizaciaId", SUM(amount) AS sum_amt
  FROM "RealizaciaItem"
  GROUP BY "realizaciaId"
) s
WHERE r.id = s."realizaciaId";

-- Себестоимость единицы списания (для производственных потерь в ОПиУ).
-- amount будет = quantity * costPrice, считается в FIFO.
ALTER TABLE "WriteOffItem" ADD COLUMN "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX "WriteOffItem_nomenclatureId_idx" ON "WriteOffItem"("nomenclatureId");
