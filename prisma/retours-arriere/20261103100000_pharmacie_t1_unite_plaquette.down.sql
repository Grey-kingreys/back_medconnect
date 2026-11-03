-- Retour arrière de 20261103100000_pharmacie_t1_unite_plaquette (PB21, M7).
-- PostgreSQL ne retire pas une valeur d'enum : le type UniteMinimale est recréé avec ses 7
-- valeurs d'avant. Refusé tant qu'une fiche produit utilise PLAQUETTE (changer d'abord son
-- unité). Aucune donnée n'est perdue. À appliquer avant le retour des migrations précédentes,
-- puis redéployer le code précédent. Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

DO $$
DECLARE
  nombre integer;
BEGIN
  SELECT count(*) INTO nombre FROM "StockMedicament" WHERE "uniteMinimale" = 'PLAQUETTE';
  IF nombre > 0 THEN
    RAISE EXCEPTION 'Retour arrière refusé : % fiche(s) produit utilisent l''unité PLAQUETTE. Changez leur unité d''abord.', nombre;
  END IF;
END
$$;

ALTER TABLE "StockMedicament" ALTER COLUMN "uniteMinimale" DROP DEFAULT;

ALTER TYPE "UniteMinimale" RENAME TO "UniteMinimale_ancien";

CREATE TYPE "UniteMinimale" AS ENUM ('COMPRIME', 'GELULE', 'ML', 'SACHET', 'GRAMME', 'AMPOULE', 'UNITE');

ALTER TABLE "StockMedicament" ALTER COLUMN "uniteMinimale" TYPE "UniteMinimale" USING ("uniteMinimale"::text::"UniteMinimale");

ALTER TABLE "StockMedicament" ALTER COLUMN "uniteMinimale" SET DEFAULT 'UNITE';

DROP TYPE "UniteMinimale_ancien";

COMMIT;
