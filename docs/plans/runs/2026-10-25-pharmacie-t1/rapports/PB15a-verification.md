# PB15a - Vérification indépendante

Verdict : PASS

## Commandes relancées (depuis la racine medconnecte)

1. `docker compose exec -T backend npx tsc --noEmit` : 0 erreur.
2. `docker compose exec -T backend npx eslint <16 fichiers .ts de la fiche>` : 0 erreur, 0 avertissement.
3. `docker compose exec -T backend npm test` : 87 suites vertes, 962 passés, 3 ignorés (préexistants). Comptage par spec : sortie.spec 4, anomalies.spec 6, inventaires.http.spec 3, anomalies.http.spec 3 (16 tests, conformes à la fiche).
4. `docker compose exec -T backend npm run test:db` : 22 suites, 253 tests verts. `sorties-anomalies.db-spec.ts` : 15 tests (15 `it(`, tous verts avec le titre exact de la fiche). receptions, resolution, non-regression-lectures verts et non modifiés.
5. `git status --porcelain -uall` : seuls les 17 fichiers attendus, plus docker-entrypoint.sh (hors sujet) et docs/plans (chef). `git diff --stat -- prisma test/db/instantanes` : vide. Aucun fichier de test existant modifié.
6. `git diff receptions.service.ts` : uniquement la transaction de `corrigerDateLot` (select réduit, relecture `findUniqueOrThrow` après `verrouillerFiches`), conforme D588. `codes-erreur.ts` : une seule ligne ajoutée. `pharmacie.module.ts` : imports, contrôleurs et fournisseurs seulement. CLAUDE.md : une puce ajoutée.
7. grep `mouvementStock.create|lotStock.create|lotStock.update` dans inventaires/ et anomalies/ : aucune ligne.
8. Tirets U+2013 et U+2014 : aucun dans les lignes ajoutées (diff) ni dans les fichiers nouveaux.
9. Reformatage prettier : eslint ne laisse aucun diff parasite sur les fichiers modifiés (les diffs ci-dessus sont minimaux).

## Relecture du code contre la fiche, D584 à D588

- Sorties : raisons fixes et types de mouvement (PERIME en PEREMPTION, RETOUR_FOURNISSEUR en RETOUR, autres en PERTE), motif construit comme spécifié, AUTRE exige 3 caractères, 400 MOTIF_REQUIS avant toute lecture en base, unité BOITE ou UNITE avec coefficient du lot, plafond ENTIER_MAX, 409 STOCK_LOT_NEGATIF testé avant écriture, 404 lot d'une autre fiche ou pharmacie, rejeu par `evenementId` y compris course (doublon rattrapé), écriture uniquement via `MouvementsStockService.ecrire` sous `verrouillerFiches`, auteur attribué, audit sans commentaire, aucun coût lu ni renvoyé, permission `stock:write` sur la route.
- CA13 (sortie d'un périmé avec motif) couvert par le test DB 1 ; sorties sur fiche archivée acceptées (test 6).
- Anomalies : filtre statut (défaut OUVERTE) et type, pagination 20, tri creeLe puis id décroissants, `ouvertes`, libellés lisibles, statut de rattachement calculé sur toutes les anomalies de la vente, allocations PROVISOIRE et ventes annulées (D586). Traitement : commentaire 3 caractères, `findFirst` filtré par structure (404 sinon), `updateMany` conditionnel sur OUVERTE, un seul gagnant en concurrence (D587), audit sans commentaire, aucun traitement automatique. Permission `anomalie:gerer`.
- Journal immuable et compteur gelé : aucun accès hors du service de mouvements ; invariants vérifiés par le test 15.
- Textes : messages en français clair, sans jargon pour un vendeur d'officine.

## Problèmes

Aucun bloquant. Aucun test affaibli ni supprimé, rien hors sujet.

## Lacunes de couverture (mineures, non bloquantes)

- Pas de test direct du plafond `ENTIER_MAX` sur `quantite` (400 VALIDATION) ni du cas « aucun point de vente d'ordre 1 » (404 sortie, liste vide) ; ils ne figuraient pas dans la fiche.
- Le rattachement n'est testé qu'en EN_ATTENTE, PARTIELLE, RATTACHEE et VENTE_ANNULEE sur une seule fiche ; le cas de deux anomalies BOITE et UNITE pour la même fiche (somme des quantités) n'est couvert que par la logique, pas par un test DB.
