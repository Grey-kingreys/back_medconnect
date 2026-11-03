# PB20 - Vente en ligne refusée au-delà du stock, quantité jamais négative en sortie d'API

Tier: dur (codeur Sonnet, vérificateur Sonnet)
Audience: API dev ; messages d'erreur et d'anomalie non-dev (vendeur, titulaire)
Visuel: non
Background-safe: oui, un seul agent en `test:db`
Dépôt: `back_medconnect`, branche `orch/pharmacie-t1-back`

## Spec

### Objectif

Appliquer D713 côté serveur. En ligne, une vente au-delà du stock vendable est refusée avec le stock restant. Hors ligne, le rejeu ne change pas. Aucune sortie d'API lisible par le front ne porte de quantité négative. Aucune migration, aucune correction SQL : journal et agrégat par produit gardent la vérité.

Décisions applicables : D713 à D721, D726 ; D657, D675, D692 restent vraies sauf ce que D713 révise.

### Contexte vérifié dans le code (ne pas re-découvrir)

- `vente.service.ts`, `enregistrerVente` : étape 10 verrous (`verrouillerFiches`), relecture des coefficients, `agregatsAvant`, `lireLotsCandidats` ; étape 12 `allouerLignes` puis `SORTIE_MANUELLE_REQUISE` ; étape 13 `ecrirePieceVente`. Le numéro de ticket est pris à l'étape 9 dans la même transaction : un refus à l'étape 12 l'annule.
- `allouerLignes` (`vente-regles.ts`) décrémente les soldes en mémoire : une fiche en boîtes et en unités dans la même vente voit déjà le reste. `selectionnerLots` ne renseigne `lotsPerimesDisponibles` que s'il reste un manque. Une ligne avec sortie manuelle a `lotsPerimesDisponibles` vide.
- `ecriture-vente.ts` : partagée avec `synchro.service.ts:1019`.
- `codes-erreur.ts:39-40` : commentaire « plus jamais renvoyé » à remplacer. `CODES_AVEC_DETAILS` contient déjà `STOCK_INSUFFISANT`. `assainirDetails` ne recopie que `stockId`, `nom`, `disponible`, `demande`, `lots` et les clés de clôture : ajouter `unite` (chaîne) et `disponibleUm` (nombre).
- `lecture-stock.ts` : `calculerEtatStock` calcule `quantite` = agrégat, `quantiteVendable` = somme des lots non périmés. Ne sont lus que les lots à solde positif.
- `upsertStock` compare `etat.quantite` (vérité) à la somme des lots : cette comparaison doit garder la vérité.
- Le DTO d'upsert a déjà `@Min(0)` ; `avecStock` et `avecStockPublic` sont les points de présentation.

### 1. Refus de la vente web

Fonction pure dans `vente-regles.ts` :

```ts
export function controlerStockVente(entree: {
  lignes: { index: number; stockMedicamentId: string; nom: string; unite: UniteVente; nombre: number; quantiteUm: number; coefficientLigne: number; sortieManuelle: boolean }[];
  allouees: readonly LigneAllouee[];
  soldeProduit: ReadonlyMap<string, number>;
}): { insuffisantes: LigneInsuffisante[]; sortiesManuelles: LigneAllouee[] };
```

Par fiche, avec `plafond = max(0, soldeProduit)`, `demandeUm` = somme des lignes, `restes` = somme des `resteProvisoire`, `alloue` = somme des `quantiteAllouee` :

