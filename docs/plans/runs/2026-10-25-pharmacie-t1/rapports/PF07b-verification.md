# PF07b - Vérification indépendante

Verdict : **PASS avec une réserve à corriger (unités du choix de lot, majeur mais non bloquant pour la gate)**

Branche `orch/pharmacie-t1-front`, base 1d2197f, modifications non commitées.

## 1. Gate « Done when »

| Commande | Résultat |
|---|---|
| `docker compose exec -T frontend npx tsc --noEmit` | aucune erreur |
| `docker compose exec -T frontend npx eslint` sur les 9 fichiers autorisés | aucune sortie, aucune erreur |
| `docker compose exec -T frontend npx vitest run` | 67 fichiers, 575 tests verts (562 + 13 : 4 + 6 + 1 + 2 de `api_pharmacie.test.ts`) |
| `npm run build` (local) | réussi |
| `git status` | 4 fichiers modifiés et 5 nouveaux, tous dans la liste autorisée |
| U+2014 / U+2013 (script Python sur les 9 fichiers) | 0 |
| `fetch(` brut dans SortieStock et le détail | aucun, tout passe par `authFetch` (api_pharmacie.ts) |

Les captures clair et sombre (point 6 de la fiche) n'ont pas été prises : non demandé dans ce brief.

## 2. Conformité à la fiche et au back

- Détail de réception (`[receptionId]/page.tsx`) : en-tête, fournisseur et bon de livraison « Non renseigné », tableau avec `caption`, colonne du coût affichée seulement si la clé `coutAchatBoite` existe sur au moins un lot (l.171), « Inconnu » pour `null` et pour 0 (l.235, conforme D698, jamais « 0 GNF »), `ALERTE_INFO` des résolutions, états introuvable et erreur avec `ErreurAvecReessai`, `aria-label` par lot. Conforme.
- Correction de date (`CorrectionDateLot.tsx`) : le DTO back `CorrigerLotDto` n'a aucun `id` (confirmé), la route n'est donc pas rejouable. Le front n'offre pas « Réessayer » : après échec réseau, saisie verrouillée par `fieldset disabled`, message exact de la fiche, seul « Fermer » reste, et il recharge le détail. Motif 3 à 300 : `motifValide` et `LONGUEUR_MAX_MOTIF` (ventes/affichage) ; le serveur reste maître (MOTIF_REQUIS). Date via `lireDatePeremption`, case « Sans date » envoie `sansPeremption: true`. Un refus du serveur garde le dialogue ouvert et rouvre l'envoi (`envoiRef` remis à false). Conforme.
- Sortie de stock (`SortieStock.tsx`) :
  - `CreerSortieStockDto` accepte `id?` en `@IsUUID`, `quantite` `@Min(1)` ; le service rejoue (`cree: false`, message « déjà enregistrée ») et donne 409 `IDENTIFIANT_DEJA_UTILISE` s'il appartient ailleurs.
  - Front : `idSortie` créé à l'ouverture (`useState` initial, composant monté à chaque ouverture), le même `corpsEnvoye` est renvoyé par « Réessayer l'envoi » (l.355), donc pas de doublon. Refus serveur (409 STOCK_LOT_NEGATIF etc.) : message du serveur, champs modifiables, même id. Conforme.
  - Raison obligatoire (aucune présélection sauf lot périmé, l.115), commentaire obligatoire pour AUTRE (l.122), quantité entier >= 1 (regex + `isSafeInteger`), « Tout le lot » = `lot.quantite` en `UNITE` (l.167), donc jamais au-delà du lot ; le plafond reste garanti côté serveur (409).
  - Succès : « message + Reste dans ce lot : … » avec `coefficientLot` du LOT (correct).
- Page du stock : bouton `PackageMinus` seulement pour `quantite > 0`, `aria-label` conforme, entre « Corriger la quantité » et « Archiver ». Conforme.

## 3. Cohérence des unités (point précis)

