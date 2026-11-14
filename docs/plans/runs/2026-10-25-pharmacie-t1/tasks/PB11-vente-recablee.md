# PB11 - Vente recâblée sur lots, prix et caisse

Tier: dur (codeur Sonnet selon l'arbitrage A2 ; fiche très détaillée, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages d'erreur lus par les pharmaciens au comptoir, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Cinquième pas du jalon J2 (PB07 à PB13, indissociables, D445). Depuis PB07 le compteur `StockMedicament.quantite` est gelé et depuis PB09 la création de vente échoue en base (D505, D524). Cette tâche réécrit `VenteService.creerVente` sur le journal de stock, les lots et la caisse :

- vente à la boîte ou à l'unité, deux prix lus de la fiche (jamais du client), refus de l'unité sur une fiche non déconditionnable ;
- allocations reliquat puis FEFO par les règles pures de PB04, allocation provisoire et anomalie `STOCK_NEGATIF` sans jamais bloquer, 409 `SORTIE_MANUELLE_REQUISE` quand il ne reste que du périmé, sortie manuelle motivée ;
- ordonnance toujours exigée ;
- session de caisse ouverte automatiquement, paiements multiples (espèces par défaut) ;
- numéro pris sur `CompteurTicket`, clé d'idempotence permanente ;
- réponse compatible enrichie, coûts masqués sans `marge:read`, alerte de stock bas sur le stock calculé.

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate`.** Ne pas toucher à la logique d'annulation (`annulerVente` : PB12 la réécrit ; seuls ses `include` et sa sortie changent, section 6.6), ni à `listerVentes` (filtre par jour métier : PB12), ni au domaine pur `src/pharmacie/domaine/` (PB04), ni aux instantanés `test/db/instantanes/`, ni aux migrations. Jamais `prisma migrate dev`, `migrate reset` ni `db push`.

Décisions qui encadrent la tâche (lire par grep dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D404, D409, D414, D415, D419 à D425, D428, D429, D435, D462, D466, D469 à D473, D476, D481, D482, D500, D507, D508, D510, D511, D519, D520, D524, D525, D527, D532, et surtout **D534 à D543** (écrites avec cette fiche, elles priment sur le plan en cas d'écart). `CORRECTIONS-PORTEUR.md` prime sur tout : seuil de stock bas en boîtes (A4), coupures de 20 000 à 500 GNF (aucun impact ici).

### Contexte vérifié (ne pas re-découvrir)

- Schéma en place (M6, `prisma/schema.prisma`) :
  - `Vente { id, structureId, pointDeVenteId, posteId, sessionCaisseId (non nuls), typePiece TypePieceVente (VENTE par défaut), venteOrigineId? @unique, numero, numeroTicket Int?, jourMetier @db.Date, jourMetierOrigine?, horodatageLocal?, sequencePoste?, vendeurId, vendeurNom, clientNom?, clientTelephone?, ordonnanceVerifiee, total, statut (VALIDEE par défaut, gelé), annuleeLe?, annuleeParId?, motifAnnulation?, cleIdempotence?, createdAt }`, relations `lignes`, `paiements`, `poste`, `sessionCaisse`, `pointDeVente`. Uniques : `(structureId, numero)`, `(structureId, cleIdempotence)`, `(pointDeVenteId, numeroTicket)`. Trigger `vente_verifier_rattachement` (BEFORE INSERT) : le PV appartient à la pharmacie, la session à ce PV et à ce poste. Vente et lignes immuables (trigger).
  - `LigneVente { id, venteId, medicamentId, stockMedicamentId, nomMedicament, prixUnitaire (prix appliqué par UM), quantite (UM), sousTotal (montant de ligne), uniteAffichee UniteVente (BOITE | UNITE), nombreAffiche, coefficientApplique }`, relation `allocations`. CHECK : `quantite = nombreAffiche x coefficientApplique`, UNITE implique coefficient 1, coefficient >= 1.
  - `AllocationLot { id, ligneVenteId, lotId? (copie sans FK), numeroLot?, dateExpiration? @db.Date, quantite (<> 0), coutUnitaire (>= 0), lotTechnique, statut StatutAllocation (DEFINITIVE | PROVISOIRE | REMPLACEE), remplaceeParPieceId?, sortieManuelle, motif?, auteurId?, createdAt }`. CHECK : lot si et seulement si DEFINITIVE ; motif non vide si `sortieManuelle`.
  - `Paiement { id, venteId, sessionCaisseId, modePaiementId, montant (<> 0), referenceExterne?, montantRecu? (>= 0), createdAt }`, immuable.
  - `CompteurTicket { pointDeVenteId @id, prochainNumero Int @default(1) }` : aucun trigger.
  - `ModePaiement { id, code @unique, libelle, comptagePhysique, referenceAutorisee, ordre, actif }` : `ESPECES` (physique, sans référence, ordre 1), `ORANGE_MONEY` (2), `MTN_MOMO` (3), les deux derniers avec référence autorisée.
  - `Anomalie { id, pointDeVenteId, type TypeAnomalie (dont STOCK_NEGATIF), statut (OUVERTE par défaut), attribueeAId?, pieceType String, pieceId?, details Json, creeLe }`.
  - `ParametresPharmacie.seuilStockBas` (boîtes, défaut 10), clé `structureId`.
  - `StockMedicament { id, medicamentId, structureId, prixUnitaire (prix boîte), prixUnite?, coefficientBoite, deconditionnable, archiveLe?, quantite et disponible gelés (trigger : ne jamais les écrire), ... }`, relation `medicament { id, nom, ordonnanceRequise }`.
  - `PointDeVente { id, structureId, ordre, nom }`, `Poste { id, pointDeVenteId, code, libelle, type, appareilId?, actif }`.
- Domaine pur (PB04, ne pas modifier) :
  - `src/pharmacie/domaine/prix.ts` : `type UniteVente = 'BOITE' | 'UNITE'` ; `calculerLigne({ unite, nombre, coefficientBoite, prixBoite, prixUnite, deconditionnable })` renvoie `{ ok: true, uniteAffichee, nombreAffiche, coefficientApplique, quantiteUm, prixAppliqueParUm, montantLigne }` ou `{ ok: false, code: 'VENTE_UNITE_INTERDITE' | 'PRIX_UNITE_MANQUANT' | 'PRIX_MANQUANT' }` (ordre D471, prix nul ou 0 = manquant).
  - `src/pharmacie/domaine/selection-lots.ts` : `LotCandidat { id, numeroLot, dateExpiration: 'AAAA-MM-JJ' | null, dateReception: ISO, solde, coefficientReception, coutUnitaire, lotTechnique }` ; `selectionnerLots({ jour, unite, quantiteUm, lots })` renvoie `{ allocations: [{ lotId, numeroLot, dateExpiration, quantite, coutUnitaire, lotTechnique }], resteProvisoire, lotsPerimesDisponibles: [{ lotId, numeroLot, dateExpiration, quantite }] }` (périmés jamais pris ; `lotsPerimesDisponibles` rempli seulement si reste positif) ; `estPerime(date, jour)`.
  - `src/pharmacie/domaine/quantites.ts` : `etatStock(quantiteUm, coefficientBoite, seuilBoites): 'RUPTURE' | 'BAS' | 'NORMAL'`.
  - `src/pharmacie/domaine/caisse.ts` : `CODE_ESPECES = 'ESPECES'`.
- `MouvementsStockService` (`src/pharmacie/stock/mouvements-stock.service.ts`, sans dépendance, chaque méthode reçoit la transaction) : `verrouillerFiches(tx, ids)` (verrous consultatifs triés) ; `ecrire(tx, { evenementId?, pointDeVenteId, stockMedicamentId, lotId | null, type, quantite (signée), pieceOrigineType, pieceOrigineId?, motif?, auteurId?, horodatageLocal?, posteId?, sequencePoste? })` renvoie `{ mouvement, soldeLot, soldeProduit }` et maintient `ConditionnementOuvert` (ouverture quand le reliquat devient non nul, attribuée à `auteurId` et `pieceOrigineId`) ; un mouvement sans lot n'est permis que pour les pièces `VENTE`, `ANNULATION`, `RESOLUTION`. Exporte `MESSAGE_STOCK_LOT_INSUFFISANT` (« Ce lot n'a pas assez de stock pour cette sortie. »). `creerLot(tx, NouveauLot)` crée un lot et son mouvement RECEPTION (tests).
- `src/pharmacie/stock/lecture-stock.ts` : `dateVersJour(date)`, `jourVersDate(jour)`, `versCandidat(lotLu)` (non exporté, à réutiliser), `lireEtatsStock(client, ids, jour)` (`reliquat [{ lotId, unitesRestantes }]` pour les tests).
- `SessionsCaisseService.ouvrirDansTransaction(tx, { structureId, userId, utilisateurNom, posteId, sessionId?, comptage? })` renvoie `{ session: SessionReponse, ouverteMaintenant }` : verrou de ligne du poste ; 409 `POSTE_INCONNU` (poste absent, technique, d'une autre pharmacie, inactif) ; 409 `SESSION_AUTRE_UTILISATEUR` (session ouverte d'un collègue) ; renvoie la session OUVERTE de l'utilisateur ou en crée une (`jourMetier` = jour de Conakry). `SessionReponse.poste.code` donne le code du poste. Exporte `messageModeInconnu(code)` (« Le mode de paiement X n'existe pas ou n'est plus accepté. »). `src/pharmacie/caisse/sessions-caisse.service.ts` importe aujourd'hui `jourConakry` depuis `../vente.service` (voir section 1).
- `PointsDeVenteService.enregistrerPoste` (`src/pharmacie/points-de-vente.service.ts`) : verrou `FOR UPDATE` du PV, poste existant par `(pointDeVenteId, appareilId)` (409 `POSTE_TYPE_DIFFERENT` si l'autre type), sinon code `W<n>`/`D<n>`, libellé `libelleParDefaut(type, code, prenom)` (fonction locale du fichier), création et audit `create` `Poste` `{ code, type }`. Ce fichier importe `jourConakry` depuis `./vente.service`.
- `assurerPointDeVente(tx, { id, nom })` (`src/pharmacie/point-de-vente.ts`) : ne l'appeler que si le PV manque (D507).
- `AccesPharmacieService.verifier(structureId, userId)` renvoie `{ user: { id, nom, prenom, structureId }, structure: { id, nom, type, adminId, isActive, adresse, ville, telephone, logoFile } }`.
- `PermissionsService.getUserPermissions(userId): Promise<string[]>` (module global) ; `PERMISSIONS.MARGE_READ` (`'marge:read'`), `PERMISSIONS.CAISSE_UTILISER`, `PERMISSIONS.VENTE_WRITE`.
- `masquerCouts(donnees, peutVoirMarge)` et `cheminsCout(donnees)` (`src/pharmacie/masquer-couts.ts`, D466) : toute clé qui contient « cout » ou « marge » est retirée sans `marge:read`. Aucune autre clé de cette tâche ne doit contenir ces mots.
- `MESSAGE_LOT_INTROUVABLE` (« Ce lot est introuvable pour ce médicament. ») est exporté par `src/pharmacie/pharmacie.service.ts`, qui importe `jourConakry` depuis `./vente.service` (voir section 1).
- `lireCleIdempotence`, `estConflitCleIdempotence` (`src/carnet-sante/sos-idempotence.ts`) restent utilisés ; `SOS_IDEMPOTENCE_HEURES` ne l'est plus par la vente.
- Filtre d'erreurs `src/common/filters/all-exceptions.filter.ts` : `CODES_AVEC_DETAILS` et `assainirDetails` (recopie `stockId`, `nom`, `disponible`, `demande`, 50 lignes au plus). Catalogue `src/common/filters/codes-erreur.ts`.
- Jeu de test `chargerFormatActuel` : `str-pharma-1` (administratrice `usr-admin-p1` Fatoumata Camara, `adminId` de la pharmacie ; pharmacien `usr-pharm-p1` Mamadou Diallo), `str-pharma-2` (`usr-admin-p2`, `usr-pharm-p2`), fiches `stk-01` à `stk-20` sur `str-pharma-1` (médicaments `med-01` à `med-20`), ventes historiques `vte-p1-1` etc. M2 a créé un PV d'ordre 1 et un `CompteurTicket` par pharmacie. Modèles : `test/db/sessions-caisse.db-spec.ts` (`refus`, `sql`, `compter`, construction des services), `test/db/mouvements-stock.db-spec.ts` (`creerLot` en transaction, insertion SQL d'un `Medicament` et d'une `StockMedicament`).

### 1. Rupture des imports circulaires (`src/pharmacie/jour-metier.ts`, nouveau)

`vente.service.ts` va importer `sessions-caisse.service.ts`, `points-de-vente.service.ts` et `pharmacie.service.ts`, qui importent tous `jourConakry` de `vente.service.ts` : cycle, et Nest injecte alors `undefined` (D534).

1. Créer `src/pharmacie/jour-metier.ts` qui contient, déplacées telles quelles depuis `vente.service.ts` (mêmes commentaires) : `export function jourConakry(d: Date): string` et `export function bornesDuJour(jour: string): { debut: Date; fin: Date }`.
2. Dans `vente.service.ts`, supprimer ces deux définitions, les importer de `./jour-metier` pour l'usage interne et les réexporter : `export { bornesDuJour, jourConakry } from './jour-metier';` (les tests qui les importent de `vente.service` restent valables).
3. Remplacer la seule ligne d'import de `jourConakry` dans `src/pharmacie/caisse/sessions-caisse.service.ts` (`'../jour-metier'`), `src/pharmacie/points-de-vente.service.ts` (`'./jour-metier'`) et `src/pharmacie/pharmacie.service.ts` (`'./jour-metier'`). Rien d'autre ne change dans ces fichiers à cette étape.

### 2. Codes d'erreur et filtre

#### 2.1 `src/common/filters/codes-erreur.ts`

- Remplacer le commentaire de `'STOCK_INSUFFISANT'` par `// Ancien refus de vente faute de stock (409) : plus jamais renvoyé depuis PB11, conservé (code stable).` et celui de `'MEDICAMENT_EXPIRE'` par `// Ancien refus de vente d'un médicament périmé (400) : plus jamais renvoyé depuis PB11 (remplacé par SORTIE_MANUELLE_REQUISE), conservé (code stable).`
- Ajouter à la fin, avant `] as const;`, dans cet ordre :

```ts
  // Vente à l'unité d'un médicament qui se vend uniquement à la boîte (400), lignes dans `details`.
  'VENTE_UNITE_INTERDITE',
  // Vente à l'unité d'un médicament sans prix à l'unité (400), lignes dans `details`.
  'PRIX_UNITE_MANQUANT',
  // Il ne reste que des lots périmés pour couvrir la vente : choisir un lot et un motif (409), lignes et lots dans `details`.
  'SORTIE_MANUELLE_REQUISE',
  // Somme des paiements différente du montant de la vente (400).
  'PAIEMENTS_INCOHERENTS',
```

#### 2.2 `src/common/filters/all-exceptions.filter.ts`

- Ajouter à `CODES_AVEC_DETAILS` : `'VENTE_UNITE_INTERDITE'`, `'PRIX_UNITE_MANQUANT'`, `'SORTIE_MANUELLE_REQUISE'` (laisser les cinq existants).
- `assainirDetails` : type de retour `Record<string, string | number | LotDetail[]>[]` avec, au niveau du module :

```ts
interface LotDetail {
  lotId: string;
  numeroLot: string | null;
  dateExpiration: string;
  quantite: number;
}
```

  Après les quatre champs actuels, si `Array.isArray(source.lots)` : `ligne.lots` = les 50 premiers éléments objets dont `lotId` est une chaîne, `dateExpiration` une chaîne et `quantite` un nombre, réduits à `{ lotId, numeroLot: typeof numeroLot === 'string' ? numeroLot : null, dateExpiration, quantite }` ; toute autre clé est ignorée. Absent ou non tableau : pas de clé `lots`.

### 3. Règles pures d'assemblage (`src/pharmacie/vente-regles.ts`, nouveau)

Sans import de Nest, de Prisma, ni de fichier hors `src/pharmacie/domaine/` ; pas d'horloge. Entrée impossible : `RangeError` en français (le service filtre avant).

```ts
import type { UniteVente } from './domaine/prix';
import { etatStock } from './domaine/quantites';
import {
  selectionnerLots,
  type AllocationCalculee,
  type LotCandidat,
  type LotPerimeDisponible,
} from './domaine/selection-lots';
import { CODE_ESPECES } from './domaine/caisse';

/** Numéro lisible d'un ticket : T<ordre du PV>-<numéro sur 7 chiffres au moins> (D423, D539). */
export function formaterNumeroTicket(ordre: number, numero: number): string;
// `T${ordre}-${String(numero).padStart(7, '0')}` ; RangeError si ordre ou numero n'est pas un entier >= 1.

/** Clé d'unicité d'une ligne du corps : une fiche au plus une fois par unité (D414) ; unité absente = BOITE (D415). */
export function cleLigneVente(stockId: string, unite?: UniteVente): string;
// `${stockId}|${unite ?? 'BOITE'}`

export interface LigneAAllouer {
  /** Position de la ligne dans le corps. */
  index: number;
  stockMedicamentId: string;
  unite: UniteVente;
  quantiteUm: number;
  /** Motif déjà nettoyé (3 à 300 caractères) par le service. */
  sortieManuelle: { lotId: string; motif: string } | null;
}

export interface AllocationPrevue extends AllocationCalculee {
  sortieManuelle: boolean;
  motif: string | null;
}

export interface LigneAllouee {
  index: number;
  allocations: AllocationPrevue[];
  resteProvisoire: number;
  /** Vide si la ligne porte une sortie manuelle ou si tout est couvert. */
  lotsPerimesDisponibles: LotPerimeDisponible[];
  /** Unités minimales non périmées prises automatiquement ou manuellement. */
  quantiteAllouee: number;
}

/** Allocation de toutes les lignes, dans l'ordre reçu, soldes décrémentés en mémoire (D537). */
export function allouerLignes(
  jour: string,
  lignes: readonly LigneAAllouer[],
  lotsParFiche: ReadonlyMap<string, readonly LotCandidat[]>,
): LigneAllouee[];
```

Algorithme de `allouerLignes` (ne pas en dévier) :
1. `soldes = new Map<lotId, number>()` initialisée avec le `solde` de chaque lot de chaque fiche.
2. Pour chaque ligne dans l'ordre : `lots = lotsParFiche.get(stockMedicamentId) ?? []` recopiés avec `solde = soldes.get(id)`.
3. `reste = quantiteUm`, `allocations = []`. Si `sortieManuelle` : chercher le lot `lotId` dans `lots` ; absent : `RangeError('Lot de sortie manuelle absent des lots de la fiche : <lotId>.')` ; `prise = Math.min(solde, reste)` ; si `prise > 0`, pousser `{ lotId, numeroLot, dateExpiration, quantite: prise, coutUnitaire, lotTechnique, sortieManuelle: true, motif }`, décrémenter `soldes` et `reste`.
4. Si `reste > 0` : `r = selectionnerLots({ jour, unite, quantiteUm: reste, lots: <lots avec soldes à jour> })` ; pousser chaque allocation de `r` avec `sortieManuelle: false, motif: null` et décrémenter `soldes` ; `resteProvisoire = r.resteProvisoire` ; `lotsPerimesDisponibles = sortieManuelle ? [] : r.lotsPerimesDisponibles`. Sinon `resteProvisoire = 0`, `lotsPerimesDisponibles = []`.
5. `quantiteAllouee` = somme des quantités poussées.

```ts
export interface ModeConnu {
  id: string;
  code: string;
  libelle: string;
  comptagePhysique: boolean;
  referenceAutorisee: boolean;
  ordre: number;
}

export interface PaiementDemande {
  mode: string;
  montant: number;
  reference?: string;
  montantRecu?: number;
}

export interface PaiementPrevu {
  modePaiementId: string;
  code: string;
  montant: number;
  referenceExterne: string | null;
  montantRecu: number | null;
}

export type ResultatPaiements =
  | { ok: true; paiements: PaiementPrevu[] }
  | { ok: false; code: 'MODE_PAIEMENT_INCONNU'; mode: string }
  | { ok: false; code: 'MODE_EN_DOUBLE' }
  | { ok: false; code: 'MONTANT_RECU_INSUFFISANT' }
  | { ok: false; code: 'PAIEMENTS_INCOHERENTS'; somme: number };

/** Paiements d'une vente (D538). `modes` = modes ACTIFS seulement. */
export function preparerPaiements(
  total: number,
  demandes: readonly PaiementDemande[] | undefined,
  modes: readonly ModeConnu[],
): ResultatPaiements;
```

Règles de `preparerPaiements`, dans cet ordre :
1. `demandes` absent : `demandes = [{ mode: CODE_ESPECES, montant: total }]`.
2. Pour chaque demande dans l'ordre : mode absent de `modes` (comparaison exacte du code) : `{ ok: false, code: 'MODE_PAIEMENT_INCONNU', mode }` (premier fautif).
3. Un code présent deux fois : `{ ok: false, code: 'MODE_EN_DOUBLE' }`.
4. Mode `comptagePhysique` avec `montantRecu` défini et `< montant` : `MONTANT_RECU_INSUFFISANT`.
5. Somme des montants différente de `total` : `{ ok: false, code: 'PAIEMENTS_INCOHERENTS', somme }`.
6. Sinon `ok` ; chaque `PaiementPrevu` : `referenceExterne` = référence nettoyée (`trim`) si le mode a `referenceAutorisee` et qu'elle est non vide, sinon `null` ; `montantRecu` = la valeur si le mode a `comptagePhysique`, sinon `null`. Ordre de sortie : ordre reçu.

```ts
export interface FicheVendue {
  nom: string;
  coefficientBoite: number;
  /** Agrégat produit du PV avant et après la vente, en UM. */
  avant: number;
  apres: number;
}

/** Fiches passées de NORMAL à BAS ou RUPTURE par la vente (D541). */
export function passagesStockBas(
  fiches: readonly FicheVendue[],
  seuilBoites: number,
): { nom: string; apres: number }[];
// garde une fiche si etatStock(avant, coef, seuil) === 'NORMAL' && etatStock(apres, coef, seuil) !== 'NORMAL'
```

### 4. Lecture des lots candidats (`src/pharmacie/stock/lecture-stock.ts`)

Ajouter, sans toucher au reste :

```ts
/**
 * Lots à solde positif des fiches demandées, au point de vente donné, en
 * candidats de sélection (une entrée par identifiant, éventuellement vide).
 * À appeler sous les verrous des fiches (D507).
 */
export async function lireLotsCandidats(
  client: Pick<Prisma.TransactionClient, 'lotStock'>,
  pointDeVenteId: string,
  stockMedicamentIds: readonly string[],
): Promise<Map<string, LotCandidat[]>>;
```

Requête : `lotStock.findMany({ where: { pointDeVenteId, stockMedicamentId: { in: ids }, agregat: { is: { quantite: { gt: 0 } } } }, select: { id, stockMedicamentId, numeroLot, dateExpiration, dateReception, coefficientReception, coutUnitaire, lotTechnique, agregat: { select: { quantite: true } } } })`, conversion par `versCandidat` (solde = `agregat.quantite`). Liste vide d'identifiants : aucune requête, `Map` vide.

### 5. Création de poste extraite (`src/pharmacie/points-de-vente.service.ts`)

Extraire le corps de la transaction de `enregistrerPoste` (à partir du verrou du PV inclus) en fonction exportée au niveau du module, placée juste après `libelleParDefaut` :

```ts
/**
 * Poste d'un appareil dans un point de vente : renvoyé s'il existe (même type),
 * sinon créé et audité ; verrou du PV (D482). Utilisé par l'enregistrement d'un
 * poste et par la vente sans poste (D536).
 */
export async function assurerPoste(
  tx: Prisma.TransactionClient,
  entree: {
    pointDeVenteId: string;
    type: TypePosteEnregistrable;
    appareilId: string;
    libelle?: string;
    user: { id: string; prenom: string };
    ip?: string | null;
  },
): Promise<{ poste: Poste; cree: boolean }>;
```

`enregistrerPoste` garde sa résolution du PV (`findFirst` puis `assurerPointDeVente`) puis appelle `assurerPoste(tx, { pointDeVenteId: pointDeVente.id, type: dto.type, appareilId: dto.appareilId, libelle: dto.libelle, user, ip })`. Comportement, messages et audit strictement identiques (les tests existants de PB05 et PB10 restent verts sans modification). `Poste` est importé en type depuis `generated/prisma/client`.

### 6. Service (`src/pharmacie/vente.service.ts`)

#### 6.1 Imports, constantes, constructeur

- Supprimer l'import de `SOS_IDEMPOTENCE_HEURES`, la constante `SEUIL_STOCK_BAS` (remplacée par `SEUIL_STOCK_BAS_DEFAUT = 10`, boîtes, utilisée si la pharmacie n'a pas de paramètres). Garder `formaterNumero` (format historique, exporté) et `PRIX_MAX`, `VENTES_PAR_PAGE`, `OPTIONS_TRANSACTION_VENTE`.
- Constructeur (D534), dans cet ordre :

