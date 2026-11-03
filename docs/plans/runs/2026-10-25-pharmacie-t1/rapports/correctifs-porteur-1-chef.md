# Correctifs porteur 1 : contrôle du chef d'orchestration

Verdict : validé. Front `orch/pharmacie-t1-front` 4f54bb3 (9 fichiers) ; back `orch/pharmacie-t1-back`, commit `docs(pharmacie): correctifs demandés par le porteur (D711, D712)` (rapports, `decisions.md`, `ACTIVE.md`). Un commit par dépôt, sans amend, hooks actifs. Vérification PASS avec réserves mineures (`correctifs-porteur-1-verification.md`), toutes traitées ici.

## Relecture du diff

- A. Réception : `CHAMP_QUANTITE` et `CHAMP_QUANTITE_INVALIDE` dérivent de `CHAMP` par remplacement de `w-full px-4`, chaîne bien présente dans `components/pharmacie/classes.ts`. Tests : largeur fixe, 6 chiffres saisis.
- B. Stock : 7 en-têtes, `colSpan` 7. La date est découpée sans passer par `Date` (`slice`, `afficherDatePeremption`), donc aucun recul d'un jour ; comparaison à `jourConakry`, le jour même n'est pas périmé. Modale : lots filtrés à solde positif, lecture seule, phrase de correction conditionnée à `reception:write`.
- C. Fiche produit : `manqueVenteAuDetail` pure, sans exception sur une saisie non numérique (`lireEntier` non « ok » donne null). Avertissement seulement si la fiche se vend à l'unité, `role="status"`, enregistrement non bloqué (test présent). `ECART_PRIX` non touché.

## Corrections du chef

1. Réception : colonne Quantité en `min-w-52` au lieu de `min-w-56`. Somme des largeurs minimales : 192 + 208 + 128 + 112 + 128 + 34 = 802 px pour 886 px disponibles à 1280 px, menu ouvert (calcul du vérificateur). Une unité longue (« en comprimés », environ 220 px de contenu) élargit la colonne d'environ 12 px : 814 px, la ligne tient toujours.
2. Espaces manquants : `SELECT_UNITE =` (réception), `lotsEnStock =` et `unitesEnPlus =` (`StockModal`).

## Preuves

- `docker compose exec -T frontend npx tsc --noEmit` exit 0.
- `npx eslint` sur les 9 fichiers exit 0 ; hook pre-commit du front passé.
- `npx vitest run` : 68 fichiers, 610 verts.
- `npm run build` local réussi.
- Aucun U+2013 ni U+2014 dans les fichiers touchés ; aucune valeur de `.env` lue.
- **Aucune écriture dans la base de dev** : rien n'a été joué par l'API ni à l'écran ; les comportements sont prouvés par les tests avec appels simulés et par la lecture du contrat du back.

## Test à la main (à faire par le porteur)

Front `http://localhost:3100`, **Djénabou Baldé** (titulaire, Kaloum).

1. Nouvelle réception, largeur 1280 px, menu ouvert : saisir `123456` en quantité ; les 6 chiffres se lisent, pas de défilement horizontal, y compris sur un médicament vendu à l'unité (« en comprimés »).
2. Stock : colonne « Péremption » ; une fiche à plusieurs lots montre « +N autres lots », une fiche périmée montre « Périmé ».
3. Modifier une fiche : section « Lots en stock » sans champ de date. Avec **Ousmane Keita** (vendeur, sans `reception:write`) : la phrase de correction n'apparaît pas, s'il peut ouvrir la fenêtre.
4. Cocher « Se vend aussi à l'unité », boîte 18 000, 10 unités, unité 1 500 : l'avertissement donne 15 000, 3 000 et 18 000 GNF ; unité 1 800 : il disparaît. Ne pas enregistrer pour ne rien écrire.

## Réserves

- **`coefficientReception` non renvoyé par la lecture du stock** (`lecture-stock.ts`) : champ facultatif gardé dans `LotFiche`, toujours absent aujourd'hui. La modale retombe sur le coefficient de la fiche (D709) : le nombre de boîtes affiché est inexact pour un lot reçu avec un autre coefficient que l'actuel. Le back n'est pas touché ici ; le champ sera exposé par la tâche suivante « plaquette ».
- Un lot périmé masqué par un lot valide n'apparaît que dans « +N autres lots » (date du prochain lot, D711).
- Écran, clavier réel et captures clair et sombre non joués, renvoyés au porteur ; la largeur à 1280 px est un calcul, la colonne de plus du stock n'a pas été vue dans un navigateur.
- `docker-entrypoint.sh` modifié dans le dépôt back hors de ce travail, non commité.
