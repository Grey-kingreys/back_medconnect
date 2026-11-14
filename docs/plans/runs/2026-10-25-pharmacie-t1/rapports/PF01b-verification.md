# PF01b : vérification indépendante

Verdict : **PASS avec réserves** (aucune réserve bloquante pour la gate ; 1 réserve moyenne sur la clé d'idempotence et 1 défaut mineur du dialogue de sortie, à corriger avant ou pendant la sous-fiche suivante).

Dépôt front, branche `orch/pharmacie-t1-front`, travail non commité sur 3bd8abe (PF01a). Aucune valeur de `.env` lue, aucun code modifié, aucun commit.

## 1. Gate « Done when »

| Commande | Résultat |
|---|---|
| `docker compose exec -T frontend npx tsc --noEmit` | OK, 0 erreur |
| `docker compose exec -T frontend npx eslint` (vente, components/pharmacie, api_ventes*) | OK, aucune sortie |
| `docker compose exec -T frontend npx vitest run` | 60 fichiers, 501 tests verts (479 avant, +22) |
| `npm run build` (local, front_medconnect) | OK, EXIT=0 |
| `git status --porcelain` | uniquement des fichiers autorisés, plus `src/lib/api_ventes.test.ts` (écart déclaré) |
| grep `STOCK_INSUFFISANT\|MEDICAMENT_EXPIRE\|appliquerStockInsuffisant` (vente, api_ventes.ts) | aucune ligne |
| grep U+2014 / U+2013 (vente, ChoixLot, api_ventes) | aucun |
| `fetch(` brut dans les fichiers de l'écran | aucun |
| termes interdits dans les chaînes visibles ajoutées | aucun (« serveur » n'apparaît que dans des commentaires et des titres de tests ; le test `verifierTermes` contrôle le DOM) |
| couleurs ou classes inventées | aucune : `classes.ts`, pastilles emerald et slate demandées, amber pour les avertissements, rose existant |

Non vérifié par moi : captures clair et sombre (point 8 de la fiche), test à la main sur la démo.

## 2. Conformité au contrat du back

- Corps de `POST /ventes` (`panier.ts` `corpsVente`) : `lignes: [{ stockId, quantite: nombre, unite, sortieManuelle? }]`, `clientNom`, `clientTelephone`, `ordonnanceVerifiee`, `paiements` seulement s'il est fourni ; jamais `posteId` (D692). Conforme à `vente.dto.ts` (quantite = boîtes ou unités selon `unite`, `paiements` 1 à 5, absent = espèces du total).
- Espèces du total sans montant reçu : `onConfirmer(null)` donc pas de clé `paiements` (D691) ; testé (`"paiements" in corps` faux).
- Idempotence : le back (`vente.service.ts:348-380`, `:734`) enregistre la clé dans la transaction qui porte aussi `SORTIE_MANUELLE_REQUISE` (`:703`) : un refus 400/403/404/409 annule tout, la clé n'est pas gardée. Le front met `cleIdempotence: null` après chaque refus (`page.tsx:319`, appliqué dans toutes les branches sauf réseau) et garde la clé après `estErreurReseau` ; « Réessayer » rejoue `paiementsEnvoyes.current` avec la clé du panier ; `confirmerSortie` force une nouvelle clé. Conforme (tests : refus donne une autre clé, réseau la même, sortie une autre clé).
- Codes d'erreur : `SORTIE_MANUELLE_REQUISE` ouvre le dialogue avec les lots de `details` ; `MOTIF_REQUIS` et `STOCK_LOT_NEGATIF` affichent le message dans le dialogue ; `VENTE_UNITE_INTERDITE`, `PRIX_UNITE_MANQUANT`, `PRIX_MANQUANT`, `FICHE_MODIFIEE`, `STOCK_INTROUVABLE` : message du serveur, stock rechargé, ligne retirée pour `STOCK_INTROUVABLE` ; `PAIEMENTS_INCOHERENTS` et `MODE_PAIEMENT_INCONNU` : message + « Le total a été recalculé... », rechargement ; `POSTE_INCONNU`, `SESSION_AUTRE_UTILISATEUR`, `JOURNEE_CLOTUREE` : message, caisse rechargée, sans « Réessayer » ; 403 et autres : `messageErreurPour` (message du serveur tel quel). Conforme au tableau de la fiche.
- Aucun blocage par le stock (D689) : `raisonNonVendable` ne regarde que prix et unité ; `QUANTITE_MAX_LIGNE` 10 000 seul plafond ; une fiche à -1 s'ajoute et se vend (test).
- Panier v1 lu et converti en v2 (`lirePanierStocke`, `quantite` devient `nombre`, `BOITE`), version inconnue ou JSON illisible donne `PANIER_VIDE`, écriture en `version: 2` sans `sortieManuelle` (test « relit un panier version 1 »).
- Unité par défaut : `UNITE` si déconditionnable avec `prixUnite` entier positif, sinon `BOITE` ; Entrée dans la recherche ajoute le premier résultat vendable dans cette unité.
- Reliquat : « Boîte entamée : 6 comprimés restants », somme des `unitesRestantes`, pour la dernière ligne ajoutée.
- « Cinq interactions au plus » : le test enrobe réellement les trois `fireEvent` utilisés (change, keyDown, click) avec un compteur incrémenté à chaque événement envoyé, et seuls ces événements sont déclenchés ; il compte donc 4 sans valeur codée en dur. Le focus du bouton « Confirmer la vente » est vérifié. Valide.
- Fixture `VENTE` : porte toutes les clés demandées (D705), l'écran lit `paiements` et `jourMetier` sans repli inventé (`Array.isArray`, `typeof`).

## 3. Écarts déclarés

- `api_ventes.test.ts` (une ligne, `STOCK_INSUFFISANT` remplacé par `SORTIE_MANUELLE_REQUISE`) : accepté, imposé par le retrait du code de `CODES_ERREUR_VENTE` exigé par la fiche.
- `changerUnite(panier, cle, stock)` : accepté, la fiche demande de tester la vendabilité de l'autre unité, impossible sans la fiche.
- `perime-seulement` testé avant `attente-stock` : accepté, imposé par le test 10 de la fiche (quantite 12, quantiteVendable 0 doit donner `perime-seulement`) ; sinon `attente-stock` l'emporterait toujours.
- Suppression du paramètre `maintenant` : accepté (la péremption ne bloque plus, D689).
- `ConfirmationVente` structurée (contenu monté à chaque ouverture, donc repart d'Espèces) et focus par effet : accepté, effet déclaré après `useDialogA11y` donc le focus final est bien sur « Confirmer la vente ». Les flèches gèrent le radiogroup (tabIndex itinérant).
- Ajouts hors fiche (paiement partagé masqué avec un seul mode, message du montant reçu, doublon d'ordonnance, sortie retirée en fermant le dialogue) : acceptés, cohérents et testés pour la plupart, sans nouvelle couleur.

## 4. Accessibilité et design

Rôles et libellés corrects : `radiogroup` nommé « Mode de paiement » avec `role="radio"` et `aria-checked`, sélecteur d'unité en `role="group"` avec `aria-pressed`, boutons icône avec `aria-label`, `fieldset` + `legend` dans `ChoixLot`, `role="alert"` sur les erreurs, `aria-live` sur le reste à répartir, dialogues via `useDialogA11y`, focus visible (`FOCUS`) sur les boutons du panier ; textes en français ; F2 posé au montage et retiré au démontage.

## Problèmes

1. **Moyen** : `src/app/dashboard/vente/panier.ts:150-158` (`changerNombre`), `:130-147` (`ajouterAuPanier`), `:164-181` (`changerUnite`), `retirerDuPanier` conservent `cleIdempotence`. Après un échec réseau, le bandeau « Réessayer » reste affiché et le panier reste modifiable : si le vendeur change une quantité puis valide, la même clé est renvoyée avec un autre corps. Si la première requête était arrivée au back, il rejoue l'ancienne vente (`rejeu`) et la modification est perdue (le back ne compare pas le contenu, D688, PB14a). L'écran affiche bien « déjà enregistrée », mais l'énoncé de contrôle demande une nouvelle clé quand le panier change. Correction : mettre `cleIdempotence: null` (ou une nouvelle clé) dans ces fonctions quand `reessayable` est vrai, ou masquer « Réessayer » dès qu'une modification du panier a lieu et renouveler la clé.
2. **Mineur** : `src/app/dashboard/vente/page.tsx:322-331` et `SortieLotPerime.tsx:78-80` : si deux fiches périmées exigent chacune un lot, le second 409 remplace `sortie` sans démonter `ContenuSortie` (isOpen reste vrai) ; `lotId` et `motif` du premier dialogue restent en état. Aucun bouton radio n'apparaît coché pour la seconde fiche, mais `lotId` est non nul : « Vendre ce lot » enverrait l'id du lot de la première fiche (refus du back). Correction : `key={sortie?.stockId}` sur `SortieLotPerime` ou sur son contenu.
3. **Mineur** : `page.tsx:739` `formaterGNF(prix ?? 0)` : repli sur 0 dans l'affichage du prix de la ligne ; sans effet réel (ligne vendable donc prix non nul), mais contraire à l'esprit « pas de repli inventé ».
4. **Mineur** : le reliquat dépend de `derniereCle`, perdue au rechargement de la page ; après relecture du panier stocké, il ne s'affiche plus jusqu'au prochain ajout (conforme à « dernière ligne ajoutée », à noter).
5. **Mineur** : l'avertissement de stock n'apparaît que dans les résultats de recherche, pas sur la ligne du panier (conforme à la fiche).

## Fichiers

- `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect\src\app\dashboard\vente\panier.ts`
- `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect\src\app\dashboard\vente\page.tsx`
- `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect\src\app\dashboard\vente\ConfirmationVente.tsx`
- `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect\src\app\dashboard\vente\SortieLotPerime.tsx`
- `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect\src\components\pharmacie\ChoixLot.tsx`