```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly notificationsService: NotificationsService,
  private readonly storage: StorageService,
  private readonly accesPharmacie: AccesPharmacieService,
  private readonly permissions: PermissionsService,
  private readonly mouvementsStock: MouvementsStockService,
  private readonly sessionsCaisse: SessionsCaisseService,
) {}
```

- Constantes exportées (messages exacts) :

```ts
export const PREFIXE_APPAREIL_WEB_DEFAUT = 'web-defaut:';
export const MESSAGE_MOTIF_SORTIE_REQUIS =
  'Indiquez le motif de la sortie de ce lot (3 caractères au moins).';
export function messageVenteUniteInterdite(noms: string[]): string;
// 1 : `Ce médicament se vend uniquement à la boîte : « ${nom} ». Passez-le en vente à la boîte.`
// n : `${n} médicaments du panier se vendent uniquement à la boîte. Passez-les en vente à la boîte.`
export function messagePrixUniteManquant(noms: string[]): string;
// 1 : `Vente impossible : « ${nom} » n'a pas de prix à l'unité. Ajoutez son prix à l'unité dans la fiche du médicament, ou vendez-le à la boîte.`
// n : `Vente impossible : ${n} médicaments du panier n'ont pas de prix à l'unité. Ajoutez leur prix à l'unité dans leur fiche, ou vendez-les à la boîte.`
export function messageSortieManuelleRequise(noms: string[]): string;
// 1 : `Le stock non périmé de « ${nom} » ne suffit pas : il ne reste que des lots périmés. Réduisez la quantité, ou choisissez un lot et indiquez le motif de la sortie.`
// n : `Le stock non périmé de ${n} médicaments du panier ne suffit pas : il ne reste que des lots périmés. Réduisez les quantités, ou choisissez un lot et indiquez le motif de chaque sortie.`
export function messagePaiementsIncoherents(somme: number, total: number): string;
// `Le total des paiements (${somme} GNF) ne correspond pas au montant de la vente (${total} GNF). Corrigez les montants puis validez de nouveau.`
```

  Les messages existants de `STOCK_INTROUVABLE`, `PRIX_MANQUANT`, `ORDONNANCE_NON_CONFIRMEE` et `totalMaximal` sont conservés mot pour mot.

- `include` unique de lecture d'une vente, remplaçant tous les `include: { lignes: true }` de création, rejeu, détail et annulation :

```ts
const INCLUDE_VENTE = {
  lignes: { include: { allocations: true } },
  paiements: { include: { modePaiement: true } },
  poste: { select: { id: true, code: true } },
} satisfies Prisma.VenteInclude;
type VenteComplete = Prisma.VenteGetPayload<{ include: typeof INCLUDE_VENTE }>;
```

  Ne pas ajouter d'`orderBy` sur `lignes` (ordre des instantanés PB02 inchangé).

#### 6.2 Présentation (D540)

`presenterVente(vente: VenteComplete, pharmacie: PharmacieRecu, ouverteAutomatiquement = false)` renvoie, dans cet ordre de clés : toutes les clés actuelles avec les mêmes valeurs (`id, numero, statut, createdAt, total, ordonnanceVerifiee, clientNom, clientTelephone, vendeur, annuleeLe, annuleeParId, motifAnnulation`), puis `typePiece`, `numeroTicket`, `jourMetier` (`dateVersJour(vente.jourMetier)`), `provisoire` (vrai si une allocation de la vente est PROVISOIRE), `poste: { id, code }`, `session: { id: vente.sessionCaisseId, ouverteAutomatiquement }`, `paiements` (triés par `modePaiement.ordre` puis `modePaiement.code`) `[{ id, mode: code, libelle, montant, reference: referenceExterne, montantRecu, rendu: montantRecu === null ? null : montantRecu - montant }]`, `annulation: null` (commentaire : remplie par PB12), puis `lignes` (clés actuelles inchangées, puis `uniteAffichee`, `nombreAffiche`, `coefficientApplique`, `allocations`), puis `pharmacie`. Chaque allocation : `{ lotId, numeroLot, dateExpiration: date ? dateVersJour(date) : null, quantite, statut, sortieManuelle, motif, lotTechnique, coutUnitaire }`, triées : DEFINITIVE avant PROVISOIRE (puis REMPLACEE), date nulle d'abord, date croissante, `lotId` croissant (nul en dernier).

Toute réponse qui contient une vente présentée (création, rejeu, détail, annulation) passe par `masquerCouts(data, peutVoirMarge)` avec `peutVoirMarge = (await this.permissions.getUserPermissions(userId)).includes(PERMISSIONS.MARGE_READ)`, calculé avant toute transaction (méthode privée `peutVoirMarge(userId)`). `reponseRejeu(vente, pharmacie, peutVoirMarge)` garde son message et `rejeu: true`.

#### 6.3 `creerVente` (signature inchangée)

Hors transaction, dans cet ordre :
1. `{ user, structure } = accesPharmacie.verifier(...)`, `pharmacie = pharmacieRecu(structure)`.
2. Doublon par `cleLigneVente(stockId, unite)` : 400 `{ message: "Un même médicament ne peut apparaître qu'une fois par unité dans la vente (une ligne à la boîte, une ligne à l'unité). Regroupez les quantités.", code: 'VALIDATION', champs: [{ champ: 'lignes', contraintes: ['stockUnique'] }] }`.
3. `peutVoirMarge`.
4. Clé : `cle = lireCleIdempotence(enTete)` (journal `vente.cle_idempotence_ignoree` inchangé) ; si `cle` et une vente `(structureId, cle)` existe (`include: INCLUDE_VENTE`) : rejeu, **quel que soit son âge** (supprimer la remise à nul et la fenêtre de 24 h, D539).
5. Transaction `this.prisma.$transaction((tx) => this.enregistrerVente(tx, { structure, user, dto, cle, ip }), OPTIONS_TRANSACTION_VENTE)` ; en cas d'erreur, rejeu concurrent par `estConflitCleIdempotence` exactement comme aujourd'hui (avec `INCLUDE_VENTE`).
6. Après validation : `alerterStockBas(structureId, vente.id, passages)` (méthode actuelle inchangée), journal `vente.creee venteId=... numero=...`, réponse `{ data: masquerCouts(presenterVente(vente, pharmacie, ouverteAutomatiquement), peutVoirMarge), message: \`Vente enregistrée (${vente.numero}).\`, success: true }`.

#### 6.4 `enregistrerVente` (privée, transaction, D535)

Renvoie `{ vente: VenteComplete; passages: { nom: string; apres: number }[]; ouverteAutomatiquement: boolean }`. Étapes dans cet ordre exact :

1. **Fiches** : `tx.stockMedicament.findMany({ where: { id: { in: ids uniques }, structureId, archiveLe: null }, include: { medicament: { select: { id, nom, ordonnanceRequise } } } })`. Identifiants absents (inconnus, autre pharmacie, archivés) : 404 `STOCK_INTROUVABLE` (message et `details [{ stockId }]` actuels, un élément par identifiant distinct).
2. **Lignes** : pour chaque ligne du corps, `calculerLigne({ unite: l.unite ?? 'BOITE', nombre: l.quantite, coefficientBoite, prixBoite: prixUnitaire, prixUnite, deconditionnable })`. Grouper les refus par code ; s'il y a des `VENTE_UNITE_INTERDITE` : 400 `{ message: messageVenteUniteInterdite(noms), code, details: [{ stockId, nom }] }` ; sinon `PRIX_UNITE_MANQUANT` (même forme, `messagePrixUniteManquant`) ; sinon `PRIX_MANQUANT` (message actuel). Une fiche citée deux fois n'apparaît qu'une fois dans `details`.
3. **Motifs** : pour chaque ligne avec `sortieManuelle`, `motif = (l.sortieManuelle.motif ?? '').trim()` ; longueur < 3 : 400 `{ message: MESSAGE_MOTIF_SORTIE_REQUIS, code: 'MOTIF_REQUIS' }`.
4. **Ordonnance** : règle et message actuels (`dto.ordonnanceVerifiee !== true` et une fiche du panier `ordonnanceRequise`).
5. **Total** : somme des `montantLigne` ; au-delà de `PRIX_MAX` : 400 `VALIDATION` `totalMaximal` (message actuel).
6. **Paiements** : modes actifs `tx.modePaiement.findMany({ where: { actif: true } })` ; `preparerPaiements(total, dto.paiements, modes)` ; refus : `MODE_PAIEMENT_INCONNU` 400 `{ message: messageModeInconnu(mode), code: 'MODE_PAIEMENT_INCONNU' }` ; `MODE_EN_DOUBLE` 400 `{ message: 'Un même mode de paiement ne peut apparaître qu’une fois. Regroupez les montants.', code: 'VALIDATION', champs: [{ champ: 'paiements', contraintes: ['modeUnique'] }] }` ; `MONTANT_RECU_INSUFFISANT` 400 `{ message: 'La somme reçue en espèces est inférieure au montant à payer en espèces.', code: 'VALIDATION', champs: [{ champ: 'paiements', contraintes: ['montantRecuInsuffisant'] }] }` ; `PAIEMENTS_INCOHERENTS` 400 `{ message: messagePaiementsIncoherents(somme, total), code: 'PAIEMENTS_INCOHERENTS' }`.
7. **Poste** (D536) : `posteId = dto.posteId` ; absent : PV = `tx.pointDeVente.findFirst({ where: { structureId }, orderBy: { ordre: 'asc' } }) ?? (await assurerPointDeVente(tx, structure)).pointDeVente` ; `appareilId = PREFIXE_APPAREIL_WEB_DEFAUT + user.id` ; poste existant `tx.poste.findFirst({ where: { pointDeVenteId, appareilId } })`, sinon `(await assurerPoste(tx, { pointDeVenteId, type: 'WEB', appareilId, user, ip })).poste`.
8. **Session** : `{ session, ouverteMaintenant } = await this.sessionsCaisse.ouvrirDansTransaction(tx, { structureId, userId: user.id, utilisateurNom: \`${user.prenom} ${user.nom}\`.trim(), posteId })` ; puis verrou :
   ```sql
   SELECT s."statut"::text AS "statut", s."pointDeVenteId", s."jourMetier", pv."ordre"
   FROM "SessionCaisse" s JOIN "PointDeVente" pv ON pv."id" = s."pointDeVenteId"
   WHERE s."id" = ${session.id} FOR UPDATE OF s
   ```
   (`tx.$queryRaw`). Statut différent de `OUVERTE` (fermée entre-temps) : rappeler `ouvrirDansTransaction` une fois (elle crée une nouvelle session, le poste est encore verrouillé), relire la ligne de la même façon ; `ouverteAutomatiquement = ouverteMaintenant` du dernier appel. Retenir `sessionId`, `pointDeVenteId`, `jourMetier` (Date renvoyée par PostgreSQL), `ordre`, `posteCode = session.poste.code`.
9. **Numéro** :
   ```sql
   INSERT INTO "CompteurTicket" ("pointDeVenteId", "prochainNumero") VALUES (${pointDeVenteId}, 2)
   ON CONFLICT ("pointDeVenteId") DO UPDATE SET "prochainNumero" = "CompteurTicket"."prochainNumero" + 1
   RETURNING "prochainNumero" - 1 AS "numero"
   ```
   (`tx.$queryRaw<{ numero: number }[]>`) ; `numero = formaterNumeroTicket(ordre, n)`.
10. **Verrous et lots** : `await this.mouvementsStock.verrouillerFiches(tx, ids)` ; agrégats avant : `tx.agregatStockProduit.findMany({ where: { pointDeVenteId, stockMedicamentId: { in: ids } } })` (absent = 0) ; `lotsParFiche = await lireLotsCandidats(tx, pointDeVenteId, ids)` ; `jour = jourConakry(new Date())`.
11. **Lots de sortie manuelle** : pour chaque ligne avec sortie manuelle dont le `lotId` n'est pas dans `lotsParFiche.get(stockId)` : `tx.lotStock.findFirst({ where: { id: lotId, stockMedicamentId, pointDeVenteId } })` ; absent : 404 `NotFoundException(MESSAGE_LOT_INTROUVABLE)` ; présent (solde nul) : 409 `{ message: MESSAGE_STOCK_LOT_INSUFFISANT, code: 'STOCK_LOT_NEGATIF' }`.
12. **Allocation** : `lignesAllouees = allouerLignes(jour, lignes, lotsParFiche)` (lignes construites depuis le corps et l'étape 2 : `quantiteUm`, `unite`, sortie manuelle avec motif nettoyé). Lignes dont `resteProvisoire > 0` et `lotsPerimesDisponibles.length > 0` : 409 `{ message: messageSortieManuelleRequise(noms), code: 'SORTIE_MANUELLE_REQUISE', details: [{ stockId, nom, disponible: quantiteAllouee, demande: quantiteUm, lots: lotsPerimesDisponibles }] }` (une entrée par ligne concernée).
13. **Vente** : `tx.vente.create({ data, include: INCLUDE_VENTE })` avec `data: Prisma.VenteUncheckedCreateInput` (supprimer le `Omit` et la conversion de D524) : `structureId, pointDeVenteId, posteId, sessionCaisseId, typePiece: 'VENTE', numero, numeroTicket: n, jourMetier, vendeurId: user.id, vendeurNom, clientNom, clientTelephone, ordonnanceVerifiee, total, cleIdempotence: cle`, `lignes: { create: [...] }` dans l'ordre du corps, chaque ligne `{ medicamentId, stockMedicamentId, nomMedicament, prixUnitaire: prixAppliqueParUm, quantite: quantiteUm, sousTotal: montantLigne, uniteAffichee, nombreAffiche, coefficientApplique, allocations: { create: [...] } }`, allocations : celles de `allouerLignes` en `DEFINITIVE` (`lotId, numeroLot, dateExpiration: jourVersDate(...) | null, quantite, coutUnitaire, lotTechnique, sortieManuelle, motif, auteurId: user.id`) puis, si `resteProvisoire > 0`, une `PROVISOIRE` `{ lotId: null, numeroLot: null, dateExpiration: null, quantite: resteProvisoire, coutUnitaire: 0, lotTechnique: false, sortieManuelle: false, motif: null, auteurId: user.id }`.
14. **Paiements** : `tx.paiement.createMany({ data: paiements.map(p => ({ venteId, sessionCaisseId, modePaiementId, montant, referenceExterne, montantRecu })) })`.
15. **Mouvements** : pour chaque ligne dans l'ordre, pour chaque allocation DEFINITIVE : `mouvementsStock.ecrire(tx, { pointDeVenteId, stockMedicamentId, lotId, type: 'VENTE', quantite: -quantite, pieceOrigineType: 'VENTE', pieceOrigineId: vente.id, motif: sortieManuelle ? motif : null, auteurId: user.id, posteId })` ; puis, si `resteProvisoire > 0`, un mouvement identique avec `lotId: null`, `quantite: -resteProvisoire`. Retenir par fiche le `soldeProduit` du dernier mouvement écrit.
16. **Anomalies** : par ligne provisoire, `tx.anomalie.create({ data: { pointDeVenteId, type: 'STOCK_NEGATIF', attribueeAId: structure.adminId, pieceType: 'VENTE', pieceId: vente.id, details: { stockId, nom, quantiteProvisoire, soldeProduit, posteCode, utilisateurId: user.id, utilisateurNom, jourMetier: dateVersJour(jourMetier) } } })` (D537 ; jamais de donnée du client).
17. **Audit** : `auditLog.create` `action 'create'`, `entityType 'Vente'`, `entityId vente.id`, `ip`, `metadata: { numero, total, nombreLignes, provisoire, sessionOuverteAutomatiquement: ouverteAutomatiquement }`.
18. **Stock bas** : `seuil = (await tx.parametresPharmacie.findUnique({ where: { structureId }, select: { seuilStockBas: true } }))?.seuilStockBas ?? SEUIL_STOCK_BAS_DEFAUT` ; `passages = passagesStockBas(fiches distinctes { nom, coefficientBoite, avant (étape 10), apres (étape 15) }, seuil)`.
19. Relire la vente (les paiements sont créés après elle) : `tx.vente.findUniqueOrThrow({ where: { id }, include: INCLUDE_VENTE })`, et renvoyer `{ vente, passages, ouverteAutomatiquement }`.

Plus aucune écriture de `StockMedicament` ni de `CompteurVente` dans la vente.

#### 6.5 `detailVente`

`include: INCLUDE_VENTE`, réponse `masquerCouts(presenterVente(vente, pharmacie), peutVoirMarge)`. Messages et 404 inchangés. `listerVentes` n'est pas modifié.

#### 6.6 `annulerVente`

Logique inchangée (PB12 la réécrit ; elle échoue en base sur le trigger d'immuabilité depuis PB09, D524). Seuls changent : les deux `findFirst` prennent `include: INCLUDE_VENTE`, et `data` passe par `masquerCouts(..., await this.peutVoirMarge(userId))`.

### 7. DTO (`src/pharmacie/dto/vente.dto.ts`)

```ts
export const UNITES_VENTE = ['BOITE', 'UNITE'] as const;
export type UniteVenteSaisie = (typeof UNITES_VENTE)[number];

export class SortieManuelleDto {
  @ApiProperty({ description: 'Lot choisi par le vendeur (périmé ou contre l’ordre FEFO)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  lotId: string;

  @ApiPropertyOptional({ example: 'Dernière boîte, client informé', description: 'Obligatoire, 3 à 300 caractères (sinon MOTIF_REQUIS)' })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(300)
  motif?: string;
}
```

- `LigneVenteDto` : `quantite` garde ses règles (nombre de boîtes ou d'unités saisi) avec `ApiProperty` décrivant « nombre de boîtes, ou d'unités si unite = UNITE » ; ajouter `@ApiPropertyOptional({ enum: UNITES_VENTE, description: 'Absent : BOITE' }) @IsOptional() @IsIn(UNITES_VENTE) unite?: UniteVenteSaisie;` et `@ApiPropertyOptional({ type: SortieManuelleDto }) @IsOptional() @ValidateNested() @Type(() => SortieManuelleDto) sortieManuelle?: SortieManuelleDto;`.
- `PaiementVenteDto` : `mode` (`@IsString @IsNotEmpty @MaxLength(40)`), `montant` (`@IsInt @Min(1) @Max(2147483647)`), `reference?` (`@IsOptional @IsString @Transform(rognerTexte) @MaxLength(100)`), `montantRecu?` (`@IsOptional @IsInt @Min(0) @Max(2147483647)`), avec `ApiProperty`.
- `CreerVenteDto` : ajouter `paiements?: PaiementVenteDto[]` (`@IsOptional @IsArray @ArrayMinSize(1) @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => PaiementVenteDto)`) et `posteId?: string` (`@IsOptional @IsString @IsNotEmpty @MaxLength(64)`), avec `ApiPropertyOptional` (posteId : « Poste de caisse ; absent : poste web de l'utilisateur, créé à la volée »).

### 8. Contrôleur et module

- `vente.controller.ts` : `@RequirePermissions(PERMISSIONS.VENTE_WRITE, PERMISSIONS.CAISSE_UTILISER)` sur la création ; descriptions Swagger mises à jour (session ouverte automatiquement, prix de la fiche, lots, paiements ; en-tête `Idempotency-Key` : « Un renvoi avec la même clé renvoie la même vente, sans limite de durée. » ; 400 : `VALIDATION`, `VENTE_UNITE_INTERDITE`, `PRIX_UNITE_MANQUANT`, `PRIX_MANQUANT`, `ORDONNANCE_NON_CONFIRMEE`, `MOTIF_REQUIS`, `PAIEMENTS_INCOHERENTS`, `MODE_PAIEMENT_INCONNU` ; 404 : `STOCK_INTROUVABLE`, lot introuvable ; 409 : `SORTIE_MANUELLE_REQUISE`, `STOCK_LOT_NEGATIF`, `POSTE_INCONNU`, `SESSION_AUTRE_UTILISATEUR`, `POSTE_TYPE_DIFFERENT`) ; plus aucune mention de `STOCK_INSUFFISANT` ni `MEDICAMENT_EXPIRE`. Description de la route d'annulation inchangée.
- `pharmacie.module.ts` : rien à ajouter (`MouvementsStockService`, `SessionsCaisseService` sont déjà fournis ; `PermissionsService` est global).

### 9. Tests

#### 9.1 Supprimer `src/pharmacie/vente.service.spec.ts` (D542)

#### 9.2 `src/pharmacie/vente-regles.spec.ts` (nouveau, unitaire)

Lots construits par une fonction `lot(id, solde, { exp?: string | null, coef?: number, cout?: number, recu?: string })` (défauts : `exp` null, `coef` 1, `cout` 0, `recu` `'2026-01-01T00:00:00.000Z'`), `JOUR = '2026-06-15'`.

1. `formaterNumeroTicket(1, 1)` vaut `'T1-0000001'`, `(2, 1234567)` vaut `'T2-1234567'`, `(1, 12345678)` vaut `'T1-12345678'` ; `(0, 1)` et `(1, 0)` lèvent `RangeError`.
2. `cleLigneVente('s1')` égale `cleLigneVente('s1', 'BOITE')` et diffère de `cleLigneVente('s1', 'UNITE')`.
3. Même fiche en BOITE puis UNITE : lot `L` 30, coef 10 ; lignes `[{ index 0, BOITE, 10 }, { index 1, UNITE, 3 }]` : ligne 0 = `[L:10]`, ligne 1 = `[L:3]`, restes 0.
4. Soldes partagés : lot `L` 5 coef 1 ; deux lignes de la même fiche (BOITE 4, UNITE 4) : ligne 0 `[L:4]` reste 0 ; ligne 1 `[L:1]` reste 3, `lotsPerimesDisponibles` vide.
5. Sortie manuelle d'un périmé : lots `P` 2 exp `2026-06-01`, `F` 10 exp `2026-12-01` ; ligne BOITE 5 avec `{ lotId: 'P', motif: 'Client informé' }` : `[P:2 sortieManuelle vrai motif 'Client informé', F:3 sortieManuelle faux motif null]`, reste 0, `lotsPerimesDisponibles` vide.
6. Sans sortie manuelle, que du périmé : `P` 10 exp `2026-06-01`, ligne BOITE 2 : allocations vides, reste 2, `lotsPerimesDisponibles` `[{ lotId: 'P', numeroLot, dateExpiration: '2026-06-01', quantite: 10 }]`, `quantiteAllouee` 0.
7. Avec sortie manuelle et reste non couvert : `P` 1 périmé, ligne BOITE 3 avec sortie sur `P` : `[P:1]`, reste 2, `lotsPerimesDisponibles` vide.
8. Aucun lot : reste = quantité, allocations vides, `lotsPerimesDisponibles` vide.
9. Lot de sortie manuelle absent de la fiche : `RangeError`.
10. Lot de sortie manuelle épuisé par une ligne précédente : lots `A` 3, `B` 10 (même fiche) ; ligne 0 BOITE 3 avec sortie sur `A`, ligne 1 BOITE 2 avec sortie sur `A` : ligne 1 n'a aucune allocation sur `A`, prend `B:2`.
11. `preparerPaiements(1000, undefined, modes)` : un paiement `ESPECES` de 1000, référence et montant reçu nuls.
12. Mode inconnu : `[{ mode: 'CARTE', montant: 1000 }]` donne `MODE_PAIEMENT_INCONNU` `mode 'CARTE'` ; avec `modes` sans `ESPECES` et `demandes` absent : `MODE_PAIEMENT_INCONNU` `mode 'ESPECES'`.
13. Ordre des contrôles : `[{ CARTE 500 }, { ESPECES 500 }, { ESPECES 500 }]` donne `MODE_PAIEMENT_INCONNU` ; `[{ ESPECES 500 }, { ESPECES 500 }]` donne `MODE_EN_DOUBLE` ; `[{ ESPECES 600, montantRecu 500 }, { ORANGE_MONEY 400 }]` donne `MONTANT_RECU_INSUFFISANT` ; `[{ ESPECES 600 }, { ORANGE_MONEY 300 }]` donne `PAIEMENTS_INCOHERENTS` `somme 900`.
14. Normalisation : `[{ ESPECES 500, reference: 'X', montantRecu: 1000 }, { ORANGE_MONEY 500, reference: '  OM-1  ', montantRecu: 800 }]` : espèces `referenceExterne null, montantRecu 1000` ; Orange Money `referenceExterne 'OM-1', montantRecu null`.
15. `passagesStockBas` : `{ avant 105, apres 95, coef 10 }` seuil 10 : `[{ nom, apres: 95 }]` ; `{ 95 vers 85 }` : vide ; `{ 12 vers 0, coef 1 }` : `[{ apres: 0 }]` ; seuil 0, `{ 5 vers 0 }` : un passage ; `{ 3 vers -2, coef 1 }` seuil 10 (déjà BAS) : vide.

`modes` du test : `ESPECES` (physique, sans référence, ordre 1), `ORANGE_MONEY` (non physique, référence, ordre 2), `MTN_MOMO` (ordre 3), identifiants `'m-esp'`, `'m-om'`, `'m-mtn'`.

#### 9.3 `src/common/filters/all-exceptions.filter.spec.ts`

Ajouter un test sur le modèle du test « recopie details assainis » : un 409 `SORTIE_MANUELLE_REQUISE` dont `details` = `[{ stockId: 's1', nom: 'Doliprane', disponible: 0, demande: 2, interne: 'x', lots: [{ lotId: 'l1', numeroLot: 'A12', dateExpiration: '2026-01-01', quantite: 10, coutUnitaire: 300 }, { lotId: 'l2', numeroLot: 7, dateExpiration: '2026-02-01', quantite: 4 }, { lotId: 3 }] }]` ressort avec `details` égal à `[{ stockId: 's1', nom: 'Doliprane', disponible: 0, demande: 2, lots: [{ lotId: 'l1', numeroLot: 'A12', dateExpiration: '2026-01-01', quantite: 10 }, { lotId: 'l2', numeroLot: null, dateExpiration: '2026-02-01', quantite: 4 }] }]` ; et un 400 `VENTE_UNITE_INTERDITE` garde `details [{ stockId, nom }]`.

#### 9.4 `src/pharmacie/vente.http.spec.ts`

- Profils : ajouter `'caisse:utiliser'` aux codes de `pharmacien` et `admin` ; nouveau profil `sanscaisse: { type: 'PHARMACIE', codes: ['vente:read', 'vente:write'] }`.
- Nouveau test « 2c. sans caisse:utiliser : création refusée (403 PERMISSION_REFUSEE), liste acceptée » : POST 403 `PERMISSION_REFUSEE`, `creerVente` non appelé ; GET liste 200.
- Cas de validation ajoutés au tableau du test 3 (champ attendu dans `champs`) : `unite 'PLAQUETTE'` (`lignes`), `sortieManuelle sans lotId` (`lignes`), `paiements []` (`paiements`), `paiement montant 0` (`paiements`), `paiement mode absent` (`paiements`), `posteId ''` (`posteId`).
- Nouveau cas valide : corps `{ lignes: [{ stockId: 'st1', quantite: 6, unite: 'UNITE', sortieManuelle: { lotId: 'l1', motif: '  Client informé  ' } }], paiements: [{ mode: 'ESPECES', montant: 3000, montantRecu: 5000 }, { mode: 'ORANGE_MONEY', montant: 600, reference: ' OM-1 ' }], posteId: 'p1' }` : 201, `creerVente` reçoit le corps avec `motif` `'Client informé'` et `reference` `'OM-1'`.
- Remplacer le test 4 (STOCK_INSUFFISANT) par « 4. 409 SORTIE_MANUELLE_REQUISE : details et lots filtrés » : rejet mocké avec une clé `interne` au niveau de la ligne et `coutUnitaire` dans un lot ; la réponse porte `code`, `details[0].lots[0]` sans `coutUnitaire`, et le JSON ne contient ni `interne` ni `coutUnitaire`.

#### 9.5 `test/db/vente.db-spec.ts` (nouveau, base de test)

Mise en place sur le modèle de `test/db/sessions-caisse.db-spec.ts` (base vide, migrations jusqu'à `DERNIERE_MIGRATION_FORMAT_ACTUEL`, `chargerFormatActuel`, migrations restantes, `creerPrismaDeTest`) :

```ts
const notifications = { createManyNotifications: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
const stockage = { getPublicUrl: (cle: string) => `logo/${cle}` } as unknown as StorageService;
const acces = new AccesPharmacieService(prisma);
const permissions = { getUserPermissions: (id: string) => Promise.resolve(id === 'usr-admin-p1' ? ['vente:write', 'caisse:utiliser', 'caisse:superviser', 'marge:read'] : ['vente:write', 'caisse:utiliser']) } as unknown as PermissionsService;
const mouvements = new MouvementsStockService();
const sessions = new SessionsCaisseService(prisma, acces, permissions);
service = new VenteService(prisma, notifications, stockage, acces, permissions, mouvements, sessions);
postes = new PointsDeVenteService(prisma, acces);
```

Constantes `PHARMACIE = 'str-pharma-1'`, `VENDEUR = 'usr-pharm-p1'`, `RESPONSABLE = 'usr-admin-p1'`, `pv1` = identifiant du PV d'ordre 1 de `str-pharma-1` (lu en SQL dans `beforeAll`), `jour(n)` = jour de Conakry décalé de n jours (`AAAA-MM-JJ`). Fonctions d'aide :
- `nouvelleFiche({ coef = 1, prixBoite = 1000, prixUnite = null, decond = false, ordonnance = false })` : insère par SQL un `Medicament` (`med-vente-<n>`, nom `Produit vente <n>`, catégorie `Test PB11`, `ordonnanceRequise`) puis une `StockMedicament` (`stk-vente-<n>`, `str-pharma-1`, `quantite` 0, `disponible` faux, `prixUnitaire`, `prixUnite`, `coefficientBoite`, `deconditionnable`, `updatedAt now()`) ; renvoie `{ stockId, nom }`.
- `nouveauLot(stockId, { quantite, coef = 1, exp = jour(200) (null autorisé), cout = 0, numero = null })` : `prisma.$transaction(tx => mouvements.creerLot(tx, { stockMedicamentId, pointDeVenteId: pv1, numeroLot, dateExpiration: exp ? jourVersDate(exp) : null, quantite, coutUnitaire: cout, coutAchatBoite: null, coefficientReception: coef, fournisseurId: null, receptionId: null, lotTechnique: false, auteurId: RESPONSABLE, pieceOrigineType: 'RECEPTION', pieceOrigineId: null, motif: null }))`, renvoie l'identifiant du lot.
- `vendre(dto, utilisateur = VENDEUR, cle?)` : `service.creerVente(PHARMACIE, utilisateur, dto, cle, '127.0.0.1')`.
- `soldeProduit(stockId)`, `soldeLot(lotId)` (SQL sur les agrégats, absent = 0), `prochainNumero()` (SQL sur `CompteurTicket` de `pv1`), `refus`, `sql`, `compter` (copiés du modèle).

Tests (numérotés, dans cet ordre, base partagée) :

1. **CA1 vente de 6 unités** : fiche coef 20, prix boîte 10 000, prix unité 600, déconditionnable ; lot 40 UM coef 20 coût 300. `vendre({ lignes: [{ stockId, quantite: 6, unite: 'UNITE' }] })` : `data.total` 3600 ; ligne `{ quantite: 6, prixUnitaire: 600, sousTotal: 3600, uniteAffichee: 'UNITE', nombreAffiche: 6, coefficientApplique: 1 }` ; `soldeProduit` 34 ; un seul `MouvementStock` de pièce `VENTE` et `pieceOrigineId` = `data.id` : type `VENTE`, quantité -6, lot = le lot, `auteurId` VENDEUR, `posteId` = `data.poste.id` ; `data.numero` correspond à `/^T1-\d{7}$/` ; message `Vente enregistrée (<numero>).` ; `data.typePiece` `VENTE`, `data.provisoire` faux, `data.annulation` nul.
2. **CA5 reliquat de 14** : fiche identique, lot 20 UM coef 20 ; vente de 6 unités ; `lireEtatsStock(prisma, [stockId], jour(0)).get(stockId).reliquat` vaut `[{ lotId, unitesRestantes: 14 }]` ; une ligne `ConditionnementOuvert` ouverte (`fermeLe` nul) sur ce lot et `pv1`, `unitesParConditionnement` 20, `ouvertParId` VENDEUR, `ouvertParPieceId` = `data.id`.
3. **CA2 boîte** : fiche identique, lot 40 coef 20 ; `vendre({ lignes: [{ stockId, quantite: 1 }] })` (unité absente) : ligne `{ quantite: 20, prixUnitaire: 500, sousTotal: 10000, uniteAffichee: 'BOITE', nombreAffiche: 1, coefficientApplique: 20 }`, total 10 000, `soldeProduit` 20, aucun `ConditionnementOuvert` ouvert sur ce lot.
4. **CA4 non déconditionnable** : fiche coef 10, prix boîte 5000, non déconditionnable ; lot 30 coef 10. Vente de 3 `UNITE` : 400 `VENTE_UNITE_INTERDITE`, message contenant « uniquement à la boîte », `details` `[{ stockId, nom }]` ; `prochainNumero()` inchangé, nombre de `Vente` de la pharmacie inchangé, `soldeProduit` 30. Puis 1 boîte : acceptée, quantité 10.
5. **Prix manquants** : fiche déconditionnable sans prix unité, lot 10 : vente `UNITE` : 400 `PRIX_UNITE_MANQUANT` `details [{ stockId, nom }]` ; fiche prix boîte nul, lot 10 : vente boîte : 400 `PRIX_MANQUANT`.
6. **CA7 reliquat avant FEFO** : fiche coef 20, prix boîte 10 000, prix unité 600, déconditionnable ; lot A 20 coef 20 `exp jour(30)` coût 100 numéro `A` ; lot B 20 coef 20 `exp jour(90)` coût 200 numéro `B`. (a) 6 unités avec `sortieManuelle: { lotId: B, motif: 'Plaquette B déjà entamée' }` : une allocation B 6 `sortieManuelle` vrai, motif `Plaquette B déjà entamée`, et le mouvement porte ce motif. (b) 10 unités sans sortie manuelle : allocations exactement `[{ lotId: B, quantite: 10, sortieManuelle: false, motif: null }]`. (c) 6 unités : allocations `B:4` et `A:2` ; `soldeLot(B)` 0, `soldeLot(A)` 18 ; reliquat lu = `[{ lotId: A, unitesRestantes: 18 }]`.
7. **CA9 et CA11 deux lots 30 et 90 jours** : fiche coef 1 prix boîte 1000 ; lot 30 jours 10 UM coût 400 numéro `L30`, lot 90 jours 10 UM coût 450 numéro `L90`. Vente de 15 par VENDEUR : deux allocations DEFINITIVE, `L30:10` puis `L90:5` (ordre de la réponse), `soldeLot` 0 et 5 ; en base, `AllocationLot` porte `coutUnitaire` 400 et 450, `numeroLot` et `dateExpiration` copiés ; `cheminsCout(data)` vide pour VENDEUR ; `detailVente(PHARMACIE, id, RESPONSABLE)` : les allocations portent `coutUnitaire` 400 et 450 ; `detailVente` par VENDEUR : `cheminsCout` vide.
8. **CA10 sans date avant daté** : lot daté `jour(5)` créé d'abord, puis lot sans date (`exp: null`) ; vente de 1 : allocation sur le lot sans date.
9. **CA13 périmé jamais automatique, sortie manuelle motivée** : fiche coef 1 ; lot `P` 10 `exp jour(-3)`. (a) Vente de 2 : 409 `SORTIE_MANUELLE_REQUISE`, `details` `[{ stockId, nom, disponible: 0, demande: 2, lots: [{ lotId: P, numeroLot: 'P', dateExpiration: jour(-3), quantite: 10 }] }]` ; rien n'est écrit (nombre de ventes, mouvements de la fiche, `prochainNumero()`, sessions OUVERTES du VENDEUR inchangés). (b) Sortie manuelle sur `P` avec motif `'  '` : 400 `MOTIF_REQUIS`. (c) Motif `'  Client informé, produit périmé  '` : vente acceptée, allocation `sortieManuelle` vrai, motif `Client informé, produit périmé`, `auteurId` VENDEUR ; `soldeLot(P)` 8. (d) Nouveau lot frais 10 `exp jour(100)` ; vente de 3 sans sortie manuelle : allocation sur le lot frais seulement, `soldeLot(P)` reste 8. (e) Sortie manuelle avec le lot d'une autre fiche : 404 « Ce lot est introuvable pour ce médicament. » ; avec un lot de la fiche à solde nul (créer un lot de 1 puis le vendre par sortie manuelle) : 409 `STOCK_LOT_NEGATIF`.
10. **O11 vente en négatif** : fiche, lot 3. Vente de 5 : réussie, `data.provisoire` vrai, allocations `DEFINITIVE 3` et `PROVISOIRE 2` (`lotId` nul, `coutUnitaire` 0, pour RESPONSABLE qui voit les coûts) ; mouvements de la vente : -3 avec lot, -2 sans lot ; `soldeProduit` -2, `soldeLot` 0 ; une `Anomalie` `STOCK_NEGATIF` `OUVERTE`, `pieceType` `VENTE`, `pieceId` = id, `attribueeAId` `usr-admin-p1`, `details.stockId`, `details.quantiteProvisoire` 2, `details.soldeProduit` -2, sans clé `clientNom` ni `clientTelephone` (la vente porte `clientNom: 'Client essai'`). Fiche sans aucun lot, vente de 1 : une allocation PROVISOIRE de 1, `soldeProduit` -1.
11. **Deux ventes simultanées de la dernière unité** : lot 1 ; `Promise.allSettled` d'une vente de 1 par VENDEUR et d'une par RESPONSABLE : deux réussites ; une seule allocation DEFINITIVE et une PROVISOIRE sur la fiche ; `soldeLot` 0, `soldeProduit` -1 ; `numeroTicket` différents.
12. **CA16 et CA19 caisse** : poste créé par `postes.enregistrerPoste(PHARMACIE, VENDEUR, { type: 'WEB', appareilId: 'appareil-pb11-caisse' })`, aucune session. Fiche prix boîte 10 000 (lot 10) et fiche prix boîte 1000 (lot 10). (a) Vente de 1 boîte à 10 000 avec `posteId` et `paiements [{ mode: 'ESPECES', montant: 5000, montantRecu: 10000 }, { mode: 'ORANGE_MONEY', montant: 5000, reference: 'OM-778899' }]` : `data.session.ouverteAutomatiquement` vrai ; session OUVERTE de VENDEUR sur ce poste, `Vente.sessionCaisseId` = `data.session.id`, `jourMetier` = jour de la session ; deux `Paiement` dans cette session ; `data.paiements` = `[{ mode: 'ESPECES', montant: 5000, montantRecu: 10000, rendu: 5000, reference: null }, { mode: 'ORANGE_MONEY', montant: 5000, reference: 'OM-778899', montantRecu: null, rendu: null }]` (clés `id` et `libelle` aussi présentes). (b) Vente de 2 boîtes à 1000 sans `paiements` : `ouverteAutomatiquement` faux, même session, un paiement `ESPECES` de 2000. (c) `sessions.bilan(PHARMACIE, VENDEUR, sessionId)` : théorique `ESPECES` 7000, `ORANGE_MONEY` 5000. (d) `sessions.fermer` avec `comptageFermeture { coupures: [{ valeurFaciale: 5000, nombre: 1 }, { valeurFaciale: 2000, nombre: 1 }], releves: [{ mode: 'ORANGE_MONEY', montant: 4000 }] }` : écart `ESPECES` 0, écart `ORANGE_MONEY` -1000. (e) Nouvelle vente sur ce poste : `ouverteAutomatiquement` vrai, `data.session.id` différent du précédent.
13. **Paiements refusés** (rien d'écrit : `prochainNumero()` inchangé) : somme 900 pour un total de 1000 : 400 `PAIEMENTS_INCOHERENTS`, message contenant « 900 GNF » et « 1000 GNF » ; mode `CARTE` : 400 `MODE_PAIEMENT_INCONNU` ; `MTN_MOMO` désactivé par SQL (`UPDATE "ModePaiement" SET "actif" = false`, réactivé dans un `finally`) : 400 `MODE_PAIEMENT_INCONNU` ; `ESPECES` deux fois : 400 `VALIDATION` contrainte `modeUnique` ; espèces reçues 500 pour 1000 : 400 `VALIDATION` contrainte `montantRecuInsuffisant`. Une référence sur `ESPECES` est acceptée et enregistrée nulle.
14. **Poste et session** : `posteId` inconnu : 409 `POSTE_INCONNU` ; poste d'une autre pharmacie (créé par `postes.enregistrerPoste('str-pharma-2', 'usr-pharm-p2', ...)`) : 409 `POSTE_INCONNU` ; poste créé par `postes.enregistrerPoste(PHARMACIE, RESPONSABLE, { type: 'WEB', appareilId: 'appareil-pb11-responsable' })`, session ouverte dessus par `sessions.ouvrir(PHARMACIE, RESPONSABLE, { posteId })`, puis vente de VENDEUR avec ce `posteId` : 409 `SESSION_AUTRE_UTILISATEUR`. Poste par défaut (les tests précédents ont déjà vendu sans `posteId`) : il existe exactement un poste d'`appareilId` `web-defaut:usr-pharm-p1`, de type `WEB`, code commençant par `W`, libellé « Navigateur de Mamadou », et exactement un audit `create` `Poste` dont `entityId` est ce poste ; une nouvelle vente sans `posteId` renvoie ce même `data.poste.id`.
15. **Numérotation et idempotence** : deux ventes successives : `numeroTicket` n puis n+1 et `numero` `T1-` suivi de n sur 7 chiffres ; une vente refusée entre les deux (ordonnance) ne consomme aucun numéro. Clé `cle-pb11-0001` envoyée deux fois : seconde réponse `rejeu: true`, même `id`, message « Cette vente était déjà enregistrée. », un seul jeu de mouvements, stock décrémenté une fois ; clé `cle-pb11-0002` en `Promise.all` de deux appels : même `id`, une seule vente porte cette clé en base ; `JSON.stringify(data)` ne contient jamais `cleIdempotence`.
16. **Ordonnance** : fiche dont le médicament exige l'ordonnance : sans `ordonnanceVerifiee` : 400 `ORDONNANCE_NON_CONFIRMEE` `details [{ stockId, nom }]` ; avec `ordonnanceVerifiee: true` : acceptée, `data.ordonnanceVerifiee` vrai.
17. **Lignes** : même fiche deux fois en `BOITE` : 400 `VALIDATION` contrainte `stockUnique` ; fiche coef 10, déconditionnable, prix boîte 1000, prix unité 120, lot 30 coef 10 : lignes `[{ quantite: 1 }, { quantite: 3, unite: 'UNITE' }]` acceptées, deux lignes (quantités 10 et 3), total 1360, `soldeProduit` 17, somme des allocations de chaque ligne = sa quantité ; fiche archivée (`UPDATE "StockMedicament" SET "archiveLe" = now()`) : 404 `STOCK_INTROUVABLE` `details [{ stockId }]` ; fiche `stk-21` (autre pharmacie) : 404 `STOCK_INTROUVABLE`.
18. **Alerte de stock bas** (`createManyNotifications` remis à zéro) : fiche coef 10, prix boîte 1000, lot 105 coef 10 (seuil 10 boîtes, soit 100 UM). Vente de 1 boîte : un appel dont le message vaut `Le stock de "<nom>" est descendu à 95 unités.` ; seconde vente de 1 boîte : aucun nouvel appel ; `createManyNotifications` rejeté une fois (`mockRejectedValueOnce`) sur une fiche identique franchissant le seuil : la vente réussit.
19. **Ventes historiques** : `detailVente(PHARMACIE, 'vte-p1-1', VENDEUR)` : `statut`, `numero`, `lignes` inchangés, `poste.code` `REPRISE`, `paiements` vide, chaque ligne `allocations` vide, `session.ouverteAutomatiquement` faux, `provisoire` faux.
20. **Invariants** (dernier test) : `verifierStock(base.client).totalAnomalies` vaut 0 ; requête SQL : lignes de vente de `str-pharma-1` qui ont des allocations, aucune PROVISOIRE, et dont la somme des DEFINITIVE diffère de la quantité : 0 ; ventes `T1-%` de la pharmacie rattachées à une session technique : 0 ; toutes ces ventes ont `pointDeVenteId` = `pv1` et `typePiece` `VENTE`.

Aucune URL, aucun mot de passe, aucune valeur de `.env` dans les tests ni dans leurs messages (D454).

#### 9.6 `test/db/non-regression-lectures.db-spec.ts` (D462, D543)

Seuls changements : la ligne `import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';` et, dans le bloc de construction, `ventes = new VenteService(prisma, notifications, stockageFactice, acces, permissionsFactices, new MouvementsStockService(), new SessionsCaisseService(prisma, acces, permissionsFactices));`. Appels, assertions, ajustements et instantanés intouchés : le test doit rester vert tel quel (lectures historiques identiques par projection, D458).

### 10. `CLAUDE.md` du dépôt back

- Puce « Ventes en pharmacie (B13, lot 7 ; B14, lot 8) » : ajouter en tête de la sous-puce « Création » la phrase « Contrat de création remplacé par la tranche pharmacie 1 (PB11, puce « Vente recâblée » plus bas) ; les règles ci-dessous restent vraies pour la liste, le détail et l'annulation jusqu'à PB12. »
- Puce PB08 : remplacer « L'import Excel du stock et la vente écrivent encore le compteur gelé jusqu'à PB11, PB14 et PB15. » par « L'import Excel du stock écrit encore le compteur gelé jusqu'à PB14 et PB15. »
- Ajouter après la puce PB10 une puce « **Vente recâblée (tranche pharmacie 1, PB11)** » qui décrit en français, sans tiret long : permissions `vente:write` et `caisse:utiliser` ; corps `{ lignes: [{ stockId, quantite, unite?, sortieManuelle?: { lotId, motif } }], paiements?: [{ mode, montant, reference?, montantRecu? }], posteId?, clientNom?, clientTelephone?, ordonnanceVerifiee? }` ; `quantite` = boîtes sans `unite` ; prix de la fiche ; ligne en UM (`quantite`, `prixUnitaire` par UM, `sousTotal` de référence) ; allocations reliquat puis FEFO, provisoire et anomalie `STOCK_NEGATIF` sans refus ; 409 `SORTIE_MANUELLE_REQUISE` et sortie manuelle motivée ; poste web par défaut `web-defaut:<userId>` ; session ouverte automatiquement ; paiements (espèces par défaut, D538) ; numéro `T<ordre>-NNNNNNN` sur `CompteurTicket` ; clé d'idempotence permanente ; champs ajoutés à la réponse (D540) et coûts retirés sans `marge:read` ; ordre des refus (D535) et codes ajoutés ; alerte de stock bas au passage de l'état normal, seuil en boîtes.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés (les seuls déplacements permis sont ceux des sections 1 et 5). Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (messages en français, actionnables, aucun tiret cadratin ni demi-cadratin nulle part). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Aucune migration, aucun `prisma generate`, jamais `prisma migrate dev`, `migrate reset` ni `db push` sur la base de dev. Ne jamais afficher ni écrire d'URL de base, de mot de passe ni de valeur de `.env`. Si une étape se révèle impossible telle qu'écrite (contrainte de base, type Prisma), s'arrêter en BLOCKED avec la commande et l'erreur, sans contournement.

Fichiers touchés attendus (et seulement eux) : `src/pharmacie/jour-metier.ts` (nouveau), `src/pharmacie/vente-regles.ts` (nouveau), `src/pharmacie/vente-regles.spec.ts` (nouveau), `src/pharmacie/vente.service.ts`, `src/pharmacie/vente.controller.ts`, `src/pharmacie/dto/vente.dto.ts`, `src/pharmacie/vente.http.spec.ts`, `src/pharmacie/vente.service.spec.ts` (supprimé), `src/pharmacie/stock/lecture-stock.ts`, `src/pharmacie/points-de-vente.service.ts`, `src/pharmacie/caisse/sessions-caisse.service.ts`, `src/pharmacie/pharmacie.service.ts` (ligne d'import seulement), `src/common/filters/codes-erreur.ts`, `src/common/filters/all-exceptions.filter.ts`, `src/common/filters/all-exceptions.filter.spec.ts`, `test/db/vente.db-spec.ts` (nouveau), `test/db/non-regression-lectures.db-spec.ts`, `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/pharmacie/jour-metier.ts src/pharmacie/vente-regles.ts src/pharmacie/vente-regles.spec.ts src/pharmacie/vente.service.ts src/pharmacie/vente.controller.ts src/pharmacie/dto/vente.dto.ts src/pharmacie/vente.http.spec.ts src/pharmacie/stock/lecture-stock.ts src/pharmacie/points-de-vente.service.ts src/pharmacie/caisse/sessions-caisse.service.ts src/pharmacie/pharmacie.service.ts src/common/filters/codes-erreur.ts src/common/filters/all-exceptions.filter.ts src/common/filters/all-exceptions.filter.spec.ts test/db/vente.db-spec.ts test/db/non-regression-lectures.db-spec.ts` : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert (dont `vente-regles.spec.ts` avec ses 15 tests, `vente.http.spec.ts`, `all-exceptions.filter.spec.ts`, et les specs existantes de PB05 et PB10 sans modification).
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/vente.db-spec.ts` (20 tests), `non-regression-lectures.db-spec.ts` (instantanés intouchés), `sessions-caisse.db-spec.ts`, `points-de-vente.db-spec.ts`, `commandes-stock.db-spec.ts`, `schema-derive.db-spec.ts`.
5. `git status --porcelain` ne liste que les fichiers de la section « Fichiers touchés attendus » ; `git diff --stat -- test/db/instantanes prisma` est vide.
6. `grep -rn "CompteurVente\|SOS_IDEMPOTENCE_HEURES\|STOCK_INSUFFISANT\|MEDICAMENT_EXPIRE" src/pharmacie/vente.service.ts src/pharmacie/vente.controller.ts` : aucune ligne.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées (`git diff -U0 | grep -P "[\x{2013}\x{2014}]"` vide).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
