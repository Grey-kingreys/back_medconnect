# PF01b : contrôle du chef d'orchestration

Verdict : validé, commité sur `orch/pharmacie-t1-front` (front 646edfd, un seul commit, sans amend, hooks actifs). Le PASS avec réserves du vérificateur est levé par trois corrections du chef.

## Relecture du diff contre le contrat réel du back

- Corps de `POST /ventes` (`panier.ts` `corpsVente`) : `lignes [{ stockId, quantite, unite, sortieManuelle? }]` conforme à `vente.dto.ts` ; `paiements` absent pour « espèces du total sans montant reçu » (D691) ; jamais de `posteId` (D692). Référence limitée à 60 caractères côté front (100 au back) : plus strict, sans risque.
- 409 `SORTIE_MANUELLE_REQUISE` (`vente.service.ts:703`) : `details[]` porte `stockId`, `nom` et `lots [{ lotId, numeroLot, dateExpiration, quantite }]` (`LotPerimeDisponible`, `domaine/selection-lots.ts`), identique à `LotErreurVente`. Le back cite toutes les fiches périmées d'un coup ; le front traite la première, puis la suivante au renvoi : c'est exactement le cas du problème 2.
- `CODES_ERREUR_VENTE` couvre tous les codes du tableau de la fiche ; `STOCK_INSUFFISANT` et `MEDICAMENT_EXPIRE` retirés (plus renvoyés depuis PB11). Le 404 « lot introuvable » d'une sortie manuelle (sans code) tombe dans la branche générique : message du serveur, clé renouvelée.
- Idempotence : un refus annule toute la transaction (clé non gardée), la clé est renouvelée ; échec réseau : même clé.

## Corrections du chef

1. Important (perte de vente possible) : D688 appliqué tel qu'écrit, détaillé en D706. Variable `verrouille = envoi || reessayable` dans `page.tsx` : boutons « Ajouter », Entrée de la recherche, unité, `-`, `+`, « Retirer », case d'ordonnance, nom et téléphone du client, « Valider la vente », « Vider le panier » et F2 désactivés. Après un échec réseau, le panier envoyé est réappliqué tel quel ; le bandeau (sans bouton de fermeture, sinon aucune issue) propose « Réessayer » (même clé, même corps) et « Modifier la saisie » (clé remise à null, donc nouvelle clé au prochain envoi, message « Avant de valider à nouveau, vérifiez dans les ventes du jour que la vente précédente n'a pas été enregistrée : sinon elle serait comptée deux fois. »). Le verrou couvre aussi la durée de l'envoi, pour la même raison. Tests : « après un échec de connexion, le panier est verrouillé ; « Modifier la saisie » le débloque avec une nouvelle clé » (contrôles désactivés, Entrée sans effet, puis quantité modifiée envoyée sous une autre clé) ; le test « Réessayer » vérifie en plus que le corps renvoyé est identique.
2. Mineur : `key={sortie?.stockId ?? "aucune-sortie"}` sur `SortieLotPerime`, avec un commentaire. Test « deux fiches périmées successives : le second dialogue repart sans lot ni motif » (Augmentin puis Paracétamol : aucun lot coché, motif vide, « Vendre ce lot » refusé sans envoi, troisième envoi avec les deux `sortieManuelle`). Sans la `key`, le motif du premier dialogue resterait affiché et le test échouerait.
3. Mineur : `prixUnite` et `prixUnitaire` sont typés facultatifs et nuls ; le repli `?? 0` est retiré, la ligne « prix × nombre » ne s'affiche que si le prix est un nombre (toujours le cas pour une ligne vendable), avec un commentaire.
4. Écart du codeur accepté et noté dans l'Historique de la fiche : une ligne de `src/lib/api_ventes.test.ts` (hors liste) passée de `STOCK_INSUFFISANT` à `SORTIE_MANUELLE_REQUISE`, imposée par le retrait du code.
5. `docs/plans/ACTIVE.md` du front : seule la ligne PF01b passée à validé, incluse dans le commit du front.

## Preuves

- `docker compose exec -T frontend npx tsc --noEmit` : 0 erreur.
- `docker compose exec -T frontend npx eslint` (src/app/dashboard/vente, ChoixLot, api_ventes) : 0 erreur, 0 avertissement.
- `docker compose exec -T frontend npx vitest run` : 60 fichiers, 503 tests verts (479 avant PF01b, 501 annoncés par le codeur, +2 du chef).
- `npm run build` (local, front_medconnect) : réussi.
- Hook pre-commit du front (conteneur `frontend`) : passé.
- Aucun U+2013 ni U+2014 dans les fichiers de la vente et de `ChoixLot`. Aucune valeur de `.env` lue.

## Test à la main pour le porteur

Après remise à zéro de la démo (procédure « Mode démo » du `CLAUDE.md` du back), front `http://localhost:3100`, « Comptes de démonstration » : Ousmane Keita (Pharmacie de Kaloum), « Nouvelle vente ».

1. Taper « doli » puis Entrée : Doliprane ajouté en comprimés, « Boîte entamée : 6 comprimés restants » ; F2 passe à la boîte, F2 revient au comprimé.
2. Ventoline (stock -1) : avertissement ambre « Stock insuffisant... », la vente passe ; l'écran de succès annonce l'attente de livraison.
3. Confirmation : Espèces sélectionné, Entrée confirme ; montant reçu supérieur au total : monnaie à rendre ; paiement partagé Espèces + Orange Money avec référence : confirmation active seulement à somme égale.
4. Badge « Caisse ouverte depuis ... » dans l'en-tête, à jour après la première vente.
5. Échec réseau (nouveau) : outils du navigateur, onglet Réseau, « Hors ligne », puis confirmer une vente : bandeau rouge avec « Réessayer » et « Modifier la saisie », panier non modifiable. Repasser en ligne, « Réessayer » : vente enregistrée une seule fois (vérifier dans « Ventes du jour »). Refaire avec « Modifier la saisie » : message de vérification, panier modifiable.
6. Augmentin : la sortie d'un lot périmé (`AG23C777`) ne se voit que si les autres lots sont épuisés ; sinon elle est couverte par les tests automatiques.
7. Captures en thème clair et sombre de la recherche, du panier avec reliquat, de la confirmation en paiement partagé et du dialogue de sortie (point 8 de la fiche, non fait par le vérificateur ni par le chef).

## Réserves

- Le verrou après échec réseau vit en mémoire (D706) : un rechargement de la page le perd. La clé stockée est gardée, donc un renvoi sans modification reste sans doublon, mais une modification après rechargement repartirait sous l'ancienne clé. Persister le verrou et les paiements envoyés est repoussé ; à décider par le porteur.
- Le reliquat dépend de la dernière ligne ajoutée, perdue au rechargement (conforme à la fiche).
- L'avertissement de stock n'apparaît que dans les résultats de recherche, pas sur la ligne du panier (conforme à la fiche).
- Captures clair et sombre non faites (point 8 du « Done when »), renvoyées au test à la main.
- Fins de ligne LF dans les fichiers (avertissements git CRLF) : sans effet sur la gate.
