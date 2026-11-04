-- Retour arrière de 20261026110000_pharmacie_t1_fiche_produit (PB06, M3).
-- Retire les contraintes, les colonnes et le type ajoutés par M3 (pertes : unité minimale,
-- coefficient, prix à l'unité, déconditionnement, tolérance, qualification, archivage et date
-- de création des fiches). Le prix de la boîte (prixUnitaire) et la quantité ne sont pas
-- touchés. À appliquer après le retour des migrations suivantes, dans l'ordre inverse, puis
-- redéployer le code précédent. Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

ALTER TABLE "StockMedicament" DROP CONSTRAINT "StockMedicament_toleranceInventaire_check";
ALTER TABLE "StockMedicament" DROP CONSTRAINT "StockMedicament_prixUnite_check";
ALTER TABLE "StockMedicament" DROP CONSTRAINT "StockMedicament_prixUnite_deconditionnable_check";
ALTER TABLE "StockMedicament" DROP CONSTRAINT "StockMedicament_coefficientBoite_check";

ALTER TABLE "StockMedicament" DROP COLUMN "archiveLe",
DROP COLUMN "coefficientBoite",
DROP COLUMN "createdAt",
DROP COLUMN "deconditionnable",
DROP COLUMN "prixUnite",
DROP COLUMN "qualifie",
DROP COLUMN "toleranceInventaire",
DROP COLUMN "uniteMinimale";

DROP TYPE "UniteMinimale";

COMMIT;
