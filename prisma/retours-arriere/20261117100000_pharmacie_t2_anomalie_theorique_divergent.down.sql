-- Retour arrière de 20261117100000_pharmacie_t2_anomalie_theorique_divergent (inventaire hors ligne).
-- PostgreSQL ne retire pas une valeur d'enum : le type TypeAnomalie est recréé avec ses 15 valeurs d'avant.
-- Refusé tant qu'une anomalie THEORIQUE_DIVERGENT existe (traitez-les d'abord ou supprimez-les
-- explicitement, une anomalie n'est jamais effacée en silence). Aucune autre donnée n'est perdue.
-- À appliquer avant le retour des migrations précédentes, puis redéployer le code précédent.
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

DO $$
DECLARE
  nombre integer;
BEGIN
  SELECT count(*) INTO nombre FROM "Anomalie" WHERE "type"::text = 'THEORIQUE_DIVERGENT';
  IF nombre > 0 THEN
    RAISE EXCEPTION 'Retour arrière refusé : % anomalie(s) THEORIQUE_DIVERGENT existent. Supprimez-les d''abord.', nombre;
  END IF;
END
$$;

ALTER TYPE "TypeAnomalie" RENAME TO "TypeAnomalie_ancien";

CREATE TYPE "TypeAnomalie" AS ENUM ('STOCK_NEGATIF', 'ECART_INVENTAIRE', 'CONDITIONNEMENT_CONCURRENT', 'REMONTEE_APRES_CLOTURE', 'ECART_CAISSE', 'FOND_NON_COMPTE', 'PLAGE_EPUISEE', 'PRIX_DIVERGENT', 'ORDONNANCE_NON_CONFIRMEE', 'VENTE_UNITE_INTERDITE', 'PRODUIT_ARCHIVE', 'EVENEMENT_REJETE', 'SEQUENCE_MANQUANTE', 'RECEPTION_COEFFICIENT_DIFFERENT', 'FICHE_MODIFIEE_ENTRETEMPS');

ALTER TABLE "Anomalie" ALTER COLUMN "type" TYPE "TypeAnomalie" USING ("type"::text::"TypeAnomalie");

DROP TYPE "TypeAnomalie_ancien";

COMMIT;
