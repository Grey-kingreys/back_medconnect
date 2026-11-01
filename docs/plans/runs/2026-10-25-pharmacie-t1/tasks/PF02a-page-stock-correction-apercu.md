# PF02a - Page du stock : quantités en boîtes et unités, alertes du serveur, correction avec motif, aperçu corrigé

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (titulaire et vendeur de la pharmacie)
Visuel: oui (page « Stock Médicaments » existante, aucun nouveau système visuel)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Troisième sous-fiche (D685), après PF01b. La page du stock lit le contrat de PB08 : quantités en unités minimales affichées en boîtes et unités, stock bas et rupture lus des alertes du serveur (seuil des paramètres, négatif compris), filtre et compteur « À qualifier ». Les flèches +1 / -1, aujourd'hui **cassées** (le serveur exige un motif depuis PB08 : 400 `MOTIF_REQUIS`), sont remplacées par un dialogue « Corriger la quantité » avec motif (D700). La suppression devient un archivage annoncé comme tel. L'aperçu de l'accueil (`apercu_pharmacie.ts`) est corrigé (valeur au prix de la boîte divisé par le nombre d'unités, stock bas en boîtes, périmé lu sur la quantité vendable, D697).

Décisions applicables : D686, D687, D693, D697, D698, D700.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- `src/app/dashboard/stock/page.tsx` (331 lignes) : `getMyStock`, filtres « Tous / Alertes / Rupture » calculés sur `s.quantite < 10` et `s.quantite === 0` (lignes 74 à 79, faux depuis PB08 : unités minimales, seuil en boîtes, négatif possible) ; boutons flèches qui appellent `updateStockQuantite(structureId, stockId, ±1)` sans motif (lignes 81 à 89, 213 à 228) ; carte « Valeur Stock » = somme `prixUnitaire x quantite` (ligne 147, faux dès que le coefficient dépasse 1) ; badges « Rupture / Faible / OK » (lignes 236 à 244) ; `DeleteConfirmModal` « Retirer du stock ? ... Cette action est irréversible. » (lignes 318 à 328, faux : le serveur archive) ; erreur de chargement seulement en `console.error`.
- `src/lib/api_pharmacie.ts` : `updateStockQuantite(structureId, stockId, variation, notes?)` envoie `{ variation, notes }` ; `removeStockItem` (DELETE).
- `src/lib/apercu_pharmacie.ts` : `calculerApercuStock(stocks, maintenant)`, `SEUIL_STOCK_BAS = 10` comparé à la quantité en unités, valeur `q x prixUnitaire`, détail « Plus que N unités en stock » ; tests `src/lib/apercu_pharmacie.test.ts`, affichage `src/components/dashboard/ApercuPharmacie.tsx` et son test.
- PF01a : `formaterQuantite`, `LIBELLES_UNITE_MINIMALE`, `erreurs_api.ts`, `classes.ts`, `ErreurAvecReessai` ; PF01b : `src/components/pharmacie/ChoixLot.tsx`.
- Contrat (back `CLAUDE.md`, puce PB08) : `GET /pharmacie/stock/:structureId` renvoie `stocks[]` (avec `quantite` en unités minimales, `quantiteVendable`, `lots`, `reliquat`, champs de fiche) et `alertes { stockBas: [{ id, nom, quantite }], rupture: [{ id, nom }] }` (stock bas si 0 < quantité < `seuilStockBas` boîtes x coefficient, rupture si quantité <= 0) ; `PATCH /pharmacie/stock/:structureId/:stockId/quantite` `{ variation (entier non nul, unités minimales), lotId?, motif (3 à 300), notes? }` : 400 `MOTIF_REQUIS`, 409 `LOT_REQUIS`, 409 `STOCK_LOT_NEGATIF`, 404 « Ce lot est introuvable pour ce médicament. », sans identifiant client (non rejouable) ; `DELETE /pharmacie/stock/:structureId/:stockId` archive (la fiche sort des listes et de la vente, une nouvelle saisie la réactive).
- Jeu démo (PB19a-chef.md) : Kaloum : Amlor en stock bas, Ventoline à -1 ; Niger : Spasfon non qualifié (60, coefficient 1), Gaviscon en rupture, Coartem en stock bas.

### 1. `src/lib/api_pharmacie.ts`

