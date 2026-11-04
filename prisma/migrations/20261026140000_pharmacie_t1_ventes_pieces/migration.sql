-- Tranche pharmacie 1, pièces de vente et allocations de lots (PB09, M6, D419, D421, D422, D430, D431, D514 à D521).
-- DDL généré par prisma migrate diff (schéma de PB08 vers schéma de PB09, partie M6) ; colonnes non
-- nulles ajoutées nullables puis remplies puis contraintes ; contrôles, CHECK, fonctions et triggers
-- écrits à la main. Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
BEGIN;

-- Arrêt (plan, section 2) : toute vente se rattache au point de vente d'ordre 1 de sa pharmacie et à
-- la session technique de ce point de vente (M5).
DO $$
DECLARE
  nombre INTEGER;
  en_cause TEXT;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM "Vente" v
  WHERE NOT EXISTS (
    SELECT 1 FROM "PointDeVente" pv WHERE pv."structureId" = v."structureId" AND pv."ordre" = 1
  );
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT v."id"
      FROM "Vente" v
      WHERE NOT EXISTS (
        SELECT 1 FROM "PointDeVente" pv WHERE pv."structureId" = v."structureId" AND pv."ordre" = 1
      )
      ORDER BY v."id"
      LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M6 arrêtée : % vente(s) appartiennent à une structure sans point de vente. Ventes en cause (50 au plus) : %', nombre, en_cause;
  END IF;

  SELECT count(*)::int INTO nombre
  FROM "Vente" v
  JOIN "PointDeVente" pv ON pv."structureId" = v."structureId" AND pv."ordre" = 1
  WHERE NOT EXISTS (
    SELECT 1 FROM "SessionCaisse" s WHERE s."pointDeVenteId" = pv."id" AND s."technique"
  );
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT v."id"
      FROM "Vente" v
      JOIN "PointDeVente" pv ON pv."structureId" = v."structureId" AND pv."ordre" = 1
      WHERE NOT EXISTS (
        SELECT 1 FROM "SessionCaisse" s WHERE s."pointDeVenteId" = pv."id" AND s."technique"
      )
      ORDER BY v."id"
      LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M6 arrêtée : % vente(s) dont le point de vente n''a pas de session technique de reprise (rejouer le bloc de reprise de M5). Ventes en cause (50 au plus) : %', nombre, en_cause;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "TypePieceVente" AS ENUM ('VENTE', 'ANNULATION', 'REGULARISATION');

-- CreateEnum
CREATE TYPE "UniteVente" AS ENUM ('BOITE', 'UNITE');

-- CreateEnum
CREATE TYPE "StatutAllocation" AS ENUM ('DEFINITIVE', 'PROVISOIRE', 'REMPLACEE');

-- DropForeignKey
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_structureId_fkey";

-- DropForeignKey
ALTER TABLE "LigneVente" DROP CONSTRAINT "LigneVente_venteId_fkey";

-- AlterTable (colonnes non nulles remplies ci-dessous avant SET NOT NULL)
ALTER TABLE "Vente" ADD COLUMN     "horodatageLocal" TIMESTAMP(3),
ADD COLUMN     "jourMetier" DATE,
ADD COLUMN     "jourMetierOrigine" DATE,
ADD COLUMN     "numeroTicket" INTEGER,
ADD COLUMN     "pointDeVenteId" TEXT,
ADD COLUMN     "posteId" TEXT,
ADD COLUMN     "sequencePoste" INTEGER,
ADD COLUMN     "sessionCaisseId" TEXT,
ADD COLUMN     "typePiece" "TypePieceVente" NOT NULL DEFAULT 'VENTE',
ADD COLUMN     "venteOrigineId" TEXT;

-- AlterTable
ALTER TABLE "LigneVente" ADD COLUMN     "coefficientApplique" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "nombreAffiche" INTEGER,
ADD COLUMN     "uniteAffichee" "UniteVente" NOT NULL DEFAULT 'BOITE';

-- Reprise (D421, D422, D518) : ventes historiques rattachées au point de vente d'ordre 1, au poste
-- REPRISE et à la session technique ; jour métier = date de createdAt (horodatage UTC sans fuseau,
-- Conakry est à UTC+0) ; lignes : nombre affiché = quantité, coefficient 1, unité BOITE (défauts).
UPDATE "Vente" v
SET "pointDeVenteId" = pv."id",
    "posteId" = s."posteId",
    "sessionCaisseId" = s."id",
    "jourMetier" = v."createdAt"::date
