# PF02b - Vérification (fiche produit, deux prix, qualification)

Vérificateur indépendant. Dépôt front `orch/pharmacie-t1-front`, base 63bb9ad, travail non commité (5 fichiers).

## Verdict : FAIL

Gate « Done when » verte, conformité à la fiche bonne, mais deux séquences d'écriture peuvent détruire du stock réel (risques de données (a) et (b), confirmés dans le code du back).

## Commandes

| Commande | Résultat |
|---|---|
| `docker compose exec frontend npx tsc --noEmit` | exit 0 |
| `npx eslint` sur les 5 fichiers autorisés | exit 0, aucune erreur |
| `npx vitest run` | 63 fichiers, 533 tests verts (dont `date_peremption.test.ts` 8, `StockModal.test.tsx` 8) |
| `npm run build` (local) | réussi |
| `git status --porcelain` | 5 fichiers, tous autorisés (api_pharmacie.ts, StockModal.tsx, StockModal.test.tsx, date_peremption.ts, date_peremption.test.ts) |
| `grep parseFloat StockModal.tsx` | aucune ligne |
| U+2014 / U+2013 dans les 5 fichiers | aucun |
| « coefficient », « qualifier », « UM » à l'écran | absents (seulement identifiants de code) |

## Conformité à la fiche

- `date_peremption.ts` : conforme. `M/AA`, `MM/AAAA` donnent le dernier jour du mois (bissextile via `Date.UTC`), `JJ/MM/AA(AA)`, `AAAA-MM-JJ`, séparateurs `/ - .`, mois 13 et 31/04 refusés avec le message exact, aucune comparaison avec aujourd'hui, D684 respectée. Cas limite mineur : `06/0028` (année sur 4 chiffres inférieure à 100) passe par `Date.UTC(28, ...)` qui lit 1928 : le bissextile de février serait faux. Sans effet réel (le serveur refuse le passé).
- `api_pharmacie.ts` : `sansPeremption`, `AvertissementFiche`, `CorpsFiche`, `modifierFiche` conformes au back (`ModifierFicheDto` : mêmes champs, `null` accepté sur prixUnitaire, prixUnite, toleranceInventaire).
- `StockModal` : deux prix indépendants, 7 unités, unités par boîte entier >= 1, case déconditionnable avec prix d'unité conditionnel (décocher envoie `deconditionnable: false` et `prixUnite: null`), tolérance, qualification (bandeau, case, choix MULTIPLIER / CONSERVER obligatoire quand le nombre change et le stock n'est pas nul, ou après `CONVERSION_REQUISE`), `ECART_PRIX` non bloquant avec bouton « Fermer » seul, verrou (`fieldset disabled`) après échec réseau avec « Réessayer » et étapes déjà faites non refaites, entiers par `parseInt`, `htmlFor` présents, classes et tailles du design existant, textes français. Ordre (a) (b) (c) (d) respecté à l'ajout.
- Écarts déclarés : croix « Fermer la fenêtre » (distincte du bouton « Fermer » de l'avertissement, évite l'ambiguïté d'accessibilité) : accepté. `qualifie: true` envoyé à l'ajout : conforme à la fiche (c), sans effet si la fiche est déjà qualifiée (le back compare `voulus` à `existante`, aucun 409). Messages ajoutés (chiffres seulement, choix de conversion) : acceptés, en français. Contrastes slate-600 / 800 et teintes 700 : acceptés. Hauteur `max-h-[90vh]` avec défilement : acceptée. Réinitialisation : acceptée.

## Risques de données (établis dans le back)

Références : `back_medconnect/src/pharmacie/pharmacie.service.ts` `upsertStock` (l.531 à 720), `fiche-produit.service.ts`, `dto/fiche-produit.dto.ts`.

### (a) Ajout d'un médicament déjà en stock : FAIL

`upsertStock` fait un `stockMedicament.upsert` : sur fiche existante, il écrase `prixUnitaire` (si fourni), `notes` (si fournies) et **désarchive** (`archiveLe: null`). Puis il traite `quantite` comme une quantité ABSOLUE :

- fiche sans lot : `quantite: 0` ne fait rien (cas sain).
- **un seul lot** : `quantite (0) !== lot.quantite` écrit un mouvement `INVENTAIRE` de `0 - lot.quantite` : **le stock est remis à 0** (tracé comme « correction de fiche », mais le stock réel disparaît). L'étape (d) écrit ensuite `boîtes x coefficient` (absolu, pas un ajout) et, si la date saisie diffère, **remplace la date du lot** : le stock existant est donc remplacé, jamais additionné.
- **plusieurs lots**, ou **vente en négatif sans lot** (provisoire) : 409 `LOT_REQUIS`, transaction annulée, rien n'est détruit (mais l'écran montre une erreur sans issue).
- Les ventes passées et les lignes de vente ne sont pas touchées ; seuls la quantité du lot et sa date sont perdues.
- Fiche **archivée** : même résultat (le lot est conservé à l'archivage), en plus de la désarchivation silencieuse.

Défauts liés dans la même séquence :
- (d) calcule `boîtes x coefficient` avec le champ du formulaire (défaut 1), pas avec le nombre d'unités par boîte réel de la fiche existante (par exemple 20) ; (c) n'envoie `coefficientBoite` que s'il diffère de 1. Quantité fausse (boîtes lues comme unités).
- Si la fiche existante est non qualifiée avec du stock, (b) a déjà vidé le stock quand (c) reçoit `CONVERSION_REQUISE` (400, non géré en ajout).

### (b) Notes en modification : FAIL (cas à un seul lot)

`upsertStock({ quantite: editItem.quantite, notes })` : `editItem.quantite` est la valeur chargée avec la page. Avec un seul lot, si des ventes (ou réceptions) ont eu lieu depuis, `quantite !== lot.quantite` et le back écrit un `INVENTAIRE` qui **remet le stock à l'ancienne valeur** : les ventes sont annulées dans le stock. Plusieurs lots : 409 `LOT_REQUIS` (sûr, mais les notes ne s'enregistrent pas). Stock négatif (vente sans stock) : 400 (`@Min(0)` sur `quantite`), les notes sont inenregistrables.

