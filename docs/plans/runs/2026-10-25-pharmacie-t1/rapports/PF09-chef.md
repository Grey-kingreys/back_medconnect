# PF09 : contrôle du chef d'orchestration

Verdict : contrôlé et commité, test navigateur à faire par l'orchestrateur principal. Front `orch/pharmacie-t1-front` 8a2a159. Aucune correction du chef dans le code.

## Réserves tranchées

1. **« Il ne reste pas assez de stock pour une boîte de plus. » sur une ligne en plaquettes (`vente/page.tsx:791`)** : ne peut pas se produire. Sur une ligne à l'unité, `peutAugmenter` n'est faux que si la demande atteint le plafond (ou à la limite par ligne, exclue du texte) : la branche « Vous avez pris tout le stock disponible. » passe avant. Le texte ne paraît donc que sur une ligne à la boîte, où il est juste, y compris pour une fiche en plaquettes.
2. **Classes de l'aide** : `stock-aide-unite` utilise `AIDE`. Seule `stock-aide-nombre` écrit ses classes, car elle est ambre (avertissement) et qu'aucune constante n'existe pour cette couleur ; un seul usage dans ce fichier. Laissé tel quel (règle de trois).

## Relecture

- Aides de `StockModal` contre le serveur (D724) : « comptez-le d'abord à 0 » sur une fiche avec stock hors reprise ; sur une reprise non qualifiée en `UNITE` à coefficient 1, passée à une autre unité sans changer le nombre, rappel d'indiquer le nombre par boîte. Le point signalé par le rapport PB21 est donc traité à l'écran.
- `aDuStock` compte la part à régulariser. Le sélecteur reste actif, le parcours de conversion reste permis.
- Accords : prix par `article`, « il reste 3 plaquettes », `deOuD`, `aArticle` et `unArticle` ; carte des libellés complète par son type.

## Détails laissés

- `messageNombreAIndiquer` dit que le nombre « ne pourra plus convertir le stock » : c'est vrai une fois la fiche qualifiée. Si le titulaire enregistre sans cocher la confirmation, la conversion reste possible : le texte est prudent, sans risque.
- Fenêtre de confirmation de vente (`ConfirmationVente.tsx:230`) : « 3 × plaquette de Doliprane », au singulier comme les autres unités avant PF09. Hors de la fiche, à reprendre si le porteur le relève.

## Preuves

- Rendues par le vérificateur, non rejouées par le chef : `tsc`, `vitest` 659 verts, table de vérité de l'aide concordante, accords justes pour les 8 unités.
- Crochet pre-commit (`tsc`, `eslint`) passé au commit.
- Aucun test navigateur par le chef.