1. `plafond === 0` : insuffisante, disponible 0 (même s'il y a des lots périmés).
2. `restes > 0`, `alloue === 0`, lots périmés disponibles et aucune sortie manuelle : sortie manuelle requise.
3. `restes > 0` sinon (stock non périmé partiel, lot manuel trop petit) : insuffisante, disponible = `min(alloue, plafond)`.
4. `restes === 0` et `demandeUm > plafond` : insuffisante, disponible = `plafond`.

Une ligne insuffisante donne `disponible = floor(max(0, disponibleFiche - autres lignes de la fiche en UM) / coefficientLigne)`. `coefficientLigne` vaut 1 pour `UNITE`, `coefficientApplique` pour `BOITE`.

Dans `enregistrerVente`, juste après `allouerLignes`, sous les verrous, avec `avantParFiche` lu sous verrou :

- d'abord `STOCK_INSUFFISANT` (ConflictException), toutes les lignes en cause ;
- ensuite le refus `SORTIE_MANUELLE_REQUISE` existant, `details` inchangés.

Message, `messageStockInsuffisant` : un médicament : « Stock insuffisant pour « Doliprane » : il reste 1 boîte et 15 comprimés. Réduisez la quantité, ou faites enregistrer la livraison si ces boîtes viennent d'arriver. » ; plusieurs : « Stock insuffisant : Doliprane (il reste 1 boîte), Flagyl (il ne reste rien). Réduisez les quantités, ou faites enregistrer la livraison si ces boîtes viennent d'arriver. » ; reste nul : « il ne reste rien ». Quantité lisible : nouvelle fonction pure `formaterQuantiteLisible(um, coefficient, uniteMinimale)` dans `domaine/quantites.ts`, mêmes sorties que `formaterQuantite` du front (`src/lib/caisse/regles/quantites.ts`) pour une quantité positive ou nulle, RangeError si négative. La carte des libellés du back contient les 7 valeurs actuelles ; PB21 ajoutera la plaquette.

`ecrirePieceVente` : champ obligatoire `provisoireAutorise` (D716), `false` web, `true` rejeu. À `false`, une allocation avec `resteProvisoire > 0` lève une `RangeError` avant toute écriture. Audit web : retirer `provisoire` de `metadata` s'il ne sert plus. `provisoire` reste dans `presenterVente` (une vente rejouée le porte).

Texte de la `@ApiResponse` 409 de `vente.controller.ts` et description du 201 : ajouter `STOCK_INSUFFISANT`.

### 2. Lecture (D717)

`lecture-stock.ts` :

- `EtatStockFiche` gagne `quantiteARegulariser = max(0, somme des lots en stock - soldeProduit)`.
- `quantiteVendable = min(somme des lots non périmés, max(0, soldeProduit))` (D714).
- `quantite` interne inchangée (commentaire : vérité, jamais à exposer telle quelle).
- `avecStock` : `quantite: max(0, etat.quantite)`, `quantiteARegulariser`, `disponible` inchangé en valeur.
- `avecStockPublic` : inchangé, sans le nouveau champ (la recherche publique ne montre rien du négatif).

### 3. Autres sorties à écrêter

| Surface | Fichier | Changement |
|---|---|---|
| Liste du stock et `alertes` | `pharmacie.service.ts` `getStockPharmacie` | passe par `avecStock` ; `alertes.rupture[]` gagne `quantiteARegulariser` |
| Correction | `updateStockQuantite`, lignes 845 et 852 | message et alerte avec `max(0, apres)` ; gardes internes `avant`/`apres` en vérité |
| Sortie manuelle | `inventaires/sorties.service.ts:237` | `soldeProduit` écrêté, `quantiteARegulariser` ajouté |
| Import livraison | `pharmacie.service.ts`, `importerStock`, aperçu | écrêter `quantiteAvant` et `quantiteApres` à la réponse seulement, après le calcul de l'alerte qui garde la vérité ; ajouter `quantiteARegulariserAvant` à la ligne si positive |
| Inventaire | `inventaires.service.ts` lignes 759, 773, 1017 et aperçu d'import | `quantiteTheorique` écrêté, `quantiteARegulariser` = `max(0, -quantiteTheorique)` ajouté à la ligne ; `ecart` reste signé ; `LigneInventaire` en base inchangée |
| Qualification | `fiche-produit.service.ts:203-249`, et le message `messageStockMultiplie` | `conversion.quantiteAvant`/`quantiteApres` écrêtés à la réponse |
| Notification de stock bas | `vente.service.ts:880` | sans changement : `apres` est positif ou nul en ligne, test à l'appui |
| Photographie desktop | `synchro/catalogue-synchro.service.ts:272` | `quantite` écrêtée, `quantiteARegulariser` (D719), type `FicheSynchro` |
| Anomalies | `anomalies/anomalies.service.ts:276` | D720 : `detailsLisibles(type, details)`, fonction pure testée |
| Message `STOCK_NEGATIF` à l'écriture | `ecriture-vente.ts:204` | texte D720 ; `details.soldeProduit` garde la vérité |

### 4. Audit des écrivains du stock en ligne (résultat, à garder en tête)

| Écrivain | Saisie négative | Peut passer l'agrégat sous zéro ? | Suite |
|---|---|---|---|
| Vente web | `@Min(1)` | Oui aujourd'hui | Refus, cette fiche |
| Upsert `quantite` | `@Min(0)` | Non : avec une part à régulariser, seule la valeur égale à la vérité passe (`LOT_REQUIS` sinon, et une vérité négative ne passe jamais `@Min(0)`) | Aucun. Test : fiche à -1, `quantite: 0` donne 409 `LOT_REQUIS` |
| Correction `PATCH .../quantite` | variation signée, voulue | Oui si part à régulariser : lot 3, part 1, variation -3 donne -1 | Permis (D718), lot protégé, message écrêté |
| Sortie manuelle | `@Min(1)` | Oui, même cas | Permis (D718) |
| Inventaire et import inventaire | `@Min(0)`, `quantite < 0` rejetée | Oui si part à régulariser non couverte par le comptage (comptage 0) | Permis (D718), l'écart reste juste |
| Annulation | sans saisie | Non : mouvements positifs | Aucun |
| Réception et import livraison | `@Min(1)` | Non : positif, et résolution neutre sur l'agrégat | Aucun |
| Qualification | sans saisie | Non : `CONVERSION_IMPOSSIBLE` s'il y a du provisoire ; `CONSERVER` n'écrit rien | Aucun |
| Rejeu | hors périmètre | Oui, voulu | Inchangé (D713.2) |

Vérifier en passant qu'aucun autre champ de quantité d'entrée n'accepte un négatif (`nombreBoites`, `unitesEnPlus`, `quantiteComptee`, `quantiteUnites`) : déjà `@Min`, à confirmer par un test de DTO s'il n'existe pas.

### 5. Jeu démo (D721)

`scenario-demo-pharmacie.donnees.ts` :

- `CleSessionScenario` gagne `S3`.
- `EVENEMENTS_POSTE_LOT_C` : séquence 17 `SESSION_OUVERTE` (S3, jour 0, 00:10), 18 `COMPTAGE_SAISI` (fond habituel), 19 `VENTE` (ticket 10, Ventoline 1 boîte à 60 000, Orange Money `OM-7815530`, `ordonnanceVerifiee: true`).
- Heure volontairement proche de minuit : un horodatage local dans le futur serait faux pour une remise à zéro faite tôt le matin. Si le jour local du rejeu pose problème à 00:10 (fuseau de Conakry, UTC), l'expliquer dans le rapport.
- Retirer W2 de `VENTES_WEB_SCENARIO`, garder les clés W1 et W3 pour ne pas toucher l'annulation.

`scenario-demo-pharmacie.service.ts` : `sessions.S3`, envoi du lot C après l'inventaire (étape 8) et avant les ventes web, `sessionOuverte: true`. Bilan `evenementsAppliques: 19`, `ventesWeb: 2` ; `demo.seeder.spec.ts:28` et `test/db/demo.db-spec.ts:91` suivent.

`test/db/demo.db-spec.ts` : la vente de Ventoline se retrouve par son poste ou son ticket ; le message attendu (ligne 510) prend le texte D720 ; `STOCK_FINAL_KALOUM` garde `'Ventoline 100 µg': -1` ; ajouter la lecture par `getStockPharmacie` : `quantite: 0`, `quantiteARegulariser: 1`. Marge : `provisoires` toujours 1 ligne et 60 000. Revoir les totaux de caisse du jour (Orange Money quitte la caisse web pour S3).

### 6. Tests

Aide commune `test/db/rejeu-provisoire.ts` : `venteProvisoireParRejeu(synchro, { structureId, vendeurId, poste, sessionId, stockId, nombre, unite, prixUnitaire })`, à la séquence suivante du poste, numéro de secours, `expect(statut).toBe('APPLIQUE')`. Une seule aide, reprise de `evVente` de `synchro-ventes.db-spec.ts`. Les services du rejeu sont à instancier dans chaque spec comme le fait déjà `journee-cloturee.db-spec.ts:145`.

À écrire :

- `vente-regles.spec.ts`, `controlerStockVente` : refus simple ; boîtes + unités sur la somme (`disponible` de chaque ligne) ; périmés seuls ; partiel + périmés (insuffisant) ; agrégat négatif + périmés (insuffisant) ; lots 3 et part 1 (2 disponibles) ; sortie manuelle au-delà du lot ; sortie manuelle au-delà de l'agrégat.
- `lecture-stock.spec.ts` : agrégat -1 ; lots 3 et part 1 ; périmés 5 et part 3 (`quantite` 2, N 3, vendable 0) ; `avecStock` jamais négatif.
- `quantites.spec.ts` : `formaterQuantiteLisible`.
- `all-exceptions.filter.spec.ts` : `unite`, `disponibleUm` recopiés.
- `anomalies.spec` ou fichier dédié : `detailsLisibles`, ancien message réécrit, positif non touché.
- `vente.http.spec.ts` : 409 `STOCK_INSUFFISANT`, forme des `details`.
- `test/db/vente.db-spec.ts` : test 10 inversé (sans stock : 409, aucune vente, aucun mouvement, aucune anomalie, `CompteurTicket` inchangé, aucune caisse ouverte automatiquement, clé d'idempotence réutilisable) ; stock partiel ; mélange boîtes et unités ; **course : deux ventes simultanées de la dernière boîte, une 201 et une 409, agrégat à 0** ; ordre avec `SORTIE_MANUELLE_REQUISE` ; lignes 795 et 819 à reprendre par rejeu.
- `test/db/synchro-ventes.db-spec.ts` : **preuve du rejeu** : le test 5 (CA24) reste vert sans modification ; ajouter une assertion de non-régression du résultat identique avec `provisoireAutorise: true`, et un test fiche à zéro en rejeu : `APPLIQUE`, provisoire, anomalie, agrégat négatif, lecture écrêtée à 0 avec N.

À adapter (provisoire créé par le rejeu) : `annulation.db-spec.ts:885`, `inventaire.db-spec.ts:677`, `import-inventaire.db-spec.ts:513` et `546`, `import-livraison.db-spec.ts:361`, `receptions.db-spec.ts:952`, `resolution.db-spec.ts` (aide `vendre`, y compris les deux tests de concurrence), `sorties-anomalies.db-spec.ts:340`, `564`, `610`, `618`, `700`, `rapports-pharmacie.db-spec.ts:474`, `qualification.db-spec.ts` si la fiche vend sans stock, `journee-cloturee.db-spec.ts`, `plages-tickets.db-spec.ts`, `etancheite-couts.db-spec.ts`, `m6-ventes-pieces.db-spec.ts`. Toute vente de ces specs qui échoue en `STOCK_INSUFFISANT` sans viser le provisoire reçoit du stock, on n'affaiblit aucune assertion. Le test de `sorties-anomalies.db-spec.ts:618` (boîte et unité sur la même fiche) passe par deux lignes de rejeu.

Cas à contrôler en premier : une annulation de vente rejouée se fait depuis la caisse web ; si une règle l'empêche, le signaler au lieu de contourner.

`test/db/non-regression-lectures.db-spec.ts` et `test/db/instantanes/get-stock-pharmacie.json` : ajout du seul champ `quantiteARegulariser` attendu. Mise à jour de l'instantané justifiée dans le rapport, aucune autre clé ne doit bouger. `test/db/etancheite-couts` : le nouveau champ n'a pas de nom de coût, à confirmer vert. `test/db/commandes-stock.db-spec.ts` : doit rester vert sans modification, preuve que `stock:verifier` lit la vérité.

### 7. Documentation

- `CLAUDE.md` du back : puce PB08 (`quantite`, `quantiteARegulariser`, formule de `quantiteVendable`, rupture à 0) ; puce PB11 (retirer « sans jamais refuser la vente » et « `STOCK_INSUFFISANT` ... ne sont plus renvoyés », ajouter le 409, la somme par fiche, l'ordre des refus) ; puce PB18 (rejeu inchangé, photographie écrêtée) ; section Mode démo (« vente sans stock » remontée par le poste) ; puce PB15a (message D720). Une puce courte : « journal et agrégat peuvent rester négatifs, jamais une sortie d'API ». `web-defaut:<userId>` y figure déjà (D726), rien à ajouter.
- `codes-erreur.ts` : commentaire de `STOCK_INSUFFISANT` à jour.
- Swagger : 409 de la vente, `quantiteARegulariser` si un schéma de réponse est décrit.

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, `prettier --write`, `eslint --fix`).
- Jamais `prisma migrate dev`, `reset` ni `db push`. Cette fiche n'a aucune migration.
- Jamais commiter `docker-entrypoint.sh` (modifié localement, à laisser).
- Jamais afficher une valeur de `.env`.
- Jamais deux agents en `test:db` en même temps.
- Ne pas modifier `selectionnerLots`, `allouerLignes`, ni le comportement de `synchro.service.ts` hors du passage de `provisoireAutorise: true` et de la photographie.
- Aucune écriture dans les tables immuables ni correction de données.
- Pas de tiret cadratin ni demi-cadratin, tout en français.
- Gates : `docker compose exec -T backend npx tsc --noEmit`, `docker compose exec -T backend npx eslint <fichiers touchés>`, `docker compose exec -T backend npm test`, `docker compose exec -T backend npm run test:db`.
- Commit avec la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.

## Test à la main

Après relance du backend : `GET /pharmacie/stock/:structureId` sur la base du porteur, Ventoline à `quantite: 0`, `quantiteARegulariser: 1`. Vente d'une boîte de Ventoline : 409 lisible. `npm run stock:verifier` inchangé.

## Done when

- [ ] Vente web au-delà du stock : 409 `STOCK_INSUFFISANT`, `details` D715, message avec le stock restant
- [ ] Somme boîtes et unités contrôlée, y compris avec des lots et une part à régulariser
- [ ] Périmé seul : `SORTIE_MANUELLE_REQUISE` ; partiel : `STOCK_INSUFFISANT` ; périmé jamais compté vendable
- [ ] Refus : transaction annulée, aucun numéro consommé, aucune caisse ouverte
- [ ] Course sur la dernière boîte prouvée en base : une réussite, un refus, agrégat à 0
- [ ] Rejeu inchangé, prouvé : CA24 vert sans modification, provisoire et anomalie présents
- [ ] Aucune clé de quantité négative dans les surfaces du tableau section 3
- [ ] Base existante à -1 lue `quantite: 0`, `quantiteARegulariser: 1`, sans écriture
- [ ] Anciennes anomalies relues sans « -N »
- [ ] Démo : Ventoline démontrée par le rejeu, `demo.db-spec` vert, bilan 19 et 2
- [ ] `stock:verifier` et `commandes-stock.db-spec` inchangés et verts
- [ ] `tsc`, `eslint`, `npm test`, `npm run test:db` verts
- [ ] `CLAUDE.md` et Swagger à jour

## Return

Fichiers touchés, sorties des gates, liste des tests adaptés et pourquoi, justification de l'instantané, tout écart à la fiche.

## Historique

## Validation