`updateStockQuantite(structureId: string, stockId: string, corps: { variation: number; lotId?: string; motif: string })` remplace l'ancienne signature (seul appelant : la page du stock). URL inchangée.

### 2. `src/lib/apercu_pharmacie.ts`

- `SEUIL_STOCK_BAS` = 10 **boîtes** (commentaire : « seuil par défaut du serveur, `seuilStockBas` ») ; `bas` = `q > 0 && q < SEUIL_STOCK_BAS x coefficient` (coefficient = `coefficientBoite ?? 1`).
- `perime` = `q > 0 && quantiteVendable === 0` quand `quantiteVendable` est un nombre ; sinon règle actuelle sur la date.
- `disponible` = `(quantiteVendable ?? q) > 0 && !perime`.
- `valeur` = somme de `Math.round(max(quantiteVendable ?? q, 0) x prixUnitaire / coefficient)` des lignes disponibles qui ont un prix.
- Détail du stock bas : « Plus que <formaterQuantite(q, coefficient, uniteMinimale ?? "UNITE")> en stock » ; rupture d'une quantité négative : « Rupture de stock (ventes en attente de livraison) ».
- Mettre à jour `src/lib/apercu_pharmacie.test.ts` (attentes changées seulement là où la règle change) et ajouter 4 tests : 1. 26 comprimés en boîtes de 20 (coefficient 20) sont en stock bas (26 < 200), 260 ne le sont pas ; 2. valeur de 40 comprimés à 3 500 la boîte de 20 = 7 000 ; 3. `quantite` 12 et `quantiteVendable` 0 comptent comme périmé, jamais comme disponible ; 4. `quantite` -1 compte en rupture avec le détail « Rupture de stock (ventes en attente de livraison) ».
- `src/components/dashboard/ApercuPharmacie.test.tsx` : ajuster seulement les attentes de texte touchées.

### 3. Page du stock (`page.tsx`)

- Chargement en échec : `ErreurAvecReessai` avec « Le stock n'a pas pu être chargé. Vérifiez votre connexion puis réessayez. » (`messageErreurPour` si le serveur a envoyé un message) et bouton « Réessayer ».
- Cartes de tête : « Total Produits » inchangé ; « Stock Bas » = `alertes.stockBas.length` ; « Rupture » = `alertes.rupture.length` ; « Valeur Stock » = `formaterGNF(calculerApercuStock(stocks, new Date()).valeur)` (au lieu de `GNF ...toLocaleString()`), sous-texte « au prix de vente, hors périmés ».
- Filtres : « Tous », « Alertes » (identifiants de `alertes.stockBas`), « Rupture » (identifiants de `alertes.rupture`), et nouveau « À qualifier » (fiches `qualifie === false`) avec son compteur dans le bouton : « À qualifier (3) » ; même classes que les filtres existants (couleur `primary`). Sous la barre, quand le filtre « À qualifier » est actif : « Confirmez le nombre d'unités par boîte de ces médicaments : ouvrez la fiche avec le bouton Modifier. ».
- Colonne « Quantité » : `formaterQuantite(quantite, coefficientBoite ?? 1, uniteMinimale ?? "UNITE")`, et en dessous, si `reliquat` non vide, « boîte entamée » en `text-xs text-slate-600 dark:text-slate-400` ; plus de flèches.
- Colonne « Prix (GNF) » : prix de la boîte (`formaterGNF`, « Non renseigné » si absent) et, si `prixUnite` existe, ligne « <formaterGNF(prixUnite)> le <singulier de l'unité> ».
- Colonne « Statut » : « Rupture » si l'identifiant est dans `alertes.rupture`, « Stock bas » si dans `alertes.stockBas`, sinon « OK » ; pastille « À qualifier » en plus si `qualifie === false` (classes de la pastille « Faible » actuelle). Les classes de couleur gardent leur forme mais passent aux teintes AA : `text-rose-700 dark:text-rose-300`, `text-amber-700 dark:text-amber-300`, `text-emerald-700 dark:text-emerald-300` (fonds et bordures inchangés).
- Colonne « Actions » : « Modifier » (inchangé), nouveau bouton « Corriger la quantité » (icône `SlidersHorizontal` de lucide, `aria-label="Corriger la quantité de <nom>"`, même classes que « Modifier »), « Archiver » (icône `Archive` au lieu de `Trash2`, `title` et `aria-label` « Archiver <nom> »). Les boutons existants reçoivent aussi un `aria-label` nommant le médicament. Les trois icônes d'action passent aux teintes AA (contraste 3:1 des éléments d'interface en clair) : `text-slate-600 dark:text-slate-400`, survol `hover:text-amber-700 dark:hover:text-amber-300` (Modifier, Corriger) et `hover:text-rose-700 dark:hover:text-rose-300` (Archiver), fonds de survol inchangés.
- Dialogue d'archivage : titre « Archiver ce médicament ? », texte « <nom> disparaîtra de la liste du stock et de la vente. Son historique (ventes, mouvements) est conservé. Vous pourrez le remettre en stock en l'ajoutant de nouveau. ».
- Liste vide : filtre « Tous » sans aucune fiche : « Votre stock est vide. Ajoutez un médicament ou importez votre fichier Excel. » ; filtre actif sans résultat : « Aucun médicament dans ce filtre. ».

