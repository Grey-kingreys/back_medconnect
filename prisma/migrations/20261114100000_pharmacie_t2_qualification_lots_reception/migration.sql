-- Qualification d'une fiche avec du stock reçu par réception ou import (D557 étendu).
-- Le trigger lot_stock_proteger n'autorisait la mise à jour de coefficientReception et coutUnitaire que
-- sur un lot technique. Il l'autorise aussi sur un lot non technique dont le coefficient vaut 1 et passe
-- à 2 ou plus (conversion des boîtes en unités). Toute autre modification d'un lot reste refusée.
-- Retour arrière : prisma/retours-arriere/20261114100000_pharmacie_t2_qualification_lots_reception.down.sql.
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
  -- Qualification de la fiche (PB13) : un lot reçu à 1 unité par boîte prend le nouveau coefficient (au moins 2) et son coût par unité.
  IF NOT OLD."lotTechnique"
    AND (NEW."coefficientReception" IS DISTINCT FROM OLD."coefficientReception"
      OR NEW."coutUnitaire" IS DISTINCT FROM OLD."coutUnitaire")
    AND NOT (OLD."coefficientReception" = 1 AND NEW."coefficientReception" >= 2) THEN
    RAISE EXCEPTION 'Le lot % ne peut pas être modifié : le coefficient et le coût ne changent que sur un lot technique, ou sur un lot reçu à 1 unité par boîte à la qualification de la fiche.', OLD."id";
  END IF;
  RETURN NEW;
END
$$;

COMMIT;
