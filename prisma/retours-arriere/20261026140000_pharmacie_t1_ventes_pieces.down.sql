-- Retour arrière de 20261026140000_pharmacie_t1_ventes_pieces (PB09, M6).
-- Chaque pièce d'annulation est reportée sur sa vente d'origine (statut ANNULEE, annuleeLe = date de la
-- pièce, annuleeParId = son auteur, motifAnnulation = son motif), puis supprimée avec ses lignes et ses
-- paiements. Les pièces de régularisation et les ventes T- restent des ventes (ce sont des ventes réelles).
-- Les mouvements de stock des annulations restent dans le journal : le retour de M4 en tient compte.
-- Pertes : allocations de lots, unité affichée, rattachement des ventes au point de vente, au poste et à
-- la session, jour métier. Clés étrangères de Vente vers Structure et de LigneVente vers Vente remises
-- en Cascade. À appliquer avant le retour de M5, puis redéployer le code précédent.
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

-- Contournement de purge (local à la transaction) : suppression des paiements des annulations.
SELECT set_config('medconnecte.purge_autorisee', 'on', true);

DROP TRIGGER "vente_immuable" ON "Vente";
DROP TRIGGER "vente_sans_troncature" ON "Vente";
DROP TRIGGER "vente_verifier_rattachement" ON "Vente";
DROP TRIGGER "ligne_vente_immuable" ON "LigneVente";
DROP TRIGGER "ligne_vente_sans_troncature" ON "LigneVente";

DO $$
DECLARE
  nombre INTEGER;
BEGIN
  SELECT count(*)::int INTO nombre FROM "Vente" WHERE "typePiece" = 'ANNULATION';
  IF nombre > 0 THEN
    RAISE NOTICE 'Retour arrière de M6 : % pièce(s) d''annulation reportées sur leur vente d''origine puis supprimées.', nombre;
  END IF;
END $$;

UPDATE "Vente" o
SET "statut" = 'ANNULEE',
    "annuleeLe" = a."createdAt",
    "annuleeParId" = a."vendeurId",
    "motifAnnulation" = a."motifAnnulation"
FROM "Vente" a
WHERE a."typePiece" = 'ANNULATION' AND a."venteOrigineId" = o."id";

DELETE FROM "Paiement" p
USING "Vente" a
WHERE p."venteId" = a."id" AND a."typePiece" = 'ANNULATION';

DROP TABLE "AllocationLot";

DELETE FROM "LigneVente" l
USING "Vente" a
WHERE l."venteId" = a."id" AND a."typePiece" = 'ANNULATION';

ALTER TABLE "Vente" DROP CONSTRAINT "Vente_venteOrigineId_fkey";

DELETE FROM "Vente" WHERE "typePiece" = 'ANNULATION';

ALTER TABLE "Vente" DROP CONSTRAINT "Vente_structureId_fkey";
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_pointDeVenteId_fkey";
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_posteId_fkey";
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_sessionCaisseId_fkey";
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_venteOrigine_check";
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_motifAnnulation_check";
ALTER TABLE "LigneVente" DROP CONSTRAINT "LigneVente_venteId_fkey";
ALTER TABLE "LigneVente" DROP CONSTRAINT "LigneVente_coefficientApplique_check";
ALTER TABLE "LigneVente" DROP CONSTRAINT "LigneVente_quantite_check";
ALTER TABLE "LigneVente" DROP CONSTRAINT "LigneVente_uniteAffichee_check";

DROP INDEX "Vente_venteOrigineId_key";
DROP INDEX "Vente_pointDeVenteId_jourMetier_idx";
DROP INDEX "Vente_sessionCaisseId_idx";
DROP INDEX "Vente_pointDeVenteId_numeroTicket_key";

ALTER TABLE "Vente" DROP COLUMN "horodatageLocal",
DROP COLUMN "jourMetier",
DROP COLUMN "jourMetierOrigine",
DROP COLUMN "numeroTicket",
DROP COLUMN "pointDeVenteId",
DROP COLUMN "posteId",
DROP COLUMN "sequencePoste",
DROP COLUMN "sessionCaisseId",
DROP COLUMN "typePiece",
DROP COLUMN "venteOrigineId";

ALTER TABLE "LigneVente" DROP COLUMN "coefficientApplique",
DROP COLUMN "nombreAffiche",
DROP COLUMN "uniteAffichee";

ALTER TABLE "Vente" ADD CONSTRAINT "Vente_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP FUNCTION "allocation_lot_proteger"();
DROP FUNCTION "vente_verifier_rattachement"();

DROP TYPE "StatutAllocation";
DROP TYPE "UniteVente";
DROP TYPE "TypePieceVente";

SELECT set_config('medconnecte.purge_autorisee', 'off', true);

COMMIT;
