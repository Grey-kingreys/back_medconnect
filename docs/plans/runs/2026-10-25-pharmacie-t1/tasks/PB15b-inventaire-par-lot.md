# PB15b - Inventaire par lot, tolérance par fiche, anomalies d'écart

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche très détaillée, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages d'erreur et de succès lus par les pharmaciens, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Deuxième des trois sous-fiches de PB15 (D583). Prérequis : PB15a validé et commité (`src/pharmacie/inventaires/inventaires.controller.ts`, `src/pharmacie/dto/inventaires.dto.ts`, code `ANOMALIE_DEJA_TRAITEE` existent).

PB15b livre l'inventaire par lot du plan (3.2) :

- `POST /pharmacie/:structureId/inventaires` (`inventaire:write`) : comptage absolu par lot ; un mouvement `INVENTAIRE` par ligne qui vise un lot, y compris à écart nul (CA8, D417) ; tolérance évaluée par fiche, une anomalie `ECART_INVENTAIRE` par fiche au-dessus, attribuée à l'auteur (D591) ;
- `GET /pharmacie/:structureId/inventaires` (liste) et `GET .../inventaires/:inventaireId` (détail) ;
- ciblage du lot d'une ligne par une règle pure partagée avec l'import de PB15c (D589), quantité en unités ou en boîtes et unités en plus (D590) ;
- ventes faites sans stock rattachées par l'inventaire, le stock final de chaque lot compté étant égal au comptage (D592) ;
- un cœur `enregistrerDansTransaction` réutilisable par l'import, avec un mode qui écarte les lignes refusées au lieu de tout refuser, et une simulation sans écriture (D595).

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate`** : `Inventaire`, `LigneInventaire` (immuables, CHECK `quantiteComptee >= 0` et `ecart = quantiteComptee - quantiteTheorique`, `lotId` nullable, `anomalieId` FK Restrict) existent (M5) ; `MouvementStock_quantite_check` permet un `INVENTAIRE` nul (M4). Ne pas toucher aux migrations, aux retours arrière, aux instantanés, ni aux fichiers `test/db/*.db-spec.ts` existants. Jamais `prisma migrate dev`, `migrate reset` ni `db push`.

Décisions applicables : D404, D411, D417, D466, D473, D507, D548, D554, D559, D570, D571, D573, D576, D577, D578, et celles de cette fiche, D589 à D595.

### Contexte vérifié (ne pas re-découvrir)

- `MouvementsStockService` : `verrouillerFiches`, `ecrire` (un `INVENTAIRE` doit avoir un lot : `PIECES_SANS_LOT` ne contient pas `INVENTAIRE`, ne pas le changer), `creerLot(tx, NouveauLot)` (écrit aujourd'hui toujours un premier mouvement `RECEPTION`).
- `src/pharmacie/stock/resolution-provisoires.ts` : `resoudreProvisoires(tx, mouvementsStock, { pointDeVenteId, stockMedicamentIds, pieceId, auteurId, jour })` lit par fiche les allocations `PROVISOIRE` éligibles (quantité positive, pièce `VENTE` ou `REGULARISATION` du point de vente, sans pièce liée, D548), planifie par `planifierResolution` (`src/pharmacie/domaine/resolution.ts` : lots non périmés à solde positif en FEFO, ventes les plus anciennes d'abord, partielle permise) et écrit (deux mouvements `VENTE` de pièce `RESOLUTION`, `PROVISOIRE` vers `REMPLACEE`, `DEFINITIVE` par lot et `PROVISOIRE` du reste), `ResolutionEcrite` exportée. `ReceptionsService.presenterReception` (privée) relit les résolutions d'une pièce (allocations `remplaceeParPieceId` = pièce et somme des mouvements `RESOLUTION` de `evenementId` `resolution:<allocation>:`, triées par numéro de vente puis allocation).
- `LotCandidat` (`src/pharmacie/domaine/selection-lots.ts`) : `{ id, numeroLot, dateExpiration (AAAA-MM-JJ | null), dateReception (ISO), solde (>= 0), coefficientReception, coutUnitaire, lotTechnique }` ; `comparerFefo`, `estPerime`. `lireLotsCandidats` ne lit que les lots à solde positif.
- `ReceptionsService.enregistrerDansTransaction` : modèle exact des étapes (point de vente, rejeu par `id`, verrous de ligne `FOR NO KEY UPDATE` triés filtrés par structure, 404 `STOCK_INTROUVABLE` `details [{ stockId }]`, désarchivage audité avant les verrous consultatifs, verrous consultatifs triés). `MESSAGE_FICHE_NON_QUALIFIEE` y est exporté. `ENTIER_MAX`, `jourValide` (`src/pharmacie/domaine/reception.ts`).
- Filtre d'erreurs (`src/common/filters/all-exceptions.filter.ts`) : `CODES_AVEC_DETAILS` ne contient pas `LOT_REQUIS` ; `assainirDetails` ignore un lot dont `dateExpiration` n'est pas une chaîne.
- Fixture : `usr-admin-p1` (Fatoumata Camara, titulaire de `str-pharma-1`), `usr-pharm-p1` (Mamadou Diallo). Modèles de tests : `test/db/resolution.db-spec.ts`, `test/db/receptions.db-spec.ts`, `test/db/sorties-anomalies.db-spec.ts` (PB15a).
- Ordre des verrous de la tranche : poste, session, `CompteurTicket`, ligne de fiche (`FOR NO KEY UPDATE`), verrou consultatif de fiche. L'inventaire, comme la réception (D570), ne prend ni poste, ni session, ni `CompteurTicket`, ne verrouille aucune ligne de `Vente` : aucun cycle avec la vente, l'annulation, la réception, la qualification ni la correction de quantité.
- Ne jamais importer `src/pharmacie/pharmacie.service.ts` depuis les fichiers de cette fiche (PB15c fait dépendre `PharmacieService` de `InventairesService`).

### 1. `src/common/filters/all-exceptions.filter.ts` (+ spec)

- `LOT_REQUIS` ajouté à `CODES_AVEC_DETAILS`.
- `LotDetail.dateExpiration` devient `string | null` ; dans `assainirDetails`, la condition de rejet d'un lot devient `typeof l.lotId !== 'string' || (typeof l.dateExpiration !== 'string' && l.dateExpiration !== null) || typeof l.quantite !== 'number'`, et `dateExpiration: l.dateExpiration` est recopié tel quel. Rien d'autre.
- `src/common/filters/all-exceptions.filter.spec.ts` : un test ajouté `LOT_REQUIS recopie les lots, date nulle comprise` : `ConflictException({ message: 'm', code: 'LOT_REQUIS', details: [{ stockId: 's', nom: 'n', lots: [{ lotId: 'a', numeroLot: null, dateExpiration: null, quantite: 3 }, { lotId: 'b', numeroLot: 'B1', dateExpiration: '2027-01-31', quantite: 2, coutUnitaire: 9 }] }] })` : `details` `toEqual([{ stockId: 's', nom: 'n', lots: [{ lotId: 'a', numeroLot: null, dateExpiration: null, quantite: 3 }, { lotId: 'b', numeroLot: 'B1', dateExpiration: '2027-01-31', quantite: 2 }] }])`. Suivre le style des tests voisins de `SORTIE_MANUELLE_REQUISE`.

### 2. `src/pharmacie/stock/mouvements-stock.service.ts` (D593)

`NouveauLot` gagne `typeMouvement?: 'RECEPTION' | 'INVENTAIRE';` (commentaire « Type du premier mouvement : RECEPTION par défaut, INVENTAIRE pour un lot trouvé à l'inventaire. »). Dans `creerLot`, `type: l.typeMouvement ?? 'RECEPTION'`. Rien d'autre. Test ajouté à `mouvements-stock.service.spec.ts` seulement si ce fichier teste déjà `creerLot` par doublure ; sinon la couverture est en base (test 8 de la section 10).

### 3. `src/pharmacie/stock/resolution-provisoires.ts` (extraction sans changement de comportement, D593)

1. `export interface ProvisoireEligible { id: string; quantite: number; ligneVenteId: string; ligneVente: { nomMedicament: string; vente: { id: string; numero: string; createdAt: Date } } }`.
2. `export async function lireProvisoiresEligibles(tx, pointDeVenteId: string, stockId: string): Promise<ProvisoireEligible[]>` : la requête `allocationLot.findMany` actuelle, à l'identique.
3. `export async function ecrireResolutions(tx, mouvementsStock, p: { pointDeVenteId: string; stockId: string; pieceId: string; auteurId: string | null }, provisoires: readonly ProvisoireEligible[], plan: readonly ResolutionPlanifiee[]): Promise<ResolutionEcrite[]>` : la boucle `for (const r of plan)` actuelle, à l'identique (mouvements, `updateMany`, `createMany`, `ResolutionEcrite`).
4. `export async function lireResolutionsDePiece(client: Pick<Prisma.TransactionClient, 'allocationLot' | 'mouvementStock'>, pieceId: string): Promise<ResolutionEcrite[]>` : le bloc actuel de `ReceptionsService.presenterReception` (allocations `remplaceeParPieceId: pieceId`, agrégation par allocation avec `pieceOrigineType: 'RESOLUTION', pieceOrigineId: pieceId, lotId: { not: null }, evenementId: { startsWith: \`resolution:${a.id}:\` }`, tri) déplacé ici.
5. `resoudreProvisoires` : pour chaque fiche triée : `verrouillerFiches`, `lireProvisoiresEligibles`, `continue` si vide, `lireLotsCandidats`, `planifierResolution`, `resultat.push(...(await ecrireResolutions(...)))`. Comportement identique.
6. `receptions.service.ts` : `presenterReception` appelle `lireResolutionsDePiece(client, receptionId)` à la place du bloc déplacé (le type `ClientLecture` reste `Pick<..., 'reception' | 'allocationLot' | 'mouvementStock'>`). Seul changement de ce fichier.

`test/db/resolution.db-spec.ts`, `receptions.db-spec.ts` et `import-livraison.db-spec.ts` restent verts sans modification.

### 4. `src/pharmacie/stock/lecture-stock.ts`

Ajouter :

```ts
/**
 * Tous les lots des fiches demandées au point de vente, solde nul compris (ciblage
 * d'un inventaire, D589). À appeler sous les verrous des fiches.
 */
