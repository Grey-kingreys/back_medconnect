-- Retour arrière de 20261026120000_pharmacie_t1_lots_mouvements (PB07, M4).
-- Valable même après activité réelle : restaure le compteur de chaque fiche depuis le stock calculé
-- (somme de ses mouvements, écrêtée à 0 ; les fiches écrêtées sont listées par un NOTICE),
-- disponible = quantité positive, et la date de péremption de la fiche depuis ses lots encore en
-- stock (la plus proche, nulle si aucun n'est daté ; inchangée si la fiche n'a plus de lot en stock).
-- Pertes : lots (numéros, dates par lot, fournisseurs), coûts, journal des mouvements, conditionnements ouverts.
-- À appliquer après les retours arrière de M6 puis M5, puis redéployer le code précédent.
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

DROP TRIGGER "stock_medicament_geler_compteur" ON "StockMedicament";

DO $$
DECLARE
  nombre INTEGER;
  en_cause TEXT;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM (
    SELECT m."stockMedicamentId" FROM "MouvementStock" m GROUP BY m."stockMedicamentId" HAVING sum(m."quantite") < 0
  ) n;
  IF nombre > 0 THEN
    SELECT string_agg(x."stockMedicamentId", ', ' ORDER BY x."stockMedicamentId") INTO en_cause
    FROM (
      SELECT m."stockMedicamentId"
      FROM "MouvementStock" m
      GROUP BY m."stockMedicamentId"
      HAVING sum(m."quantite") < 0
      ORDER BY m."stockMedicamentId"
      LIMIT 50
    ) x;
    RAISE NOTICE 'Retour arrière de M4 : % fiche(s) au stock calculé négatif remises à 0. Fiches en cause (50 au plus) : %', nombre, en_cause;
  END IF;
END $$;

UPDATE "StockMedicament" f
SET "quantite" = c."quantite",
    "disponible" = c."quantite" > 0
FROM (
  SELECT s."id", GREATEST(COALESCE(sum(m."quantite"), 0), 0)::int AS "quantite"
  FROM "StockMedicament" s
  LEFT JOIN "MouvementStock" m ON m."stockMedicamentId" = s."id"
  GROUP BY s."id"
) c
WHERE c."id" = f."id"
  AND (f."quantite" <> c."quantite" OR f."disponible" <> (c."quantite" > 0));

UPDATE "StockMedicament" f
SET "dateExpiration" = d."dateExpiration"::timestamp(3)
FROM (
  SELECT l."stockMedicamentId", min(l."dateExpiration") AS "dateExpiration"
  FROM "LotStock" l
  JOIN (
    SELECT m."lotId", sum(m."quantite") AS "solde"
    FROM "MouvementStock" m
    WHERE m."lotId" IS NOT NULL
    GROUP BY m."lotId"
  ) s ON s."lotId" = l."id"
  WHERE s."solde" > 0
  GROUP BY l."stockMedicamentId"
) d
WHERE d."stockMedicamentId" = f."id"
  AND f."dateExpiration"::date IS DISTINCT FROM d."dateExpiration";

DROP TABLE "ConditionnementOuvert";
DROP TABLE "AgregatStockLot";
DROP TABLE "AgregatStockProduit";
DROP TABLE "MouvementStock";
DROP TABLE "LotStock";

DROP FUNCTION "stock_medicament_geler_compteur"();
DROP FUNCTION "mouvement_stock_agreger"();
DROP FUNCTION "lot_stock_proteger"();
DROP FUNCTION "journal_refuser_modification"();

DROP TYPE "TypePiece";
DROP TYPE "TypeMouvementStock";

COMMIT;
