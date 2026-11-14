-- Retour arrière de 20261114100000_pharmacie_t2_qualification_lots_reception.
-- Remet la règle d'origine du trigger lot_stock_proteger : le coefficient et le coût ne changent que sur un lot technique.
-- Les lots déjà convertis gardent leur coefficient et leur coût (aucune donnée n'est modifiée).
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

CREATE OR REPLACE FUNCTION "lot_stock_proteger"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('medconnecte.purge_autorisee', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Le lot % ne peut pas être supprimé : un lot de stock est conservé définitivement.', OLD."id";
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM 1
    FROM "StockMedicament" f
    JOIN "PointDeVente" pv ON pv."structureId" = f."structureId"
    WHERE f."id" = NEW."stockMedicamentId" AND pv."id" = NEW."pointDeVenteId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lot refusé : le point de vente % n''appartient pas à la pharmacie de la fiche %.', NEW."pointDeVenteId", NEW."stockMedicamentId";
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."stockMedicamentId" IS DISTINCT FROM OLD."stockMedicamentId"
    OR NEW."pointDeVenteId" IS DISTINCT FROM OLD."pointDeVenteId"
    OR NEW."numeroLot" IS DISTINCT FROM OLD."numeroLot"
    OR NEW."quantiteRecue" IS DISTINCT FROM OLD."quantiteRecue"
    OR NEW."coutAchatBoite" IS DISTINCT FROM OLD."coutAchatBoite"
    OR NEW."fournisseurId" IS DISTINCT FROM OLD."fournisseurId"
    OR NEW."receptionId" IS DISTINCT FROM OLD."receptionId"
    OR NEW."dateReception" IS DISTINCT FROM OLD."dateReception"
    OR NEW."lotTechnique" IS DISTINCT FROM OLD."lotTechnique"
    OR NEW."auteurId" IS DISTINCT FROM OLD."auteurId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Le lot % ne peut pas être modifié : seule sa date de péremption se corrige après la réception.', OLD."id";
  END IF;
  IF NOT OLD."lotTechnique"
    AND (NEW."coefficientReception" IS DISTINCT FROM OLD."coefficientReception"
      OR NEW."coutUnitaire" IS DISTINCT FROM OLD."coutUnitaire") THEN
    RAISE EXCEPTION 'Le lot % ne peut pas être modifié : le coefficient et le coût ne changent que sur un lot technique, à la qualification de la fiche.', OLD."id";
  END IF;
  RETURN NEW;
END
$$;

COMMIT;