Faits établis :
- Le back renvoie bien un `coefficientReception` PAR LOT dans `GET .../stock/:stockId/lots` (`ElementLot`, receptions.service.ts:187-215), figé sur le lot ; `quantite` = solde en unités.
- `SortieStock.tsx:230` passe `coefficient={coefficientFiche}` à `ChoixLot`, qui applique ce seul coefficient à TOUS les lots (`ChoixLot.tsx:57`, `libelleLot`). Même chose dans `ResumeLot` (l.398, `coefficient={coefficientFiche}` en l.220).
- L'envoi et la saisie (`coefficientLot` l.116, étiquette « en boîtes », `quantite` en `BOITE` multipliée par le serveur) utilisent le coefficient du lot.

Conséquence : si la fiche a un coefficient différent de celui d'un lot (réception avant qualification ou changement de coefficient avant la conversion ; les lots non techniques gardent leur coefficient figé), le vendeur voit dans la liste « N boîtes + reliquat » calculé avec le coefficient de la fiche, faux pour ces lots, alors que la quantité saisie « en boîtes » sera interprétée par le serveur avec le coefficient du lot. Exemple : lot reçu à coefficient 10 contenant 40 unités, fiche à 20 : la liste affiche « 2 boîtes », le lot compte 4 boîtes ; saisir « 2 boîtes » sort 20 unités. Risque de sortie erronée sur des données de stock. Aucun test ne couvre ce cas (tous les lots de test ont coefficient 20, comme la fiche).

Correction minimale recommandée (aucune route à toucher, périmètre : ChoixLot, SortieStock, test) :
1. `ChoixLot.tsx` : ajouter `coefficientReception?: number` à `LotChoisissable` ; dans `libelleLot` utiliser `Math.max(1, lot.coefficientReception ?? coefficient)`. Les autres utilisateurs de ChoixLot (vente, sans ce champ) gardent le coefficient passé en paramètre.
2. `SortieStock.tsx` : `ResumeLot` utilise `lot.coefficientReception` (l.398) au lieu du coefficient de la fiche.
3. Ajouter un test (SortieStock.test.tsx) : lot à `coefficientReception: 10`, `quantite: 40` sur une fiche à 20, la liste affiche 4 boîtes.

## 4. Accessibilité, design, texte

- Dialogues : `useDialogA11y` (role dialog, titre `aria-labelledby`, focus et Echap, Echap bloqué pendant l'envoi), fond cliquable désactivé pendant l'envoi ; composant interne monté à chaque ouverture, champs remis à zéro.
- Lecture seule après échec réseau : `fieldset disabled` (raisons, unité), `readOnly` (quantité, précision), « Tout le lot » désactivé ; le groupe de radios du lot est remplacé par `ResumeLot` (résumé en texte), conforme à la contrainte « radios non lisibles seuls ».
- Design : classes `classes.ts`, icône dans carré `bg-amber-50 dark:bg-amber-500/15`, variantes sombres présentes, `role="alert"`/`status` sur les messages. Pas de fautes de français repérées, aucun terme technique visible (ni id, ni code).
- Les tests de la page du stock : mock passé à `importOriginal` (l.13-18), `listerLotsFiche` mocké explicitement, aucun vrai appel réseau masqué ; les deux autres fichiers de test font de même.

## 5. Problèmes

1. (Majeur, à corriger avant commit) `ChoixLot.tsx:57` et `SortieStock.tsx:220,230,398` : libellé des lots calculé avec le coefficient de la fiche et non celui du lot (détail en section 3).
2. (Mineur) `SortieStock.tsx:176` : le fond du dialogue reste cliquable alors que l'issue est inconnue (`issueInconnue`) : fermer par un clic hors dialogue est cohérent (rechargement), aucun correctif requis.
3. (Info, hors périmètre) Réserve PB15a déjà remontée : une sortie « Perdu ou volé » n'est tracée que par l'audit.
