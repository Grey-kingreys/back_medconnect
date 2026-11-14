# PF07b : contrôle du chef d'orchestration

Verdict : validé. Front `orch/pharmacie-t1-front` 23a558c (code de PF07b, correction du chef, `docs/plans/ACTIVE.md`) ; back `orch/pharmacie-t1-back`, commit `docs(pharmacie): contrôle de PF07b` (fiche, rapports PF07b, `decisions.md` D709, `ACTIVE.md`). Un commit par dépôt, sans amend, hooks actifs. Vérification PASS avec une réserve majeure (unités du choix de lot), corrigée ici.

## Relecture du diff contre la fiche et le contrat du back

- `api_pharmacie.ts` : `corrigerDateLot`, `LotEnStock`, `listerLotsFiche`, `RaisonSortie`, `LIBELLES_RAISON_SORTIE`, `CorpsSortieStock`, `SortieStockEnregistree`, `sortirDuStock` conformes à `receptions.dto.ts`, `receptions.service.ts` (`ElementLot`) et au service des sorties (PB15a) ; identifiants par `encodeURIComponent`, tout passe par `authFetch`.
- Détail (`receptions/[receptionId]/page.tsx`) : états chargement, prêt, introuvable (404), erreur avec réessai ; « Non renseigné » ; quantités reçues et restantes lues avec le coefficient du lot ; colonne du coût seulement si la clé `coutAchatBoite` existe, « Inconnu » pour `null` (D698) ; bandeau des résolutions ; route couverte par la garde (D708).
- `CorrectionDateLot.tsx` : route non rejouable, aucun « Réessayer » après échec réseau, saisie verrouillée et message exact de la fiche ; motif 3 à 300, date MM/AA par `lireDatePeremption`, « Sans date » envoie `sansPeremption: true`.
- `SortieStock.tsx` : `id` créé à l'ouverture et corps identique rejoué par « Réessayer l'envoi » (D688) ; refus du serveur affiché tel quel, champs modifiables, même `id` ; raison obligatoire, « Périmé » présélectionné pour un lot périmé, commentaire exigé pour « Autre raison » ; « Tout le lot » en unités.
- Page du stock : bouton « Sortir du stock » seulement pour une quantité positive, entre correction et archivage.

## Correction du chef (réserve du vérificateur)

1. **Unités du choix de lot (D709)** : `ChoixLot.tsx` (fichier hors de la liste de la fiche, touché sur ordre de l'orchestrateur principal) : `LotChoisissable` gagne `coefficientReception?` et la fonction exportée `coefficientDuLot(lot, coefficientFiche)` (coefficient du lot, repli sur la fiche s'il est absent, au moins 1) ; `libelleLot` l'utilise. `SortieStock.tsx` : `ResumeLot` et `coefficientLot` (choix « en boîtes », reste affiché) passent par la même fonction. Les lots de `GET .../stock/:stockId/lots` portant toujours `coefficientReception`, la liste, le résumé, la saisie et l'envoi lisent désormais le même coefficient.
2. **Test ajouté** (`SortieStock.test.tsx`, 6 vers 7) : fiche à 20, lot à `coefficientReception: 10` et 40 unités : la liste affiche « 4 boîtes », « 2 boîtes » envoie `{ unite: "BOITE", quantite: 2 }` (20 unités côté serveur), le résumé en lecture seule après un échec réseau montre aussi « 4 boîtes », et le reste après succès (20 unités) « 2 boîtes ».
3. **Autres appelants de `ChoixLot`** : (a) sortie d'un lot périmé dans la vente (PF01b, `SortieLotPerime.tsx`) : les `details[].lots` du 409 `SORTIE_MANUELLE_REQUISE` (`LotPerimeDisponible` de `selection-lots.ts` : `lotId`, `numeroLot`, `dateExpiration`, `quantite`) ne portent **aucun** coefficient par lot ; (b) correction de quantité (PF02a) : lots de `GET /pharmacie/stock/:structureId`, sans coefficient non plus. Dans ces deux écrans, la quantité envoyée est calculée avec le coefficient de la fiche (la vente compte des boîtes de la fiche, la correction des unités), donc aucune mauvaise quantité n'est envoyée ; seul le nombre de boîtes affiché pour un lot reçu à un autre coefficient peut différer des boîtes physiques. Rien n'est changé (repli sur la fiche) ; réserve ci-dessous.

## Preuves

