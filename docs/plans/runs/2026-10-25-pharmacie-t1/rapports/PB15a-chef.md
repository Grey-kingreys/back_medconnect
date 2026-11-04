# PB15a - Contrôle du chef d'orchestration

Verdict : validé, commité (message « feat(pharmacie): sorties de stock et file d'anomalies (PB15a) »).

## Fait

- Diff relu en entier : `sorties.service.ts`, `anomalies.service.ts`, les deux contrôleurs, les deux DTO, `domaine/sortie.ts` (identique au texte de la fiche), `domaine/anomalies.ts`, les deux specs HTTP, les specs unitaires, `test/db/sorties-anomalies.db-spec.ts`, `codes-erreur.ts` (une ligne), `pharmacie.module.ts` (imports, contrôleurs, fournisseurs), `receptions.service.ts` (seule la transaction de `corrigerDateLot`, D588), puce PB15a de `CLAUDE.md`.
- Lacunes du vérificateur : deux tests DB ajoutés par le chef dans `test/db/sorties-anomalies.db-spec.ts` (17 tests au lieu de 15) :
  - « vente sans stock en boîte et en unité sur la même fiche : quantités additionnées » : fiche à 10 unités par boîte, déconditionnable ; vente de 1 boîte et 3 unités sans stock : deux anomalies, chacune `EN_ATTENTE` 13 sur 13 ; réception de 5 unités : `PARTIELLE`, 8 en attente sur 13 ; réception d'une boîte : `RATTACHEE`. Vert du premier coup : la somme par clé vente et fiche est juste (une anomalie et une provisoire par ligne, toutes deux en unités minimales).
  - « sortie en boîtes au-delà de l'entier maximal : 400 sans écriture » : 10^9 boîtes à 10 unités : 400 `VALIDATION`, solde du lot inchangé.
- Cas « aucun point de vente d'ordre 1 » non testé : le point de vente est créé à la demande (`assurerPointDeVente`, D478) par la vente, la caisse, la fiche ou la réception ; sans lui il ne peut exister ni lot ni anomalie, donc le 404 de la sortie et la liste vide de la file sont justes, et ne rien créer en lecture est voulu. Pas de test ajouté.
- Fiche PB15b corrigée (section 10.2) : le fichier `inventaires.http.spec.ts` commité n'a que les profils `titulaire` et `lecteur` ; la fiche dit maintenant d'ajouter le profil `vendeur` `['stock:read', 'stock:write']` sans toucher aux trois tests existants, et de fournir `InventairesService` simulé à côté de `SortiesStockService`. Fiche PB15c : rien à ajuster (elle ne dépend que de PB15b).

## Preuves (relancées par le chef, `docker compose exec -T backend`, depuis la racine)

- `npx tsc --noEmit` : aucune erreur.
- `npx eslint` sur les 16 fichiers `.ts` : 0 erreur, 0 avertissement (après ajout des deux tests).
- `npm test` : 87 suites, 962 passés, 3 sautés, 0 échec.
- `npm run test:db` : 22 suites, 255 passés (dont `sorties-anomalies.db-spec.ts`, 17) ; `receptions`, `resolution`, `non-regression-lectures` verts et non modifiés.
- `git diff --stat -- prisma test/db/instantanes` : vide. Grep `mouvementStock.create|lotStock.create|lotStock.update` dans `inventaires/` et `anomalies/` : aucune ligne. Aucun tiret cadratin ni demi-cadratin dans les ajouts.

## Justesse métier

- Quantité convertie en unités minimales par le coefficient figé du lot (`coefficientReception`), relu sous le verrou : une boîte d'un lot reçu à 10 sort 10 unités même si la fiche a changé depuis.
- Raisons : `PERIME` en `PEREMPTION`, `RETOUR_FOURNISSEUR` en `RETOUR`, cassé, perdu et autre en `PERTE` ; motif lisible enregistré, commentaire obligatoire pour « Autre ». Refus avant toute lecture en base.
- Sortie jamais au-delà du stock du lot (409 au message chiffré, CHECK de l'agrégat en filet) ; acceptée sur fiche archivée (non désarchivée) et sur lot périmé (CA13).
- Rattachement : une vente annulée prime ; somme sur toutes les anomalies de la vente pour la fiche (pas seulement la page) ; aucune clôture automatique.

## Concurrence

- Sortie : un seul verrou consultatif (la fiche), aucun verrou de ligne : pas de cycle possible avec la vente (verrous consultatifs triés), la réception et la qualification (ligne puis consultatif). Solde et coefficient du lot relus après le verrou : une vente ou une qualification concurrente est vue.
- Rejeu : `evenementId` `sortie:<id>` unique ; course rattrapée par le doublon (test 5, `Promise.all`).
- Traitement d'anomalie : `updateMany` conditionnel sur `OUVERTE`, une seule réussite (test 10). Aucune interaction avec les verrous de stock.
- `corrigerDateLot` : date relue sous le verrou de la fiche, audit « avant » juste (test 13, rouge sans le correctif).

## Sécurité

- Rôles par défaut d'une pharmacie (`permissions.constants.ts`) : « Pharmacien » (le vendeur) a `stock:write` mais pas `anomalie:gerer` ; « Administrateur de structure » (le titulaire) a les deux, garantis par `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE`. Un vendeur peut donc déclarer une casse ou une perte (D585, attribuée et auditée) mais ne voit ni ne clôt les anomalies (test HTTP 1 : 403 sur GET et PATCH).
- Contrôle par structure : `AccesPharmacieService.verifier` d'abord ; lot cherché par fiche et point de vente de la structure (404 sinon, test 4) ; anomalie cherchée par `pointDeVente.structureId` (404, test 11) ; rejeu d'un `id` d'une autre pharmacie : 409.
- Coûts : la sortie ne lit pas `coutUnitaire` ; les `details` des anomalies ne contiennent aucun coût (test 14, `cheminsCout` vide). Audit sans commentaire libre.

## Contrat front (PF06)

- `POST /pharmacie/:structureId/stock/sorties` `{ id?, stockId, lotId, unite: BOITE|UNITE, quantite, raison, commentaire? }` : `data { id, mouvementId, stockId, nom, lotId, numeroLot, dateExpiration, perime, type, motif, quantite (unités), soldeLot, soldeProduit, auteurId, createdAt, cree }`. Erreurs : 400 `MOTIF_REQUIS` (deux messages), 400 `VALIDATION`, 404, 409 `STOCK_LOT_NEGATIF`, 409 `IDENTIFIANT_DEJA_UTILISE`. Le front doit générer l'`id` avant l'envoi pour rejouer sans doublon.
- `GET .../anomalies?statut=&type=&page=` : `data { anomalies[], page, parPage, total, ouvertes }`, chaque élément avec `libelle`, `attribueeA`, `traiteePar`, `rattachement` (message prêt à afficher). `PATCH .../anomalies/:id` `{ commentaire }` : élément relu ; 409 `ANOMALIE_DEJA_TRAITEE` à afficher tel quel (un autre l'a traitée).
- Le badge utilise `ouvertes`, indépendant du filtre.

## Décisions

Aucune nouvelle décision : D583 à D588 appliquées telles quelles.

## Réserves

- Un vendeur peut sortir tout un lot en « Perdu ou volé » sans contrôle a priori et sans anomalie : seuls l'attribution et l'audit le tracent. À surfacer au titulaire (journal des sorties, ou anomalie au-delà d'un seuil) avec PB16 ou le front.
- PB15b attribue l'anomalie d'écart au vendeur qui compte, mais le rôle par défaut « Pharmacien » n'a pas `inventaire:write` : avec les rôles par défaut, seul le titulaire compte. À trancher avec le porteur (ajouter `inventaire:write` au rôle Pharmacien ou non) ; sans effet sur le code de PB15b.
- `details` des anomalies est renvoyé brut : sûr aujourd'hui (aucun coût écrit), à garder en liste blanche pour tout nouveau type (rappel D591).
