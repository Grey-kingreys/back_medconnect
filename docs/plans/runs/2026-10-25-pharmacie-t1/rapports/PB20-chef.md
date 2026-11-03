# PB20 : contrôle du chef d'orchestration

Verdict : validé. Back `orch/pharmacie-t1-back`, commit `feat(pharmacie): vente refusée au-delà du stock, quantité jamais négative en sortie d'API (PB20)`. Aucune migration, aucune écriture de données.

## Relecture du diff contre la fiche

- `controlerStockVente` : appelée après `allouerLignes`, sous les verrous, avec l'agrégat lu sous verrou ; somme par fiche ; `STOCK_INSUFFISANT` avant `SORTIE_MANUELLE_REQUISE` ; agrégat nul ou négatif refusé même avec des périmés ; `disponible` par ligne déduit des autres lignes de la fiche.
- `ecrirePieceVente` : `provisoireAutorise` obligatoire, `false` web avec filet `RangeError` avant toute écriture, `true` au rejeu ; une seule ligne ajoutée à `synchro.service.ts`.
- Lecture : `EtatStockFiche.quantite` reste la vérité ; `avecStock` écrête ; `avecStockPublic` sans le nouveau champ ; `quantiteVendable` suit D714.
- Écrêtages à la réponse seulement : import (l'alerte lit la vérité avant), inventaire par `presenter` (preuve `inventaire.db-spec.ts:700`, `quantiteTheorique` 0 et `quantiteARegulariser` 2), sortie, qualification (l'audit garde la vérité), correction, photographie, anomalies (`detailsLisibles`, rien en base).
- `assainirDetails` : `unite` et `disponibleUm` recopiés, autres clés toujours filtrées.
- Instantané `get-stock-pharmacie.json` : seul ajout de `quantiteARegulariser: 0` (les lignes `nom` ne changent que par la virgule).
- Démo : lot C après l'inventaire, W2 retirée, clés W1 et W3 gardées, `CLAUDE.md` à jour.

## Correction du chef

`CLAUDE.md`, puce PB11 : la liste « Ordre des refus » ne citait pas le stock insuffisant, ajouté avant la sortie manuelle requise. Documentation seule, `test:db` non relancé.

## Réserves tranchées

1. **`disponible` (lecture-stock.ts:320)** : vrai pour périmés 5, part 3, `quantite` 2, alors que `quantiteVendable` vaut 0. Aucun écran ne peut annoncer une vente refusée : le front déclare le champ dans son type (`api_pharmacie.ts:54`) sans le lire, le mobile ne le lit pas, l'écran de vente et `apercu_pharmacie.ts` lisent `quantiteVendable`, la page des médicaments passe par la recherche publique dont `disponible` suit déjà la quantité vendable, et aucun service du back ne le relit. Pas de correction, D728.
2. **`quantiteTheorique` et `quantiteAvant`** : le front actuel ne s'en sert que pour afficher (`inventaire/page.tsx:678`, `ImportStockModal.tsx:36-39`). L'écart vient du serveur, `soldeProduit` est typé sans être lu. Aucun calcul ne devient faux. Effet visible avant PF08 : « Attendu 0, Compté 2, Écart +3 » et « 0 → 4 », sans la mention à régulariser.
3. **Horodatage démo 00:10 à 00:15** : accepté. Le lot C reste au jour J à toute heure de remise à zéro ; signalé dans `CLAUDE.md`.

## Point trouvé au contrôle, à traiter par PF08

`quantite` écrêtée change un test du front, hors du périmètre de la réserve 2 : `StockModal.tsx:324` juge « déjà dans votre stock » par `quantite !== 0` ou des lots. Une fiche à -1 lue à 0 sans lot n'est plus vue comme déjà présente à l'ajout : le parcours continue sur la fiche existante au lieu de s'arrêter, et les lignes 378 et 488 (choix de conversion) ont le même test. La fiche PF08 prévoit déjà cette condition dans son tableau, à vérifier par un test explicite. Sans gravité immédiate : rien n'est fusionné vers dev et PF08 suit.

Autres effets jusqu'à PF08 : un 409 `STOCK_INSUFFISANT` tombe dans le cas générique de `gererEchec` (message affiché, panier gardé, stock non relu) et l'écran annonce encore « en attente de livraison » avant ce refus.

## Preuves

- Rendues par le vérificateur, non rejouées par le chef : `tsc` propre, `npm test` 1150 verts (3 ignorés), `test:db` 418 verts, `stock:verifier` sans anomalie.
- Le crochet pre-commit rejoue `tsc` et `eslint` sur les fichiers indexés.
- Entorse du codeur : fichiers écrits par scripts et heredoc au lieu de Write/Edit ; encodage contrôlé propre, diff sans réécriture de fichier entier.
- `docker-entrypoint.sh` laissé hors du commit.
- Parcours à l'écran non joué : il dépend de PF08.

## Décisions

D713 à D728 consignées. D718 et D724 restent à présenter au porteur (D727). D724 s'applique à PB21.
