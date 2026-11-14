-- Tranche pharmacie 1, caisse, réceptions, inventaires et synchronisation (PB09, M5, D421, D431, D514 à D521).
-- DDL généré par prisma migrate diff (schéma de PB08 vers schéma de PB09, partie M5) ; contrôles,
-- CHECK, fonctions, triggers et reprise écrits à la main.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
BEGIN;

-- Arrêt (plan, section 2) : chaque point de vente a son poste technique REPRISE (M2, D484).
DO $$
DECLARE
  nombre INTEGER;
  en_cause TEXT;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM "PointDeVente" pv
  WHERE NOT EXISTS (
    SELECT 1 FROM "Poste" p WHERE p."pointDeVenteId" = pv."id" AND p."code" = 'REPRISE' AND p."type" = 'TECHNIQUE'
  );
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT pv."id"
      FROM "PointDeVente" pv
      WHERE NOT EXISTS (
        SELECT 1 FROM "Poste" p WHERE p."pointDeVenteId" = pv."id" AND p."code" = 'REPRISE' AND p."type" = 'TECHNIQUE'
      )
      ORDER BY pv."id"
      LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M5 arrêtée : % point(s) de vente sans poste technique REPRISE. Points de vente en cause (50 au plus) : %', nombre, en_cause;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "StatutSession" AS ENUM ('OUVERTE', 'FERMEE', 'INCLUSE_DANS_CLOTURE');

-- CreateEnum
CREATE TYPE "MomentComptage" AS ENUM ('OUVERTURE', 'FERMETURE');

-- CreateEnum
CREATE TYPE "TypeMouvementCaisse" AS ENUM ('PRELEVEMENT', 'APPORT', 'REMBOURSEMENT');

-- CreateEnum
CREATE TYPE "StatutEvenementSynchro" AS ENUM ('APPLIQUE', 'EN_ATTENTE', 'REJETE');

