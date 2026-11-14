-- Retour arrière de 20261112100000_pharmacie_t2_telephone_prescripteur.
-- Supprime la colonne telephonePrescripteur de Vente : les numéros saisis sont perdus. Aucune autre donnée n'est modifiée.
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

ALTER TABLE "Vente" DROP COLUMN "telephonePrescripteur";

COMMIT;
