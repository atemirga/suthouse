-- OrderBuyerItem — товарные позиции заказов покупателей (Document_ЗаказПокупателя_Товары).
-- Нужны чтобы показывать пользователю состав «несобранных» заказов (упаковщики, модалка).

CREATE TABLE "OrderBuyerItem" (
  "id"               TEXT PRIMARY KEY,
  "orderBuyerId"     TEXT NOT NULL,
  "nomenclatureId"   TEXT,
  "nomenclatureName" TEXT,
  "quantity"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "price"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "amount"           DOUBLE PRECISION NOT NULL DEFAULT 0
);

CREATE INDEX "OrderBuyerItem_orderBuyerId_idx" ON "OrderBuyerItem"("orderBuyerId");
CREATE INDEX "OrderBuyerItem_nomenclatureId_idx" ON "OrderBuyerItem"("nomenclatureId");

ALTER TABLE "OrderBuyerItem"
  ADD CONSTRAINT "OrderBuyerItem_orderBuyerId_fkey"
  FOREIGN KEY ("orderBuyerId") REFERENCES "OrderBuyer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
