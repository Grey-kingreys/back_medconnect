# PF01a - Socle du front de la tranche : types, droits, erreurs, règles de caisse

Tier: spécifié (codeur Sonnet, vérificateur Sonnet ; fiche détaillée, aucune décision laissée ouverte)
Audience: dev (aucun écran ; seuls `ErreurAvecReessai` et les libellés d'unité sont visibles, non-dev)
Visuel: n/a (deux petits éléments visuels copiés de l'existant, voir 6)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Première des 14 sous-fiches du front de la tranche pharmacie 1 (D685). Elle pose, sans changer aucun écran, ce dont toutes les suivantes ont besoin : types d'API alignés sur le back réel (contrats de `back_medconnect/CLAUDE.md`, mis à jour en PB19b), les 7 permissions de la tranche, la lecture des erreurs du serveur, les règles pures de quantité et de prix, l'interface de source de la caisse (en ligne seulement ici, D690) et les classes visuelles partagées (D693). Autonome, gate verte, commitée seule.

**Aucun écran modifié, aucun comportement visible changé.** `src/app/dashboard/vente/page.tsx`, `panier.ts` et les autres écrans compilent sans modification (les anciens codes de vente restent dans la liste, retirés en PF01b et PF04).

Décisions applicables : D683 à D700 (surtout D686, D687, D690, D693).

### Contexte vérifié dans le code front (ne pas re-découvrir)

- `src/lib/api_auth.ts` : `authFetch<T>(endpoint, options)` renvoie `ApiResponse<T>` (`{ data, message, success }`) ; `ApiError { status, message, details? }`, `details` = corps entier de la réponse d'erreur (`code`, `details`, `champs` y sont des clés) ; `status` 0 = hors connexion ou délai dépassé ; les GET sont réessayés (1 s puis 3 s) sur erreur réseau ou 502/503/504, jamais les POST/PATCH ; `authDownload(endpoint)` renvoie `{ blob, filename }`.
- `src/lib/api_ventes.ts` : `CODES_ERREUR_VENTE`, `codeErreurVente`, `lignesErreurVente`, types `Vente`, `VenteResume`, `VentesDuJour`, `CorpsCreationVente` (contrat du lot 8, sans les champs de la caisse).
- `src/lib/api_pharmacie.ts` : `StockMedicament` sans les champs de PB06 et PB08 ; `StockInfo { stocks, alertes: { stockBas, rupture } }`.
- `src/lib/acces.ts` : `CodePermission` (24 codes, miroir de `back_medconnect/src/common/rbac/permissions.constants.ts`), sans les 7 de la tranche.
- `src/lib/api_carnet.ts` : `nouvelleCleIdempotence()` (UUID v4) ; à réutiliser pour tout identifiant client (D688).
- `src/hooks/useToast.tsx` : `messageErreurPour(err, texteParDefaut)` (message de l'`ApiError`, sinon le texte par défaut).
- `src/lib/format_gnf.ts` : `formaterGNF(montant)` (entier, espace insécable, suffixe « GNF »), seul format monétaire autorisé.
- `src/app/dashboard/vente/page.tsx` lignes 46 à 51 : constantes `CARTE`, `CHAMP`, `FOCUS`, `BOUTON_PRIMAIRE`, `BOUTON_ICONE` ; ligne 54 `STATUTS_RESEAU = [0, 502, 503, 504]` ; lignes 364 à 373 : bloc d'erreur rose avec bouton « Réessayer ».
- Back (lecture seule) : règles `back_medconnect/src/pharmacie/domaine/prix.ts` (`calculerLigne`) et `quantites.ts` (`umVersBoites`, `boitesVersUm`), et leurs specs (`prix.spec.ts`, `quantites.spec.ts`) d'où viennent les vecteurs ; contrats `back_medconnect/CLAUDE.md` puces PB05, PB06, PB08, PB10, PB11, PB12.

### 1. `src/lib/acces.ts`

Ajouter à `CodePermission`, après `"vente:annuler"` : `"caisse:utiliser" | "caisse:superviser" | "cloture:gerer" | "inventaire:write" | "reception:write" | "marge:read" | "anomalie:gerer"`. Rien d'autre.

### 2. `src/lib/erreurs_api.ts` (nouveau, D687)

```ts
export interface ChampRefuse { champ: string; contraintes: string[] }
/** Code métier du corps d'erreur (`code`), ou null. */
export function codeErreur(err: unknown): string | null;
/** Tableau `details` du corps d'erreur (codes à lignes), [] sinon ; éléments non objets ignorés. */
export function detailsErreur(err: unknown): Record<string, unknown>[];
/** `champs` d'une erreur VALIDATION, [] sinon ; éléments mal formés ignorés. */
export function champsErreur(err: unknown): ChampRefuse[];
/** Vrai pour une erreur dont l'issue est inconnue : ApiError de statut 0, 502, 503 ou 504. */
export function estErreurReseau(err: unknown): boolean;
/** Vrai pour un 403 (droit manquant ou pharmacie inaccessible). */
export function estRefusDroit(err: unknown): boolean;
```

Règles : uniquement `ApiError` (tout autre objet donne null, [] ou faux) ; `codeErreur` lit `err.details?.code` s'il est une chaîne non vide. `src/lib/api_ventes.ts` garde ses fonctions (non modifiées ici).

Tests `src/lib/erreurs_api.test.ts` (6) :
1. « code lu » : `new ApiError("m", 409, { code: "LOT_REQUIS" })` donne `"LOT_REQUIS"` ; erreur sans code, `Error` simple et `null` donnent `null`.
2. « details » : `details: [{ stockId: "s1" }, 3, null]` donne `[{ stockId: "s1" }]` ; absence donne `[]`.
3. « champs » : `champs: [{ champ: "lignes.0.dateExpiration", contraintes: ["dateValide"] }, { champ: 2 }]` donne le seul premier élément.
4. « réseau » : statuts 0, 502, 503, 504 vrais ; 400, 409, 500 faux ; `Error` faux.
5. « refus de droit » : 403 vrai, 401 et 404 faux.
6. « jamais d'exception » : chacune des cinq fonctions appelée avec `undefined` ne lève rien.

### 3. Types d'API (D686)

`src/lib/api_pharmacie.ts` :
- `export type UniteMinimale = "COMPRIME" | "GELULE" | "ML" | "SACHET" | "GRAMME" | "AMPOULE" | "UNITE";`
- `export interface LotFiche { id: string; numeroLot: string | null; dateExpiration: string | null; quantite: number; lotTechnique: boolean; coutUnitaire?: number | null }` (commentaire : `coutUnitaire` présent seulement avec `marge:read`, tester la présence de la clé, D698).
- `StockMedicament` gagne, tous facultatifs (la recherche publique ne les renvoie pas) : `uniteMinimale?: UniteMinimale; coefficientBoite?: number; prixUnite?: number | null; deconditionnable?: boolean; toleranceInventaire?: number | null; qualifie?: boolean; reliquat?: { lotId: string; unitesRestantes: number }[]; quantiteVendable?: number; lots?: LotFiche[]` ; commentaire sur `quantite` : « unités minimales (comprimés, ml...), peut être négative » ; sur `prixUnitaire` : « prix de la boîte ».
- Rien d'autre dans ce fichier (les routes de stock arrivent en PF02 et PF07).

`src/lib/api_ventes.ts` :
- `export type UniteVente = "BOITE" | "UNITE";` `export type TypePiece = "VENTE" | "ANNULATION" | "REGULARISATION";`
- `CODES_ERREUR_VENTE` : garder les 8 codes actuels, ajouter `"VENTE_UNITE_INTERDITE", "PRIX_UNITE_MANQUANT", "SORTIE_MANUELLE_REQUISE", "MOTIF_REQUIS", "PAIEMENTS_INCOHERENTS", "MODE_PAIEMENT_INCONNU", "POSTE_INCONNU", "SESSION_AUTRE_UTILISATEUR", "STOCK_LOT_NEGATIF", "FICHE_MODIFIEE", "JOURNEE_CLOTUREE", "PIECE_NON_ANNULABLE"` (commentaire : « STOCK_INSUFFISANT, MEDICAMENT_EXPIRE et ANNULATION_HORS_DELAI ne sont plus renvoyés par le serveur (PB11, PB12) ; retirés par PF01b et PF04 »).
- `LigneVenteDemandee` : `{ stockId: string; quantite: number; unite?: UniteVente; sortieManuelle?: { lotId: string; motif: string } }`.
- `export interface PaiementDemande { mode: string; montant: number; reference?: string; montantRecu?: number }` ; `CorpsCreationVente` gagne `paiements?: PaiementDemande[]` (jamais `posteId`, D692).
- `export interface AllocationVente { lotId: string | null; numeroLot: string | null; dateExpiration: string | null; quantite: number; statut: "DEFINITIVE" | "PROVISOIRE" | "REMPLACEE"; sortieManuelle: boolean; motif: string | null; lotTechnique: boolean; coutUnitaire?: number | null }`.
- `LigneVente` gagne `uniteAffichee: UniteVente; nombreAffiche: number; coefficientApplique: number; allocations: AllocationVente[]` (commentaire : `quantite` et `prixUnitaire` en unités minimales, `sousTotal` fait foi).
- `export interface PaiementVente { id: string; mode: string; libelle: string; montant: number; reference: string | null; montantRecu: number | null; rendu: number | null }`.
- `export interface AnnulationPiece { id: string; numero: string; motif: string | null; le: string; par: { id: string; nom: string } }`.
- `Vente` gagne `typePiece: TypePiece; numeroTicket: number | null; jourMetier: string; provisoire: boolean; poste: { id: string; code: string }; session: { id: string; ouverteAutomatiquement: boolean }; paiements: PaiementVente[]; annulation: AnnulationPiece | null; venteOrigine: { id: string; numero: string } | null; motif: string | null`.
- `VenteResume` gagne `typePiece: TypePiece; numeroTicket: number | null; jourMetier: string; venteOrigine: { id: string; numero: string } | null; annulation: { id: string; numero: string } | null` ; commentaire sur `nombreArticles` : « somme des quantités en unités minimales » ; sur `total` : « négatif pour une annulation ».
- `export interface LotErreurVente { lotId: string; numeroLot: string | null; dateExpiration: string | null; quantite: number }` ; `LigneErreurVente` gagne `lots?: LotErreurVente[]` ; `lignesErreurVente` lit en plus `lots` (tableau d'objets à `lotId` chaîne non vide, `quantite` entier, `numeroLot` et `dateExpiration` chaîne ou null ; éléments invalides ignorés).
- Les fonctions `creerVente`, `listerVentes`, `getVente`, `annulerVente` ne changent pas de signature.

`src/lib/api_caisse.ts` (nouveau ; PF03, PF04 et PF05 y ajouteront leurs routes) :
```ts
export interface ModePaiement { code: string; libelle: string; comptagePhysique: boolean; referenceAutorisee: boolean; ordre: number }
export interface Coupure { devise: string; valeurFaciale: number; type: string; ordre: number }
export interface ParametresPharmacie { horizonsPeremptionJours: number[]; seuilEcartCaisse: number; seuilAvertissementPrixPct: number; seuilStockBas: number; taillePlageTickets: number; seuilRechargementPlagePct: number; debutCaisse: string }
export interface Referentiels { modesPaiement: ModePaiement[]; coupures: Coupure[]; parametres: ParametresPharmacie }
export interface Poste { id: string; code: string; libelle: string; type: "WEB" | "DESKTOP"; cree?: boolean }
export interface ComptageCaisse { id: string; moment: "OUVERTURE" | "FERMETURE"; totalEspeces: number; coupures: { valeurFaciale: number; nombre: number }[]; releves: { mode: string; libelle: string; montant: number }[]; auteurId: string; createdAt: string }
export interface SessionCaisse { id: string; poste: { id: string; code: string; libelle: string; type: "WEB" | "DESKTOP" }; utilisateurId: string; utilisateurNom: string; statut: "OUVERTE" | "FERMEE" | "INCLUSE_DANS_CLOTURE"; jourMetier: string; ouverteLe: string; fermeeLe: string | null; commentaireEcart: string | null; fondCaisse: number; fondCompte: boolean; comptageOuverture: ComptageCaisse | null; comptageFermeture: ComptageCaisse | null }
export function getReferentiels(structureId: string): Promise<ApiResponse<Referentiels>>;   // GET /pharmacie/:id/referentiels
/** Poste web par défaut de l'utilisateur, le même que celui de la vente (D692). */
export function assurerPosteWeb(structureId: string, utilisateurId: string): Promise<ApiResponse<Poste>>; // POST /pharmacie/:id/postes { type: "WEB", appareilId: `web-defaut:${utilisateurId}` }
export function getSessionCourante(structureId: string, posteId: string): Promise<ApiResponse<SessionCaisse | null>>; // GET /pharmacie/:id/caisse/sessions/courante?posteId=
```
Identifiants dans l'URL passés par `encodeURIComponent`, comme `api_ventes.ts`. Commentaire en tête : « Caisse d'une pharmacie. Contrat aligné sur back_medconnect (orch/pharmacie-t1-back, CLAUDE.md puces PB05 et PB10). »

Tests `src/lib/api_caisse.test.ts` (3), `authFetch` simulé par `vi.mock("./api_auth")` comme `src/lib/api_ventes.test.ts` : 1. `getReferentiels("s 1")` appelle `/pharmacie/s%201/referentiels` ; 2. `assurerPosteWeb("s1", "u1")` envoie `POST /pharmacie/s1/postes` au corps exact `{"type":"WEB","appareilId":"web-defaut:u1"}` ; 3. `getSessionCourante("s1", "p1")` appelle `/pharmacie/s1/caisse/sessions/courante?posteId=p1`.

Tests ajoutés à `src/lib/api_ventes.test.ts` (2) : 1. `lignesErreurVente` d'un 409 `SORTIE_MANUELLE_REQUISE` à `details: [{ stockId: "s1", nom: "Doliprane", lots: [{ lotId: "l1", numeroLot: "DL23K052", dateExpiration: "2026-10-01", quantite: 6 }, { lotId: "" }] }]` renvoie la ligne avec un seul lot ; 2. `codeErreurVente` reconnaît `"PAIEMENTS_INCOHERENTS"`.

### 4. Règles pures de la caisse (D690)

Dossier `src/lib/caisse/regles/`, aucun import de React, de Next ni de `api_auth`.

`quantites.ts` : portage exact de `umVersBoites(um, coefficient)` (`{ boites, unites }`, division entière, valeur négative : `boites` et `unites` négatifs ou nuls selon le back, recopier sa règle) et `boitesVersUm(boites, coefficient)` du back. Plus :
```ts
export const LIBELLES_UNITE_MINIMALE: Record<UniteMinimale, { singulier: string; pluriel: string }>;
// COMPRIME comprimé/comprimés, GELULE gélule/gélules, ML ml/ml, SACHET sachet/sachets, GRAMME gramme/grammes, AMPOULE ampoule/ampoules, UNITE unité/unités
/** Quantité lisible : « 12 boîtes », « 2 boîtes et 6 comprimés », « 6 comprimés », « 1 boîte », « 0 boîte », « -3 comprimés » (négatif : en unités seulement). */
export function formaterQuantite(um: number, coefficient: number, unite: UniteMinimale): string;
```
Règles de `formaterQuantite` : coefficient 1 : « N boîte(s) » (singulier pour 0 et 1) ; coefficient supérieur à 1 et `um` positif : boîtes puis « et N <unité> » si reste non nul, ou seulement les unités si moins d'une boîte ; `um` négatif : « -N <unité> » (coefficient 1 : « -N boîte(s) ») ; nombres formatés par `toLocaleString("fr-FR")`.

`prix.ts` : portage exact de `calculerLigne(entree)` du back (mêmes types `EntreeLigne`, `ResultatLigne`, mêmes refus `VENTE_UNITE_INTERDITE`, `PRIX_UNITE_MANQUANT`, `PRIX_MANQUANT`, même arrondi) ; commentaire « estimation affichée au comptoir : le serveur recalcule et fait foi ». `exigerEntier` du back devient un refus silencieux : une entrée non entière renvoie `{ ok: false, code: "PRIX_MANQUANT" }` (jamais d'exception dans l'interface).

Tests (vecteurs recopiés des specs du back, valeurs identiques ; citer en commentaire le fichier et le nom du test d'origine) :
- `src/lib/caisse/regles/quantites.test.ts` (5) : 1. CA2 : 20 boîtes de coefficient 1 ; 2. 245 comprimés en boîtes de 20 donnent 12 boîtes et 5 ; 3. `formaterQuantite(26, 20, "COMPRIME")` = « 1 boîte et 6 comprimés » ; `formaterQuantite(6, 20, "COMPRIME")` = « 6 comprimés » ; `formaterQuantite(40, 20, "COMPRIME")` = « 2 boîtes » ; 4. `formaterQuantite(-1, 1, "UNITE")` = « -1 boîte » et `formaterQuantite(-3, 20, "COMPRIME")` = « -3 comprimés » ; 5. `formaterQuantite(1200, 1, "UNITE")` contient « 1 » puis une espace insécable ou fine puis « 200 » (séparateur de `toLocaleString("fr-FR")`).
- `src/lib/caisse/regles/prix.test.ts` (5) : 1. CA1 : 6 unités à 600 = 3 600 ; 2. CA2 : 20 boîtes à 500 = 10 000 ; 3. unité sur fiche non déconditionnable : `VENTE_UNITE_INTERDITE` ; 4. unité sans prix unité : `PRIX_UNITE_MANQUANT` ; boîte sans prix : `PRIX_MANQUANT` ; 5. nombre 1,5 : refus `PRIX_MANQUANT`, aucune exception.

### 5. Source de la caisse (D690)

`src/lib/caisse/source.ts` :
```ts
export interface EtatCaisse { poste: Poste; session: SessionCaisse | null }
/** Accès de l'écran de vente aux données : en ligne ici, desktop hors ligne en PD04. */
export interface SourceCaisse {
  chargerStock(structureId: string): Promise<StockMedicament[]>;
  chargerReferentiels(structureId: string): Promise<Referentiels>;
  etatCaisse(structureId: string, utilisateurId: string): Promise<EtatCaisse>;
  creerVente(structureId: string, corps: CorpsCreationVente, cleIdempotence: string): Promise<Vente>;
}
```
`src/lib/caisse/source_en_ligne.ts` : `export const sourceEnLigne: SourceCaisse` qui appelle `getMyStock` (renvoie `res.data.stocks`), `getReferentiels`, `assurerPosteWeb` puis `getSessionCourante` (avec `poste.id`), `creerVente` (`res.data`). Les erreurs remontent telles quelles (aucun `catch`). Le contrat IPC du desktop n'est pas écrit ici (PD04, D690).

Test `src/lib/caisse/source_en_ligne.test.ts` (2) : 1. `etatCaisse("s1", "u1")` appelle `assurerPosteWeb("s1", "u1")` puis `getSessionCourante("s1", <id du poste>)` et renvoie `{ poste, session }` ; 2. une `ApiError` 0 de `getMyStock` remonte telle quelle.

### 6. Éléments visuels partagés (D693)

`src/components/pharmacie/classes.ts` (nouveau) : exporter `CARTE`, `CHAMP`, `FOCUS`, `BOUTON_PRIMAIRE`, `BOUTON_ICONE` **copiés caractère pour caractère** de `src/app/dashboard/vente/page.tsx` (lignes 46 à 51), plus :
- `BOUTON_SECONDAIRE` = `` `px-4 py-3 rounded-2xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors ${FOCUS}` `` (bouton « Nouvelle vente » de l'écran de succès, ligne 335) ;
- `ALERTE_ERREUR` = `"flex items-center gap-3 p-4 rounded-2xl bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 text-sm"` (ligne 366) ;
- `ALERTE_ATTENTION` = même chaîne avec `amber` au lieu de `rose` ; `ALERTE_INFO` = même chaîne avec `primary` au lieu de `rose` ; `ALERTE_SUCCES` = même chaîne avec `emerald`.
- `POLICE_TITRE` = `{ fontFamily: "var(--font-outfit, var(--font-inter))" } as const`.
La page de vente n'est **pas** modifiée ici (elle importera ces constantes en PF01b).

`src/components/pharmacie/ErreurAvecReessai.tsx` (nouveau) : `export function ErreurAvecReessai({ message, onReessayer, libelleBouton = "Réessayer" }: { message: string; onReessayer?: () => void; libelleBouton?: string })` : un `div role="alert"` aux classes `ALERTE_ERREUR` avec l'icône `AlertCircle` (lucide, `aria-hidden`) et le message, puis, si `onReessayer`, un bouton `BOUTON_PRIMAIRE` + ` mt-4` au libellé donné ; rendu identique au bloc des lignes 362 à 374 de la page de vente.

Test `src/components/pharmacie/ErreurAvecReessai.test.tsx` (2) : 1. message affiché dans un `role="alert"`, clic sur « Réessayer » appelle `onReessayer` une fois ; 2. sans `onReessayer`, aucun bouton.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactor, helper ou abstraction non demandés (D693 est la seule extraction autorisée ici). Réutiliser l'existant (`authFetch`, `ApiError`, `nouvelleCleIdempotence`, `formaterGNF`). Aucun `fetch()` brut. Commentaires en français. Écrire uniquement avec Write et Edit, jamais par redirection shell ni script. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/` (ni du front, ni du back). Ne pas commiter. Aucun tiret cadratin (U+2014) ni demi-cadratin (U+2013). Pas de `@testing-library/user-event` (absent, ne pas l'ajouter) : tests en `render`, `screen`, `fireEvent`, `waitFor` et `vi.mock`, comme `src/app/dashboard/stock/page.test.tsx`.

Fichiers autorisés (et seulement eux) : `src/lib/acces.ts`, `src/lib/erreurs_api.ts`, `src/lib/erreurs_api.test.ts`, `src/lib/api_pharmacie.ts`, `src/lib/api_ventes.ts`, `src/lib/api_ventes.test.ts`, `src/lib/api_caisse.ts`, `src/lib/api_caisse.test.ts`, `src/lib/caisse/regles/quantites.ts`, `src/lib/caisse/regles/quantites.test.ts`, `src/lib/caisse/regles/prix.ts`, `src/lib/caisse/regles/prix.test.ts`, `src/lib/caisse/source.ts`, `src/lib/caisse/source_en_ligne.ts`, `src/lib/caisse/source_en_ligne.test.ts`, `src/components/pharmacie/classes.ts`, `src/components/pharmacie/ErreurAvecReessai.tsx`, `src/components/pharmacie/ErreurAvecReessai.test.tsx`.

## Test à la main

Aucun écran. Le vérificateur se contente de la gate.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` (ou, depuis la racine, `docker compose exec -T frontend npx tsc --noEmit` si le conteneur tourne) : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur.
3. `npm test` : tout vert, dont `erreurs_api.test.ts` (6), `api_caisse.test.ts` (3), `api_ventes.test.ts` (2 de plus), `quantites.test.ts` (5), `prix.test.ts` (5), `source_en_ligne.test.ts` (2), `ErreurAvecReessai.test.tsx` (2) ; aucun test existant modifié ou supprimé.
4. `npm run build` (toujours en local, jamais dans le conteneur) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés ; `git diff --stat -- src/app` vide.
6. `grep -rn "fetch(" src/lib/caisse src/lib/api_caisse.ts src/lib/erreurs_api.ts` : aucune ligne.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-11-01 | spécifié (codeur Sonnet) | FAIL au contrôle | `numeroTicket` typé `string | null` (erreur de la fiche) alors que le back renvoie un entier (rapports/PF01a-verification.md)
2026-11-01 | chef Opus | corrigé et validé | `numeroTicket: number | null` dans `Vente` et `VenteResume`, JSDoc de `LigneErreurVente` remis en place, fiche corrigée ; champs facultatifs acceptés, rendus obligatoires en PF04 (D705)

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
`docker compose exec -T frontend npx tsc --noEmit` ; `npx eslint` des fichiers touchés ; `docker compose exec -T frontend npx vitest run` ; `npm run build` (local) | tsc 0 erreur, eslint 0, vitest 59 fichiers 479 tests verts (454 avant), build réussi | front 3bd8abe