### (c) Voies sans écriture de quantité

- `PATCH .../stock/:stockId/fiche` accepte `prixUnitaire` (et `null`) : le prix de la boîte passe sans risque par `modifierFiche` (le front le fait déjà).
- Il n'accepte **pas** `notes` (`ModifierFicheDto` sans ce champ, `forbidNonWhitelisted: true` dans `main.ts`) : les notes ne peuvent passer que par `upsertStock`, qui exige `quantite`.
- La page stock charge bien la liste des fiches actives (`stockInfo.stocks`, `src/app/dashboard/stock/page.tsx` l.45, 93), mais ne la passe pas à `StockModal` ; les fiches archivées n'y figurent pas (l'API les exclut). Le front seul ne peut donc pas savoir qu'un médicament est « déjà en stock » dans le cas archivé.

## Recommandation minimale

Un seul changement back, petit, qui règle (a) et (b) à la racine : rendre `quantite` **facultative** dans `UpsertStockDto` (`@IsOptional()`, `quantite?: number`) et, dans `upsertStock`, **ne rien faire côté stock quand elle est absente** (sauter le bloc `if (etat.quantite !== sommeLots) ... else if (...)`). Sans quantité, l'upsert ne fait plus que prix, notes et désarchivage. Ajouter les tests back correspondants (fiche à un lot, notes sans quantité : aucun mouvement).

Puis, côté front (même fiche ou retouche PF02b) :
1. Modification : envoyer `upsertStock({ medicamentId, notes })` **sans** `quantite`.
2. Ajout : étape (b) sans `quantite` quand la fiche existe n'est pas détectable ; pour la fiche neuve, `quantite: 0` reste inoffensif, mais le plus simple est d'omettre `quantite` partout sauf à l'étape (d). Lire la réponse de (b) : si `data.quantite !== 0` (fiche déjà en stock, active ou archivée) ou si la fiche a un `coefficientBoite` déjà qualifié, **ne pas exécuter (d)** et afficher « Ce médicament est déjà en stock : utilisez « Réception » pour ajouter des boîtes » ; calculer sinon `boîtes x coefficientBoite` avec le coefficient renvoyé par (c).
3. Complément sans changement du back : passer `stockInfo.stocks` à `StockModal` et bloquer l'ajout d'un médicament déjà présent dans la liste active (n'élimine pas le cas archivé, d'où le changement du back).

Sans le changement du back, aucune parade côté front ne protège le cas archivé ni le cas des notes après vente.

## Autres constats (non bloquants)

