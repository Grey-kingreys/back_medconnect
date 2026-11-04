-- Migration témoin du harnais (PB01) : table liée aux fiches de stock, remplie depuis la base chargée.
CREATE TABLE "HarnaisTemoin" (
  "stockMedicamentId" TEXT PRIMARY KEY REFERENCES "StockMedicament"("id")
);
INSERT INTO "HarnaisTemoin" ("stockMedicamentId")
SELECT "id" FROM "StockMedicament" WHERE "quantite" > 0;