-- CreateTable
CREATE TABLE "SessionCaisse" (
    "id" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "posteId" TEXT NOT NULL,
    "utilisateurId" TEXT,
    "utilisateurNom" TEXT NOT NULL,
    "statut" "StatutSession" NOT NULL DEFAULT 'OUVERTE',
    "technique" BOOLEAN NOT NULL DEFAULT false,
    "jourMetier" DATE NOT NULL,
    "jourMetierOrigine" DATE,
    "ouverteLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ouverteLeLocal" TIMESTAMP(3),
    "fermeeLe" TIMESTAMP(3),
    "fermeeLeLocal" TIMESTAMP(3),
    "evenementOuvertureId" TEXT NOT NULL,
    "evenementFermetureId" TEXT,
    "commentaireEcart" TEXT,
    "commentaireParId" TEXT,
    "clotureJournaliereId" TEXT,

    CONSTRAINT "SessionCaisse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComptageCaisse" (
    "id" TEXT NOT NULL,
    "sessionCaisseId" TEXT NOT NULL,
    "moment" "MomentComptage" NOT NULL,
    "totalEspeces" INTEGER NOT NULL,
    "auteurId" TEXT NOT NULL,
    "evenementId" TEXT NOT NULL,
    "horodatageLocal" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComptageCaisse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneComptage" (
    "id" TEXT NOT NULL,
    "comptageId" TEXT NOT NULL,
    "valeurFaciale" INTEGER NOT NULL,
    "nombre" INTEGER NOT NULL,

    CONSTRAINT "LigneComptage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleveModePaiement" (
    "id" TEXT NOT NULL,
    "comptageId" TEXT NOT NULL,
    "modePaiementId" TEXT NOT NULL,
    "montantDeclare" INTEGER NOT NULL,

    CONSTRAINT "ReleveModePaiement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementCaisse" (
    "id" TEXT NOT NULL,
    "sessionCaisseId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "type" "TypeMouvementCaisse" NOT NULL,
    "modePaiementId" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "motif" TEXT NOT NULL,
    "auteurId" TEXT NOT NULL,
    "horodatageServeur" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horodatageLocal" TIMESTAMP(3),
    "evenementId" TEXT NOT NULL,

    CONSTRAINT "MouvementCaisse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paiement" (
    "id" TEXT NOT NULL,
    "venteId" TEXT NOT NULL,
    "sessionCaisseId" TEXT NOT NULL,
    "modePaiementId" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "referenceExterne" TEXT,
    "montantRecu" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Paiement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultatSessionMode" (
    "id" TEXT NOT NULL,
    "sessionCaisseId" TEXT NOT NULL,
    "modePaiementId" TEXT NOT NULL,
    "theorique" INTEGER NOT NULL,
    "compte" INTEGER,
    "ecart" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultatSessionMode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClotureJournaliere" (
    "id" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "jourMetier" DATE NOT NULL,
    "clotureParId" TEXT NOT NULL,
    "clotureeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forcee" BOOLEAN NOT NULL DEFAULT false,
    "motifForcage" TEXT,
    "postesManquants" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ClotureJournaliere_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TotalClotureMode" (
    "id" TEXT NOT NULL,
    "clotureId" TEXT NOT NULL,
    "modePaiementId" TEXT NOT NULL,
    "theorique" INTEGER NOT NULL,
    "compte" INTEGER,
    "ecart" INTEGER,

    CONSTRAINT "TotalClotureMode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reception" (
    "id" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "fournisseurId" TEXT,
    "reference" TEXT,
    "recueLe" TIMESTAMP(3) NOT NULL,
    "auteurId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventaire" (
    "id" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "auteurId" TEXT NOT NULL,
    "commentaire" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inventaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneInventaire" (
    "id" TEXT NOT NULL,
    "inventaireId" TEXT NOT NULL,
    "stockMedicamentId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantiteTheorique" INTEGER NOT NULL,
    "quantiteComptee" INTEGER NOT NULL,
    "ecart" INTEGER NOT NULL,
    "sousTolerance" BOOLEAN NOT NULL,
    "anomalieId" TEXT,

    CONSTRAINT "LigneInventaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvenementSynchro" (
    "id" TEXT NOT NULL,
    "evenementId" TEXT NOT NULL,
    "posteId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "utilisateurId" TEXT,
    "horodatageLocal" TIMESTAMP(3),
    "recuLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statut" "StatutEvenementSynchro" NOT NULL,
    "empreinte" TEXT NOT NULL,
    "corps" JSONB NOT NULL,
    "resultat" JSONB,

    CONSTRAINT "EvenementSynchro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionCaisse_evenementOuvertureId_key" ON "SessionCaisse"("evenementOuvertureId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionCaisse_evenementFermetureId_key" ON "SessionCaisse"("evenementFermetureId");

-- CreateIndex
CREATE INDEX "SessionCaisse_pointDeVenteId_jourMetier_idx" ON "SessionCaisse"("pointDeVenteId", "jourMetier");

-- CreateIndex
CREATE INDEX "SessionCaisse_clotureJournaliereId_idx" ON "SessionCaisse"("clotureJournaliereId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionCaisse_posteId_ouverte_key" ON "SessionCaisse"("posteId") WHERE ("statut" = 'OUVERTE');

-- CreateIndex
CREATE UNIQUE INDEX "ComptageCaisse_evenementId_key" ON "ComptageCaisse"("evenementId");

-- CreateIndex
CREATE UNIQUE INDEX "ComptageCaisse_sessionCaisseId_moment_key" ON "ComptageCaisse"("sessionCaisseId", "moment");

-- CreateIndex
CREATE UNIQUE INDEX "LigneComptage_comptageId_valeurFaciale_key" ON "LigneComptage"("comptageId", "valeurFaciale");

-- CreateIndex
CREATE UNIQUE INDEX "ReleveModePaiement_comptageId_modePaiementId_key" ON "ReleveModePaiement"("comptageId", "modePaiementId");

-- CreateIndex
CREATE UNIQUE INDEX "MouvementCaisse_evenementId_key" ON "MouvementCaisse"("evenementId");

-- CreateIndex
CREATE INDEX "MouvementCaisse_sessionCaisseId_idx" ON "MouvementCaisse"("sessionCaisseId");

-- CreateIndex
CREATE INDEX "Paiement_venteId_idx" ON "Paiement"("venteId");

-- CreateIndex
CREATE INDEX "Paiement_sessionCaisseId_modePaiementId_idx" ON "Paiement"("sessionCaisseId", "modePaiementId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultatSessionMode_sessionCaisseId_modePaiementId_key" ON "ResultatSessionMode"("sessionCaisseId", "modePaiementId");

-- CreateIndex
CREATE UNIQUE INDEX "ClotureJournaliere_pointDeVenteId_jourMetier_key" ON "ClotureJournaliere"("pointDeVenteId", "jourMetier");

-- CreateIndex
CREATE UNIQUE INDEX "TotalClotureMode_clotureId_modePaiementId_key" ON "TotalClotureMode"("clotureId", "modePaiementId");

-- CreateIndex
CREATE INDEX "Reception_pointDeVenteId_recueLe_idx" ON "Reception"("pointDeVenteId", "recueLe");

-- CreateIndex
CREATE INDEX "Inventaire_pointDeVenteId_createdAt_idx" ON "Inventaire"("pointDeVenteId", "createdAt");

-- CreateIndex
CREATE INDEX "LigneInventaire_inventaireId_idx" ON "LigneInventaire"("inventaireId");

-- CreateIndex
CREATE INDEX "LigneInventaire_lotId_idx" ON "LigneInventaire"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "EvenementSynchro_evenementId_key" ON "EvenementSynchro"("evenementId");

-- CreateIndex
CREATE INDEX "EvenementSynchro_posteId_statut_idx" ON "EvenementSynchro"("posteId", "statut");

-- CreateIndex
CREATE UNIQUE INDEX "EvenementSynchro_posteId_sequence_key" ON "EvenementSynchro"("posteId", "sequence");

-- AddForeignKey
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_receptionId_fkey" FOREIGN KEY ("receptionId") REFERENCES "Reception"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_posteId_fkey" FOREIGN KEY ("posteId") REFERENCES "Poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_clotureJournaliereId_fkey" FOREIGN KEY ("clotureJournaliereId") REFERENCES "ClotureJournaliere"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComptageCaisse" ADD CONSTRAINT "ComptageCaisse_sessionCaisseId_fkey" FOREIGN KEY ("sessionCaisseId") REFERENCES "SessionCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneComptage" ADD CONSTRAINT "LigneComptage_comptageId_fkey" FOREIGN KEY ("comptageId") REFERENCES "ComptageCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleveModePaiement" ADD CONSTRAINT "ReleveModePaiement_comptageId_fkey" FOREIGN KEY ("comptageId") REFERENCES "ComptageCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleveModePaiement" ADD CONSTRAINT "ReleveModePaiement_modePaiementId_fkey" FOREIGN KEY ("modePaiementId") REFERENCES "ModePaiement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementCaisse" ADD CONSTRAINT "MouvementCaisse_sessionCaisseId_fkey" FOREIGN KEY ("sessionCaisseId") REFERENCES "SessionCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementCaisse" ADD CONSTRAINT "MouvementCaisse_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementCaisse" ADD CONSTRAINT "MouvementCaisse_modePaiementId_fkey" FOREIGN KEY ("modePaiementId") REFERENCES "ModePaiement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_sessionCaisseId_fkey" FOREIGN KEY ("sessionCaisseId") REFERENCES "SessionCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_modePaiementId_fkey" FOREIGN KEY ("modePaiementId") REFERENCES "ModePaiement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultatSessionMode" ADD CONSTRAINT "ResultatSessionMode_sessionCaisseId_fkey" FOREIGN KEY ("sessionCaisseId") REFERENCES "SessionCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultatSessionMode" ADD CONSTRAINT "ResultatSessionMode_modePaiementId_fkey" FOREIGN KEY ("modePaiementId") REFERENCES "ModePaiement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClotureJournaliere" ADD CONSTRAINT "ClotureJournaliere_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotalClotureMode" ADD CONSTRAINT "TotalClotureMode_clotureId_fkey" FOREIGN KEY ("clotureId") REFERENCES "ClotureJournaliere"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotalClotureMode" ADD CONSTRAINT "TotalClotureMode_modePaiementId_fkey" FOREIGN KEY ("modePaiementId") REFERENCES "ModePaiement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reception" ADD CONSTRAINT "Reception_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reception" ADD CONSTRAINT "Reception_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventaire" ADD CONSTRAINT "Inventaire_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_inventaireId_fkey" FOREIGN KEY ("inventaireId") REFERENCES "Inventaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_stockMedicamentId_fkey" FOREIGN KEY ("stockMedicamentId") REFERENCES "StockMedicament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_anomalieId_fkey" FOREIGN KEY ("anomalieId") REFERENCES "Anomalie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvenementSynchro" ADD CONSTRAINT "EvenementSynchro_posteId_fkey" FOREIGN KEY ("posteId") REFERENCES "Poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contraintes (plan 1.5 et 1.6, D516)
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_utilisateur_check" CHECK ("technique" OR "utilisateurId" IS NOT NULL);
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_fermeture_check" CHECK (("statut" = 'OUVERTE') = ("fermeeLe" IS NULL));
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_cloture_check" CHECK (("statut" = 'INCLUSE_DANS_CLOTURE') = ("clotureJournaliereId" IS NOT NULL));
ALTER TABLE "ComptageCaisse" ADD CONSTRAINT "ComptageCaisse_totalEspeces_check" CHECK ("totalEspeces" >= 0);
ALTER TABLE "LigneComptage" ADD CONSTRAINT "LigneComptage_valeurFaciale_check" CHECK ("valeurFaciale" > 0);
ALTER TABLE "LigneComptage" ADD CONSTRAINT "LigneComptage_nombre_check" CHECK ("nombre" >= 0);
ALTER TABLE "ReleveModePaiement" ADD CONSTRAINT "ReleveModePaiement_montantDeclare_check" CHECK ("montantDeclare" >= 0);
ALTER TABLE "MouvementCaisse" ADD CONSTRAINT "MouvementCaisse_montant_check" CHECK ("montant" > 0);
ALTER TABLE "MouvementCaisse" ADD CONSTRAINT "MouvementCaisse_motif_check" CHECK (btrim("motif") <> '');
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_montant_check" CHECK ("montant" <> 0);
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_montantRecu_check" CHECK ("montantRecu" IS NULL OR "montantRecu" >= 0);
ALTER TABLE "ResultatSessionMode" ADD CONSTRAINT "ResultatSessionMode_ecart_check" CHECK (("compte" IS NULL AND "ecart" IS NULL) OR ("compte" IS NOT NULL AND "ecart" IS NOT NULL AND "ecart" = "compte" - "theorique"));
ALTER TABLE "ClotureJournaliere" ADD CONSTRAINT "ClotureJournaliere_forcage_check" CHECK (NOT "forcee" OR ("motifForcage" IS NOT NULL AND btrim("motifForcage") <> ''));
ALTER TABLE "TotalClotureMode" ADD CONSTRAINT "TotalClotureMode_ecart_check" CHECK (("compte" IS NULL AND "ecart" IS NULL) OR ("compte" IS NOT NULL AND "ecart" IS NOT NULL AND "ecart" = "compte" - "theorique"));
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_quantiteComptee_check" CHECK ("quantiteComptee" >= 0);
ALTER TABLE "LigneInventaire" ADD CONSTRAINT "LigneInventaire_ecart_check" CHECK ("ecart" = "quantiteComptee" - "quantiteTheorique");
ALTER TABLE "EvenementSynchro" ADD CONSTRAINT "EvenementSynchro_sequence_check" CHECK ("sequence" >= 1);

-- Pièces immuables (D431, D496) : ni modification, ni suppression, ni troncature, sauf suppression
-- et troncature sous le contournement de purge. Fonction journal_refuser_modification de M4.
CREATE TRIGGER "comptage_caisse_immuable" BEFORE UPDATE OR DELETE ON "ComptageCaisse" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "comptage_caisse_sans_troncature" BEFORE TRUNCATE ON "ComptageCaisse" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "ligne_comptage_immuable" BEFORE UPDATE OR DELETE ON "LigneComptage" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "ligne_comptage_sans_troncature" BEFORE TRUNCATE ON "LigneComptage" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "releve_mode_paiement_immuable" BEFORE UPDATE OR DELETE ON "ReleveModePaiement" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "releve_mode_paiement_sans_troncature" BEFORE TRUNCATE ON "ReleveModePaiement" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "mouvement_caisse_immuable" BEFORE UPDATE OR DELETE ON "MouvementCaisse" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "mouvement_caisse_sans_troncature" BEFORE TRUNCATE ON "MouvementCaisse" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "paiement_immuable" BEFORE UPDATE OR DELETE ON "Paiement" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "paiement_sans_troncature" BEFORE TRUNCATE ON "Paiement" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "resultat_session_mode_immuable" BEFORE UPDATE OR DELETE ON "ResultatSessionMode" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "resultat_session_mode_sans_troncature" BEFORE TRUNCATE ON "ResultatSessionMode" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "cloture_journaliere_immuable" BEFORE UPDATE OR DELETE ON "ClotureJournaliere" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "cloture_journaliere_sans_troncature" BEFORE TRUNCATE ON "ClotureJournaliere" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "total_cloture_mode_immuable" BEFORE UPDATE OR DELETE ON "TotalClotureMode" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "total_cloture_mode_sans_troncature" BEFORE TRUNCATE ON "TotalClotureMode" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "reception_immuable" BEFORE UPDATE OR DELETE ON "Reception" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "reception_sans_troncature" BEFORE TRUNCATE ON "Reception" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "inventaire_immuable" BEFORE UPDATE OR DELETE ON "Inventaire" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "inventaire_sans_troncature" BEFORE TRUNCATE ON "Inventaire" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "ligne_inventaire_immuable" BEFORE UPDATE OR DELETE ON "LigneInventaire" FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();
CREATE TRIGGER "ligne_inventaire_sans_troncature" BEFORE TRUNCATE ON "LigneInventaire" FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();

-- Session de caisse (D431, D515) : poste du même point de vente, technique si et seulement si le poste
-- l'est ; transitions OUVERTE vers FERMEE et FERMEE vers INCLUSE_DANS_CLOTURE seulement ; session
-- technique jamais modifiée ; suppression d'une session technique permise (suppression d'une pharmacie
-- sans pièce, les ventes historiques la protègent par leur clé étrangère), des autres sous contournement.
CREATE FUNCTION "session_caisse_proteger"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."technique" OR current_setting('medconnecte.purge_autorisee', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'La session de caisse % ne peut pas être supprimée : une session est conservée définitivement.', OLD."id";
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM 1
    FROM "Poste" p
    WHERE p."id" = NEW."posteId"
      AND p."pointDeVenteId" = NEW."pointDeVenteId"
      AND (p."type" = 'TECHNIQUE') = NEW."technique";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Session refusée : le poste % n''appartient pas au point de vente %, ou son type ne correspond pas (une session technique va sur le poste technique, et seulement elle).', NEW."posteId", NEW."pointDeVenteId";
    END IF;
    RETURN NEW;
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;
  IF OLD."technique" THEN
    RAISE EXCEPTION 'La session technique % ne se modifie pas.', OLD."id";
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."pointDeVenteId" IS DISTINCT FROM OLD."pointDeVenteId"
    OR NEW."posteId" IS DISTINCT FROM OLD."posteId"
    OR NEW."utilisateurId" IS DISTINCT FROM OLD."utilisateurId"
    OR NEW."utilisateurNom" IS DISTINCT FROM OLD."utilisateurNom"
    OR NEW."technique" IS DISTINCT FROM OLD."technique"
    OR NEW."jourMetier" IS DISTINCT FROM OLD."jourMetier"
    OR NEW."jourMetierOrigine" IS DISTINCT FROM OLD."jourMetierOrigine"
    OR NEW."ouverteLe" IS DISTINCT FROM OLD."ouverteLe"
    OR NEW."ouverteLeLocal" IS DISTINCT FROM OLD."ouverteLeLocal"
    OR NEW."evenementOuvertureId" IS DISTINCT FROM OLD."evenementOuvertureId" THEN
    RAISE EXCEPTION 'La session de caisse % ne peut pas être modifiée : seules sa fermeture et son inclusion dans une clôture s''enregistrent.', OLD."id";
  END IF;
  IF OLD."statut" = 'OUVERTE' AND NEW."statut" = 'FERMEE' THEN
    RETURN NEW;
  END IF;
  IF OLD."statut" = 'FERMEE' AND NEW."statut" = 'INCLUSE_DANS_CLOTURE'
    AND NEW."fermeeLe" IS NOT DISTINCT FROM OLD."fermeeLe"
    AND NEW."fermeeLeLocal" IS NOT DISTINCT FROM OLD."fermeeLeLocal"
    AND NEW."evenementFermetureId" IS NOT DISTINCT FROM OLD."evenementFermetureId"
    AND NEW."commentaireEcart" IS NOT DISTINCT FROM OLD."commentaireEcart"
    AND NEW."commentaireParId" IS NOT DISTINCT FROM OLD."commentaireParId" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Session de caisse % : modification refusée (statut % vers %). Seules les transitions OUVERTE vers FERMEE et FERMEE vers INCLUSE_DANS_CLOTURE sont permises.', OLD."id", OLD."statut", NEW."statut";
END
$$;

CREATE TRIGGER "session_caisse_proteger"
BEFORE INSERT OR UPDATE OR DELETE ON "SessionCaisse"
FOR EACH ROW EXECUTE FUNCTION "session_caisse_proteger"();

CREATE TRIGGER "session_caisse_sans_troncature"
BEFORE TRUNCATE ON "SessionCaisse"
FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();

-- Événement de synchronisation (D431) : seule la sortie de EN_ATTENTE vers APPLIQUE ou REJETE,
-- avec son résultat ; suppression sous contournement seulement.
CREATE FUNCTION "evenement_synchro_proteger"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('medconnecte.purge_autorisee', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'L''événement de synchronisation % ne peut pas être supprimé.', OLD."evenementId";
  END IF;
  IF OLD."statut" = 'EN_ATTENTE'
    AND NEW."statut" IN ('APPLIQUE', 'REJETE')
    AND NEW."id" IS NOT DISTINCT FROM OLD."id"
    AND NEW."evenementId" IS NOT DISTINCT FROM OLD."evenementId"
    AND NEW."posteId" IS NOT DISTINCT FROM OLD."posteId"
    AND NEW."sequence" IS NOT DISTINCT FROM OLD."sequence"
    AND NEW."type" IS NOT DISTINCT FROM OLD."type"
    AND NEW."utilisateurId" IS NOT DISTINCT FROM OLD."utilisateurId"
    AND NEW."horodatageLocal" IS NOT DISTINCT FROM OLD."horodatageLocal"
    AND NEW."recuLe" IS NOT DISTINCT FROM OLD."recuLe"
    AND NEW."empreinte" IS NOT DISTINCT FROM OLD."empreinte"
    AND NEW."corps" IS NOT DISTINCT FROM OLD."corps" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Événement de synchronisation % : seule la sortie de EN_ATTENTE vers APPLIQUE ou REJETE, avec son résultat, est permise.', OLD."evenementId";
END
$$;

CREATE TRIGGER "evenement_synchro_proteger"
BEFORE UPDATE OR DELETE ON "EvenementSynchro"
FOR EACH ROW EXECUTE FUNCTION "evenement_synchro_proteger"();

CREATE TRIGGER "evenement_synchro_sans_troncature"
BEFORE TRUNCATE ON "EvenementSynchro"
FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();

-- REPRISE: DEBUT (rejouable sans doublon, D421, D517)
-- Une session technique fermée par point de vente, sur son poste REPRISE, ouverte à la première vente
-- de la pharmacie (sinon à la migration), jour métier = jour UTC de l'ouverture (Conakry, UTC+0).
INSERT INTO "SessionCaisse" ("id", "pointDeVenteId", "posteId", "utilisateurId", "utilisateurNom", "statut", "technique", "jourMetier", "ouverteLe", "fermeeLe", "evenementOuvertureId")
SELECT gen_random_uuid()::text, pv."id", p."id", NULL, 'Reprise historique', 'FERMEE', true, o."ouverteLe"::date, o."ouverteLe", (now() AT TIME ZONE 'UTC')::timestamp(3), 'reprise:' || pv."id"
FROM "PointDeVente" pv
JOIN "Poste" p ON p."pointDeVenteId" = pv."id" AND p."code" = 'REPRISE' AND p."type" = 'TECHNIQUE'
CROSS JOIN LATERAL (
  SELECT COALESCE(min(v."createdAt"), (now() AT TIME ZONE 'UTC')::timestamp(3)) AS "ouverteLe"
  FROM "Vente" v
  WHERE v."structureId" = pv."structureId"
) o
WHERE NOT EXISTS (
  SELECT 1 FROM "SessionCaisse" s WHERE s."pointDeVenteId" = pv."id" AND s."technique"
)
ON CONFLICT ("evenementOuvertureId") DO NOTHING;
-- REPRISE: FIN

-- Contrôle final : une session technique et une seule par point de vente.
DO $$
DECLARE
  nombre INTEGER;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM "PointDeVente" pv
  WHERE (SELECT count(*) FROM "SessionCaisse" s WHERE s."pointDeVenteId" = pv."id" AND s."technique") <> 1;
  IF nombre > 0 THEN
    RAISE EXCEPTION 'Migration M5 arrêtée : % point(s) de vente sans session technique de reprise unique.', nombre;
  END IF;
END $$;

COMMIT;