- `StockModal.tsx` l.366 à 369 : en modification, si le stock est négatif ou multi-lots, l'enregistrement des notes échoue (400 / 409) avec le message du serveur ; sera résolu par la recommandation ci-dessus.
- `date_peremption.ts` : cas limite d'année sur 4 chiffres inférieure à 100 (voir plus haut), à ignorer.
- Captures clair et sombre (point 6 du Done when) : non réalisées par ce vérificateur (pas de session Moussa Kanté / Djénabou Baldé lancée) ; design repris du code existant vérifié à la lecture seulement.

## Seconde vérification (après D707)

### Verdict : PASS

### Commandes

| Commande | Résultat |
|---|---|
| back : `tsc --noEmit` | exit 0 |
| back : eslint sur dto, dto.spec, pharmacie.service, mouvements-stock.db-spec | exit 0 |
| back : `npm test` | 101 suites, 1114 tests verts (3 ignorés, préexistants) |
| back : `npm run test:db` | 35 suites, 410 tests verts |
| front : `tsc --noEmit`, eslint, `vitest run` | tsc 0, eslint 0, 63 fichiers, 538 tests verts |
| front : `npm run build` local | réussi |

### Back (relecture ligne à ligne)

- Chemin avec quantité présente : inchangé. Les trois changements de `pharmacie.service.ts` sont tous gardés par `dto.quantite === undefined` ou `!== undefined` : `archiveLe` (`undefined` seulement sans quantité, `null` sinon, donc même désarchivage), audit de désarchivage (condition `&& quantite !== undefined`, toujours vraie avec quantité), alerte de stock (idem). Le reste du bloc (verrou, lots, INVENTAIRE, 409) n'est pas touché.
- Branche sans quantité : retour avant `verrouillerFiches`, `lireEtatsStock`, création de lot, mouvement et lecture de date : aucun mouvement, aucun lot, aucun audit de désarchivage, aucun verrou consultatif. Elle prend seulement le verrou de ligne implicite de l'upsert de la fiche. Une fiche archivée reste archivée (les prix et notes sont mis à jour) ; pas d'alerte de stock.
- Test sur base (test 14) : prouve réellement : lots avant et après identiques en base, journal de mouvements identique (`mouvementsDe`), quantité et lots lus identiques, fiche archivée toujours `archiveLe` non nul et absente de la lecture, `verifierStock` sans anomalie. Tests DTO : quantité absente acceptée, 2,5 et -1 toujours refusés.
- Aucun test existant modifié (seulement des ajouts) ; `upsertStock` n'a qu'un appelant (le contrôleur) : import Excel, démo et autres passent par d'autres méthodes, non affectés.
- `quantite` devenue `number | undefined` : `tsc` OK.
- Hors périmètre à noter : `docker-entrypoint.sh` apparaît modifié dans `git status` du back sans différence de contenu (fins de ligne seulement) ; à ne pas commiter avec PF02b.

### Front

- Notes en modification : `upsertStock({ medicamentId, notes })` sans quantité (plus de risque (b)).
- Ajout arrêté si la fiche existait : lecture de la réponse de (b) (quantité non nulle, `archiveLe`, ou lots) ; la réponse réelle du back porte bien `archiveLe`, `quantite` et `lots` (`avecStock` étale la fiche) ; message exact « Ce médicament est déjà dans votre stock. Pour ajouter des boîtes, utilisez « Réception ». », aucun appel `modifierFiche` ni écriture de quantité, `onSuccess` non appelé ; test couvrant les trois cas.
- Coefficient lu dans la réponse de `modifierFiche` pour calculer (d) : testé (20 saisi, 10 renvoyé, 3 boîtes donnent 30).
- `fichesActives` passée par la page : refus dès la sélection dans la recherche, bouton désactivé : testé.

### Course résiduelle (prix et notes de l'étape b sur une fiche existante)

Acceptable, non bloquante : aucun stock, lot ni date n'est touché. Elle ne concerne que le cas archivé (la liste de la page couvre l'actif) ou une fiche créée par un autre poste depuis le chargement : le prix de la boîte et les notes de cette fiche sont alors remplacés par la saisie, sans audit. Durcissement facultatif, peu coûteux : à l'étape (b), n'envoyer ni prix ni notes (seulement `medicamentId`), détecter, puis envoyer le prix par `modifierFiche` (c) et les notes par un second `upsertStock` sans quantité. À décider par l'orchestrateur ; pas de FAIL.

### Problèmes restants

Aucun bloquant. Les captures clair et sombre restent non réalisées par le vérificateur.