export async function lireTousLesLots(
  client: Pick<Prisma.TransactionClient, 'lotStock'>,
  pointDeVenteId: string,
  stockMedicamentIds: readonly string[],
): Promise<Map<string, LotCandidat[]>>
```

Même corps que `lireLotsCandidats` sans le filtre `agregat` (solde = `agregat?.quantite ?? 0`), une entrée (éventuellement vide) par identifiant.

### 5. `src/pharmacie/domaine/inventaire.ts` (nouveau, règles pures, D589 à D592)

```ts
import { ENTIER_MAX } from './reception';
import { planifierResolution, type ProvisoireAResoudre, type ResolutionPlanifiee } from './resolution';
import { comparerFefo, type LotCandidat } from './selection-lots';
import { exigerEntier } from './quantites';

/** Numéro de lot comparable : espaces retirés, minuscules. */
export function normaliserNumeroLot(numero: string): string {
  return numero.replace(/\s+/g, '').toLowerCase();
}

export interface SaisieCible {
  lotId: string | null;
  /** Rogné, null si vide. */
  numeroLot: string | null;
  /** AAAA-MM-JJ valide ou null. */
  dateExpiration: string | null;
  sansPeremption: boolean;
  /** Vrai si la quantité comptée est nulle (connue avant toute conversion). */
  quantiteNulle: boolean;
}

export type CodeRefusCible =
  | 'LOT_INTROUVABLE'
  | 'LOT_REQUIS'
  | 'DATE_PEREMPTION_REQUISE'
  | 'LOT_INCONNU_VIDE';

export type CibleLot =
  | { type: 'LOT'; lotId: string }
  | { type: 'NOUVEAU'; numeroLot: string | null; dateExpiration: string | null }
  | { type: 'SANS_LOT' }
  | { type: 'REFUS'; code: CodeRefusCible };
```

`export function ciblerLot(s: SaisieCible, lots: readonly LotCandidat[]): CibleLot` (`lots` = tous les lots de la fiche au point de vente, solde nul compris). Date visée `dv` = `s.dateExpiration` si non nulle, sinon `null` si `s.sansPeremption`, sinon « aucune date ». Dans l'ordre :

1. `s.lotId` non nul : lot de cet `id` dans `lots` : `LOT`, sinon `REFUS LOT_INTROUVABLE`.
2. `s.numeroLot` non nul : `memes` = lots de même `normaliserNumeroLot` ; 1 : `LOT` (la date saisie est ignorée, l'inventaire ne corrige jamais une date) ; plus d'un : si une date est visée, `memes` filtrés par `dateExpiration === dv` : 1 : `LOT`, sinon `REFUS LOT_REQUIS` ; plus d'un sans date visée : `REFUS LOT_REQUIS` ; 0 : étape 5.
3. Une date est visée (sans numéro) : `enStock` = lots à solde positif de `dateExpiration === dv` ; 1 : `LOT` ; plus d'un : `REFUS LOT_REQUIS` ; 0 : étape 5.
4. Ni lot, ni numéro, ni date : `enStock` = lots à solde positif ; 1 : `LOT` ; plus d'un : `REFUS LOT_REQUIS` ; 0 : `s.quantiteNulle` ? `SANS_LOT` : `REFUS DATE_PEREMPTION_REQUISE`.
5. Nouveau lot : `s.quantiteNulle` : `REFUS LOT_INCONNU_VIDE` ; aucune date visée : `REFUS DATE_PEREMPTION_REQUISE` ; sinon `NOUVEAU { numeroLot: s.numeroLot, dateExpiration: dv }` (une date passée est acceptée : l'inventaire constate ce qui est en rayon).

```ts
export interface LigneCiblee {
  /** Index de la ligne dans la saisie. */
  index: number;
  cible:
    | { type: 'LOT'; lotId: string }
    | { type: 'NOUVEAU'; idVirtuel: string; numeroLot: string | null; dateExpiration: string | null }
    | { type: 'SANS_LOT' };
  /** Unités minimales comptées, >= 0 (0 pour SANS_LOT). */
  quantiteComptee: number;
}

