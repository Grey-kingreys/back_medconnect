# PB15b : contrôle du chef d'orchestration

Verdict : validé, commité (un seul commit, sans amend, hooks actifs).

## Fait

- Relecture complète du diff : filtre d'erreurs (`LOT_REQUIS` avec détails, date de lot nulle), `NouveauLot.typeMouvement`, extraction de `resolution-provisoires.ts` (comparée au bloc retiré, à l'identique), `lireTousLesLots`, domaine `inventaire.ts` (ciblage D589, plan D592), DTO, service, contrôleur, module, tests.
- Correction de la remarque du vérificateur (D599) : le désarchivage est déplacé après l'évaluation et ne vise qu'une fiche dont au moins une ligne **retenue** compte une quantité non nulle. En mode normal, rien ne change (toute ligne refusée lève une exception et annule la transaction). En mode `rejeterLignes`, une ligne refusée ne désarchive plus sa fiche. La ligne de la fiche est déjà tenue en `FOR NO KEY UPDATE` : la mise à jour n'attend aucun verrou, l'ordre des verrous (D594) est inchangé ; le déclencheur `stock_medicament_geler_compteur` ne regarde que `quantite` et `disponible`.
- Test ajouté : `test/db/inventaire.db-spec.ts`, « mode rejeterLignes : une ligne refusée ne désarchive pas sa fiche » (fiche à deux lots refusée `LOT_REQUIS` reste archivée sans audit, fiche retenue désarchivée).
- D598 consignée (Pharmacien sans `inventaire:write`, vérifié dans `permissions.constants.ts` : seuls le titulaire et `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` l'ont). D599 consignée.
- Fiche PB15c complétée (contexte vérifié : désarchivage déjà corrigé, Pharmacien en 403 sur l'import inventaire).

## Preuves (relancées depuis la racine, `docker compose exec -T backend`)

- `npx tsc --noEmit` : 0 erreur.
- `npx eslint` sur les 14 fichiers .ts touchés : 0 erreur.
- `npm test` : 88 suites, 976 réussis, 3 ignorés (préexistants), 0 échec.
- `npm run test:db` : 23 suites, 279 réussis (278 du vérificateur plus le test ajouté), 0 échec.
- Aucun U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux ; `prisma/` et instantanés inchangés ; aucune écriture directe de stock dans `src/pharmacie/inventaires` ; `docker-entrypoint.sh` exclu du commit.

## Jugement métier

- Comptage en boîtes et unités : boîtes multipliées par le coefficient du lot visé (celui de la fiche pour un nouveau lot), unités d'une boîte entamée en plus, exclusivité contrôlée. Correct.
- Plusieurs lots : ciblage par identifiant, numéro (casse et espaces ignorés), date, lot unique ; ambiguïté : 409 `LOT_REQUIS` avec la liste FEFO, jamais de répartition automatique. Correct.
- Lot inconnu : nouveau lot daté (date passée acceptée), mouvement `INVENTAIRE`, coût 0. Périmés trouvés : comptés comme les autres, jamais rattachés aux ventes sans stock (CA13).
- Ventes sans stock : le lot compté finit exactement au comptage (démontré par le plan et le test 12) ; vente annulée exclue (D548).
- Tolérance par fiche (écarts de lots compensés, D591), anomalie attribuée à l'auteur.

## Concurrence

Inventaire, réception, sortie et vente prennent le verrou de ligne de la fiche puis le verrou consultatif, dans l'ordre trié ; ni poste, ni session, ni `CompteurTicket`, ni ligne de `Vente` : pas de cycle. Le théorique est lu sous verrou. Tests 20 à 22 verts (vente avant, vente après, réception simultanée).

## Sécurité et contrat front

- Les trois routes exigent `inventaire:write` ; accès par `AccesPharmacieService` ; fiches filtrées par `structureId` ; détail d'un inventaire d'une autre pharmacie : 404.
- Aucune clé de coût dans la réponse, le détail, la liste ni les détails d'anomalie (masquerCouts D466 sans objet ici).
- Réponse `POST` : `data` = détail présenté (`lignes`, `anomalies`, `resolutions`, `auteur`) plus `cree` et `avertissements` ; message en français.

## Réserves (non bloquantes, pour l'orchestrateur principal)

1. Lot enregistré sans numéro à la réception, compté ensuite par le numéro lu sur la boîte : aucun lot de ce numéro, donc nouveau lot ; l'ancien lot non compté garde son solde (inventaire partiel par lot, D589). Risque de stock doublé. Le front (PF) doit proposer les lots existants de la fiche (lot par `lotId`) plutôt qu'une saisie libre du numéro ; à envisager plus tard : option « inventaire complet de la fiche » qui met à 0 les lots non comptés.
2. Un nouveau lot trouvé à l'inventaire a un coût unitaire 0 : la marge de ses ventes sera surévaluée (PB16 marge à prévenir ; coût du dernier lot de la fiche envisageable).
3. Une vente entre le comptage et la saisie compte comme un écart (D594, déjà documenté).
4. Le test 22 attend un verrou de ligne (`attendreVerrouLigne`) au lieu d'un verrou consultatif : comportement couvert, attente un peu moins spécifique (relevé par le vérificateur).

## Ajustements de la fiche PB15c

Faits directement dans `tasks/PB15c-import-inventaire.md` (contexte vérifié) : désarchivage déjà corrigé en PB15b (D599), rien à faire ; Pharmacien en 403 sur l'import inventaire (D598), ne pas toucher aux permissions.