### 4. Dialogue « Corriger la quantité » (`src/app/dashboard/stock/CorrectionQuantite.tsx`, nouveau, D700)

Gabarit de `src/app/dashboard/ventes/AnnulationVente.tsx` (`useDialogA11y`, contenu remonté à chaque ouverture, icône `SlidersHorizontal` dans un carré `bg-primary-50 dark:bg-primary-500/15`). Props : `{ isOpen, stock: StockMedicament | null, structureId, onClose, onSucces }`.

- Titre « Corriger la quantité de <nom> » ; ligne « Stock actuel : <formaterQuantite> ».
- Sens : deux boutons radio « Ajouter au stock » / « Retirer du stock » (« Retirer » par défaut).
- Quantité : champ entier positif ; si le coefficient dépasse 1, choix « en boîtes » / « en <pluriel de l'unité> » (« en boîtes » par défaut) ; variation envoyée en unités minimales (boîtes x `coefficientBoite`), signe selon le sens.
- Lot : si `lots` compte plus d'un lot, `ChoixLot` (légende « Lot concerné ») obligatoire ; un seul lot ou aucun : pas de choix, pas de `lotId`.
- Motif : obligatoire, 3 à 300 caractères, aide « Par exemple : boîte retrouvée, erreur de comptage ». Pour une casse, une perte ou un périmé, aide en plus : « Pour un médicament cassé, perdu ou périmé, utilisez plutôt « Sortir du stock » (raison enregistrée). » (le bouton arrive en PF07b ; texte affiché dès maintenant).
- Bouton « Enregistrer la correction » (`BOUTON_PRIMAIRE`), « Annuler » (`BOUTON_SECONDAIRE`), refus local tant que quantité, lot et motif ne sont pas valides : « Indiquez une quantité, le lot concerné et un motif de 3 caractères au moins. ».
- Succès : `onSucces()` (rechargement du stock) puis fermeture ; message du serveur affiché par la page dans un `ALERTE_SUCCES` qui disparaît au prochain rechargement.
- Erreurs : message du serveur dans le dialogue (`MOTIF_REQUIS`, `LOT_REQUIS`, `STOCK_LOT_NEGATIF`, 404, 403) ; échec réseau (`estErreurReseau`) : « La correction n'a peut-être pas été enregistrée. Fermez cette fenêtre et vérifiez la quantité affichée avant de recommencer. » et la page recharge le stock à la fermeture ; **aucun bouton « Réessayer »** (route non rejouable, D688).

### 5. Tests

`src/app/dashboard/stock/page.test.tsx` (garder les 2 tests existants, en adaptant les données simulées au nouveau contrat ; ajouter 7) :
1. « quantité en boîtes et unités » : fiche Doliprane `quantite: 26`, coefficient 20, `COMPRIME` : « 1 boîte et 6 comprimés » affiché ;
2. « statuts lus des alertes du serveur » : une fiche citée dans `alertes.stockBas` montre « Stock bas » même avec une grande quantité, une fiche citée dans `alertes.rupture` montre « Rupture » ;
3. « filtre À qualifier » : bouton « À qualifier (1) », clic : seule la fiche non qualifiée reste ;
4. « valeur du stock » : 40 comprimés à 3 500 la boîte de 20 donnent « 7 000 GNF » (espace insécable acceptée) ;
5. « correction avec motif » : ouvrir le dialogue, « Retirer », 1 boîte, motif « Boîte abîmée retrouvée », envoyer : `updateStockQuantite` appelée avec `(s1, id, { variation: -20, motif: "Boîte abîmée retrouvée" })` puis stock rechargé ;
6. « correction : lot exigé si plusieurs lots » : fiche à deux lots, envoi refusé localement sans choix de lot, puis `lotId` envoyé ;
7. « chargement en échec » : `getMyStock` rejette une `ApiError` 0 : message et bouton « Réessayer » qui relance le chargement.

