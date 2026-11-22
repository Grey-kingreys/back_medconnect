-- Tranche pharmacie 2, inventaire hors ligne : type d'anomalie THEORIQUE_DIVERGENT.
-- Migration additive : une valeur ajoutée à l'enum TypeAnomalie, après FICHE_MODIFIEE_ENTRETEMPS. Aucune anomalie existante ne change.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- La valeur n'est utilisée par aucune instruction de cette transaction.
-- Retour arrière : prisma/retours-arriere/20261117100000_pharmacie_t2_anomalie_theorique_divergent.down.sql.
BEGIN;

-- AlterEnum
ALTER TYPE "TypeAnomalie" ADD VALUE IF NOT EXISTS 'THEORIQUE_DIVERGENT' AFTER 'FICHE_MODIFIEE_ENTRETEMPS';

COMMIT;
