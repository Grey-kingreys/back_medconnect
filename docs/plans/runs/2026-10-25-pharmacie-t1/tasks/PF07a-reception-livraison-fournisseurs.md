# PF07a - Réception d'une livraison et fournisseurs

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (titulaire qui recopie la facture du grossiste, au clavier)
Visuel: oui (nouvelle page, entièrement composée des éléments existants)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Cinquième sous-fiche (D685) et première de PF07 « Réception, inventaire et sorties de stock » (D683, décision de l'orchestrateur principal : aucun écran prévu au plan alors que le back les expose et que c'est le premier besoin du pharmacien visité, `rapport/INVENTAIRE.md`). Page « Réceptions » : liste des livraisons reçues et saisie d'une nouvelle réception depuis la facture papier (fournisseur, référence du bon, une ligne par produit avec quantité en boîtes, date de péremption au format de la facture `6/28`, numéro de lot et coût d'achat facultatifs), fournisseurs créés sur place, avertissement `FICHE_NON_QUALIFIEE`. Le détail d'une réception, la correction de date d'un lot et les sorties arrivent en PF07b.

Décisions applicables : D683, D684, D686, D687, D688, D693, D695, D698, D704.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- Aucune page ni appel de réception, de fournisseur ou de lot dans le front. `src/lib/navigation_tableau_de_bord.ts` : tableau `ENTREES` (section `activite`, `perm([...], { typesStructure: P })`, `rolesRepli: []`) ; `estRouteAutorisee` autorise une route absente de `ENTREES` : toute nouvelle page **doit** y avoir son entrée.
- PF01a : `nouvelleCleIdempotence` (dans `api_carnet.ts`), `erreurs_api.ts` (`codeErreur`, `detailsErreur`, `champsErreur`, `estErreurReseau`), `classes.ts`, `ErreurAvecReessai`, `formaterQuantite`. PF02b : `src/lib/date_peremption.ts` (`lireDatePeremption`, `afficherDatePeremption`). `src/app/dashboard/ventes/affichage.ts` : `formaterDateCourte`, `formaterDateHeure`, `jourConakry`. `src/app/dashboard/ventes/page.tsx` : modèle de page liste paginée (états `chargement`, `pret`, `erreur`, pagination).
- Contrats (back `CLAUDE.md`, puce PB14a ; DTO `back_medconnect/src/pharmacie/dto/receptions.dto.ts` ; service `receptions/receptions.service.ts`) :
  - `GET /pharmacie/:structureId/fournisseurs` (`reception:write`) : `data: [{ id, nom, telephone, createdAt }]` ; `POST` `{ nom (2 à 100), telephone? (6 à 30, chiffres, espaces, + ( ) . -) }` : `data { id, nom, telephone, createdAt, cree }`, 409 `FOURNISSEUR_EXISTANT` (nom déjà pris, sans tenir compte des majuscules).
  - `POST /pharmacie/:structureId/receptions` (`reception:write`, 200) : `{ id? (UUID), fournisseurId?, reference? (100), recueLe? (ISO, jamais futur), lignes: [{ stockId, numeroLot? (64), dateExpiration? (AAAA-MM-JJ), sansPeremption?, nombreBoites? | quantiteUnites? (exactement un des deux, entier >= 1), coutAchatBoite? (entier >= 0) }] (1 à 200) }` ; réponse `data { id, reference, recueLe, createdAt, auteurId, fournisseur, lots: [{ id, stockId, nom, numeroLot, dateExpiration, quantiteRecue, coefficientReception, solde, coutAchatBoite?, coutUnitaire? }], resolutions, cree, avertissements: [{ code: "FICHE_NON_QUALIFIEE", stockId, nom, message }] }`, message « Réception enregistrée : N lots. » (plus « Les ventes faites en attente de ce stock ont été rattachées aux lots reçus. » si des ventes sans stock ont été rattachées) ou « Cette réception était déjà enregistrée. » (rejeu du même `id`). Erreurs : 400 `VALIDATION` avec `champs` `lignes.<i>.nombreBoites` ou `lignes.<i>.dateExpiration`, 400 `DATE_PEREMPTION_REQUISE` et 400 `DATE_PEREMPTION_PASSEE` avec `details: [{ stockId, nom }]`, 404 `STOCK_INTROUVABLE`, 404 fournisseur, 409 `IDENTIFIANT_DEJA_UTILISE`, 409 `JOURNEE_CLOTUREE` (date de réception d'un jour clôturé), 403.
  - `GET /pharmacie/:structureId/receptions?page=` : `data { receptions: [{ id, reference, recueLe, createdAt, auteurId, fournisseur, nombreLots, quantiteTotale }], page, parPage (20), total }`.
  - Une réception exige une fiche existante (`stockId`) : un médicament absent du stock s'ajoute d'abord par « Ajouter un médicament » (page du stock).
- Rôles par défaut : seul le titulaire (« Administrateur de structure ») a `reception:write` ; le rôle « Pharmacien » ne l'a pas (D704).
- Jeu démo (PB19a-chef.md) : Kaloum : fournisseurs et réceptions `BL-MAT-0412` (J-20, 11 lignes dont un Ibuprofène sans coût) et `BL-BON-0087` (J-3) ; Niger : `BL-KAN-0153` (J-15).

### 1. `src/lib/api_pharmacie.ts` (ajouts)

Types `Fournisseur`, `LigneReceptionDemandee`, `CorpsReception`, `LotRecu` (avec `coutAchatBoite?: number | null; coutUnitaire?: number | null`, commentaire D698), `AvertissementReception`, `Reception`, `ReceptionResume`, `PageReceptions`, conformes au contrat ci-dessus ; fonctions `listerFournisseurs(structureId)`, `creerFournisseur(structureId, { nom, telephone? })`, `enregistrerReception(structureId, corps)`, `listerReceptions(structureId, page = 1)`, `getReception(structureId, receptionId)` (utilisée par PF07b). Identifiants passés par `encodeURIComponent`.

### 2. Navigation (`src/lib/navigation_tableau_de_bord.ts`, D695)

Entrée après `stock` : `{ id: "receptions", section: "activite", href: "/dashboard/receptions", icone: Truck (lucide), libelle: { defaut: "Réceptions" }, acces: perm(["reception:write"], { typesStructure: P }), rolesRepli: [] }`, sans raccourci. Test ajouté à `src/lib/navigation_tableau_de_bord.pharmacie.test.ts` : la route est visible avec `reception:write`, invisible et refusée (`estRouteAutorisee` faux) pour un vendeur au rôle « Pharmacien ».

### 3. Page `src/app/dashboard/receptions/page.tsx` (liste)

- En-tête (gabarit de la page « Nouvelle vente » : titre `text-2xl sm:text-3xl font-extrabold`, `POLICE_TITRE`) : « Réceptions », sous-titre « Enregistrez les livraisons de vos fournisseurs à partir de la facture. » ; bouton `BOUTON_PRIMAIRE` « Nouvelle réception » (lien vers `/dashboard/receptions/nouvelle`).
- Liste (`CARTE`), 20 par page, colonnes « Reçue le » (`formaterDateHeure(recueLe)`), « Fournisseur » (« Non renseigné » si nul), « Bon de livraison » (« Non renseigné »), « Lots », chaque ligne étant un lien vers `/dashboard/receptions/<id>` (page créée en PF07b ; avant elle, le lien mène à une page absente : acceptable entre deux commits du même run). Pagination « Précédente » / « Suivante » comme `ventes/page.tsx`.
- Vide : « Aucune réception enregistrée. Enregistrez votre première livraison avec « Nouvelle réception ». » ; erreur : `ErreurAvecReessai` « Les réceptions n'ont pas pu être chargées. Vérifiez votre connexion puis réessayez. ».
- Utilisateur sans `structureId` : même message que la page de vente (« Votre compte n'est rattaché à aucune pharmacie... »).

### 4. Page `src/app/dashboard/receptions/nouvelle/page.tsx` (saisie)

Chargement en parallèle : stock (`getMyStock`, fiches non archivées) et fournisseurs ; échec : `ErreurAvecReessai`.

**En-tête de la réception** (`CARTE`) :
- « Fournisseur » : liste déroulante des fournisseurs (option vide « Non renseigné ») et bouton `BOUTON_SECONDAIRE` « Nouveau fournisseur » qui déplie deux champs « Nom du fournisseur » et « Téléphone (facultatif) » et un bouton « Enregistrer le fournisseur » ; succès : fournisseur ajouté et sélectionné ; 409 `FOURNISSEUR_EXISTANT` : message du serveur et le fournisseur existant au même nom (comparaison sans majuscules) est sélectionné s'il est dans la liste.
- « Numéro du bon de livraison ou de la facture (facultatif) ».
- « Date de réception » : champ date, défaut aujourd'hui (`jourConakry`), `max` = aujourd'hui ; envoyé comme `recueLe` = maintenant si c'est aujourd'hui, sinon `<jour>T12:00:00.000Z`.

**Lignes** (`CARTE`, tableau éditable ; une ligne vide au départ) :
- « Médicament » : champ de recherche dans les fiches du stock (même règle de recherche que la vente : sans casse ni accents, `rechercherDansStock` de `src/app/dashboard/vente/panier.ts`), liste de suggestions au clavier (flèches, Entrée) ; aide sous le tableau : « Un médicament absent de la liste s'ajoute d'abord depuis Stock Médicaments, bouton « Ajouter un médicament ». » avec le lien.
- « Quantité » : entier ; « boîtes » par défaut, bascule « en unités » (`<pluriel de l'unité>`) proposée si le coefficient dépasse 1 ; envoi `nombreBoites` ou `quantiteUnites`.
- « Péremption » : champ texte (placeholder « 06/28 »), lu par `lireDatePeremption` à la sortie du champ, date lue affichée en clair sous le champ (« 30/06/2028 ») ou le message de refus ; case « Sans date » (`sansPeremption`) qui désactive le champ.
- « Lot (facultatif) » : numéro inscrit sur la boîte, 64 caractères.
- « Coût d'achat d'une boîte (GNF, facultatif) » : entier ; aide « Sans coût, la marge de ce lot restera inconnue. » (D698).
- Bouton icône « Retirer la ligne » (`aria-label="Retirer la ligne <n>"`) ; bouton `BOUTON_SECONDAIRE` « Ajouter une ligne » ; Entrée dans le dernier champ de la dernière ligne ajoute une ligne et place le focus sur son médicament.
- Avertissement par ligne, avant tout envoi (D683) : fiche `qualifie === false` et quantité en boîtes : `ALERTE_ATTENTION` « Le nombre d'unités par boîte de <nom> n'est pas encore confirmé : vérifiez sa fiche avant de compter en boîtes, ou saisissez la quantité en unités. » (non bloquant).
- Une même fiche peut figurer sur plusieurs lignes (lots différents).

**Récapitulatif et envoi** : « <n> lignes, <somme des boîtes> boîtes » ; bouton `BOUTON_PRIMAIRE` « Enregistrer la réception ». Contrôles locaux avant envoi (rien n'est envoyé sinon, focus sur le premier champ en cause) : médicament choisi, quantité >= 1, péremption lisible ou « Sans date », coût entier ou vide ; message « Complétez les lignes signalées avant d'enregistrer. ».

**Identifiant client** (D688) : un `id` (`nouvelleCleIdempotence`) est créé à l'ouverture de la saisie et envoyé à chaque tentative de cette saisie. Échec réseau : bandeau « La réception n'a peut-être pas été enregistrée. Vérifiez votre connexion puis appuyez sur « Réessayer l'envoi » : elle ne sera pas enregistrée deux fois. », tous les champs passent en lecture seule, boutons « Réessayer l'envoi » (même `id`) et « Modifier la saisie » ; « Modifier la saisie » demande confirmation (« Avant de modifier, vérifiez dans la liste des réceptions que cette livraison n'a pas déjà été enregistrée. Continuer ? », boutons « Modifier » et « Annuler ») puis rend les champs modifiables avec un **nouvel** `id`. Refus du serveur (400, 403, 404, 409) : rien n'est enregistré, champs modifiables, même `id` gardé (aucune réception n'existe sous cet `id`).

**Erreurs** :
- `VALIDATION` : message du serveur en tête ; chaque `champs[].champ` `lignes.<i>.<champ>` encadre le champ de la ligne i en rouge (`border-rose-500`) avec `aria-invalid`.
- `DATE_PEREMPTION_REQUISE`, `DATE_PEREMPTION_PASSEE` : message du serveur et lignes citées (`details[].stockId`) signalées sur leur champ « Péremption ».
- `JOURNEE_CLOTUREE` : message du serveur, date de réception remise à aujourd'hui, focus sur le bouton d'envoi.
- `STOCK_INTROUVABLE`, 404 fournisseur, `IDENTIFIANT_DEJA_UTILISE` : message du serveur, stock et fournisseurs rechargés ; pour `IDENTIFIANT_DEJA_UTILISE`, nouvel `id`.
- 403 : message du serveur.

**Succès** : écran de résultat (gabarit du succès de la vente) : message du serveur en titre (« Réception enregistrée : 3 lots. »), avertissements `FICHE_NON_QUALIFIEE` reçus (`ALERTE_ATTENTION`, message du serveur, nom), si `cree === false` : « Cette réception était déjà enregistrée : rien n'a été ajouté deux fois. » ; boutons « Voir la réception » (vers `/dashboard/receptions/<id>`), « Nouvelle réception » (formulaire vidé, nouvel `id`), « Retour aux réceptions ».

### 5. Tests

`src/app/dashboard/receptions/nouvelle/page.test.tsx` (9) :
1. saisie complète au clavier : fournisseur choisi, médicament trouvé par Entrée, 10 boîtes, péremption `6/28`, Entrée ajoute une ligne ; envoi : corps avec `id` (UUID), `lignes[0]` = `{ stockId, nombreBoites: 10, dateExpiration: "2028-06-30" }`, ligne vide finale ignorée ;
2. « Sans date » envoie `sansPeremption: true` sans `dateExpiration` ;
3. péremption `13/28` : aucun envoi, message de refus exact ;
4. avertissement de fiche non confirmée affiché avant envoi, disparaît en passant la ligne « en unités » (`quantiteUnites` envoyé) ;
5. échec réseau puis « Réessayer l'envoi » : deux appels au même `id`, champs en lecture seule entre les deux ;
6. « Modifier la saisie » après échec réseau : confirmation, puis l'envoi suivant porte un autre `id` ;
7. 400 `DATE_PEREMPTION_PASSEE` (`details: [{ stockId: "s1", nom: "Doliprane" }]`) : message du serveur, champ « Péremption » de la ligne marqué `aria-invalid` ;
8. 409 `JOURNEE_CLOTUREE` : message du serveur, date remise à aujourd'hui ;
9. succès avec un avertissement `FICHE_NON_QUALIFIEE` et `cree: false` : titre = message du serveur, avertissement et texte de rejeu affichés.

`src/app/dashboard/receptions/page.test.tsx` (3) : liste et lien de chaque réception ; liste vide (texte exact) ; erreur puis « Réessayer ».

`src/lib/api_pharmacie.test.ts` (2 ajoutés) : `enregistrerReception` envoie `POST /pharmacie/s1/receptions` avec le corps tel quel ; `creerFournisseur` envoie `{ nom, telephone }`.

## Contraintes

Faire uniquement ce qui est demandé ; réutiliser `rechercherDansStock`, `lireDatePeremption`, `formaterQuantite`, `classes.ts`, `ErreurAvecReessai`. Audience non-dev : termes interdits absents ; jamais « UM », « coefficient », « réception provisoire » à l'écran. Visuel : uniquement les classes existantes, clair et sombre, AA, chaque champ a un libellé (en-tête de colonne relié par `aria-label` sur une table), focus visible. Next.js 16 : lire `node_modules/next/dist/docs/` avant de créer les pages (App Router, `"use client"` comme les pages existantes). Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés : `src/lib/api_pharmacie.ts`, `src/lib/api_pharmacie.test.ts`, `src/lib/navigation_tableau_de_bord.ts`, `src/lib/navigation_tableau_de_bord.pharmacie.test.ts`, `src/app/dashboard/receptions/page.tsx`, `src/app/dashboard/receptions/page.test.tsx`, `src/app/dashboard/receptions/nouvelle/page.tsx`, `src/app/dashboard/receptions/nouvelle/page.test.tsx`.

## Test à la main

Démo remise à zéro, **Djénabou Baldé** (titulaire, Pharmacie de Kaloum) : menu « Réceptions » (liste avec `BL-BON-0087` et `BL-MAT-0412`), « Nouvelle réception » : fournisseur existant, deux lignes recopiées comme une facture UbiPharm (péremptions `6/28` et `10/27`, une ligne sans coût), Ventoline reçue (la vente sans stock de la démo est rattachée : message du serveur). **Ousmane Keita** (vendeur) : pas d'entrée « Réceptions » (D704). Captures clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur.
3. `npm test` : tout vert, dont `receptions/nouvelle/page.test.tsx` (9), `receptions/page.test.tsx` (3), `api_pharmacie.test.ts` (2 ajoutés), test de navigation ajouté.
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés.
6. Termes interdits absents des chaînes ajoutées ; aucun U+2014 ni U+2013 ajouté ; captures clair et sombre (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-11-01 | spécifié (Sonnet) | PASS avec réserves | R1 à R5 (rapports/PF07a-verification.md)
2026-11-01 | chef (Opus) | validé | R1 à R5 corrigées, garde des sous-pages (D708), 5 tests ajoutés (rapports/PF07a-chef.md)

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
front : tsc, eslint (8 fichiers), `vitest run`, `npm run build` local | 0 erreur, 0 erreur, 65 fichiers et 562 tests verts, build réussi | front 1d2197f
