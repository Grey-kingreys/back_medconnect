# PF08 : contrôle du chef d'orchestration

Verdict : contrôlé et commité, test navigateur à faire par l'orchestrateur principal après reconstruction. Front `orch/pharmacie-t1-front` 1cb3fee.

## Les trois corrections du codeur

1. **Mot « boîte » à l'import** : corrigé, les nombres de la fenêtre sont en unités et la mention ne dit plus « boîte ». Le texte restait inexact (voir ci-dessous).
2. **Bouton « Ajouter » mort** : corrigé pour moins d'une boîte en stock (« Moins d'une boîte en stock », sans bouton, Entrée sans effet). Incomplet : voir ci-dessous.
3. **Texte de plafond** : juste. « Vous avez pris tout le stock disponible. » quand la demande atteint le plafond, « Il ne reste pas assez de stock pour une boîte de plus. » quand il reste moins d'une boîte ; un plafond dû à la limite par ligne n'affiche aucun des deux.

## Corrections du chef

1. **Second bouton « Ajouter » mort** : une fiche déjà au plafond dans le panier gardait son bouton actif dans la liste, sans aucun effet, et Entrée vidait le champ sans rien ajouter. `peutAjouter` (`panier.ts`) est désormais la seule règle : `ajouterAuPanier`, la liste (« Plus assez de stock à ajouter », sans bouton) et Entrée. Test ajouté à `vente/page.test.tsx`.
2. **Texte de l'import** : « 0 → 4 dont 1 à régulariser » laissait croire que l'unité restait à régulariser après la livraison, et elle est en général rattachée. Devient « 1 à régulariser avant cette livraison », juste aussi quand la livraison ne couvre pas tout.

## Chemin `SORTIE_MANUELLE_REQUISE` (périmé seul)

Relu contre `controlerStockVente` du back :

- `plafondVente` : `quantiteVendable` si positive, sinon `quantite` si positive. Périmé seul : ajoutable jusqu'à sa quantité, avertissement « Il ne reste que des boîtes périmées », 409 puis fenêtre de choix du lot, second envoi avec lot et motif (tests existants, verts).
- Périmés 5 et part 3 : `quantite` 2, plafond 2 des deux côtés.
- Stock non périmé partiel avec périmés : plafond au vendable, le serveur refuserait au-delà en `STOCK_INSUFFISANT`.
- Lot choisi trop petit : 409 `STOCK_INSUFFISANT`, le panier garde le lot et le motif, la quantité se corrige puis la vente repart. Lu dans le code, sans test dédié.

## Réserve acceptée

Pas de focus explicite sur le bandeau du 409 : `role="alert"`, comme les autres refus (orchestrateur principal).

## Réserve de PB20

`StockModal.tsx:324`, `378` et `488` lisent aussi `quantiteARegulariser` : une fiche à régulariser reste « déjà dans votre stock » et garde le choix de conversion. Test présent dans `StockModal.test.tsx`.

## Preuves

- Après les corrections du chef : `tsc` sans erreur, `vitest` 68 fichiers et 643 verts, `eslint` sans erreur sur les 5 fichiers touchés, crochet pre-commit passé.
- Aucun texte d'attente de livraison dans le code (seule une assertion de test, qui vérifie son absence).
- `npm run build` non lancé par le chef. Le crochet pre-push le lancera.
- **Corrections du chef non revues par un agent. Aucun test navigateur.**

## À vérifier au navigateur

Ventoline « 0 boîte, 1 boîte à régulariser » et « Rupture de stock » sans ajout ; « + » et « Ajouter » arrêtés au plafond ; 409 avec panier gardé ; périmé seul jusqu'à la fenêtre de choix du lot ; clair et sombre.