export interface EntreePlanInventaire {
  lots: readonly LotCandidat[];
  lignes: readonly LigneCiblee[];
  provisoires: readonly ProvisoireAResoudre[];
  /** Unités par boîte de la fiche : coefficient d'un nouveau lot. */
  coefficientBoite: number;
  /** ISO 8601 : date de réception d'un nouveau lot (la même que celle passée à creerLot). */
  dateReceptionNouveaux: string;
  /** toleranceInventaire de la fiche, nul = 0 (D411). */
  tolerance: number;
  jour: string;
}

export interface LignePlanifiee {
  index: number;
  /** Lot visé ; idVirtuel pour un nouveau lot ; null pour SANS_LOT. */
  lotId: string | null;
  nouveauLot: boolean;
  /** Solde du lot avant l'inventaire (0 pour un nouveau lot ou SANS_LOT). */
  soldeAvant: number;
  quantiteTheorique: number;
  quantiteComptee: number;
  ecart: number;
  /** Quantité du mouvement INVENTAIRE (null pour SANS_LOT : aucun mouvement). */
  mouvement: number | null;
}

export interface PlanInventaireFiche {
  lignes: LignePlanifiee[];
  resolution: ResolutionPlanifiee[];
  ecartFiche: number;
  sousTolerance: boolean;
}
```

`export function planifierInventaireFiche(e: EntreePlanInventaire): PlanInventaireFiche` :

1. Contrôles (`RangeError`, le service filtre avant) : `exigerEntier(quantiteComptee, 'quantiteComptee', 0)`, `exigerEntier(tolerance, 'tolerance', 0)`, `exigerEntier(coefficientBoite, 'coefficientBoite', 1)` ; deux lignes `LOT` du même `lotId`, deux `NOUVEAU` du même `idVirtuel` ou deux `SANS_LOT` : erreur ; une ligne `SANS_LOT` de quantité non nulle : erreur.
2. `R` = somme des `provisoires[].quantite`.
3. Candidats du plan de rattachement : pour chaque lot existant, `solde` = `quantiteComptee + R` s'il est visé par une ligne `LOT`, sinon son `solde` ; pour chaque `NOUVEAU`, un candidat `{ id: idVirtuel, numeroLot, dateExpiration, dateReception: dateReceptionNouveaux, solde: quantiteComptee + R, coefficientReception: coefficientBoite, coutUnitaire: 0, lotTechnique: false }`. Justification (D592) : le comptage est fait après les ventes sans stock, déjà sorties du rayon ; un lot compté peut donc recevoir ces ventes au-delà de son comptage, son mouvement d'inventaire le relève d'autant et la résolution le ramène au comptage.
4. `resolution = planifierResolution(e.provisoires, candidats, e.jour)` ; `E(l)` = somme des prises sur le lot `l`.
5. Par ligne : `LOT` : `soldeAvant = S` (solde du lot), `quantiteTheorique = S - E(l)`, `ecart = X - quantiteTheorique`, `mouvement = ecart` ; `NOUVEAU` : `soldeAvant = 0`, `quantiteTheorique = -E(l)`, `ecart = X + E(l)`, `mouvement = ecart` (au moins 1) ; `SANS_LOT` : `soldeAvant 0`, `quantiteTheorique 0`, `quantiteComptee 0`, `ecart 0`, `mouvement null`, `lotId null`.
6. `ecartFiche` = somme des `ecart` ; `sousTolerance = Math.abs(ecartFiche) <= tolerance` (D591 : tolérance par fiche, écarts de lots compensés).
7. Lignes renvoyées dans l'ordre de `index`.

Conséquence vérifiée par les tests : après le mouvement `INVENTAIRE` puis la résolution, chaque lot compté vaut exactement `quantiteComptee` ; un lot non compté perd ce que la résolution y prend (comme à la réception, D576) ; les ventes sur un lot compté périmé ne sont jamais rattachées (CA13).

Exporter aussi `export function lotsEnStockFefo(lots: readonly LotCandidat[]): LotCandidat[]` (lots à solde positif triés par `comparerFefo`), utilisé pour les `details` de `LOT_REQUIS`.

### 6. `src/pharmacie/dto/inventaires.dto.ts` (ajouts)

```ts
export class LigneInventaireDto {
  stockId: string;            // @IsString @IsNotEmpty @MaxLength(64)
  lotId?: string;             // @IsOptional @IsString @IsNotEmpty @MaxLength(64)
  numeroLot?: string;         // @IsOptional @IsString @Transform(rognerTexte) @MaxLength(64)
  dateExpiration?: string;    // @IsOptional @IsString @Matches(/^\d{4}-\d{2}-\d{2}$/)
  sansPeremption?: boolean;   // @IsOptional @IsBoolean
  quantiteComptee?: number;   // @IsOptional @IsInt @Min(0) @Max(2147483647) : unités minimales
  nombreBoites?: number;      // @IsOptional @IsInt @Min(0) @Max(1000000)
  unitesEnPlus?: number;      // @IsOptional @IsInt @Min(0) @Max(1000000000) : unités d'une boîte entamée
}
export class CreerInventaireDto {
  id?: string;                // @IsOptional @IsUUID
  commentaire?: string;       // @IsOptional @IsString @Transform(rognerTexte) @MaxLength(500)
  lignes: LigneInventaireDto[]; // @IsArray @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => LigneInventaireDto)
}
export class ListerInventairesDto { page?: number } // copie de ListerReceptionsDto
```

Décorateurs Swagger sur chaque champ (descriptions : « Lot compté ; sinon numéro de lot, date de péremption, ou lot unique en stock », « Unités minimales comptées, ou bien nombreBoites (et unitesEnPlus) », « Boîtes entières comptées, multipliées par les unités par boîte du lot », « Unités d'une boîte entamée, avec nombreBoites »).

### 7. `src/pharmacie/inventaires/inventaires.service.ts` (nouveau, D589 à D595)

Constantes exportées (texte exact) :

```ts
export const MESSAGE_QUANTITE_COMPTEE_REQUISE =
  "Indiquez la quantité comptée : un nombre d'unités, ou un nombre de boîtes (et les unités en plus d'une boîte entamée).";
export const MESSAGE_QUANTITE_COMPTEE_UNIQUE =
  "Indiquez soit le nombre d'unités, soit le nombre de boîtes, pas les deux.";
export const MESSAGE_UNITES_SANS_BOITES =
  "Les unités en plus s'ajoutent à un nombre de boîtes : indiquez aussi le nombre de boîtes (0 si aucune boîte entière).";
export const MESSAGE_QUANTITE_COMPTEE_TROP_GRANDE =
  'La quantité comptée est trop grande pour être enregistrée. Vérifiez la quantité.';
export const MESSAGE_DATE_INVALIDE_INVENTAIRE =
  "La date de péremption n'existe pas : vérifiez-la (format AAAA-MM-JJ).";
export const MESSAGE_STOCK_INTROUVABLE_INVENTAIRE =
  "Un médicament de l'inventaire est introuvable dans le stock de cette pharmacie.";
export const MESSAGE_LOT_INTROUVABLE_INVENTAIRE =
  'Ce lot est introuvable pour ce médicament.';