- `docker compose exec -T frontend npx tsc --noEmit` exit 0.
- `npx eslint` sur les 10 fichiers touchés (les 9 de la fiche et `ChoixLot.tsx`) exit 0.
- `npx vitest run` : 67 fichiers, 576 verts (575 annoncés par le vérificateur, plus le test du chef).
- `npm run build` local réussi ; hook pre-commit du front passé.
- Aucun U+2013 ni U+2014 ajouté ; aucune valeur de `.env` lue.

## Test à la main (fait par le chef, au niveau de l'API)

Comme pour PF07a, l'écran n'a pas été joué (panneau navigateur sans accès à `localhost`) ; les corps exacts construits par le front ont été envoyés à l'API de dev (`localhost:3101`), comptes démo, base non remise à zéro (seule réception : `NCKY/714181`, laissée par le test de PF07a).

1. Djénabou Baldé (titulaire, Kaloum) : `reception:write` et `marge:read` présents. Détail de `NCKY/714181` : fournisseur UbiPharm Guinée, 2 lots ; clé `coutAchatBoite` présente sur les deux, `null` sur l'Amoxicilline (affichée « Inconnu »), 95 630 sur la Ventoline ; aucune résolution. Réception inconnue : 404 « Cette réception est introuvable. ».
2. Correction de date du lot d'Amoxicilline avec le corps du front (`10/27` donne `2027-10-31`, motif « Date relue sur la boîte ») : « Aucune modification du lot. » (date déjà au 31/10/2027, aucune écriture) ; motif « ab » : 400 `MOTIF_REQUIS` avec le message attendu.
3. Coefficients : sur toutes les fiches à stock positif de Kaloum, aucun lot n'a un `coefficientReception` différent de sa fiche (fiches toutes à 1 unité par boîte dans cette base) : le cas de D709 n'existe pas en base de dev, il est couvert par le test.
4. Ousmane Keita (vendeur) : sortie d'une unité « Cassé ou abîmé » sur le lot sans numéro d'ASAQ Winthrop 100/270 (95 unités) : « Sortie de stock enregistrée. », mouvement `PERTE`, solde du lot 94, `cree: true` ; même `id` renvoyé : « Cette sortie de stock était déjà enregistrée. », `cree: false`, même sortie, solde inchangé ; « Autre raison » sans commentaire : 400 `MOTIF_REQUIS` ; quantité au-delà du lot : 409 `STOCK_LOT_NEGATIF` « Ce lot n'a que 94 unité(s) en stock ... » ; liste des réceptions : 403 `PERMISSION_REFUSEE`.

**Données laissées dans la base de dev** : une sortie de stock (pièce `SORTIE_MANUELLE`, mouvement `PERTE` de 1 unité, raison `CASSE`, auteur Ousmane Keita) sur le lot sans numéro d'ASAQ Winthrop 100/270 de la Pharmacie de Kaloum (solde du lot passé de 95 à 94), immuable (journal), effacée par la prochaine remise à zéro de la démo. La correction de date n'a rien écrit.

À faire par le porteur, démo remise à zéro, front `http://localhost:3100` : le parcours de la fiche à l'écran (`BL-MAT-0412` avec « Inconnu » sur l'Ibuprofène, correction de date `10/27`, sortie du lot périmé `AG23C777` d'Augmentin en « Périmé », boîte cassée par Ousmane Keita) et les captures clair et sombre.

## Réserves

- D709 ne couvre pas la vente (sortie d'un lot périmé) ni la correction de quantité : leurs lots ne portent pas de coefficient (409 `SORTIE_MANUELLE_REQUISE` et `GET /pharmacie/stock/:structureId`). Le libellé d'un lot reçu à un autre coefficient que la fiche peut y montrer un nombre de boîtes différent des boîtes physiques, sans erreur sur la quantité envoyée. Levée : ajouter `coefficientReception` à `LotPerimeDisponible` et aux lots de la lecture du stock (back), le front le prend alors sans changement.
- Fond du dialogue de sortie cliquable quand l'issue est inconnue (vérificateur, mineur) : fermer recharge le stock, laissé tel quel.
- Une sortie « Perdu ou volé » n'est tracée que par l'audit (réserve PB15a, hors périmètre).
- Écran, clavier réel et captures clair et sombre non joués, renvoyés au porteur.
- Fins de ligne LF (avertissements git CRLF), sans effet sur les gates.