FROM "PointDeVente" pv
JOIN "SessionCaisse" s ON s."pointDeVenteId" = pv."id" AND s."technique"
WHERE pv."structureId" = v."structureId" AND pv."ordre" = 1;

UPDATE "LigneVente" SET "nombreAffiche" = "quantite";

ALTER TABLE "Vente" ALTER COLUMN "jourMetier" SET NOT NULL,
ALTER COLUMN "pointDeVenteId" SET NOT NULL,
ALTER COLUMN "posteId" SET NOT NULL,
ALTER COLUMN "sessionCaisseId" SET NOT NULL;

ALTER TABLE "LigneVente" ALTER COLUMN "nombreAffiche" SET NOT NULL;

-- CreateTable
CREATE TABLE "AllocationLot" (
    "id" TEXT NOT NULL,
    "ligneVenteId" TEXT NOT NULL,
    "lotId" TEXT,
    "numeroLot" TEXT,
    "dateExpiration" DATE,
    "quantite" INTEGER NOT NULL,
    "coutUnitaire" INTEGER NOT NULL,
    "lotTechnique" BOOLEAN NOT NULL DEFAULT false,
    "statut" "StatutAllocation" NOT NULL,
    "remplaceeParPieceId" TEXT,
    "sortieManuelle" BOOLEAN NOT NULL DEFAULT false,
    "motif" TEXT,
    "auteurId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AllocationLot_ligneVenteId_idx" ON "AllocationLot"("ligneVenteId");

-- CreateIndex
CREATE INDEX "AllocationLot_lotId_idx" ON "AllocationLot"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "Vente_venteOrigineId_key" ON "Vente"("venteOrigineId");

-- CreateIndex
CREATE INDEX "Vente_pointDeVenteId_jourMetier_idx" ON "Vente"("pointDeVenteId", "jourMetier");

-- CreateIndex
CREATE INDEX "Vente_sessionCaisseId_idx" ON "Vente"("sessionCaisseId");

-- CreateIndex
CREATE UNIQUE INDEX "Vente_pointDeVenteId_numeroTicket_key" ON "Vente"("pointDeVenteId", "numeroTicket");

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_posteId_fkey" FOREIGN KEY ("posteId") REFERENCES "Poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_sessionCaisseId_fkey" FOREIGN KEY ("sessionCaisseId") REFERENCES "SessionCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_venteOrigineId_fkey" FOREIGN KEY ("venteOrigineId") REFERENCES "Vente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationLot" ADD CONSTRAINT "AllocationLot_ligneVenteId_fkey" FOREIGN KEY ("ligneVenteId") REFERENCES "LigneVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contraintes (plan 1.4, D470, D519)
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_venteOrigine_check" CHECK (("typePiece" <> 'ANNULATION' OR "venteOrigineId" IS NOT NULL) AND ("typePiece" <> 'VENTE' OR "venteOrigineId" IS NULL));
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_motifAnnulation_check" CHECK ("typePiece" <> 'ANNULATION' OR ("motifAnnulation" IS NOT NULL AND btrim("motifAnnulation") <> ''));
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_coefficientApplique_check" CHECK ("coefficientApplique" >= 1);
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_quantite_check" CHECK ("quantite" = "nombreAffiche" * "coefficientApplique");
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_uniteAffichee_check" CHECK ("uniteAffichee" <> 'UNITE' OR "coefficientApplique" = 1);
ALTER TABLE "AllocationLot" ADD CONSTRAINT "AllocationLot_quantite_check" CHECK ("quantite" <> 0);
ALTER TABLE "AllocationLot" ADD CONSTRAINT "AllocationLot_coutUnitaire_check" CHECK ("coutUnitaire" >= 0);
ALTER TABLE "AllocationLot" ADD CONSTRAINT "AllocationLot_lot_check" CHECK (("statut" = 'DEFINITIVE') = ("lotId" IS NOT NULL));
ALTER TABLE "AllocationLot" ADD CONSTRAINT "AllocationLot_remplacee_check" CHECK (("statut" = 'REMPLACEE') = ("remplaceeParPieceId" IS NOT NULL));
ALTER TABLE "AllocationLot" ADD CONSTRAINT "AllocationLot_motif_check" CHECK (NOT "sortieManuelle" OR ("motif" IS NOT NULL AND btrim("motif") <> ''));

-- Rattachement d'une nouvelle pièce (D520) : point de vente de sa pharmacie, session de ce point de
-- vente et de ce poste, pièce d'origine du même point de vente.
CREATE FUNCTION "vente_verifier_rattachement"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM "PointDeVente" pv
  JOIN "SessionCaisse" s ON s."pointDeVenteId" = pv."id"
  WHERE pv."id" = NEW."pointDeVenteId"
    AND pv."structureId" = NEW."structureId"
    AND s."id" = NEW."sessionCaisseId"
    AND s."posteId" = NEW."posteId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente refusée : le point de vente %, le poste % et la session % ne se rattachent pas à la pharmacie %.', NEW."pointDeVenteId", NEW."posteId", NEW."sessionCaisseId", NEW."structureId";
  END IF;
  IF NEW."venteOrigineId" IS NOT NULL THEN
    PERFORM 1 FROM "Vente" o WHERE o."id" = NEW."venteOrigineId" AND o."pointDeVenteId" = NEW."pointDeVenteId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Vente refusée : la pièce d''origine % n''appartient pas au point de vente %.', NEW."venteOrigineId", NEW."pointDeVenteId";
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "vente_verifier_rattachement"
BEFORE INSERT ON "Vente"
FOR EACH ROW EXECUTE FUNCTION "vente_verifier_rattachement"();

-- Pièces immuables (D431, D496) : vente et lignes, sauf suppression sous contournement de purge.
CREATE TRIGGER "vente_immuable" BEFORE UPDATE OR DELETE ON "Vente" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "vente_sans_troncature" BEFORE TRUNCATE ON "Vente" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "ligne_vente_immuable" BEFORE UPDATE OR DELETE ON "LigneVente" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "ligne_vente_sans_troncature" BEFORE TRUNCATE ON "LigneVente" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();

-- Allocation (D431) : seule mise à jour permise, PROVISOIRE vers REMPLACEE avec la pièce de résolution ;
-- suppression sous contournement seulement.
CREATE FUNCTION "allocation_lot_proteger"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('medconnecte.purge_autorisee', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'L''allocation % ne peut pas être supprimée : une allocation est conservée définitivement.', OLD."id";
  END IF;
  IF OLD."statut" = 'PROVISOIRE'
    AND NEW."statut" = 'REMPLACEE'
    AND NEW."id" IS NOT DISTINCT FROM OLD."id"
    AND NEW."ligneVenteId" IS NOT DISTINCT FROM OLD."ligneVenteId"
    AND NEW."lotId" IS NOT DISTINCT FROM OLD."lotId"
    AND NEW."numeroLot" IS NOT DISTINCT FROM OLD."numeroLot"
    AND NEW."dateExpiration" IS NOT DISTINCT FROM OLD."dateExpiration"
    AND NEW."quantite" IS NOT DISTINCT FROM OLD."quantite"
    AND NEW."coutUnitaire" IS NOT DISTINCT FROM OLD."coutUnitaire"
    AND NEW."lotTechnique" IS NOT DISTINCT FROM OLD."lotTechnique"
    AND NEW."sortieManuelle" IS NOT DISTINCT FROM OLD."sortieManuelle"
    AND NEW."motif" IS NOT DISTINCT FROM OLD."motif"
    AND NEW."auteurId" IS NOT DISTINCT FROM OLD."auteurId"
    AND NEW."createdAt" IS NOT DISTINCT FROM OLD."createdAt" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'L''allocation % ne peut pas être modifiée : seule une allocation PROVISOIRE passe à REMPLACEE, avec sa pièce de résolution.', OLD."id";
END
$$;

CREATE TRIGGER "allocation_lot_proteger"
BEFORE UPDATE OR DELETE ON "AllocationLot"
FOR EACH ROW EXECUTE FUNCTION "allocation_lot_proteger"();

CREATE TRIGGER "allocation_lot_sans_troncature"
BEFORE TRUNCATE ON "AllocationLot"
FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();

COMMIT;
