# PF07c - Inventaire par lot (lots existants proposés, comptage à l'aveugle)

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (titulaire qui compte ses rayons, souvent en fin de journée)
Visuel: oui (nouvelle page composée des éléments existants)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Septième sous-fiche (D685), après PF07b. Page « Inventaire » : le titulaire choisit les médicaments à compter ; pour chacun, **les lots existants de la fiche sont proposés** et il saisit le nombre de boîtes et d'unités en plus par lot, sans jamais taper un numéro de lot (D699 : un lot reçu sans numéro puis compté par un numéro tapé créerait un second lot et doublerait le stock, réserve PB15b). Un lot trouvé en rayon et absent de la liste s'ajoute par sa seule date de péremption (format `6/28` accepté). Le stock théorique n'est pas montré pendant le comptage ; il apparaît avec les écarts après l'enregistrement.

Décisions applicables : D684, D686, D687, D688, D693, D699, D704.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- Aucun écran d'inventaire dans le front (seul l'import Excel en mode « inventaire », traité en PF07d).
- PF07b : `listerLotsFiche(structureId, stockId)` (lots à solde positif, ordre de sortie, `coefficientReception`, `perime`) et `LotEnStock` dans `api_pharmacie.ts`. PF07a : modèle de page de saisie avec identifiant client, lecture seule après échec réseau, « Réessayer l'envoi » et « Modifier la saisie » ; entrée de navigation. PF02b : `lireDatePeremption`, `afficherDatePeremption`. PF01a/b : `formaterQuantite`, `rechercherDansStock` (`vente/panier.ts`), `classes.ts`, `ErreurAvecReessai`, `erreurs_api.ts`.
- Contrats (back `CLAUDE.md`, puce PB15b ; DTO `inventaires.dto.ts` ; service `inventaires/inventaires.service.ts`) : `POST /pharmacie/:structureId/inventaires` (`inventaire:write`, 200) `{ id? (UUID), commentaire? (500), lignes: [{ stockId, lotId?, numeroLot?, dateExpiration?, sansPeremption?, quantiteComptee? | nombreBoites? (et unitesEnPlus?) }] (1 à 500) }` ; comptage **absolu** par lot (boîtes multipliées par les unités par boîte **du lot**) ; ciblage par `lotId`, sinon date, sinon lot unique de la fiche même épuisé (D600) ; sans lot connu : nouveau lot daté (400 `DATE_PEREMPTION_REQUISE` sinon, `details: [{ stockId, nom }]`) ; 409 `LOT_REQUIS` (`details: [{ stockId, nom, lots }]`) ; 400 `VALIDATION` (`champs` `lignes.<i>.quantiteComptee` ou `lignes.<i>.lotId` : lot compté deux fois) ; 404 lot introuvable ; 409 `IDENTIFIANT_DEJA_UTILISE`. Réponse `data { id, createdAt, commentaire, auteurId, lignes: [{ id, stockId, nom, lotId, numeroLot, dateExpiration, lotTechnique, quantiteTheorique, quantiteComptee, ecart, sousTolerance, anomalieId }], cree, avertissements: [{ code: "FICHE_NON_QUALIFIEE", stockId, nom, message }] }`, message « Inventaire enregistré ... » (avec le nombre d'écarts signalés) ou « Cet inventaire était déjà enregistré. ». Un mouvement par lot compté, même sans écart ; au-delà de la tolérance de la fiche, anomalie `ECART_INVENTAIRE` attribuée à l'auteur.
- Rôles par défaut : seul le titulaire a `inventaire:write` (D598, D704).
- Jeu démo : Kaloum, Glucophage (inventaire avec écart -5), Augmentin (+16, lot `AG23C777` trouvé) ; plusieurs fiches à plusieurs lots (Doliprane : `DL23K052` entamé).

### 1. `src/lib/api_pharmacie.ts` (ajouts)

Types `LigneInventaireDemandee`, `CorpsInventaire`, `LigneInventaireEcrite`, `Inventaire` (conformes au contrat) et `enregistrerInventaire(structureId, corps)`.

### 2. Navigation

Entrée après `receptions` : `{ id: "inventaire", href: "/dashboard/inventaire", icone: ClipboardCheck, libelle: { defaut: "Inventaire" }, acces: perm(["inventaire:write"], { typesStructure: P }), rolesRepli: [] }`. Test de navigation ajouté (visible avec `inventaire:write`, refusée au rôle « Pharmacien »).

### 3. Page `src/app/dashboard/inventaire/page.tsx`

- En-tête : « Inventaire », sous-titre « Comptez vos boîtes lot par lot. Les quantités saisies remplacent celles enregistrées. ».
- Chargement du stock (`getMyStock`) ; erreur : `ErreurAvecReessai`.
- « Ajouter un médicament à compter » : champ de recherche (`rechercherDansStock`, Entrée ajoute le premier résultat) ; bouton `BOUTON_SECONDAIRE` « Ajouter tous les médicaments du filtre » absent (hors périmètre). Une fiche ne s'ajoute qu'une fois. À l'ajout, `listerLotsFiche` (chargement par fiche, erreur par fiche avec « Réessayer »).
- Bloc par médicament (`CARTE`, titre = nom, bouton icône « Retirer <nom> de l'inventaire ») :
  - une ligne par lot proposé : libellé « Lot DL23K052, expire le 30/06/2028 » (« Lot sans numéro », « sans date », « périmé le ... » comme `ChoixLot`) ; champs « Boîtes » et, si `coefficientReception` dépasse 1, « <pluriel> en plus » (boîte entamée) ; les deux vides = lot non compté (non envoyé), aide sous le bloc : « Un lot laissé vide n'est pas modifié. Saisissez 0 pour un lot absent du rayon. » ;
  - fiche sans aucun lot en stock : une seule ligne « Stock de ce médicament » (sans `lotId`) avec les mêmes champs et un champ « Péremption (si nouveau lot) » facultatif ;
  - bouton `BOUTON_SECONDAIRE` « Autre lot trouvé en rayon » : ajoute une ligne avec « Péremption » obligatoire (`lireDatePeremption`, ou case « Sans date »), « Boîtes », « unités en plus » ; **aucun champ de numéro de lot** (D699) ; aide : « Pour un lot qui n'est pas dans la liste : la date de péremption suffit. ».
- « Commentaire (facultatif) » : 500 caractères.
- Bouton `BOUTON_PRIMAIRE` « Enregistrer l'inventaire » ; contrôles locaux : au moins une ligne comptée, entiers >= 0, péremption lisible pour une ligne « Autre lot » ; message « Saisissez au moins un comptage, et la date de péremption des lots ajoutés. ».
- Corps envoyé : par ligne comptée, `{ stockId, lotId }` pour un lot proposé, `{ stockId }` (plus `dateExpiration` si saisie) pour « Stock de ce médicament », `{ stockId, dateExpiration | sansPeremption: true }` pour « Autre lot » ; quantité `nombreBoites` (et `unitesEnPlus` s'il est positif) ; jamais `numeroLot`, jamais `quantiteComptee`.
- Identifiant client et échec réseau : exactement le comportement de PF07a (textes adaptés : « L'inventaire n'a peut-être pas été enregistré. Vérifiez votre connexion puis appuyez sur « Réessayer l'envoi » : il ne sera pas enregistré deux fois. » ; confirmation de « Modifier la saisie » : « Avant de modifier, vérifiez sur la page du stock que ces quantités n'ont pas déjà été enregistrées. Continuer ? »).
- Erreurs : `VALIDATION` (champs de la ligne i marqués `aria-invalid`), `DATE_PEREMPTION_REQUISE` (lignes de la fiche citée : champ de péremption marqué), `LOT_REQUIS` (message du serveur et, pour la fiche citée, lots du `details` ajoutés comme lignes proposées), 404, `IDENTIFIANT_DEJA_UTILISE` (nouvel `id`), 403 : message du serveur tel quel.
- Résultat (succès) : message du serveur en titre ; tableau « Médicament », « Lot », « Attendu » (`quantiteTheorique`, `formaterQuantite`, peut être négatif), « Compté », « Écart » (signé : « +16 », « -5 » en unités avec `formaterQuantite` ; `text-rose-700 dark:text-rose-300` si négatif hors tolérance, `text-amber-700 dark:text-amber-300` si positif hors tolérance, neutre sinon), colonne « Signalé au titulaire » (« Oui » si `anomalieId`, sinon « Non ») ; avertissements `FICHE_NON_QUALIFIEE` reçus (`ALERTE_ATTENTION`) ; `cree === false` : « Cet inventaire était déjà enregistré : rien n'a été compté deux fois. » ; boutons « Nouvel inventaire » (formulaire vidé, nouvel `id`) et « Voir le stock ».

### 4. Tests

`src/app/dashboard/inventaire/page.test.tsx` (9) :
1. les lots de la fiche sont proposés et aucun champ « numéro de lot » n'existe sur la page ;
2. comptage d'un lot proposé : 2 boîtes et 6 unités envoient `{ stockId, lotId, nombreBoites: 2, unitesEnPlus: 6 }` ;
3. un lot laissé vide n'est pas envoyé ; un lot à 0 est envoyé `nombreBoites: 0` ;
4. « Autre lot trouvé en rayon » avec `6/28` et 3 boîtes : `{ stockId, dateExpiration: "2028-06-30", nombreBoites: 3 }`, sans `numeroLot` ;
5. « Autre lot » sans date ni « Sans date » : aucun envoi, message exact ;
6. fiche sans lot : ligne « Stock de ce médicament » envoyée sans `lotId` ;
7. résultat : écart « -5 » marqué « Oui », titre = message du serveur ;
8. échec réseau puis « Réessayer l'envoi » : même `id` ;
9. 409 `LOT_REQUIS` : message du serveur et lots du `details` ajoutés à la fiche citée.

## Contraintes

Faire uniquement ce qui est demandé ; pas d'historique des inventaires (hors périmètre, la route existe pour plus tard). Audience non-dev : termes interdits absents ; « attendu » et « compté », jamais « théorique ». Visuel : classes existantes, clair et sombre, AA, libellés reliés. Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés : `src/lib/api_pharmacie.ts`, `src/lib/navigation_tableau_de_bord.ts`, `src/lib/navigation_tableau_de_bord.pharmacie.test.ts`, `src/app/dashboard/inventaire/page.tsx`, `src/app/dashboard/inventaire/page.test.tsx`.

## Test à la main

Démo remise à zéro, **Djénabou Baldé** (titulaire, Kaloum) : « Inventaire », Doliprane (lots proposés dont `DL23K052` entamé), Glucophage compté avec un écart, un « Autre lot trouvé en rayon » daté `9/27` ; l'anomalie d'écart apparaît ensuite dans la file (PF06a). **Ousmane Keita** (vendeur) : pas d'entrée « Inventaire » (D704). Captures clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur.
3. `npm test` : tout vert, dont `inventaire/page.test.tsx` (9) et le test de navigation ajouté.
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés ; `grep -n "numeroLot" src/app/dashboard/inventaire/page.tsx` ne montre aucun envoi de `numeroLot` (lecture d'affichage seulement).
6. Termes interdits absents ; aucun U+2014 ni U+2013 ajouté ; captures clair et sombre (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-11-01 | spécifié (Sonnet codeur, Sonnet vérificateur) | PASS avec réserve (rapports/PF07c-verification.md) | sur `LOT_REQUIS`, chiffre compté perdu et coefficient de la fiche pour les lots cités ; un seul message d'erreur par ligne
2026-11-01 | chef (Opus) | validé | rappel du comptage sans répartition (D710), lots relus avec leur coefficient (D709), deux messages par ligne, 3 tests ajoutés (rapports/PF07c-chef.md)

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
docker compose exec -T frontend npx tsc --noEmit | exit 0 | 896206d
docker compose exec -T frontend npx eslint (5 fichiers de la fiche) | exit 0, avant le commit, puis hook pre-commit passé | 896206d
docker compose exec -T frontend npx vitest run | 68 fichiers, 589 verts | 896206d
npm run build (local) | réussi, avant le commit, code inchangé depuis | 896206d
