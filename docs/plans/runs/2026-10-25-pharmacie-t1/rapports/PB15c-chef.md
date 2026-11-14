# PB15c : contrôle du chef d'orchestration

Verdict : validé, commité (un seul commit, sans amend, hooks actifs). PB15 est validé en entier (PB15a, PB15b, PB15c).

## Fait

- Relecture du diff de PB15c : DTO (`ModeleImportStockDto`, champs d'inventaire de `LigneImportStock`, `inventaireId`), service (colonne « Unités en plus », `verifierModeImport`, analyse en mode inventaire, `lireFichesImport`, `lignesInventaire`, `raisonRefusInventaire`, `evaluerAbsent`, `rapportInventaire`, aperçu par `simuler`, import par `enregistrerDansTransaction` en mode `rejeterLignes`, modèle d'inventaire), contrôleur, specs unitaires et db, CLAUDE.md. Conforme à la fiche, à D596 et D597.
- D600 (révise D589), dans `src/pharmacie/domaine/inventaire.ts` :
  - étape 4 de `ciblerLot` : sans lot en stock, si la fiche n'a qu'un seul lot au total (solde nul ou négatif), la ligne cible ce lot ;
  - étape 3 : la date (ou « sans péremption ») considère tous les lots de cette date, épuisés compris ; à date égale, le seul lot à solde positif l'emporte, sinon `LOT_REQUIS` ;
  - `lotsEnStockFefo` (liste d'un `LOT_REQUIS`) reprend tous les lots quand aucun n'est en stock, pour que la liste ne soit jamais vide (cas de deux lots épuisés de même date ; sinon le message d'import aurait affiché « plusieurs lots en stock () »).
  - La règle est partagée : `InventairesService.evaluer` appelle `ciblerLot` pour la saisie (`POST .../inventaires`), l'aperçu (`simuler`) et l'import (`enregistrerDansTransaction`). Les ventes sans stock se rattachent au lot ainsi ciblé par `planifierInventaireFiche` (D592), sans changement.
- Constante morte `MESSAGE_IMPORT_INVENTAIRE_INDISPONIBLE` retirée de `pharmacie.service.ts` (aucun usage dans `src` ni `test`). Le code `IMPORT_INVENTAIRE_INDISPONIBLE` reste au catalogue `src/common/filters/codes-erreur.ts` (précédent D542), commentaire mis à jour : « plus renvoyé depuis PB15c ». Plus aucun autre usage.
- CLAUDE.md du back : puce PB15b complétée (lot unique même épuisé, date sur lot épuisé, D600).

## Tests

- `src/pharmacie/domaine/inventaire.spec.ts` :
  - ajustés parce que D600 les contredit : « ciblage par date ou sans péremption » (la date d'un lot à solde 0 donnait un nouveau lot, elle cible désormais ce lot) ; « sans précision » (lot unique à solde 0 : `SANS_LOT` compté 0 et `DATE_PEREMPTION_REQUISE` compté positif deviennent le ciblage de ce lot ; les deux refus restent vérifiés sur une fiche sans lot et sur deux lots épuisés) ;
  - ajoutés : « D600 : lot unique de la fiche ciblé même épuisé ou négatif » (solde 0 et -3, compté positif et compté 0, numéro inconnu toujours nouveau lot) ; « D600 : la date désigne un lot épuisé parmi plusieurs » (lot à 0 et lot à -1 parmi trois, sans date : le seul en stock, même date : le seul en stock l'emporte, deux épuisés de même date : `LOT_REQUIS`, liste jamais vide).
- `test/db/import-inventaire.db-spec.ts`, ajouté : « D600 : stock négatif compté sans lot ni date, le lot unique finit au comptage » : réception de 2, vente de 2, vente sans stock de 3 (produit à -3, lot à 0), ligne `[nom, 5]` sans lot ni date ; aperçu et import : ligne acceptée sur ce lot (`nouveauLot` faux, théorique -3, écart 8), aucun nouveau lot, lot et produit à 5, allocation de la vente `REMPLACEE` 3 et `DEFINITIVE` 3.
- Aucun test db existant contredit (le test PB15b « nouveau lot trouvé » passe par un numéro inconnu, hors D600).

## Preuves (depuis la racine, `docker compose exec -T backend`)

- `npx tsc --noEmit` : 0 erreur.
- `npx eslint` sur les fichiers touchés (domaine, spec, catalogue, DTO, specs import, six db-specs) : 0 erreur ; `pharmacie.service.ts` et `pharmacie.controller.ts` : 0 erreur, 7 avertissements préexistants du contrôleur (lignes 148 à 332, hors code ajouté).
- `npm test` : 88 suites, 984 réussis, 3 ignorés (préexistants), 0 échec.
- `npm run test:db` : 24 suites, 291 réussis (290 du vérificateur plus le test D600), 0 échec.
- `prisma/` et `test/db/instantanes` inchangés ; aucune migration ; `docker-entrypoint.sh` exclu du commit.

## Jugement

- Métier : comptage absolu par lot, écart en mouvement `INVENTAIRE`, tolérance par fiche, anomalie attribuée à l'auteur, médicament absent créé seulement si compté positif (tolérance nulle, signalé), prix, coût et notes ignorés. Avec D600, le cas du stock migré (lot technique unique) et des ventes faites sans stock est traité : le lot revient à la quantité comptée, les provisoires sont rattachées, aucun lot parasite.
- Concurrence : l'import écrit dans une seule transaction ; les fiches absentes sont créées par `createMany` avec `skipDuplicates` avant les verrous, puis le cœur de PB15b pose les verrous (D594) et refait le ciblage sous verrou ; ses valeurs font foi dans le rapport. L'aperçu simule sans verrou, sans écriture.
- Sécurité : `inventaire:write` exigé avant toute lecture du fichier (403 `MESSAGE_IMPORT_INVENTAIRE_INTERDIT`) ; le rôle Pharmacien reçoit 403 (D598) ; livraison toujours sous `reception:write`. Aucune donnée de coût en inventaire (D466 sans objet ici, coûts masqués en livraison inchangés). Compteur gelé jamais écrit (test 10).

## Décisions

- D600 consignée dans decisions.md (révise D589), reprise dans ACTIVE.md.

## Réserves

- Une fiche créée pour un médicament absent reste créée si le cœur refuse ensuite sa ligne (seul cas possible : `QUANTITE_TROP_GRANDE`, irréaliste avec les bornes de l'analyse). Sans effet sur le stock.
- À date égale entre un lot en stock et un lot épuisé, le lot en stock est choisi sans demander : choix assumé (D600), réversible par le numéro de lot.

## Conséquences pour le front (PF)

- Import : le mode par défaut `inventaire` est rétabli et exige `inventaire:write` ; afficher le message du 403. Le modèle se télécharge par `GET .../import/modele?mode=inventaire` (`modele-inventaire-stock.xlsx`).
- Colonnes du rapport d'inventaire : `quantiteComptee`, `quantiteTheorique` (peut être négative), `ecart`, `sousTolerance`, `nouveauLot`, `lotId`, `unitesEnPlus` ; `quantiteAvant` peut être 0 ou négatif ; réponse `inventaireId` (et `receptionId` nul).
- D600 : sur une fiche à lot unique, même épuisé, la saisie d'un inventaire sans lot ni date est acceptée et vise ce lot ; le front n'a pas besoin d'exiger une date dans ce cas. Les messages `LOT_REQUIS` listent toujours au moins un lot.