export const MESSAGE_INVENTAIRE_LOT_REQUIS =
  'Ce médicament a plusieurs lots en stock : précisez le lot compté (numéro ou date de péremption), une ligne par lot.';
export const MESSAGE_INVENTAIRE_DATE_REQUISE =
  "Ces boîtes ne correspondent à aucun lot en stock : indiquez leur date de péremption, ou précisez que ce médicament n'en a pas.";
export const MESSAGE_LOT_INCONNU_VIDE =
  "Ce lot n'est pas dans votre stock : une quantité comptée de 0 n'a rien à enregistrer. Retirez la ligne ou vérifiez le numéro de lot.";
export const MESSAGE_LOT_COMPTE_DEUX_FOIS =
  "Ce lot est compté deux fois dans l'inventaire : gardez une seule ligne par lot.";
export const MESSAGE_INVENTAIRE_INTROUVABLE = 'Cet inventaire est introuvable.';
export const MESSAGE_IDENTIFIANT_INVENTAIRE =
  'Cet identifiant est déjà utilisé par un autre inventaire.';
export const MESSAGE_INVENTAIRE_REJOUE = 'Cet inventaire était déjà enregistré.';
export const MESSAGE_VENTES_RATTACHEES_INVENTAIRE =
  'Les ventes faites en attente de stock ont été rattachées aux lots comptés.';
export function messageInventaireEnregistre(nombreLignes: number, nombreAnomalies: number): string {
  const debut = nombreLignes === 1 ? 'Inventaire enregistré : 1 ligne.' : `Inventaire enregistré : ${nombreLignes} lignes.`;
  if (nombreAnomalies === 0) return debut;
  return nombreAnomalies === 1
    ? `${debut} 1 écart dépasse la tolérance : il est signalé dans les anomalies.`
    : `${debut} ${nombreAnomalies} écarts dépassent la tolérance : ils sont signalés dans les anomalies.`;
}
```

Types exportés :

```ts
export interface LigneInventaireAEnregistrer {
  stockId: string;
  lotId: string | null;
  numeroLot: string | null;
  dateExpiration: string | null;
  sansPeremption: boolean;
  quantiteComptee: number | null;
  nombreBoites: number | null;
  unitesEnPlus: number | null;
}
export interface InventaireAEnregistrer {
  id?: string;
  commentaire: string | null;
  lignes: LigneInventaireAEnregistrer[];
}
export type CodeRefusLigneInventaire =
  | 'STOCK_INTROUVABLE' | 'LOT_INTROUVABLE' | 'LOT_REQUIS'
  | 'DATE_PEREMPTION_REQUISE' | 'LOT_INCONNU_VIDE' | 'LOT_EN_DOUBLE' | 'QUANTITE_TROP_GRANDE';
