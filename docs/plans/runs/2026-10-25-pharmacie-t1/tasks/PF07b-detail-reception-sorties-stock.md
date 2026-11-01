# PF07b - Détail d'une réception, correction de date d'un lot, sortie de stock avec raison

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (titulaire ; vendeur pour les sorties)
Visuel: oui (nouvelle page de détail, nouveau dialogue sur la page du stock)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Sixième sous-fiche (D685), après PF07a. Trois éléments : (1) la page de détail d'une réception (lots reçus, coût seulement s'il est transmis, ventes rattachées) ; (2) la correction de la date de péremption d'un lot avec motif, depuis ce détail ; (3) la sortie d'un lot du stock avec une raison obligatoire (périmé, cassé ou abîmé, perdu ou volé, retour au fournisseur, autre), depuis la page du stock.

Décisions applicables : D684, D686, D687, D688, D693, D698, D699.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- PF07a : `getReception`, types `Reception`, `LotRecu` dans `src/lib/api_pharmacie.ts` ; liste `/dashboard/receptions` dont chaque ligne pointe vers `/dashboard/receptions/<id>`. PF02a : page du stock avec boutons « Modifier », « Corriger la quantité », « Archiver », dialogue `CorrectionQuantite.tsx` (gabarit à reprendre). PF02b : `lireDatePeremption`, `afficherDatePeremption`. PF01b : `src/components/pharmacie/ChoixLot.tsx`. PF01a : `erreurs_api.ts`, `classes.ts`, `ErreurAvecReessai`, `formaterQuantite`, `nouvelleCleIdempotence`.
- Contrats (back `CLAUDE.md`, puces PB14a et PB15a ; DTO `receptions.dto.ts`, `inventaires.dto.ts` ; services `receptions.service.ts`, `inventaires/sorties.service.ts`) :
  - `GET /pharmacie/:structureId/receptions/:receptionId` (`reception:write`) : `data { id, reference, recueLe, createdAt, auteurId, fournisseur: { id, nom } | null, lots: [{ id, stockId, nom, numeroLot, dateExpiration, quantiteRecue (unités), coefficientReception, solde (unités), coutAchatBoite?, coutUnitaire? }], resolutions: [...] }` ; 404 « Cette réception est introuvable. ».
  - `PATCH /pharmacie/:structureId/lots/:lotId` (`reception:write`) : `{ dateExpiration? (AAAA-MM-JJ) | sansPeremption?: true, motif (3 à 300) }` : 400 `MOTIF_REQUIS` (« Indiquez le motif de la correction (3 caractères au moins). »), 400 `DATE_PEREMPTION_REQUISE`, 400 `VALIDATION` (date inexistante), 404 « Ce lot est introuvable. » ; ni identifiant client ni rejeu (une même correction répétée ne change rien).
  - `GET /pharmacie/:structureId/stock/:stockId/lots` (`stock:read`) : lots à solde positif, dans l'ordre de sortie : `data: [{ id, numeroLot, dateExpiration, dateReception, quantite, reliquat, coefficientReception, lotTechnique, perime, coutUnitaire? }]`.
  - `POST /pharmacie/:structureId/stock/sorties` (`stock:write`, 200) : `{ id? (UUID), stockId, lotId, unite: "BOITE" | "UNITE", quantite (entier >= 1 ; boîtes du lot, soit `coefficientReception` unités, ou unités), raison: "PERIME" | "CASSE" | "PERDU" | "RETOUR_FOURNISSEUR" | "AUTRE", commentaire? (300, obligatoire pour AUTRE) }` ; réponse `data { id, mouvementId, stockId, nom, lotId, numeroLot, dateExpiration, perime, type, motif, quantite (unités), soldeLot, soldeProduit, auteurId, createdAt, cree }`, message « Sortie de stock enregistrée. » ou « Cette sortie de stock était déjà enregistrée. » ; erreurs 400 `MOTIF_REQUIS` (raison manquante, ou commentaire manquant pour AUTRE), 400 `VALIDATION`, 404, 409 `STOCK_LOT_NEGATIF` (« Ce lot n'a que N unité(s) en stock : la sortie ne peut pas dépasser ce stock. »), 409 `IDENTIFIANT_DEJA_UTILISE`. Jamais refusée pour journée clôturée (D614).
- Le rôle « Pharmacien » a `stock:write` : le vendeur peut sortir un lot (réserve PB15a : une sortie « Perdu ou volé » n'est tracée que par l'audit ; le front n'y ajoute rien, voir points remontés).
- Jeu démo : Kaloum, `BL-MAT-0412` (11 lots dont un Ibuprofène sans coût), lot `AG23C777` d'Augmentin périmé, `CT23H990` à 7 jours.

### 1. `src/lib/api_pharmacie.ts` (ajouts)

`corrigerDateLot(structureId, lotId, corps: { dateExpiration?: string; sansPeremption?: true; motif: string })` ; `export interface LotEnStock { id: string; numeroLot: string | null; dateExpiration: string | null; dateReception: string; quantite: number; reliquat: number; coefficientReception: number; lotTechnique: boolean; perime: boolean; coutUnitaire?: number | null }` et `listerLotsFiche(structureId, stockId)` ; `export type RaisonSortie = "PERIME" | "CASSE" | "PERDU" | "RETOUR_FOURNISSEUR" | "AUTRE"` ; `export const LIBELLES_RAISON_SORTIE: Record<RaisonSortie, string>` = « Périmé », « Cassé ou abîmé », « Perdu ou volé », « Retour au fournisseur », « Autre raison » ; `sortirDuStock(structureId, corps)` et le type de la réponse.

### 2. Page `src/app/dashboard/receptions/[receptionId]/page.tsx`

Gabarit de `src/app/dashboard/ventes/[venteId]/recu/page.tsx` pour les états (`chargement`, `pret`, `introuvable`, `erreur`) et la lecture du paramètre de route (même façon que cette page, compatible Next.js 16).
- En-tête : « Réception du <formaterDateHeure(recueLe)> », lignes « Fournisseur : <nom ou Non renseigné> », « Bon de livraison : <référence ou Non renseigné> » ; lien « Retour aux réceptions ».
- Tableau des lots (`CARTE`) : « Médicament », « Lot » (« Sans numéro »), « Péremption » (`afficherDatePeremption`, « Sans date »), « Reçu » (`formaterQuantite(quantiteRecue, coefficientReception, ...)`, unité : `uniteMinimale` de la fiche si le stock est chargé, sinon « UNITE »), « Reste en stock » (`formaterQuantite(solde, ...)`), et la colonne « Coût d'achat d'une boîte » **seulement si la clé `coutAchatBoite` est présente sur au moins un lot** (D698) : valeur `formaterGNF`, ou « Inconnu » si elle vaut `null`, jamais « 0 GNF » pour une valeur nulle.
- Si `resolutions` n'est pas vide : `ALERTE_INFO` « Des ventes faites en attente de stock ont été rattachées à ces lots. ».
- Par lot, bouton `BOUTON_SECONDAIRE` « Corriger la date » (`aria-label="Corriger la date du lot <numéro ou nom>"`).
- Introuvable : « Cette réception est introuvable. » et lien de retour ; erreur : `ErreurAvecReessai`.

### 3. Dialogue `src/app/dashboard/receptions/[receptionId]/CorrectionDateLot.tsx`

Gabarit de `CorrectionQuantite.tsx`. Titre « Corriger la date de péremption » ; rappel « <nom>, lot <numéro ou Sans numéro>, date actuelle : <date ou Sans date> » ; champ « Nouvelle date de péremption » (texte, `lireDatePeremption`, date lue affichée en clair) ou case « Sans date de péremption » ; « Motif » (3 à 300, aide « Par exemple : erreur de saisie, date relue sur la boîte ») ; boutons « Enregistrer la correction » et « Annuler ». Refus local : « Indiquez une date lisible (ou « Sans date ») et un motif de 3 caractères au moins. ». Succès : détail rechargé, message du serveur en `ALERTE_SUCCES`. Erreurs : message du serveur dans le dialogue ; réseau : « La correction n'a peut-être pas été enregistrée. Fermez cette fenêtre et vérifiez la date affichée avant de recommencer. » (pas de bouton « Réessayer »).

### 4. Sortie de stock (`src/app/dashboard/stock/SortieStock.tsx` et page du stock)

Page du stock : nouveau bouton d'action « Sortir du stock » (icône `PackageMinus` de lucide, `aria-label="Sortir <nom> du stock"`, classes des autres boutons d'action), entre « Corriger la quantité » et « Archiver », pour toute fiche dont la quantité est positive.

Dialogue (gabarit de `CorrectionQuantite.tsx`, icône dans un carré `bg-amber-50 dark:bg-amber-500/15`) :
- Titre « Sortir <nom> du stock » ; à l'ouverture, `listerLotsFiche` (état de chargement « Chargement des lots... », erreur `ErreurAvecReessai`) ; aucun lot : « Aucun lot en stock pour ce médicament. » et seul le bouton « Fermer ».
- « Lot à sortir » : `ChoixLot` (lots dans l'ordre reçu, les périmés en tête marqués « périmé ») ; un seul lot : présélectionné.
- « Raison » : boutons radio des cinq raisons (`LIBELLES_RAISON_SORTIE`), aucune présélectionnée ; si le lot choisi est périmé, « Périmé » est présélectionné.
- « Quantité » : entier >= 1, « en boîtes » / « en <pluriel> » si `coefficientReception` dépasse 1 (« en boîtes » par défaut) ; bouton `BOUTON_SECONDAIRE` « Tout le lot » qui met la quantité du lot en unités.
- « Précisez » : texte (300), obligatoire pour « Autre raison », facultatif sinon.
- Boutons « Enregistrer la sortie » et « Annuler » ; refus local : « Choisissez le lot, la raison et la quantité (et précisez pour « Autre raison »). ».
- Identifiant client (D688) : un `id` créé à l'ouverture du dialogue ; échec réseau : « La sortie n'a peut-être pas été enregistrée. Appuyez sur « Réessayer l'envoi » : elle ne sera pas comptée deux fois. », champs en lecture seule, bouton « Réessayer l'envoi » (même `id`) ; fermer le dialogue abandonne la saisie (le stock est rechargé). Refus du serveur : message du serveur dans le dialogue, champs modifiables, même `id`.
- Succès : stock rechargé, `ALERTE_SUCCES` de la page : message du serveur suivi de « Reste dans ce lot : <formaterQuantite(soldeLot)>. ».

### 5. Tests

`src/app/dashboard/receptions/[receptionId]/page.test.tsx` (4) : 1. lots affichés avec péremption `30/06/2028` et « Sans numéro » ; 2. colonne du coût absente quand aucun lot n'a la clé `coutAchatBoite` ; présente avec « Inconnu » pour `coutAchatBoite: null` et jamais « 0 GNF » ; 3. 404 : texte « Cette réception est introuvable. » ; 4. correction de date : `10/27` et motif « Date relue sur la boîte » envoient `corrigerDateLot(s1, lotId, { dateExpiration: "2027-10-31", motif: "Date relue sur la boîte" })` puis rechargent le détail.

`src/app/dashboard/stock/SortieStock.test.tsx` (6) : 1. lot périmé : « Périmé » présélectionné ; 2. « Autre raison » sans précision : aucun envoi, message exact ; 3. envoi en boîtes : `{ id, stockId, lotId, unite: "BOITE", quantite: 2, raison: "CASSE" }` ; 4. « Tout le lot » : `unite: "UNITE"` et la quantité du lot ; 5. 409 `STOCK_LOT_NEGATIF` : message du serveur, même `id` à l'envoi suivant ; 6. échec réseau puis « Réessayer l'envoi » : même `id`, champs en lecture seule.

`src/app/dashboard/stock/page.test.tsx` (1 ajouté) : le bouton « Sortir Doliprane du stock » ouvre le dialogue ; il est absent pour une fiche à quantité nulle ou négative.

## Contraintes

Faire uniquement ce qui est demandé ; réutiliser `ChoixLot`, `lireDatePeremption`, `formaterQuantite`, `classes.ts`. Audience non-dev : termes interdits absents. Visuel : classes existantes, clair et sombre, AA. Next.js 16 : lire `node_modules/next/dist/docs/` pour la route dynamique. Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés : `src/lib/api_pharmacie.ts`, `src/lib/api_pharmacie.test.ts`, `src/app/dashboard/receptions/[receptionId]/page.tsx`, `src/app/dashboard/receptions/[receptionId]/page.test.tsx`, `src/app/dashboard/receptions/[receptionId]/CorrectionDateLot.tsx`, `src/app/dashboard/stock/page.tsx`, `src/app/dashboard/stock/page.test.tsx`, `src/app/dashboard/stock/SortieStock.tsx`, `src/app/dashboard/stock/SortieStock.test.tsx`.

## Test à la main

Démo remise à zéro, **Djénabou Baldé** (titulaire, Kaloum) : « Réceptions », `BL-MAT-0412` : coût « Inconnu » sur l'Ibuprofène, colonne du coût visible (elle a `marge:read`) ; correction de date d'un lot avec `10/27`. Page du stock : sortie du lot périmé `AG23C777` (Augmentin) en « Périmé ». **Ousmane Keita** (vendeur, Kaloum) : « Sortir du stock » d'une boîte cassée ; il n'a pas accès aux réceptions. Captures clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur.
3. `npm test` : tout vert, dont détail de réception (4), `SortieStock.test.tsx` (6), page du stock (1 ajouté).
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés.
6. Termes interdits absents ; aucun U+2014 ni U+2013 ajouté ; captures clair et sombre (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
