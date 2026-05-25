-- Автор документа (Catalog_Пользователи) в реализациях.
-- Используется как fallback к responsibleName в дебиторке: «Ответственный»
-- в 1С часто пуст, а «Автор» проставляется системой всегда.

ALTER TABLE "Realizacia" ADD COLUMN "authorId"   TEXT;
ALTER TABLE "Realizacia" ADD COLUMN "authorName" TEXT;
