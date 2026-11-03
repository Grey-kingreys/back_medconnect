# PF09 - Unité plaquette à l'écran, libellés accordés

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (titulaire qui règle sa fiche, vendeur au comptoir)
Visuel: oui (textes des écrans existants)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`
Dépend de: PB21 et PF08 validés

## Spec

### Objectif

Le titulaire choisit « Plaquette » sur la fiche, indique le nombre de plaquettes par boîte et le prix d'une plaquette. Le vendeur vend à la boîte ou à la plaquette, avec des phrases justes. Le stock reste saisi en boîtes (réception, correction, inventaire : déjà le cas, à confirmer).

Décisions : D723, D724, D725, D709.

### 1. `src/lib/api_pharmacie.ts`

`UniteMinimale` gagne `"PLAQUETTE"`.

### 2. `src/lib/caisse/regles/quantites.ts`

`LIBELLES_UNITE_MINIMALE` : chaque entrée gagne `article` ; ajout `PLAQUETTE: { singulier: "plaquette", pluriel: "plaquettes", article: "la plaquette" }`. Valeurs : « le comprimé », « la gélule », « le ml », « le sachet », « le gramme », « l'ampoule », « l'unité ». Le type `Record<UniteMinimale, ...>` impose la complétude.

Fonction `deOuD(mot)` : « de plaquettes », « d'ampoules », « d'unités » (voyelle ou h muet seulement selon la liste de ces libellés).

### 3. Surfaces

| Fichier | Avant | Après |
|---|---|---|
| `components/modals/StockModal.tsx:73` | 7 unités | `PLAQUETTE` après `AMPOULE` |
| `StockModal.tsx:727` et message `:122` | « Nombre d'unités par boîte » | « Nombre de plaquettes par boîte », selon l'unité choisie, avec `deOuD` |
| `StockModal.tsx:769` | « Se vend aussi à l'unité (boîte entamée) » | « Se vend aussi à la plaquette (boîte entamée) » (article) |
| `StockModal.tsx:774`, `:531` | « Prix d'une unité (GNF) » | « Prix d'une plaquette (GNF) » : `une` ou `un` selon l'unité, à porter dans la carte (`unArticle`) |
| Tolérance d'inventaire de la fiche | « en unités » | pluriel de l'unité choisie |
| `stock/page.tsx:464` et `vente/page.tsx` (`prixUnite`) | « 3 000 GNF le plaquette » | « 3 000 GNF la plaquette » (`article`) |
| `vente/page.tsx:851-852` | « 3 plaquettes restants » | « Boîte entamée : il reste 3 plaquettes » |
| `vente/page.tsx:846` et les boutons d'unité | « de la boîte à l'unité » | article de l'unité de la dernière ligne, repli « l'unité » |
| `vente/ConfirmationVente.tsx`, `receptions/nouvelle/page.tsx`, `inventaire/page.tsx`, `stock/SortieStock.tsx`, `stock/CorrectionQuantite.tsx`, `modals/ImportStockModal.tsx` | libellés composés | recherche ci-dessous, corriger tout accord faux |

Recherche obligatoire : `grep -rnE "LIBELLES_UNITE_MINIMALE|\.singulier|\.pluriel|restant" src --include=*.tsx --include=*.ts` hors tests : relire chaque phrase composée avec « plaquette » et « ampoule ».

### 4. Refus du changement d'unité

`StockModal` : 409 `UNITE_CHANGEMENT_AVEC_STOCK` : message du serveur au bandeau de la fenêtre, fenêtre ouverte, saisie gardée, identique aux autres refus. En modification d'une fiche avec du stock, si l'unité est changée : aide sous le champ, avant l'envoi : « Ce médicament a du stock : pour changer d'unité, comptez-le d'abord à 0 par un inventaire. ». Sélecteur non désactivé : le parcours de conversion d'une fiche non qualifiée reste permis.

### 5. Lots

Le type `LotEnStock`/lot de stock lit désormais `coefficientReception` depuis `GET stock` (attendu par D709 et D711). Retirer le repli devenu inutile seulement s'il ne sert plus à aucun appelant ; `coefficientDuLot` garde son repli pour un serveur ancien. La fenêtre de fiche (`StockModal.tsx:680`) l'utilise déjà.

### 6. Tests

- `quantites.test.ts` : `formaterQuantite(26, 10, "PLAQUETTE")` donne « 2 boîtes et 6 plaquettes » ; 1 plaquette au singulier.
- `StockModal.test.tsx` : « Plaquette » proposé ; corps envoyé `uniteMinimale: "PLAQUETTE"` ; libellés accordés ; 409 de changement d'unité ; aide affichée.
- `vente/page.test.tsx` : fiche plaquette : bouton « Plaquettes », « 3 000 GNF la plaquette », « Boîte entamée : il reste 9 plaquettes », total exact.
- `vente/panier.test.ts` : plafond en plaquettes.
- `stock/page.test.tsx` : « 3 000 GNF la plaquette ».

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, `prettier --write`, `eslint --fix`).
- Jamais afficher une valeur de `.env`.
- Réutiliser le design existant, aucun champ nouveau sur la fiche : le nombre de comprimés par plaquette n'est pas saisi (D723).
- Pas de tiret cadratin ni demi-cadratin, tout en français, texte simple.
- Gates : `docker compose exec -T frontend npx tsc --noEmit`, `docker compose exec -T frontend npx vitest run`, eslint des fichiers touchés.
- Commit avec la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.

## Test à la main

Relancer les services. Créer Paracétamol en plaquettes, 10 par boîte, 3 000 GNF ; réceptionner 2 boîtes ; vendre 1 plaquette : stock « 1 boîte et 9 plaquettes », « boîte entamée » ; vendre 1 boîte ; corriger le stock en boîtes ; relire chaque phrase en clair et en sombre.

## Done when

- [ ] « Plaquette » sélectionnable, enregistrée, relue
- [ ] Nombre et prix définis par médicament, libellés de la fiche accordés
- [ ] Vente boîte et plaquette, boîte entamée juste, phrases accordées
- [ ] Refus du changement d'unité compris par l'utilisateur
- [ ] `tsc`, `vitest`, `eslint` verts

## Return

Fichiers touchés, sorties des gates, résultat de la recherche des libellés, tout écart à la fiche.

## Historique

## Validation