`src/app/dashboard/stock/CorrectionQuantite.test.tsx` (3) : 1. le 409 `STOCK_LOT_NEGATIF` affiche le message du serveur, dialogue ouvert ; 2. l'échec réseau affiche le message de vérification et aucun bouton « Réessayer » ; 3. motif de 2 caractères : aucun envoi, message de refus local.

## Contraintes

Faire uniquement ce qui est demandé. `StockModal` et `ImportStockModal` ne sont pas modifiés ici (PF02b, PF07d). Audience non-dev : termes interdits absents des chaînes ajoutées. Visuel : classes de la page conservées, nouvelles pièces avec `classes.ts`, clair et sombre, AA. Montants : `formaterGNF`. Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés : `src/lib/api_pharmacie.ts`, `src/lib/apercu_pharmacie.ts`, `src/lib/apercu_pharmacie.test.ts`, `src/components/dashboard/ApercuPharmacie.tsx` (seulement si un texte doit suivre la règle), `src/components/dashboard/ApercuPharmacie.test.tsx`, `src/app/dashboard/stock/page.tsx`, `src/app/dashboard/stock/page.test.tsx`, `src/app/dashboard/stock/CorrectionQuantite.tsx`, `src/app/dashboard/stock/CorrectionQuantite.test.tsx`.

## Test à la main

Après remise à zéro de la démo (porteur), `http://localhost:3100`, « Comptes de démonstration » : **Djénabou Baldé** (titulaire, Pharmacie de Kaloum) : « Stock Médicaments », Doliprane en boîtes et comprimés, Ventoline en « Rupture », Amlor en « Stock bas », correction d'une boîte de Flagyl avec motif. **Moussa Kanté** (titulaire, Pharmacie du Niger) : filtre « À qualifier (1) » sur Spasfon. Captures clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur (le `eslint-disable` global préexistant de `page.tsx` peut rester).
3. `npm test` : tout vert, dont `stock/page.test.tsx` (9), `CorrectionQuantite.test.tsx` (3), `apercu_pharmacie.test.ts` (4 ajoutés).
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés.
6. `grep -n "quantite < 10\|quantite === 0\|irréversible\|Trash2" src/app/dashboard/stock/page.tsx` : aucune ligne.
7. Termes interdits absents des chaînes ajoutées ; aucun U+2014 ni U+2013 ajouté ; captures clair et sombre (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

2026-11-01 | spécifié (codeur Sonnet) | livré | 8 fichiers autorisés, 517 tests (61 fichiers)
2026-11-01 | vérificateur Sonnet | PASS | 3 remarques non bloquantes dont le contraste des icônes d'action (rapports/PF02a-verification.md)
2026-11-01 | chef Opus | validé | icônes d'action aux teintes AA (`text-slate-600 dark:text-slate-400`, survols 700/300), fiche mise en cohérence ; texte du filtre actif sous 4,5:1 laissé en réserve (dette préexistante)

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->

docker compose exec -T frontend npx tsc --noEmit | exit 0 | 63bb9ad
docker compose exec -T frontend npx eslint (dossier stock, api_pharmacie, apercu_pharmacie et test, ApercuPharmacie et test) | exit 0, aucune sortie | 63bb9ad
docker compose exec -T frontend npx vitest run | 61 fichiers, 517 tests verts | 63bb9ad
npm run build (local) | réussi | 63bb9ad
grep « quantite < 10, quantite === 0, irréversible, Trash2 » sur stock/page.tsx ; U+2013 et U+2014 dans le diff | aucune ligne | 63bb9ad
hook pre-commit du front (conteneur frontend) | passé | 63bb9ad
