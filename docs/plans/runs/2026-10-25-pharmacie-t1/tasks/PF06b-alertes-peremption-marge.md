# PF06b - Alertes de péremption par lot et bloc marge sur l'accueil « pilotage »

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (titulaire ; alertes visibles aussi par qui a `stock:read`)
Visuel: oui (deux blocs ajoutés à l'accueil « pilotage » existant, avec ses composants)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Quatorzième et dernière sous-fiche du front (D685). Deux blocs minimaux sur l'accueil « pilotage » : (1) alertes de péremption par lot aux horizons des paramètres (7, 30, 90 jours par défaut) et lots périmés, valeur au prix de vente pour tous et au coût **seulement si la clé est transmise** (D698) ; (2) marge de la période (du 1er du mois à aujourd'hui par défaut, 92 jours au plus), avec le volume non valorisable, les ventes en attente de stock et la date de fiabilité, réservée à `marge:read` (bloc absent sans la permission).

Décisions applicables : D686, D687, D693, D698, D704.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- `src/components/dashboard/PilotagePharmacie.tsx` : cartes (`Carte`, `Valeur`, `Chargement`, `pluriel` d'`ApercuPharmacie.tsx`), section « Pilotage de la pharmacie », puis `ApercuPharmacie` « Votre stock » ; carte « Anomalies à traiter » ajoutée par PF06a ; `DroitsPilotage` construit dans `src/app/dashboard/page.tsx`. `ApercuPharmacie.tsx` : bloc « À surveiller » (lignes 305 à 345) = gabarit de liste courte à reprendre. PF06a : `src/lib/api_pilotage.ts`. PF01a : `classes.ts`, `ErreurAvecReessai`, `formaterQuantite`, `lireContexteAcces` (`acces.ts`). PF02b : `afficherDatePeremption`.
- Contrats (back `CLAUDE.md`, puce PB16a ; rapport `rapports/PB16a-chef.md`, « Conséquences pour le front » ; types `back_medconnect/src/pharmacie/domaine/peremption.ts` lignes 23 à 55 ; `rapports/rapports.service.ts` lignes 123 à 215) :
  - `GET /pharmacie/:structureId/stock/alertes-peremption` (`stock:read`) : `data { jour, horizons: [{ jours, nombreLots, valeurVente | null, nombreLotsSansPrix, valeurCout?, nombreLotsCoutInconnu?, lots }] (ordre décroissant : 90, 30, 7), perimes: { même groupe sans jours }, sansDate: { nombreLots } }` ; lot : `{ lotId, stockId, nom, numeroLot, dateExpiration, joursRestants (négatif si périmé), quantite (unités), quantiteBoites, unitesEnPlus, lotTechnique, ficheArchivee, valeurVente | null, valeurCout?, coutConnu? }` ; `valeurCout`, `coutConnu` et `nombreLotsCoutInconnu` **absents** sans `marge:read` ; une valeur nulle = inconnue, jamais 0 GNF. Chaque lot est rangé dans le **plus petit** horizon qui le contient (un lot à 5 jours est dans le groupe 7, pas dans 30 ni 90).
  - `GET /pharmacie/:structureId/rapports/marge?du=&au=` (`marge:read`) : `data { du, au, debutFiabilite | null, periodeAvantFiabilite, nombrePieces, chiffreAffairesTotal, chiffreAffairesValorise, coutAlloue, marge, nonValorisable: { nombreVentes, chiffreAffaires }, provisoires: { nombreLignes, chiffreAffaires } }` ; 400 `VALIDATION` (`jourInvalide`, `periodeInversee` sur `du`, `periodeMaximale` sur `au`), message à afficher tel quel ; taux calculé côté front sur `chiffreAffairesValorise` seulement (D698).
- Rôles : titulaire = `stock:read` et `marge:read` ; vendeur (« Pharmacien ») = `stock:read` sans `marge:read` (il voit la vue « comptoir », pas le « pilotage »).
- Jeu démo (PB19a-chef.md) : Kaloum, `CT23H990` à 7 jours, `DL23K052` à 30, `FG24E118` à 90, `AG23C777` périmé (coût inconnu) ; marge de J-2 à J : vente T5 (Ibuprofène sans coût) non valorisable, W2 en attente de stock.

### 1. `src/lib/api_pilotage.ts` (ajouts)

Types `LotAlerte`, `GroupeAlerte`, `AlertesPeremption`, `RapportMarge` (champs de coût facultatifs : `valeurCout?: number | null`, `coutConnu?: boolean`, `nombreLotsCoutInconnu?: number`) ; `getAlertesPeremption(structureId)`, `getRapportMarge(structureId, periode: { du?: string; au?: string } = {})`.

Règle pure `src/lib/marge_affichage.ts` : `tauxMarge(r: RapportMarge): number | null` = `marge / chiffreAffairesValorise x 100` arrondi à une décimale, `null` si `chiffreAffairesValorise <= 0` ; `formaterTaux(t)` = « 23,5 % » (virgule, espace insécable) ou « inconnu » pour `null` ; `aCoutTransmis(obj, cle)` = `Object.prototype.hasOwnProperty.call(obj, cle)`. Tests `marge_affichage.test.ts` (4) : taux 23,5 % ; CA valorisé nul : « inconnu » ; `aCoutTransmis` vrai pour `{ valeurCout: null }`, faux pour `{}` ; aucune valeur nulle ne devient « 0 ».

### 2. Bloc « Péremptions à surveiller » (`src/components/dashboard/AlertesPeremption.tsx`, nouveau)

Affiché dans `PilotagePharmacie.tsx` sous la section de tête, si `droits.peutVoirStock`.
- Titre `h3` « Péremptions à surveiller » (même style que « À surveiller ») ; chargement (`Chargement`), erreur (« Les péremptions n'ont pas pu être chargées. » + « Réessayer »), 403 : bloc absent.
- Une ligne de cartes (`Carte`) : « Périmés » (`perimes.nombreLots`, couleur rose), puis un par horizon du plus court au plus long : « Dans 7 jours », « Dans 30 jours », « Dans 90 jours » (`nombreLots`) ; sous-texte de chaque carte : « Valeur de vente : <formaterGNF(valeurVente)> » ou « Valeur de vente : inconnue » si `null`, plus « , <nombreLotsSansPrix> lot(s) sans prix » si positif ; si la clé `valeurCout` est présente : ligne « Coût d'achat : <formaterGNF> » ou « inconnu », plus « , <nombreLotsCoutInconnu> lot(s) au coût inconnu » si positif.
- Liste courte (5 lots au plus, les périmés puis par `joursRestants` croissant) : « <nom>, lot <numeroLot ou sans numéro> : <formaterQuantite(quantite, ...)> » (unités par boîte = 1 si inconnu : afficher « <quantiteBoites> boîte(s) » et « + <unitesEnPlus> unité(s) » si positif), « périmé depuis le <date> » ou « expire le <date>, dans <joursRestants> jours » ; lien « Sortir du stock » vers `/dashboard/stock` sur un lot périmé ; plus de 5 : « et <n> autres lots » avec lien « Voir le stock ».
- `sansDate.nombreLots` positif : ligne « <n> lot(s) sans date de péremption : datez-les depuis le stock. » avec lien vers `/dashboard/stock`.
- Aucun lot nulle part : « Aucune péremption dans les <plus grand horizon> prochains jours. ».

### 3. Bloc « Marge » (`src/components/dashboard/MargePeriode.tsx`, nouveau)

Affiché seulement si `lireContexteAcces(...).permissions.has("marge:read")` (nouveau droit `peutVoirMarge` de `DroitsPilotage`, calculé dans `src/app/dashboard/page.tsx`) ; jamais d'appel sinon.
- Titre « Marge » ; deux champs date « Du » (défaut 1er du mois en cours, heure de Conakry) et « Au » (défaut aujourd'hui), bouton `BOUTON_SECONDAIRE` « Afficher » ; aide « 92 jours au plus. ».
- Cartes : « Chiffre d'affaires » (`chiffreAffairesTotal`), « Marge » (`marge`, sous-texte « sur <formaterGNF(chiffreAffairesValorise)> de ventes au coût connu »), « Taux de marge » (`formaterTaux(tauxMarge(r))`).
- Sous les cartes, toujours affiché quand positif : « Ventes sans coût d'achat connu : <nombreVentes> pour <formaterGNF(chiffreAffaires)>, hors marge. » ; « Ventes en attente de livraison : <nombreLignes> ligne(s) pour <formaterGNF(chiffreAffaires)>, hors marge. ».
- `periodeAvantFiabilite` vrai : `ALERTE_ATTENTION` « Avant le <afficherDatePeremption(debutFiabilite)>, les ventes n'ont pas de coût d'achat : la marge de cette période est incomplète. » (format JJ/MM/AAAA, la fonction convient à toute date AAAA-MM-JJ) ; `debutFiabilite` affiché aussi en petit : « Marge fiable depuis le <date> ».
- `nombrePieces === 0` : « Aucune vente sur cette période. ».
- 400 `VALIDATION` : message du serveur sous les champs ; réseau : `ErreurAvecReessai`.

### 4. Tests

`src/components/dashboard/AlertesPeremption.test.tsx` (5) : 1. cartes « Périmés », « Dans 7 jours », « Dans 30 jours », « Dans 90 jours » dans cet ordre ; 2. `valeurVente: null` affiche « inconnue », jamais « 0 GNF » ; 3. sans la clé `valeurCout` : aucune mention du coût ; avec `valeurCout: null` : « Coût d'achat : inconnu » et le nombre de lots au coût inconnu ; 4. lot périmé : « périmé depuis le » et lien « Sortir du stock » ; 5. lots sans date : phrase et lien vers le stock.

`src/components/dashboard/MargePeriode.test.tsx` (5) : 1. période par défaut du 1er du mois à aujourd'hui (horloge simulée par `vi.setSystemTime`) envoyée à `getRapportMarge` ; 2. taux « 23,5 % » ; 3. non valorisable et attente de livraison affichés à part ; 4. `periodeAvantFiabilite` : avertissement exact ; 5. 400 `VALIDATION` `periodeMaximale` : message du serveur.

`src/components/dashboard/PilotagePharmacie.test.tsx` (2 ajoutés) : bloc « Marge » absent et `getRapportMarge` jamais appelé sans `peutVoirMarge` ; bloc « Péremptions à surveiller » présent avec `peutVoirStock`.

## Contraintes

Faire uniquement ce qui est demandé ; aucun recalcul côté front hors du taux (D698). Audience non-dev : « coût d'achat », « ventes sans coût connu », jamais « valorisable », « allocation », « provisoire » à l'écran ; termes interdits absents. Visuel : composants et classes de l'accueil existant, clair et sombre, AA, une seule échelle de cartes. Montants : `formaterGNF`. Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés : `src/lib/api_pilotage.ts`, `src/lib/api_pilotage.test.ts`, `src/lib/marge_affichage.ts`, `src/lib/marge_affichage.test.ts`, `src/components/dashboard/AlertesPeremption.tsx`, `src/components/dashboard/AlertesPeremption.test.tsx`, `src/components/dashboard/MargePeriode.tsx`, `src/components/dashboard/MargePeriode.test.tsx`, `src/components/dashboard/PilotagePharmacie.tsx`, `src/components/dashboard/PilotagePharmacie.test.tsx`, `src/app/dashboard/page.tsx`, `src/app/dashboard/page.test.tsx`.

## Test à la main

Démo remise à zéro, **Djénabou Baldé** (titulaire, Kaloum) : accueil, péremptions (`CT23H990` dans 7 jours, `DL23K052` dans 30, `FG24E118` dans 90, `AG23C777` périmé au coût inconnu), marge de J-2 à aujourd'hui (Ibuprofène sans coût hors marge, W2 en attente de livraison), période de 100 jours refusée avec le message du serveur. **Ousmane Keita** : vue comptoir, aucune marge. Captures clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur nouvelle.
3. `npm test` : tout vert, dont `AlertesPeremption.test.tsx` (5), `MargePeriode.test.tsx` (5), `marge_affichage.test.ts` (4), `PilotagePharmacie.test.tsx` (2 ajoutés).
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés ; `grep -rn "?? 0" src/components/dashboard/AlertesPeremption.tsx src/components/dashboard/MargePeriode.tsx` : aucune ligne sur une valeur de coût ou de vente.
6. Termes interdits absents ; aucun U+2014 ni U+2013 ajouté ; captures clair et sombre (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
