# PF08 - Écran de vente sans « attente de livraison », « 0 » et « N à régulariser » partout

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (vendeur au comptoir, titulaire)
Visuel: oui (éléments et textes dans les écrans existants, aucun nouveau design)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`
Dépend de: PB20 validé

## Spec

### Objectif

Appliquer D713 et D722 à l'écran. Le vendeur ne peut plus vendre au-delà du stock en ligne, comprend le refus et corrige son panier. Aucune quantité négative ne s'affiche nulle part ; la fiche Ventoline à -1 de la base du porteur montre « 0 boîte » et « 1 boîte à régulariser ».

Décisions applicables : D713, D714, D715, D717, D722 ; D689 est révisée ; D688 reste vraie. Réutiliser le design existant (règle du porteur) : classes `ALERTE_ATTENTION`, couleur ambre du stock bas, aucun nouveau composant visuel sans nécessité.

### Contrat (back PB20)

- Fiche de stock : `quantite` >= 0, `quantiteARegulariser` (unités minimales, >= 0), `quantiteVendable`.
- `alertes.rupture[]` : `quantiteARegulariser`.
- 409 `STOCK_INSUFFISANT` : `message` lisible (à afficher tel quel), `details[]` `{ stockId, nom, unite, demande, disponible, disponibleUm }`.
- Import : `quantiteARegulariserAvant` ; inventaire : `quantiteARegulariser` par ligne ; sortie : `quantiteARegulariser`.

### 1. `src/lib/caisse/regles/quantites.ts`

- `formaterQuantite` : toute valeur négative s'affiche comme 0 (filet) ; retirer le cas « -3 comprimés » du commentaire et inverser le test `quantites.test.ts:24`. Utiliser `umVersBoites` tel quel.
- Nouvelle `formaterARegulariser(um, coefficient, unite): string | null` : `null` si `um` est absent ou <= 0, sinon `${formaterQuantite(...)} à régulariser` (« 1 boîte à régulariser », « 2 boîtes et 3 comprimés à régulariser »).
- `src/lib/api_pharmacie.ts` : `quantiteARegulariser?: number` sur `StockMedicament`, l'alerte de rupture, les lignes d'inventaire et de sortie, `quantiteARegulariserAvant?` sur la ligne d'import. Champ facultatif : un serveur ancien ne casse rien.

### 2. Écran de vente (`src/app/dashboard/vente/`)

`panier.ts` :

- `plafondVente(stock)` : `quantiteVendable` si > 0 ; sinon `quantite` si > 0 (périmé seul, le parcours de sortie manuelle reste) ; sinon 0.
- `AvertissementStock` : `"attente-stock"` devient `"stock-insuffisant"`, sans texte « attente de livraison » ; le texte reçoit le stock restant, donc `LIBELLES_AVERTISSEMENT` devient une fonction ou le texte se compose dans la page : « Stock insuffisant : il reste 1 boîte. », « Rupture de stock » si rien. `"perime-seulement"` inchangé.
- `avertissementStock` compare la somme des deux lignes de la fiche (boîtes et unités) à `plafondVente`, pas la seule ligne.
- `ajouterAuPanier` et `changerNombre(+1)` : sans effet au-dessus du plafond, somme des deux lignes en unités minimales. Signature : passer le stock à `changerNombre` ou une fonction `peutAugmenter(panier, cle, stock)` testée à part. `changerNombre(-1)`, `changerUnite`, `retirerDuPanier` restent permis même au-dessus (D722).
- `raisonNonVendable` : inchangée (prix, unité). Nouvelle raison d'affichage `rupture` seulement à la liste de résultats si `plafondVente === 0` : badge existant « Rupture », bouton d'ajout absent, fiche sans ajout. Mettre à jour le commentaire ligne 91 et le test `panier.test.ts:139`.

`page.tsx` :

- `gererEchec` : branche `STOCK_INSUFFISANT` : `enregistrerEtAppliquer(refuse(envoye))`, `setEssai((n) => n + 1)` (stock relu), `setSortie(null)`, `setBandeau(message)` ; confirmation fermée, panier gardé et modifiable, focus sur le bandeau comme les autres refus. La clé est renouvelée : la vente corrigée n'est pas un rejeu.
- Lignes citées par `details` : avertissement sous la ligne (« Il reste 1 boîte. », à partir de l'avertissement recalculé sur le stock relu, pas de deuxième état local si le stock relu suffit à l'afficher).
- Bouton « + » : `disabled` au plafond, `title` et `aria-label` restent ; texte ambre sous la ligne.
- Retirer le bloc lignes 538-542 (« Une partie de cette vente attend une livraison ») ; `provisoire` reste dans le type `Vente` pour les pièces remontées d'un poste.
- « Reste : » de la liste de résultats : `formaterQuantite` puis, si besoin, « , 1 boîte à régulariser ». La validation n'est pas bloquée par le stock local (D722).

`src/lib/api_ventes.ts` :

- `CODES_ERREUR_VENTE` : ajouter `STOCK_INSUFFISANT`.
- `LigneErreurVente` et `lignesErreurVente` : `unite`, `disponibleUm` lus avec le même contrôle que `disponible`.

`ChoixLot` et le parcours `SORTIE_MANUELLE_REQUISE` : pas de changement de contrat. Vérifier qu'un lot affiché est toujours positif. `ChoixLot.tsx:40` passe par `formaterQuantite`, le filet s'applique.

### 3. Surfaces de quantité

| Surface | Fichier | Attendu |
|---|---|---|
| Page stock | `stock/page.tsx:312` | « 0 boîte », dessous en ambre « 1 boîte à régulariser », style de « boîte entamée » avec la couleur existante du stock bas ; aide simple au survol interdit, le texte suffit |
| Correction | `stock/CorrectionQuantite.tsx:121` | Stock actuel avec la mention ; phrase courte « Ces ventes se régularisent à la prochaine réception ou au prochain inventaire. » |
| Sortie | `stock/SortieStock.tsx:132` et `399` | Reste du lot positif par construction ; mention si `quantiteARegulariser` |
| Fiche produit | `modals/StockModal.tsx:324`, `378`, `488`, `657`, `808`, `819` | Stock actuel avec mention ; conversion : la condition `quantite !== 0` devient « `quantite !== 0` ou `quantiteARegulariser > 0` », sinon le choix de conversion disparaît pour une fiche à régulariser |
| Accueil et aperçu | `lib/apercu_pharmacie.ts:108` | « Rupture de stock, 1 boîte à régulariser » ; plus aucun « ventes en attente de livraison » ; `Math.max(vendable ?? q, 0)` déjà protégé |
| Compteur | `lib/compteurs_tableau_de_bord.ts:103` | Inchangé (`quantite > 0`) |
| Inventaire, résultat | `inventaire/page.tsx:678` | Colonne « Attendu » écrêtée, mention « dont 1 boîte à régulariser » ; écart signé conservé ; **la saisie reste à l'aveugle, rien à la saisie** |
| Réception | `receptions/[receptionId]/page.tsx:231` | Solde de lot positif ; aucun changement, à vérifier |
| Import | `modals/ImportStockModal.tsx:35-39` | `0 → 4` et, si `quantiteARegulariserAvant`, « 1 à régulariser rattachée » ; PF07d, pas encore fait, doit garder ce rendu |
| Reçu et ventes du jour | `ventes/...` | Les montants et nombres signés des pièces d'annulation ne sont pas des quantités de stock : inchangés |

Recherche finale obligatoire : `grep -rnE "quantite\b|solde" src --include=*.tsx` hors tests, chaque affichage passe par `formaterQuantite` ou est prouvé positif ; `grep -rn "livraison"` hors réception et import : plus aucun texte de vente en attente.

### 4. Textes (exacts)

- Bandeau : message du serveur.
- Rupture : « Rupture de stock ».
- Ligne au-dessus du stock : « Stock insuffisant : il reste 1 boîte et 3 comprimés. »
- Mention : « 1 boîte à régulariser ».

### 5. Tests

- `quantites.test.ts` : négatif affiché 0, `formaterARegulariser` (boîte, pluriel, boîtes et unités, null).
- `panier.test.ts` : plafond (boîtes + unités, périmé seul, rupture), `+` bloqué, `-`, unité et retrait permis au-dessus ; lignes 80-83 et 139 inversées.
- `vente/page.test.tsx` : test 332 inversé (rupture : pas d'ajout) ; test 625 sans « attend une livraison » ; nouveau 409 : message, panier gardé, stock relu, nouvelle clé au renvoi, lignes modifiables.
- `api_ventes.test.ts` : `details` du nouveau code.
- `stock/page.test.tsx` : **Ventoline à `quantite: 0`, `quantiteARegulariser: 1` : « 0 boîte » et « 1 boîte à régulariser »** ; coefficient 20 : boîtes et unités.
- `apercu_pharmacie.test.ts:132` réécrit.
- `StockModal.test.tsx`, `CorrectionQuantite.test.tsx`, `inventaire/page.test.tsx`, `ImportStockModal` : mention et absence de signe moins.
- Test de garde `src/lib/caisse/regles/quantites.test.ts` : pour un échantillon de valeurs de -1000 à 1000, la sortie de `formaterQuantite` ne contient jamais « - ».

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, `prettier --write`, `eslint --fix`).
- Jamais afficher une valeur de `.env`. Jamais commiter un fichier sans rapport.
- Aucun nouveau token, aucun second bouton principal, aucune modale nouvelle.
- Pas de tiret cadratin ni demi-cadratin, tout en français, texte simple sans jargon (pas de « provisoire », « allocation », « agrégat » à l'écran).
- Gates : `docker compose exec -T frontend npx tsc --noEmit`, `docker compose exec -T frontend npx vitest run`, eslint sur les fichiers touchés.
- Commit avec la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.

## Test à la main

Relancer les services. Avec le compte de la pharmacie : page stock, Ventoline « 0 boîte, 1 boîte à régulariser » ; recherche à la vente : Ventoline en rupture, sans ajout ; médicament à 2 boîtes : « + » s'arrête à 2 ; panier de 2 boîtes, stock réduit dans un autre onglet, validation : message, panier modifiable, nouvelle validation après correction ; accueil sans signe moins, clair et sombre.

## Done when

- [ ] 409 `STOCK_INSUFFISANT` lisible, panier gardé et modifiable, stock relu, nouvelle clé
- [ ] Saisie plafonnée au stock connu, somme boîtes et unités ; correction jamais empêchée
- [ ] Plus aucun parcours ni texte « attente de livraison » côté vente et aperçu
- [ ] « 0 » et « N à régulariser » sur le stock, l'accueil, la fiche, la correction, la sortie, le résultat d'inventaire, l'import
- [ ] Aucune valeur négative affichée, test de garde compris
- [ ] Inventaire toujours à l'aveugle à la saisie
- [ ] `tsc`, `vitest`, `eslint` verts

## Return

Fichiers touchés, sorties des gates, résultat de la recherche finale, tout écart à la fiche.

## Historique

## Validation
