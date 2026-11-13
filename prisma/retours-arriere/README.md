# Retours arrière des migrations

Ce dossier contient un fichier `<nom de la migration>.down.sql` par migration de la
tranche pharmacie. Il défait la migration du même nom.

## Procédure

1. Appliquer le fichier : `npx prisma db execute --file prisma/retours-arriere/<nom>.down.sql`.
2. Marquer la migration comme annulée : `npx prisma migrate resolve --rolled-back <nom>`.
3. Redéployer la version de code précédente.

## Ordre

Défaire de la plus récente à la plus ancienne : M9 (`20261110100000_pharmacie_t1_facture_fournisseur`, supprime les colonnes de facture fournisseur de `Reception` et `LotStock`, valeurs perdues), puis M8 (`20261104100000_pharmacie_t1_pharmacien_reception`,
retire `reception:write` des rôles « Pharmacien » des pharmacies), puis M7 (`20261103100000_pharmacie_t1_unite_plaquette`,
refusé tant qu'une fiche utilise `PLAQUETTE`), puis M6 (`20261026140000_pharmacie_t1_ventes_pieces`),
puis M5 (`20261026130000_pharmacie_t1_caisse`, refusé tant que M6 est en place), puis M4, M3, M2,
M1. Chaque fichier liste en tête ce qu'il perd.

## Vérification

Chaque fichier est testé par le harnais (`npm run test:db`) : migration en haut, retour
arrière en bas, migration en haut de nouveau, sur une base chargée de données au format
d'avant la tranche.

Voir `docs/plans/runs/2026-10-25-pharmacie-t1/PLAN.md`, section 2.