export interface RefusLigneInventaire {
  index: number;
  code: CodeRefusLigneInventaire;
  /** Pour LOT_REQUIS : lots à solde positif en FEFO. */
  lots?: { lotId: string; numeroLot: string | null; dateExpiration: string | null; quantite: number }[];
}
export interface LigneEvaluee {
  index: number;
  stockId: string;
  lotId: string | null;       // réel ; null pour un nouveau lot (simulation) ou SANS_LOT
  nouveauLot: boolean;
  soldeAvant: number;
  quantiteTheorique: number;
  quantiteComptee: number;
  ecart: number;
  sousTolerance: boolean;
}
export interface InventaireEcrit {
  inventaireId: string | null;   // null si aucune ligne retenue (mode rejeterLignes)
  cree: boolean;
  lignes: (LigneEvaluee & { anomalieId: string | null })[]; // lotId réel, nouveaux lots compris
  refusees: RefusLigneInventaire[];
  anomalies: { id: string; stockId: string }[];
  resolutions: ResolutionEcrite[];
  avertissements: AvertissementReception[]; // type réutilisé de receptions.service
}
```

Constructeur `(prisma: PrismaService, accesPharmacie: AccesPharmacieService, mouvementsStock: MouvementsStockService)`. `OPTIONS_TRANSACTION_INVENTAIRE = { maxWait: 10_000, timeout: 60_000 }`. `PAR_PAGE = 20`.

7.1. Contrôle de forme `private controlerForme(lignes)` (sans base, avant toute transaction, pour la route seulement ; l'import construit des lignes déjà valides). Par ligne `i`, champ `lignes.${i}.<champ>`, toutes les lignes en cause, une seule exception `BadRequestException({ message: <message du premier refus>, code: 'VALIDATION', champs })`, dans cet ordre de règles par ligne :

- ni `quantiteComptee` ni `nombreBoites` : `quantiteComptee` `['quantiteRequise']`, `MESSAGE_QUANTITE_COMPTEE_REQUISE` ;
- les deux : `quantiteComptee` `['quantiteUnique']`, `MESSAGE_QUANTITE_COMPTEE_UNIQUE` ;
- `unitesEnPlus` sans `nombreBoites` : `unitesEnPlus` `['unitesSansBoites']`, `MESSAGE_UNITES_SANS_BOITES` ;
- `dateExpiration` donnée et `!jourValide` : `dateExpiration` `['dateValide']`, `MESSAGE_DATE_INVALIDE_INVENTAIRE`.

`quantiteNulle(l)` = `(l.quantiteComptee ?? (l.nombreBoites ?? 0) + (l.unitesEnPlus ?? 0)) === 0`.

7.2. Évaluation commune `private async evaluer(client, pointDeVenteId: string | null, structureId, lignes, jour)` (lecture seule ; sous verrous quand l'appelant les tient) renvoie `{ fiches: Map<stockId, { id, nom, coefficientBoite, toleranceInventaire, qualifie, archiveLe }>, lotsParFiche, provisoiresParFiche, retenues: LigneCiblee par fiche, refus: RefusLigneInventaire[], plans: Map<stockId, PlanInventaireFiche>, dateReceptionNouveaux }` :

1. Fiches lues par `stockMedicament.findMany({ where: { id: { in }, structureId } })` (avec `medicament.nom`) ; ligne d'une fiche absente : refus `STOCK_INTROUVABLE`.
2. Sans point de vente (simulation d'une pharmacie neuve) : lots et provisoires vides ; sinon `lireTousLesLots(client, pointDeVenteId, ids)` et, par fiche, `lireProvisoiresEligibles(client, pointDeVenteId, stockId)` converties en `ProvisoireAResoudre` (`allocationId: id`, `venteCreeLe: ligneVente.vente.createdAt.toISOString()`, `quantite`).
3. Par ligne (ordre de la saisie) : `ciblerLot({ lotId, numeroLot (rogné, null si vide), dateExpiration, sansPeremption, quantiteNulle }, lots de la fiche)` ; `REFUS` : refus du même code (`LOT_REQUIS` porte `lots` = `lotsEnStockFefo` en `{ lotId, numeroLot, dateExpiration, quantite: solde }`) ; sinon quantité en UM : `quantiteComptee` si donnée, sinon `nombreBoites x coef + (unitesEnPlus ?? 0)` où `coef` = `coefficientReception` du lot visé (`LOT`) ou `coefficientBoite` de la fiche (`NOUVEAU`), 0 pour `SANS_LOT` ; `idVirtuel` d'un nouveau lot = `nouveau:<index>`.
4. Doublons (après le ciblage, dans l'ordre de la saisie) : deuxième ligne d'une même fiche visant le même `lotId`, ou deux `NOUVEAU` de même fiche, même `normaliserNumeroLot(numeroLot ?? '')` et même date, ou deux `SANS_LOT` de même fiche : la seconde est refusée `LOT_EN_DOUBLE`.
5. Bornes : `R` de la fiche ; ligne retenue avec `quantiteComptee + R > ENTIER_MAX` : refus `QUANTITE_TROP_GRANDE`.
6. `dateReceptionNouveaux = new Date().toISOString()` (une valeur par évaluation) ; par fiche ayant des lignes retenues : `planifierInventaireFiche({ lots, lignes retenues, provisoires, coefficientBoite, dateReceptionNouveaux, tolerance: toleranceInventaire ?? 0, jour })`.

7.3. `async simuler(client, structureId: string, lignes: LigneInventaireAEnregistrer[], jour: string): Promise<{ lignes: LigneEvaluee[]; refusees: RefusLigneInventaire[] }>` : point de vente d'ordre 1 lu (absent : null), `evaluer`, aucune écriture ni verrou ; `LigneEvaluee` d'un nouveau lot : `lotId null`, `nouveauLot true`. Utilisé par l'aperçu de PB15c.

7.4. `async enregistrerDansTransaction(tx, acces, entree: InventaireAEnregistrer, ip: string | null = null, options: { rejeterLignes?: boolean } = {}): Promise<InventaireEcrit>` :

1. Point de vente (comme la réception : `findUnique` puis `assurerPointDeVente` s'il manque).
2. Rejeu par `entree.id` : `inventaire.findUnique` ; même point de vente : `{ inventaireId, cree: false, lignes: [], refusees: [], anomalies: [], resolutions: [], avertissements: [] }` ; autre : 409 `IDENTIFIANT_DEJA_UTILISE`, `MESSAGE_IDENTIFIANT_INVENTAIRE`.
3. Verrous de ligne des fiches demandées, triées, `SELECT "id", "archiveLe" FROM "StockMedicament" WHERE "id" = ${id} AND "structureId" = ${structureId} FOR NO KEY UPDATE` (D570). Sans `rejeterLignes` : fiche absente : `NotFoundException({ message: MESSAGE_STOCK_INTROUVABLE_INVENTAIRE, code: 'STOCK_INTROUVABLE', details: [{ stockId }] })` (toutes les absentes).
4. Désarchivage, avant les verrous consultatifs : fiche archivée dont au moins une ligne a une quantité non nulle (`!quantiteNulle`) : `archiveLe: null` et audit `update` `StockMedicament` `{ avant: { archiveLe }, apres: { archiveLe: null } }` (copie de la réception).
5. `verrouillerFiches(tx, ids)`.
6. `evaluer(tx, pointDeVenteId, ...)`.
7. Refus, sans `rejeterLignes`, groupés par code dans cet ordre, toutes les lignes du code citées : `STOCK_INTROUVABLE` (404, déjà traité en 3) ; `LOT_INTROUVABLE` : `NotFoundException(MESSAGE_LOT_INTROUVABLE_INVENTAIRE)` ; `LOT_REQUIS` : `ConflictException({ message: MESSAGE_INVENTAIRE_LOT_REQUIS, code: 'LOT_REQUIS', details: [{ stockId, nom, lots }] })` ; `DATE_PEREMPTION_REQUISE` : `BadRequestException({ message: MESSAGE_INVENTAIRE_DATE_REQUISE, code: 'DATE_PEREMPTION_REQUISE', details: [{ stockId, nom }] })` ; `LOT_INCONNU_VIDE` : 400 `VALIDATION` `lignes.<i>.quantiteComptee` `['lotInconnuVide']`, `MESSAGE_LOT_INCONNU_VIDE` ; `LOT_EN_DOUBLE` : 400 `VALIDATION` `lignes.<i>.lotId` `['lotUnique']`, `MESSAGE_LOT_COMPTE_DEUX_FOIS` ; `QUANTITE_TROP_GRANDE` : 400 `VALIDATION` `lignes.<i>.quantiteComptee` `['quantiteMaximale']`, `MESSAGE_QUANTITE_COMPTEE_TROP_GRANDE`. Avec `rejeterLignes` : aucun refus levé, les refus sont renvoyés dans `refusees` ; aucune ligne retenue : renvoyer `inventaireId: null`, `cree: false`, sans rien créer.
8. `inventaire.create({ data: { ...(entree.id ? { id } : {}), pointDeVenteId, auteurId: user.id, commentaire } })`.
9. Par fiche (identifiants triés), lignes dans l'ordre de `index` :
   - `NOUVEAU` : `creerLot(tx, { stockMedicamentId, pointDeVenteId, numeroLot, dateExpiration: dateExpiration ? jourVersDate(...) : null, quantite: mouvement, coutUnitaire: 0, coutAchatBoite: null, coefficientReception: coefficientBoite, fournisseurId: null, receptionId: null, lotTechnique: false, auteurId, pieceOrigineType: 'INVENTAIRE', pieceOrigineId: inventaireId, motif: null, evenementId: \`inventaire:${inventaireId}:${index}\`, dateReception: new Date(dateReceptionNouveaux), typeMouvement: 'INVENTAIRE' })` ; retenir `idVirtuel` vers `lot.id` ;
   - `LOT` : `ecrire(tx, { evenementId: \`inventaire:${inventaireId}:${index}\`, pointDeVenteId, stockMedicamentId, lotId, type: 'INVENTAIRE', quantite: mouvement, pieceOrigineType: 'INVENTAIRE', pieceOrigineId: inventaireId, motif: null, auteurId })` (quantité nulle permise) ;
   - `SANS_LOT` : aucun mouvement.
   - Puis `ecrireResolutions(tx, mouvementsStock, { pointDeVenteId, stockId, pieceId: inventaireId, auteurId }, provisoires, plan.resolution)` avec les `lotId` virtuels des prises remplacés par les identifiants réels ; aucune résolution si le plan est vide.
   - Puis, si `!sousTolerance` : `anomalie.create({ data: { pointDeVenteId, type: 'ECART_INVENTAIRE', attribueeAId: user.id, pieceType: 'INVENTAIRE', pieceId: inventaireId, details: { stockId, nom, ecart: ecartFiche, tolerance, utilisateurId: user.id, utilisateurNom, lignes: [{ lotId, numeroLot, dateExpiration, quantiteTheorique, quantiteComptee, ecart }] } } })` (lots réels, aucun coût ; `utilisateurNom` = `` `${prenom} ${nom}`.trim() ``).
   - Puis `ligneInventaire.createMany` des lignes de la fiche `{ inventaireId, stockMedicamentId, lotId (réel ou null), quantiteTheorique, quantiteComptee, ecart, sousTolerance, anomalieId (de la fiche ou null) }`.
10. Audit `create` `Inventaire` `{ nombreLignes, nombreFiches, nombreAnomalies }` plus `nombreResolutions` s'il est positif (précédent PB14b).
11. Avertissements : `FICHE_NON_QUALIFIEE` (`MESSAGE_FICHE_NON_QUALIFIEE`) par fiche non qualifiée dont une ligne retenue a utilisé `nombreBoites`.
12. Renvoyer `InventaireEcrit` (`lignes` avec `lotId` réel et `anomalieId`).

7.5. `async enregistrer(structureId, userId, dto: CreerInventaireDto, ip?)` : `acces = verifier` ; `controlerForme` ; lignes converties (`lotId ?? null`, `numeroLot` rogné ou null, `dateExpiration ?? null`, `sansPeremption ?? false`, quantités `?? null`) ; transaction `OPTIONS_TRANSACTION_INVENTAIRE` ; course sur `entree.id` (`estDoublonSur(erreur, 'Inventaire')`) traitée comme la réception (relecture hors transaction, même pharmacie : `cree: false`, sinon 409) ; réponse `{ data: { ...await presenter(this.prisma, inventaireId), cree, avertissements }, message: cree ? messageInventaireEnregistre(lignes.length, anomalies.length) + (resolutions.length > 0 ? \` ${MESSAGE_VENTES_RATTACHEES_INVENTAIRE}\` : '') : MESSAGE_INVENTAIRE_REJOUE, success: true as const }`.

7.6. `private async presenter(client, inventaireId)` : `{ id, createdAt, commentaire, auteur: { id, nom }, lignes: [{ id, stockId, nom, lotId, numeroLot, dateExpiration (AAAA-MM-JJ ou null), lotTechnique, quantiteTheorique, quantiteComptee, ecart, sousTolerance, anomalieId }], anomalies: [{ id, stockId, nom, ecart, statut }], resolutions: await lireResolutionsDePiece(client, inventaireId) }`. Lignes triées par `nom`, puis date nulle d'abord et croissante, puis `numeroLot` nul d'abord, puis `id`. Anomalies = `ECART_INVENTAIRE` de `pieceId` = inventaire, triées par `nom`. Aucune clé de coût.

7.7. `async detail(structureId, userId, inventaireId)` : `verifier` ; `inventaire.findFirst({ where: { id, pointDeVente: { structureId } } })` sinon 404 `MESSAGE_INVENTAIRE_INTROUVABLE` ; `{ data: presenter, message: 'Inventaire trouvé.', success: true as const }`.

7.8. `async lister(structureId, userId, dto: ListerInventairesDto)` : copie de `ReceptionsService.lister` : tri `createdAt` puis `id` décroissants, 20 par page, `{ inventaires: [{ id, createdAt, commentaire, auteur: { id, nom }, nombreLignes, nombreEcarts (lignes d'écart non nul), nombreAnomalies (lignes distinctes `anomalieId` non nuls) }], page, parPage, total }`, message `${total} inventaire(s)`.

### 8. `src/pharmacie/inventaires/inventaires.controller.ts` (ajouts)

Constructeur `(sorties: SortiesStockService, inventaires: InventairesService)`. Routes, `@RequirePermissions(PERMISSIONS.INVENTAIRE_WRITE)` :

- `@Post(':structureId/inventaires') @HttpCode(HttpStatus.OK)` `enregistrerInventaire(req, structureId, @Body() dto: CreerInventaireDto, @Ip() ip)` ; summary « Enregistrer un inventaire (comptage par lot) » ; description « Quantité comptée absolue par lot : quantiteComptee (unités) ou nombreBoites (unités par boîte du lot) et unitesEnPlus. Lot : lotId, sinon numéro de lot, sinon date de péremption, sinon lot unique en stock ; plusieurs lots possibles : 409 LOT_REQUIS (lots dans details) ; boîtes d'un lot inconnu : nouveau lot (date obligatoire, 400 DATE_PEREMPTION_REQUISE). Un mouvement INVENTAIRE par lot compté, même à écart nul. Écart de la fiche au-delà de sa tolérance : anomalie ECART_INVENTAIRE attribuée à l'auteur. Les ventes faites sans stock sont rattachées aux lots comptés, qui finissent à la quantité comptée. id client pour rejouer sans doublon. » ;
- `@Get(':structureId/inventaires')` `listerInventaires(req, structureId, @Query() dto: ListerInventairesDto)` ;
- `@Get(':structureId/inventaires/:inventaireId')` `detailInventaire(req, structureId, inventaireId)`.

### 9. `src/pharmacie/pharmacie.module.ts`

`InventairesService` ajouté aux fournisseurs. Rien d'autre.

### 10. Tests

10.1. `src/pharmacie/domaine/inventaire.spec.ts` (`describe('Règles de l\'inventaire par lot')`), lots fabriqués par une aide `lot(id, solde, date, numero = null)` (`dateReception` croissante avec l'identifiant), `jour = '2026-10-27'` :

1. `ciblage par identifiant` : lot connu `LOT` ; inconnu `REFUS LOT_INTROUVABLE`.
2. `ciblage par numéro, casse et espaces ignorés` : lots `A12` et `B07`, saisie `' a 12 '` : `LOT` A ; deux lots `A12` de dates différentes : sans date `LOT_REQUIS`, avec la date du second `LOT` second ; numéro inconnu avec date : `NOUVEAU` ; numéro inconnu sans date : `DATE_PEREMPTION_REQUISE` ; numéro inconnu et quantité nulle : `LOT_INCONNU_VIDE`.
3. `ciblage par date ou sans péremption` : deux lots en stock de dates d1 et d2 : date d2 `LOT` ; `sansPeremption` vise le lot sans date ; date absente de tout lot en stock : `NOUVEAU` (même si un lot à solde nul porte cette date) ; date passée acceptée pour un nouveau lot.
4. `sans précision` : un seul lot à solde positif (et un lot vide) : `LOT` ; deux : `LOT_REQUIS` ; aucun et quantité nulle : `SANS_LOT` ; aucun et quantité positive : `DATE_PEREMPTION_REQUISE`.
5. `écart et tolérance sous et au-dessus (CA8)` : lot de 30, compté 27, tolérance 5 : théorique 30, écart -3, mouvement -3, `sousTolerance` vrai ; compté 20 : écart -10, faux ; tolérance 0 et compté 29 : faux ; écart nul : mouvement 0.
6. `tolérance par fiche : écarts compensés` : lots 10 et 10 comptés 12 et 8, tolérance 0 : `ecartFiche` 0, vrai.
7. `ventes sans stock : théorique diminué, lot compté au comptage final` : lot L solde 0 compté 3, provisoire 2 : prises 2 sur L, théorique -2, écart 5, mouvement 5 (donc 0 + 5 - 2 = 3) ; lot L solde 5 compté 3, provisoire 2 : théorique 3, écart 0 ; lot L solde 5 compté 1, provisoire 2 : prises 2 sur L, théorique 3, écart -2.
8. `ventes sans stock : FEFO, lot non compté pris d'abord s'il expire avant` : lot A non compté solde 4 (date la plus proche), lot B compté 3, provisoire 2 : prises 2 sur A, B théorique 3 ; lot compté périmé seul : aucune prise.
9. `nouveau lot` : aucun lot, `NOUVEAU` compté 4, provisoire 1 : théorique -1, écart 5, mouvement 5, prise 1 sur l'identifiant virtuel.
10. `contrôles` : deux lignes du même lot : `RangeError` ; `SANS_LOT` non nul : `RangeError`.

10.2. `src/pharmacie/inventaires/inventaires.http.spec.ts` (ajouts, `InventairesService` simulé `{ enregistrer, lister, detail }` fourni à côté de `SortiesStockService` dans le module de test, profil `vendeur` sans `inventaire:write`) ; précision du chef PB15a : le fichier commité a les profils `titulaire` et `lecteur` dans `profils` ; y ajouter `vendeur: { type: 'PHARMACIE', codes: ['stock:read', 'stock:write'] }`, sans modifier les trois tests existants :

4. `permissions : inventaire:write exigé` : vendeur 403 sur les trois routes.
5. `inventaire valide transmis au service` : `{ commentaire: 'Comptage du soir', lignes: [{ stockId: 's', nombreBoites: 2, unitesEnPlus: 3 }] }` : 200, `enregistrer` appelé.
6. `validation du corps d'inventaire` : `lignes: []` (`lignes`), `quantiteComptee: -1`, `nombreBoites: 1.5`, `dateExpiration: '31/12/2027'`, `id: 'x'` : 400 `VALIDATION` au champ attendu.

10.3. `test/db/inventaire.db-spec.ts` (nouveau). Préparation copiée de `test/db/sorties-anomalies.db-spec.ts` (PB15a) plus `inventaires = new InventairesService(prisma, acces, mouvements)` ; permissions doublées : `RESPONSABLE` comme en PB15a plus `'inventaire:write'`, `VENDEUR` `['vente:write', 'caisse:utiliser', 'stock:write', 'inventaire:write']` (le vendeur compte : l'anomalie doit lui être attribuée, pas au titulaire). Préfixes `med-inv-<n>`, `stk-inv-<n>`, catégorie `'Test PB15b'` ; `nouvelleFiche({ coef?, tolerance?, qualifie? })` écrit aussi `toleranceInventaire`. Aide `inventorier(lignes, user = VENDEUR, extra = {})` = `inventaires.enregistrer(PHARMACIE, user, { lignes, ...extra }, '127.0.0.1')`. `describe('Inventaire par lot, sur base de test (PB15b)')`. Tests exacts :

1. `CA8 sous la tolérance : mouvement INVENTAIRE écrit, aucune anomalie` : fiche coef 10 tolérance 5, réception 3 boîtes ; `{ stockId, quantiteComptee: 27 }` : ligne `toMatchObject({ quantiteTheorique: 30, quantiteComptee: 27, ecart: -3, sousTolerance: true, anomalieId: null })` ; un mouvement `{ type: 'INVENTAIRE', quantite: -3, pieceOrigineType: 'INVENTAIRE', pieceOrigineId: data.id, evenementId: \`inventaire:${data.id}:0\`, auteurId: VENDEUR }` ; `soldeLot` 27 ; aucune `Anomalie` de `pieceId` = inventaire ; message `messageInventaireEnregistre(1, 0)`.
2. `CA8 au-dessus de la tolérance : mouvement écrit et anomalie attribuée à l'auteur du comptage` : même fiche, compté 20 : anomalie `{ type: 'ECART_INVENTAIRE', statut: 'OUVERTE', attribueeAId: VENDEUR, pieceType: 'INVENTAIRE', pieceId: data.id }`, `details` `toMatchObject({ stockId, ecart: -10, tolerance: 5, utilisateurNom: 'Mamadou Diallo' })` ; ligne `anomalieId` = son id ; `soldeLot` 20 ; message `messageInventaireEnregistre(1, 1)`.
3. `écart nul : mouvement INVENTAIRE de quantité 0` : compté = solde : mouvement de quantité 0 présent, `sousTolerance` vrai.
4. `tolérance nulle par défaut` : fiche sans tolérance, écart +1 : une anomalie.
5. `tolérance par fiche : écarts de deux lots compensés` : deux réceptions (lots A et B de 10, dates différentes), tolérance 0, comptés 12 et 8 par `lotId` : aucune anomalie, lots 12 et 8.
6. `plusieurs lots sans précision : 409 LOT_REQUIS avec la liste, rien écrit` : `{ stockId, quantiteComptee: 5 }` : 409, `details[0].lots` de longueur 2 (`lotId`, `numeroLot`, `dateExpiration`, `quantite`), nombres d'`Inventaire` et de `MouvementStock` inchangés.
7. `ciblage par numéro de lot et par date` : lots `A12` (d1) et `B07` (d2) : `{ numeroLot: ' a 12 ', quantiteComptee: 4 }` et `{ dateExpiration: d2, quantiteComptee: 6 }` : lots 4 et 6.
8. `nouveau lot trouvé à l'inventaire` : fiche coef 10 avec un lot ; `{ numeroLot: 'Z99', quantiteComptee: 4 }` sans date : 400 `DATE_PEREMPTION_REQUISE` (`details[0].stockId`) ; avec `dateExpiration: jour(-10)` : lot `{ numeroLot: 'Z99', quantiteRecue: 4, coutUnitaire: 0, coutAchatBoite: null, receptionId: null, lotTechnique: false, coefficientReception: 10 }`, son seul mouvement `{ type: 'INVENTAIRE', quantite: 4, pieceOrigineType: 'INVENTAIRE' }`, ligne `{ quantiteTheorique: 0, ecart: 4 }`.
9. `fiche sans lot comptée à 0 : ligne sans lot, aucun mouvement` : `LigneInventaire` `lotId` nul, théorique 0, écart 0 ; aucun `MouvementStock` de `pieceOrigineId` = inventaire.
10. `boîtes et unités en plus, avertissement de fiche non qualifiée` : fiche coef 10 non qualifiée, lot reçu ; `{ nombreBoites: 2, unitesEnPlus: 3 }` : `quantiteComptee` 23 ; `avertissements` contient `{ code: 'FICHE_NON_QUALIFIEE', stockId }`.
11. `refus de saisie` : quantité absente (`quantiteRequise`), les deux (`quantiteUnique`), unités sans boîtes (`unitesSansBoites`), date `2027-02-30` (`dateValide`), même lot deux fois (`lotUnique`), numéro inconnu compté 0 (`lotInconnuVide`) : 400 `VALIDATION`, champ et contrainte attendus.
12. `ventes faites sans stock rattachées, lot final égal au comptage` : fiche coef 1 tolérance 10, réception 5, vente 5 puis vente 2 (provisoire) ; inventaire du lot compté 3 : ligne `{ quantiteTheorique: -2, ecart: 5, sousTolerance: true }` ; allocations de la seconde vente : `REMPLACEE` 2 (`remplaceeParPieceId` = inventaire) et `DEFINITIVE` 2 sur le lot ; `soldeLot` 3, `soldeProduit` 3 ; deux mouvements `RESOLUTION` de `pieceOrigineId` = inventaire ; `data.resolutions` `[{ quantiteResolue: 2, resteProvisoire: 0 }]` ; message terminé par `MESSAGE_VENTES_RATTACHEES_INVENTAIRE`.
13. `lot compté périmé : aucune vente rattachée (CA13)` : réception de 2, vente de 2 (lot vide), vente de 2 (provisoire : aucun lot en stock, donc pas de `SORTIE_MANUELLE_REQUISE`), puis date du lot corrigée à `jour(-3)` ; inventaire du lot compté 4 : provisoire toujours `PROVISOIRE`, `soldeLot` 4, `data.resolutions` vide.
14. `vente annulée jamais rattachée (D548)` : réception de 1, vente de 1, vente de 2 (provisoire) puis annulation de cette dernière ; inventaire du lot compté 3 : allocations des deux pièces inchangées (toujours `PROVISOIRE`), `soldeLot` 3, `data.resolutions` vide.
15. `fiche archivée désarchivée si une quantité est comptée` : compté 2 : `archiveLe` nul, un audit `update` `StockMedicament` ; autre fiche archivée comptée 0 (sans lot) : `archiveLe` non nul.
16. `idempotence` : même `id` deux fois : un `Inventaire`, seconde réponse `cree: false`, message `MESSAGE_INVENTAIRE_REJOUE` ; `id` d'un inventaire de `AUTRE_PHARMACIE` : 409 `IDENTIFIANT_DEJA_UTILISE`.
17. `mode rejeterLignes : lignes refusées écartées, les autres écrites` : `prisma.$transaction((tx) => inventaires.enregistrerDansTransaction(tx, acces, { commentaire: null, lignes: [<fiche à deux lots sans précision>, <fiche à un lot compté 7>, { stockId: 'stk-inconnu', ... }] }, null, { rejeterLignes: true }))` (acces lu par `new AccesPharmacieService(prisma).verifier`) : `refusees` `[{ index: 0, code: 'LOT_REQUIS' }, { index: 2, code: 'STOCK_INTROUVABLE' }]` (`toMatchObject`), une ligne écrite (index 1, lot 7) ; toutes refusées : `inventaireId` null et aucun `Inventaire` créé.
18. `simulation sans écriture` : `inventaires.simuler(prisma, PHARMACIE, lignes, jour(0))` sur un lot de 10 compté 8 : `lignes[0]` `{ soldeAvant: 10, quantiteTheorique: 10, ecart: -2 }` ; nombres d'`Inventaire`, `MouvementStock` et `LotStock` inchangés.
19. `lecture : détail et liste, aucune donnée de coût` : réception avec coût, inventaire ; `detail` : lignes triées, `anomalies`, `auteur.nom` `'Mamadou Diallo'` ; `lister` page 1 : `nombreLignes`, `nombreEcarts`, `nombreAnomalies` ; `cheminsCout` vide sur les deux ; inventaire d'une autre pharmacie : 404 `MESSAGE_INVENTAIRE_INTROUVABLE`.
20. `concurrence : vente en attente puis inventaire, l'inventaire compte la vente` : lot de 10 ; `tenirFiche` ; vente de 2 lancée, `attendreAttentes(1)` ; inventaire compté 7 lancé, `attendreAttentes(2)` ; `liberer()` : les deux aboutissent ; ligne `{ quantiteTheorique: 8, ecart: -1 }`, `soldeLot` 7.
21. `concurrence : inventaire en attente puis vente, la vente part du stock compté` : ordre inverse : ligne `{ quantiteTheorique: 10, ecart: -3 }`, `soldeLot` 5.
22. `concurrence : réception et inventaire simultanés, sans interblocage` : `tenirFiche`, réception de 5 puis inventaire lancés, libération : les deux aboutissent.
23. `invariants` : `verifierStock(base.client).totalAnomalies` vaut 0.

### 11. `CLAUDE.md` du dépôt back

Après la puce PB15a, puce « **Inventaire par lot (tranche pharmacie 1, PB15b)** » : routes `POST`/`GET /pharmacie/:structureId/inventaires` et `GET .../inventaires/:inventaireId` (`inventaire:write`) ; comptage absolu par lot en unités ou en boîtes du lot et unités en plus ; ciblage du lot (identifiant, numéro, date, lot unique ; sinon 409 `LOT_REQUIS` avec les lots, ou nouveau lot daté) ; un mouvement `INVENTAIRE` par lot compté même à écart nul ; tolérance par fiche (somme des écarts), anomalie `ECART_INVENTAIRE` attribuée à l'auteur au-delà ; ventes faites sans stock rattachées aux lots comptés, qui finissent à la quantité comptée ; théorique lu au moment de l'enregistrement (une vente entre le comptage et la saisie compte comme un écart) ; verrous comme la réception ; cœur `enregistrerDansTransaction` (mode `rejeterLignes`) et `simuler` pour l'import.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés (les extractions de la section 3 sont demandées). Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (messages en français, actionnables, aucun tiret cadratin ni demi-cadratin nulle part). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Aucune migration, aucun `prisma generate`, jamais `prisma migrate dev`, `migrate reset` ni `db push` sur la base de dev. Ne jamais afficher ni écrire d'URL de base, de mot de passe ni de valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh`. Ne pas commiter (le chef commite). Si une étape se révèle impossible telle qu'écrite, s'arrêter en BLOCKED avec la commande et l'erreur, sans contournement.

Fichiers touchés attendus (et seulement eux) : `src/common/filters/all-exceptions.filter.ts`, `src/common/filters/all-exceptions.filter.spec.ts`, `src/pharmacie/stock/mouvements-stock.service.ts` (et `mouvements-stock.service.spec.ts` seulement dans le cas de la section 2), `src/pharmacie/stock/resolution-provisoires.ts`, `src/pharmacie/stock/lecture-stock.ts`, `src/pharmacie/receptions/receptions.service.ts`, `src/pharmacie/domaine/inventaire.ts`, `src/pharmacie/domaine/inventaire.spec.ts`, `src/pharmacie/dto/inventaires.dto.ts`, `src/pharmacie/inventaires/inventaires.service.ts`, `src/pharmacie/inventaires/inventaires.controller.ts`, `src/pharmacie/inventaires/inventaires.http.spec.ts`, `src/pharmacie/pharmacie.module.ts`, `test/db/inventaire.db-spec.ts`, `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint <les fichiers .ts de la liste>` : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, dont `inventaire.spec.ts` (10), `inventaires.http.spec.ts` (6), le test ajouté à `all-exceptions.filter.spec.ts`.
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/inventaire.db-spec.ts` (23 tests) ; `resolution.db-spec.ts`, `receptions.db-spec.ts`, `import-livraison.db-spec.ts`, `sorties-anomalies.db-spec.ts`, `non-regression-lectures.db-spec.ts` verts et non modifiés.
5. `git status --porcelain` ne liste que les fichiers attendus (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes` vide ; `git diff -- src/pharmacie/receptions/receptions.service.ts` ne change que `presenterReception` et les imports.
6. Écritures de stock : `grep -rn "mouvementStock.create\|lotStock.create\|lotStock.update" src/pharmacie/inventaires` : aucune ligne.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-27 | spécifié (codeur Sonnet) | PASS (vérificateur Sonnet, rapports/PB15b-verification.md) | remarque : désarchivage en mode rejeterLignes, corrigé par le chef (D599)

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
docker compose exec -T backend npx tsc --noEmit, npx eslint (14 fichiers), npm test, npm run test:db | 0 erreur ; 88 suites 976 réussis 3 ignorés ; 23 suites 279 réussis | commit « feat(pharmacie): inventaire par lot avec tolérance et anomalies (PB15b) » (rapports/PB15b-chef.md)
