-- Tranche pharmacie 1, unité PLAQUETTE (PB21, M7, D723).
-- Migration additive : une valeur ajoutée à l'enum UniteMinimale, après AMPOULE. Aucune fiche existante ne change.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- La valeur n'est utilisée par aucune instruction de cette transaction.
BEGIN;

-- AlterEnum
ALTER TYPE "UniteMinimale" ADD VALUE IF NOT EXISTS 'PLAQUETTE' AFTER 'AMPOULE';

COMMIT;
