# Retours arrière des migrations

Ce dossier contient un fichier `<nom de la migration>.down.sql` par migration de la
tranche pharmacie. Il défait la migration du même nom.

## Procédure

1. Appliquer le fichier : `npx prisma db execute --file prisma/retours-arriere/<nom>.down.sql`.
2. Marquer la migration comme annulée : `npx prisma migrate resolve --rolled-back <nom>`.
3. Redéployer la version de code précédente.

## Vérification

Chaque fichier est testé par le harnais (`npm run test:db`) : migration en haut, retour
arrière en bas, migration en haut de nouveau, sur une base chargée de données au format
d'avant la tranche.

Voir `docs/plans/runs/2026-10-25-pharmacie-t1/PLAN.md`, section 2.
