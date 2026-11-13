-- Retour arrière de 20261113100000_pharmacie_t2_cahier_credit (M11).
-- Supprime ClientCredit, RemboursementCredit, EcheanceCredit, la colonne Vente.clientCreditId, le mode de paiement CREDIT
-- et les permissions credit:read et credit:write (retirées des rôles). Les clients, remboursements et dates limites sont perdus.
-- Refusé tant qu'une vente à crédit existe (vente rattachée à un client ou paiement CREDIT) : Vente et Paiement sont des pièces
-- immuables, on ne les réécrit pas. Aucune autre donnée n'est modifiée. Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

DO $$
DECLARE
  nombre integer;
BEGIN
  SELECT count(*) INTO nombre FROM "Vente" WHERE "clientCreditId" IS NOT NULL;
  IF nombre > 0 THEN
    RAISE EXCEPTION 'Retour arrière refusé : % vente(s) à crédit existent. Elles sont immuables.', nombre;
  END IF;
  SELECT count(*) INTO nombre
  FROM "Paiement" pa JOIN "ModePaiement" m ON m."id" = pa."modePaiementId" WHERE m."code" = 'CREDIT';
  IF nombre > 0 THEN
    RAISE EXCEPTION 'Retour arrière refusé : % paiement(s) en mode CREDIT existent. Ils sont immuables.', nombre;
  END IF;
END
$$;

DROP TABLE "EcheanceCredit";
DROP TABLE "RemboursementCredit";
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_clientCreditId_fkey";
DROP INDEX "Vente_clientCreditId_idx";
ALTER TABLE "Vente" DROP COLUMN "clientCreditId";
DROP TABLE "ClientCredit";

DELETE FROM "ModePaiement" WHERE "code" = 'CREDIT';

DELETE FROM "RolePermission" rp
USING "Permission" p
WHERE rp."permissionId" = p."id" AND p."code" IN ('credit:read', 'credit:write');
DELETE FROM "Permission" WHERE "code" IN ('credit:read', 'credit:write');

COMMIT;
