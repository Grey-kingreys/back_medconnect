-- Tranche pharmacie 1, fiche produit étendue (PB06, M3, D402, D409 à D411, D485 à D492).
-- DDL généré par prisma migrate diff (schéma de PB05 vers schéma de PB06) ; contraintes CHECK écrites à la main.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- Aucune reprise : chaque fiche existante prend les valeurs par défaut (UNITE, coefficient 1,
-- prix à l'unité nul, non déconditionnable, non qualifiée, non archivée).
BEGIN;

-- CreateEnum
CREATE TYPE "UniteMinimale" AS ENUM ('COMPRIME', 'GELULE', 'ML', 'SACHET', 'GRAMME', 'AMPOULE', 'UNITE');

-- AlterTable
ALTER TABLE "StockMedicament" ADD COLUMN     "archiveLe" TIMESTAMP(3),
ADD COLUMN     "coefficientBoite" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deconditionnable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prixUnite" INTEGER,
ADD COLUMN     "qualifie" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "toleranceInventaire" INTEGER,
ADD COLUMN     "uniteMinimale" "UniteMinimale" NOT NULL DEFAULT 'UNITE';

-- Contraintes de la fiche (plan 1.2, D488)
ALTER TABLE "StockMedicament" ADD CONSTRAINT "StockMedicament_coefficientBoite_check" CHECK ("coefficientBoite" >= 1);
ALTER TABLE "StockMedicament" ADD CONSTRAINT "StockMedicament_prixUnite_deconditionnable_check" CHECK ("deconditionnable" OR "prixUnite" IS NULL);
ALTER TABLE "StockMedicament" ADD CONSTRAINT "StockMedicament_prixUnite_check" CHECK ("prixUnite" IS NULL OR "prixUnite" > 0);
ALTER TABLE "StockMedicament" ADD CONSTRAINT "StockMedicament_toleranceInventaire_check" CHECK ("toleranceInventaire" IS NULL OR "toleranceInventaire" >= 0);

COMMIT;
