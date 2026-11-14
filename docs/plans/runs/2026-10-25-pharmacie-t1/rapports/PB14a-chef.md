# PB14a - Rapport du chef d'orchestration

Statut : validé.

## Ce qui a été fait

- Diff de PB14a relu en entier contre la fiche : règles pures (`domaine/reception.ts`), DTO, service, contrôleur, module, codes d'erreur et filtre, tests unitaires, HTTP et sur base, puce de `CLAUDE.md`.
- Vérifications relancées par le chef, puis un seul commit avec les fichiers de PB14a, la fiche PB14a, son rapport de vérification, ce rapport, `docs/plans/ACTIVE.md`, `decisions.md` et les fiches PB14b et PB14c (documents).

## Preuves (relancées par le chef, via `docker compose exec -T backend`)

- `npx tsc --noEmit` : aucune erreur.
- `npx eslint` sur les 10 fichiers de la fiche : aucune erreur.
- `npm test` : 82 suites, 938 tests passés, 3 ignorés (préexistants).
- `npm run test:db` : 19 suites, 218 tests passés.
- `npx jest --config ./test/db/jest-db.json --runInBand test/db/receptions.db-spec.ts` relancé une fois de plus : 14/14 (avec les exécutions du vérificateur, au moins quatre passages verts des tests de concurrence 11 et 12).

## Jugement

- Coût figé : `coutUnitaireDepuisBoite` (arrondi au GNF, moitié éloignée de zéro) appliqué au coefficient lu sous verrou, figé sur le lot par `creerLot` ; le test 3 montre qu'un changement de fiche ne change ni le lot ni le coût d'une vente, et que le trigger refuse une écriture du coût.
- A3 : date obligatoire sauf `sansPeremption`, date fournie prioritaire, date passée refusée, jour même accepté ; refus groupés avec toutes les lignes en cause dans `details` ou `champs`.
- Idempotence : rejeu par `id` dans la transaction, course traitée par P2002 sur `Reception` puis relecture ; identifiant d'une autre pharmacie en 409. Testé en séquentiel et en parallèle.
- Concurrence avec la vente : même ordre de verrous (ligne de fiche en `FOR NO KEY UPDATE` triée, puis consultatif), ni poste ni caisse ; aucun interblocage dans les deux sens (tests 11 et 12).
- Désarchivage : après les refus, sous le verrou de ligne déjà pris, audité comme `upsertStock`.
- Sécurité : chaque lecture et écriture est bornée à la structure (fiche, fournisseur, réception, lot) ; coûts retirés par `masquerCouts` sans `marge:read` sur la réponse de réception, le détail, les lots et la correction de lot ; la liste ne porte aucune clé de coût ; l'audit ne porte ni coût ni référence de bon.
- Écritures de stock uniquement par `MouvementsStockService.creerLot` ; seule écriture directe de `LotStock` : `dateExpiration` ; compteur `quantite` jamais écrit (test 1).
- Contrat lu par le front : réception `{ id, reference, recueLe, createdAt, auteurId, fournisseur, lots[], cree, avertissements }`, liste `{ receptions, page, parPage, total }`, lots `{ id, numeroLot, dateExpiration, dateReception, quantite, reliquat, coefficientReception, lotTechnique, perime, coutUnitaire }`, fournisseurs `{ id, nom, telephone, createdAt }` : conformes à D573 à D575.

## Décisions

Aucune décision nouvelle : D566 à D581 appliquées telles quelles. Écarts du codeur acceptés comme le vérificateur (rognage répété dans le service, `ElementLot` exporté, constante de message dupliquée au texte identique).

## Réserves (non bloquantes)

1. `corrigerDateLot` lit la date du lot avant le verrou consultatif : deux corrections simultanées du même lot peuvent écrire dans l'audit un « avant » périmé. Rare ; à corriger en relisant le lot après `verrouillerFiches` dans une fiche qui touche les lots (PB15 ou PB16).
2. `creerFournisseur` : le contrôle insensible à la casse n'est pas protégé par une contrainte (l'unicité de base est sensible à la casse) ; deux créations simultanées « Sopharma » et « SOPHARMA » peuvent passer. Sans effet sur le stock ; un index unique sur `lower(nom)` demanderait une migration, à décider plus tard.
3. Un rejeu par `id` renvoie la réception d'origine sans comparer le contenu (voulu par D571) ; le front doit générer un `id` neuf par saisie.

## Ajustements des fiches suivantes

- PB14b (corrigée directement, 4.1) : `ReceptionEcrite` est construit à trois endroits dans le code réel (rejeu de l'étape 2, retour de l'étape 14, rejeu de course dans le `catch` de `enregistrer`) ; la fiche dit maintenant que les trois reçoivent `resolutions`. Les noms utilisés par PB14b (`ids`, `jour`, `pointDeVenteId`, `reception.id`, `presenterReception`) existent tels quels.
- PB14c : aucun ajustement. La signature de `enregistrerDansTransaction`, la forme de `lignes` (`stockId`, `lotId`, `quantiteUm`, `soldeProduitApres`) et l'emplacement de l'étape 7 (désarchivage) avant l'étape 8 (verrous consultatifs) correspondent au code ; `receptions.service.ts` n'importe pas `pharmacie.service.ts`.
