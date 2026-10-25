-- Retour arrière de 20261026130000_pharmacie_t1_caisse (PB09, M5).
-- Refusé tant que M6 est en place (les ventes référencent les sessions) : appliquer d'abord le retour
-- de M6. Valable ensuite même après activité réelle ; pertes, comptées par un NOTICE : sessions de
-- caisse, comptages, relevés, mouvements de caisse, paiements, résultats, clôtures, réceptions
-- (LotStock.receptionId remis à nul, le trigger de protection du lot suspendu le temps de l'écriture),
-- inventaires et événements de synchronisation. À appliquer avant le retour de M4, puis redéployer le code précédent.
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

DO $$
DECLARE
  sessions INTEGER;
  paiements INTEGER;
  clotures INTEGER;
  receptions INTEGER;
  inventaires INTEGER;
  evenements INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'Vente' AND column_name = 'sessionCaisseId'
  ) THEN
    RAISE EXCEPTION 'Retour arrière de M5 refusé : appliquer d''abord le retour arrière de M6 (20261026140000_pharmacie_t1_ventes_pieces.down.sql).';
  END IF;
  SELECT count(*)::int INTO sessions FROM "SessionCaisse" WHERE NOT "technique";
  SELECT count(*)::int INTO paiements FROM "Paiement";
  SELECT count(*)::int INTO clotures FROM "ClotureJournaliere";
  SELECT count(*)::int INTO receptions FROM "Reception";
  SELECT count(*)::int INTO inventaires FROM "Inventaire";
  SELECT count(*)::int INTO evenements FROM "EvenementSynchro";
  IF sessions + paiements + clotures + receptions + inventaires + evenements > 0 THEN
    RAISE NOTICE 'Retour arrière de M5 : supprimés % session(s) de caisse, % paiement(s), % clôture(s), % réception(s), % inventaire(s), % événement(s) de synchronisation.', sessions, paiements, clotures, receptions, inventaires, evenements;
  END IF;
END $$;

ALTER TABLE "LotStock" DROP CONSTRAINT "LotStock_receptionId_fkey";

ALTER TABLE "LotStock" DISABLE TRIGGER "lot_stock_proteger";
UPDATE "LotStock" SET "receptionId" = NULL WHERE "receptionId" IS NOT NULL;
ALTER TABLE "LotStock" ENABLE TRIGGER "lot_stock_proteger";

DROP TABLE "TotalClotureMode";
DROP TABLE "ResultatSessionMode";
DROP TABLE "Paiement";
DROP TABLE "MouvementCaisse";
DROP TABLE "ReleveModePaiement";
DROP TABLE "LigneComptage";
DROP TABLE "ComptageCaisse";
DROP TABLE "SessionCaisse";
DROP TABLE "ClotureJournaliere";
DROP TABLE "LigneInventaire";
DROP TABLE "Inventaire";
DROP TABLE "Reception";
DROP TABLE "EvenementSynchro";

DROP FUNCTION "session_caisse_proteger"();
DROP FUNCTION "evenement_synchro_proteger"();

DROP TYPE "StatutEvenementSynchro";
DROP TYPE "TypeMouvementCaisse";
DROP TYPE "MomentComptage";
DROP TYPE "StatutSession";

COMMIT;
