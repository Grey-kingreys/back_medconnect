# PB14b - Contrôle du chef d'orchestration (Opus)

Verdict : validé, commité (« feat(pharmacie): résolution des allocations provisoires à la réception (PB14b) »).

## Fait

- `src/pharmacie/domaine/resolution.ts` et `resolution.spec.ts` : plan pur (contrôles, lots non périmés en FEFO, ventes les plus anciennes d'abord, résolution partielle, arrêt quand plus rien n'est pris).
- `src/pharmacie/stock/resolution-provisoires.ts` : `resoudreProvisoires` réutilisable (PB15, PB18), fiche par fiche triée, verrou réentrant, deux mouvements `VENTE` de pièce `RESOLUTION`, `PROVISOIRE` vers `REMPLACEE`, `DEFINITIVE` au coût du lot et `PROVISOIRE` du reste.
- `receptions.service.ts` : appel entre lots et audit, `resolutions` dans les trois retours, relecture en base dans `presenterReception`, message `MESSAGE_VENTES_RATTACHEES` ; Swagger complété dans `receptions.controller.ts`.
- `vente.service.ts` : bloc 4a de `annulerVente` (relecture des allocations sous les verrous des fiches, D578), seul changement.
- `test/db/resolution.db-spec.ts` (9 tests) ; `CLAUDE.md` du dépôt back complété.

## Preuves (relancées par le chef)

- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `npx eslint` sur les 7 fichiers touchés : aucune erreur.
- `npm test` : 83 suites, 948 tests passés (3 ignorés préexistants).
- `npm run test:db` : 20 suites, 227 tests passés.
- `git ls-files --eol` : `receptions.controller.ts` en LF dans l'index et la copie de travail ; `core.autocrlf=true` normalise `receptions.service.ts` en LF à l'indexation (contrôlé après `git add`).

## Revue métier

- FEFO : `comparerFefo` sur tous les lots non périmés à solde positif de la fiche au point de vente, jour même vendable (`estPerime` strict), conforme à D576.
- Conservation : par allocation, somme des prises + reste = quantité provisoire ; agrégat produit inchangé (sortie du lot puis contrepartie sans lot), lots diminués ; invariant `SQL_VERIFIER_ALLOCATIONS` (somme des `DEFINITIVE` = quantité de la ligne quand plus aucune `PROVISOIRE`) respecté, test 9 vert.
- Marge après résolution : `domaine/marge.ts` ignore les `REMPLACEE`, la ligne est valorisée au coût du lot (700 dans le test 1) ; plus comptée en provisoire.
- Vente à l'unité ou en boîte : provisoires, lots et prises sont tous en unités minimales, l'unité affichée de la ligne n'intervient pas ; aucun cas particulier.
- Annulation d'une vente résolue : `lignesInverses` ignore la `REMPLACEE`, l'opposé porte sur la `DEFINITIVE` du lot de la résolution (test 5).

## Concurrence

- Réception : lignes des fiches en `FOR NO KEY UPDATE` triées puis verrous consultatifs ; la résolution ne reprend que des verrous déjà tenus et ne verrouille aucune ligne de `Vente` (seulement le `KEY SHARE` implicite de la clé étrangère `LigneVente` à l'insertion d'allocation), donc pas de cycle avec l'annulation (poste, session, vente d'origine, fiches), D578 respectée.
- Annulation en attente pendant une résolution : relecture des allocations après les verrous des fiches (test 8 vert, rouge sans le correctif selon la fiche).
- Vente provisoire en attente pendant une réception : la réception lit la provisoire après commit de la vente (test 7). Une vente annulée pendant l'attente est exclue par `pieceLiee: null` lu sous verrou.

## Sécurité et contrat front

- Pas de nouvelle route ; `resolutions` ne porte aucun coût (masquage `masquerCouts` inchangé, test 6 : aucun chemin de coût pour le vendeur) ; filtrage par point de vente sur les provisoires et les lots.
- Contrat : champ additif `resolutions` dans la création, le rejeu et le détail de réception ; message de succès complété ; ventes : `provisoire` devient faux après résolution, `allocations` peut contenir des `REMPLACEE` (déjà triées en dernier par `comparerAllocations`).

## Décisions

- Aucune nouvelle décision. Écart accepté : `nombreResolutions` n'est écrit dans l'audit que s'il est supérieur à 0 (les audits sans résolution gardent leur forme PB14a).

## Réserves

- `presenterReception` fait une agrégation par allocation résolue (N requêtes) : acceptable au volume d'une réception, à regrouper si une réception résout un jour des centaines de ventes.
- Les anomalies `STOCK_NEGATIF` restent ouvertes après résolution (D577, voulu) : le front devra montrer qu'elles sont résolues côté stock pour éviter un double traitement par le titulaire.

## Ajustement de la fiche PB14c

- Corrigé directement : la préparation de `test/db/import-livraison.db-spec.ts` copiait l'aide `refus` depuis `resolution.db-spec.ts`, qui ne la définit pas ; elle est désormais copiée de `test/db/receptions.db-spec.ts`.
- Vérifié sans changement : signature `enregistrerDansTransaction(tx, acces, entree, ip)` et forme de retour (avec `resolutions`) conformes au code ; `soldeProduitApres` n'est pas modifié par la résolution (agrégat produit net nul), donc `quantiteAvant`/`quantiteApres` de l'import restent justes.
