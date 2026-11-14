# PB14a - Fournisseurs, réceptions et lots

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages d'erreur et de succès lus par les pharmaciens, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Première des trois sous-fiches de PB14 (D566) : PB14a (cette fiche), puis PB14b (résolution des allocations provisoires), puis PB14c (import livraison vers réception). Chacune est autonome et commitée seule.

PB14a crée les routes de 3.2 du plan pour les fournisseurs, les réceptions et les lots :

- `GET`, `POST /pharmacie/:structureId/fournisseurs` ;
- `POST /pharmacie/:structureId/receptions` : une `Reception` et un lot par ligne, coût figé par unité minimale arrondi au GNF, date de péremption obligatoire sauf « sans péremption » (A3) ;
- `GET /pharmacie/:structureId/receptions`, `GET /pharmacie/:structureId/receptions/:receptionId` ;
- `GET /pharmacie/:structureId/stock/:stockId/lots` ;
- `PATCH /pharmacie/:structureId/lots/:lotId` : correction de la date de péremption d'un lot, motivée et auditée.

PB14a ne résout PAS les allocations provisoires (PB14b) et ne touche PAS l'import Excel (PB14c). Une réception sur une fiche qui a une part provisoire laisse cette part telle quelle jusqu'à PB14b (état intermédiaire jamais déployé, D445).

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate`** : `Fournisseur`, `Reception`, `LotStock` existent (M2, M4, M5). Ne pas toucher aux migrations, aux retours arrière, aux instantanés `test/db/instantanes/`, ni aux fichiers `test/db/*.db-spec.ts` existants. Jamais `prisma migrate dev`, `migrate reset` ni `db push`.

Décisions applicables (`docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D413, D466, D470, D473, D493, D496, D498, D500, D507, D509, D513, D527, D554, D559, et celles de cette fiche, D566 à D575.

### Contexte vérifié (ne pas re-découvrir)

- `MouvementsStockService` (`src/pharmacie/stock/mouvements-stock.service.ts`) : `verrouillerFiches(tx, ids)` (verrous consultatifs triés), `creerLot(tx, NouveauLot)` (lot puis mouvement `RECEPTION` dans la même transaction, valide `quantite >= 1`, `coutUnitaire >= 0`, `coefficientReception >= 1`, maintient `ConditionnementOuvert`). `NouveauLot` accepte `evenementId?` et `dateReception?`. Le service est le seul écrivain de `LotStock` et `MouvementStock` : n'écrire ni l'un ni l'autre directement, sauf `tx.lotStock.update` de `dateExpiration` (permis par le trigger `lot_stock_proteger` sur tout lot).
- `LotStock` : `receptionId` et `fournisseurId` avec clés étrangères Restrict ; `dateReception` ; colonnes figées par trigger sauf `dateExpiration`. `Reception` (`id`, `pointDeVenteId`, `fournisseurId?`, `reference?`, `recueLe`, `auteurId`, `createdAt`) est immuable (trigger `reception_immuable`), l'insertion est permise. `Fournisseur` : `@@unique([structureId, nom])`, `actif`.
- Règles pures existantes : `coutUnitaireDepuisBoite(coutAchatBoite, coefficient)` et `reliquatLot` (`src/pharmacie/domaine/quantites.ts`), `estPerime(dateExpiration, jour)` et `comparerFefo` (`src/pharmacie/domaine/selection-lots.ts`), `lireLotsCandidats(client, pointDeVenteId, ids)`, `dateVersJour`, `jourVersDate` (`src/pharmacie/stock/lecture-stock.ts`), `jourConakry(date)` (`src/pharmacie/jour-metier.ts`), `masquerCouts(donnees, peutVoirMarge)` et `cheminsCout` (`src/pharmacie/masquer-couts.ts`), `assurerPointDeVente(tx, structure)` (`src/pharmacie/point-de-vente.ts`), `estDoublonSur(erreur, modele)` (`src/pharmacie/stock/erreurs-base.ts`).
- `AccesPharmacieService.verifier(structureId, userId)` renvoie `{ user: { id, nom, prenom, structureId }, structure: { id, nom, adminId, ... } }`.
- `PermissionsService.getUserPermissions(userId)` renvoie les codes ; `PERMISSIONS.RECEPTION_WRITE`, `PERMISSIONS.STOCK_READ`, `PERMISSIONS.MARGE_READ` existent (`src/common/rbac/permissions.constants.ts`).
- Filtre d'erreurs : `CODES_AVEC_DETAILS` (`src/common/filters/all-exceptions.filter.ts`) recopie `stockId` et `nom` des `details` ; `STOCK_INTROUVABLE` y est déjà. Les erreurs `VALIDATION` portent `champs: [{ champ, contraintes }]` (chemins `lignes.0.nombreBoites` comme le ValidationPipe).
- Ordre des verrous de la tranche : poste, session, `CompteurTicket`, puis verrou de ligne des fiches (`FOR NO KEY UPDATE`), puis verrous consultatifs des fiches (D507, D527, D554, D559). La réception ne prend ni poste, ni session, ni `CompteurTicket`.
- Ne jamais importer `src/pharmacie/pharmacie.service.ts` depuis les fichiers créés ici : PB14c fera dépendre `PharmacieService` de `ReceptionsService` (un import circulaire casse l'injection Nest, D534).

### 1. `src/pharmacie/domaine/reception.ts` (nouveau, règles pures, D568, D569)

Sans Nest ni Prisma ni horloge. Contenu exact des signatures :

```ts
import { coutUnitaireDepuisBoite, exigerEntier } from './quantites';
import { estPerime } from './selection-lots';

/** Plus grand entier enregistrable (colonne Int de PostgreSQL). */
export const ENTIER_MAX = 2147483647;

export interface SaisieLigneReception {
  /** Unités par boîte de la fiche, lu sous verrou. */
  coefficientBoite: number;
  nombreBoites: number | null;
  quantiteUnites: number | null;
  coutAchatBoite: number | null;
  /** AAAA-MM-JJ ou null. */
  dateExpiration: string | null;
  sansPeremption: boolean;
}

export type CodeRefusLigneReception =
  | 'QUANTITE_REQUISE'
  | 'QUANTITE_UNIQUE'
  | 'QUANTITE_TROP_GRANDE'
  | 'DATE_INVALIDE'
  | 'DATE_PEREMPTION_REQUISE'
  | 'DATE_PEREMPTION_PASSEE';

export type LigneReceptionPreparee =
  | {
      ok: true;
      quantiteUm: number;
      coefficientReception: number;
      coutUnitaire: number;
      coutAchatBoite: number | null;
      /** AAAA-MM-JJ, ou null si sans péremption. */
      dateExpiration: string | null;
    }
  | { ok: false; code: CodeRefusLigneReception };

/** Vrai si la chaîne est une date réelle au format AAAA-MM-JJ (2027-02-30 est faux). */
export function jourValide(jour: string): boolean;

/** Prépare une ligne de réception (D568, D569) ; `jour` = jour courant à Conakry, AAAA-MM-JJ. */
export function preparerLigneReception(
  s: SaisieLigneReception,
  jour: string,
): LigneReceptionPreparee;
```

`jourValide` : expression `^\d{4}-\d{2}-\d{2}$`, puis `new Date(Date.UTC(a, m - 1, j))` dont l'année, le mois et le jour UTC sont identiques à la saisie.

Règles de `preparerLigneReception`, dans cet ordre, le premier refus l'emporte :

1. `exigerEntier(s.coefficientBoite, 'coefficientBoite', 1)` ; si `nombreBoites` non nul, `exigerEntier(nombreBoites, 'nombreBoites', 1)` ; si `quantiteUnites` non nul, `exigerEntier(quantiteUnites, 'quantiteUnites', 1)` ; si `coutAchatBoite` non nul, `exigerEntier(coutAchatBoite, 'coutAchatBoite', 0)` (RangeError sinon : le DTO filtre avant).
2. Les deux quantités nulles : `QUANTITE_REQUISE` ; les deux non nulles : `QUANTITE_UNIQUE`.
3. `quantiteUm = nombreBoites !== null ? nombreBoites * coefficientBoite : quantiteUnites` ; `quantiteUm > ENTIER_MAX` : `QUANTITE_TROP_GRANDE`.
4. `dateExpiration` non nulle et `!jourValide(dateExpiration)` : `DATE_INVALIDE`.
5. `dateExpiration` nulle et `sansPeremption` faux : `DATE_PEREMPTION_REQUISE` (A3). Une date fournie l'emporte sur `sansPeremption` (D509).
6. `dateExpiration` non nulle et `estPerime(dateExpiration, jour)` (date strictement avant le jour) : `DATE_PEREMPTION_PASSEE`. Le jour même est accepté.
7. Sinon `{ ok: true, quantiteUm, coefficientReception: s.coefficientBoite, coutUnitaire: s.coutAchatBoite === null ? 0 : coutUnitaireDepuisBoite(s.coutAchatBoite, s.coefficientBoite), coutAchatBoite: s.coutAchatBoite, dateExpiration: s.dateExpiration }`. Avec `quantiteUnites`, le coût reste celui de la boîte divisé par le coefficient de la fiche.

### 2. `src/pharmacie/domaine/reception.spec.ts` (nouveau)

`describe('jourValide')` puis `describe('preparerLigneReception')` ; jour de référence `'2026-10-27'`, base `{ coefficientBoite: 1, nombreBoites: null, quantiteUnites: null, coutAchatBoite: null, dateExpiration: '2027-12-31', sansPeremption: false }`. Tests exacts :

- `jourValide : dates réelles et fausses` : vrai pour `'2027-12-31'`, `'2028-02-29'` ; faux pour `'2027-02-30'`, `'2027-13-01'`, `'27-12-31'`, `''`.
- `10 boîtes de 20 au coût de 1000 la boîte : 200 unités à 50` : coefficient 20, nombreBoites 10, coût 1000 : `toEqual({ ok: true, quantiteUm: 200, coefficientReception: 20, coutUnitaire: 50, coutAchatBoite: 1000, dateExpiration: '2027-12-31' })`.
- `coût arrondi au GNF, moitié éloignée de zéro` : coefficient 3, coût 1000 : `coutUnitaire` 333 ; coefficient 2, coût 1001 : 501 ; coefficient 3, coût 2 : 1.
- `sans coût : coût 0 et coût boîte nul` : `coutUnitaire` 0, `coutAchatBoite` null.
- `quantité en unités : telle quelle, coût divisé par le coefficient de la fiche` : coefficient 10, quantiteUnites 15, coût 500 : `quantiteUm` 15, `coutUnitaire` 50.
- `quantité absente ou double` : `QUANTITE_REQUISE` ; nombreBoites 1 et quantiteUnites 1 : `QUANTITE_UNIQUE`.
- `quantité trop grande` : coefficient 10000, nombreBoites 1000000 : `QUANTITE_TROP_GRANDE` ; quantiteUnites 2147483647 coefficient 1 : `ok`.
- `date invalide` : `'2027-02-30'` : `DATE_INVALIDE`.
- `date obligatoire sauf sans péremption (A3)` : date nulle : `DATE_PEREMPTION_REQUISE` ; date nulle et `sansPeremption` vrai : `ok`, `dateExpiration` null ; date `'2027-01-01'` et `sansPeremption` vrai : `ok`, `dateExpiration` `'2027-01-01'`.
- `date passée refusée, le jour même accepté` : `'2026-10-26'` : `DATE_PEREMPTION_PASSEE` ; `'2026-10-27'` : `ok`.
- `ordre des refus` : quantité absente et date nulle : `QUANTITE_REQUISE`.
- `entrées impossibles` : coefficient 0, nombreBoites 1.5, coût -1 lèvent `RangeError`.

### 3. `src/common/filters/codes-erreur.ts` et `all-exceptions.filter.ts`

Ajouter à la fin de `CODES_ERREUR`, avec ces commentaires :

```ts
  // Fournisseur du même nom déjà enregistré dans la pharmacie (409).
  'FOURNISSEUR_EXISTANT',
  // Date de péremption déjà passée à la réception (400), lignes dans `details`.
  'DATE_PEREMPTION_PASSEE',
```

Mettre à jour le commentaire de `DATE_PEREMPTION_REQUISE` : `// Date de péremption obligatoire pour créer un lot, sauf « sans péremption » (400) ; à la réception, lignes dans \`details\`.`

Dans `CODES_AVEC_DETAILS`, ajouter `'DATE_PEREMPTION_REQUISE'` et `'DATE_PEREMPTION_PASSEE'` en dernier (l'upsert de stock lève `DATE_PEREMPTION_REQUISE` sans `details` : rien ne change pour lui). Rien d'autre dans ces fichiers.

### 4. `src/pharmacie/dto/receptions.dto.ts` (nouveau)

Même style que `src/pharmacie/dto/vente.dto.ts` (`rognerTexte` local identique, `ApiProperty`/`ApiPropertyOptional` avec exemple et description en français).

```ts
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const TELEPHONE = /^[0-9 +().-]{6,30}$/;

export class CreerFournisseurDto {
  @IsString() @Transform(rognerTexte) @Length(2, 100) nom: string;
  @IsOptional() @IsString() @Transform(rognerTexte) @Matches(TELEPHONE) telephone?: string;
}

export class LigneReceptionDto {
  @IsString() @IsNotEmpty() @MaxLength(64) stockId: string;
  @IsOptional() @IsString() @Transform(rognerTexte) @MaxLength(64) numeroLot?: string;
  @IsOptional() @IsString() @Matches(JOUR) dateExpiration?: string;
  @IsOptional() @IsBoolean() sansPeremption?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(1000000) nombreBoites?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1000000000) quantiteUnites?: number;
  @IsOptional() @IsInt() @Min(0) @Max(2147483647) coutAchatBoite?: number;
}

export class CreerReceptionDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(64) fournisseurId?: string;
  @IsOptional() @IsString() @Transform(rognerTexte) @MaxLength(100) reference?: string;
  @IsOptional() @IsISO8601({ strict: true }) recueLe?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => LigneReceptionDto) lignes: LigneReceptionDto[];
}

export class ListerReceptionsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
}

export class CorrigerLotDto {
  @IsOptional() @IsString() @Matches(JOUR) dateExpiration?: string;
  @IsOptional() @IsBoolean() sansPeremption?: boolean;
  @IsOptional() @IsString() @Transform(rognerTexte) @MaxLength(300) motif?: string;
}
```

Descriptions Swagger obligatoires (une phrase chacune) : `numeroLot` « Numéro inscrit sur la boîte, facultatif » ; `dateExpiration` « AAAA-MM-JJ, obligatoire sauf sansPeremption (DATE_PEREMPTION_REQUISE), jamais passée (DATE_PEREMPTION_PASSEE) » ; `nombreBoites` et `quantiteUnites` « Exactement un des deux : boîtes (multipliées par le nombre d'unités par boîte de la fiche) ou unités » ; `coutAchatBoite` « Coût d'achat d'une boîte en GNF ; absent : coût inconnu, marge non calculable » ; `id` « Identifiant choisi par le client pour rejouer sans doublon » ; `recueLe` « Date et heure de réception, maintenant par défaut, jamais dans le futur ».

### 5. `src/pharmacie/receptions/receptions.service.ts` (nouveau, D567 à D575)

`@Injectable() export class ReceptionsService`, constructeur `(prisma: PrismaService, accesPharmacie: AccesPharmacieService, mouvementsStock: MouvementsStockService, permissions: PermissionsService)`.

5.1. Constantes exportées (texte exact) :

```ts
export const MESSAGE_FOURNISSEUR_INTROUVABLE = 'Ce fournisseur est introuvable.';
export const MESSAGE_FOURNISSEUR_EXISTANT =
  'Un fournisseur porte déjà ce nom dans votre pharmacie.';
export const MESSAGE_RECEPTION_INTROUVABLE = 'Cette réception est introuvable.';
export const MESSAGE_LOT_INTROUVABLE = 'Ce lot est introuvable.';
export const MESSAGE_FICHE_INTROUVABLE =
  'Ce médicament est introuvable dans le stock de cette pharmacie.';
export const MESSAGE_STOCK_INTROUVABLE_RECEPTION =
  "Un médicament de la livraison est introuvable dans le stock de cette pharmacie. Ajoutez-le d'abord à votre stock.";
export const MESSAGE_DATE_PEREMPTION_REQUISE_RECEPTION =
  "Indiquez la date de péremption de chaque médicament reçu, ou précisez qu'il n'en a pas.";
export const MESSAGE_DATE_PEREMPTION_PASSEE =
  'La date de péremption de ce médicament est déjà passée : vérifiez-la. Un médicament périmé ne doit pas entrer en stock.';
export const MESSAGE_DATE_INVALIDE =
  "La date de péremption n'existe pas : vérifiez-la (format AAAA-MM-JJ).";
export const MESSAGE_QUANTITE_RECUE_REQUISE =
  "Indiquez la quantité reçue : un nombre de boîtes ou un nombre d'unités.";
export const MESSAGE_QUANTITE_RECUE_UNIQUE =
  "Indiquez soit le nombre de boîtes, soit le nombre d'unités reçues, pas les deux.";
export const MESSAGE_QUANTITE_RECUE_TROP_GRANDE =
  'La quantité reçue est trop grande pour être enregistrée. Vérifiez la quantité.';
export const MESSAGE_RECUE_DANS_LE_FUTUR =
  'La date de réception ne peut pas être dans le futur.';
export const MESSAGE_IDENTIFIANT_RECEPTION =
  'Cet identifiant est déjà utilisé par une autre réception.';
export const MESSAGE_MOTIF_CORRECTION_LOT =
  'Indiquez le motif de la correction (3 caractères au moins).';
export const MESSAGE_FICHE_NON_QUALIFIEE =
  "Le nombre d'unités par boîte de ce médicament n'est pas encore confirmé : vérifiez sa fiche avant de compter en boîtes.";
export const MESSAGE_RECEPTION_REJOUEE = 'Cette réception était déjà enregistrée.';
export function messageReceptionEnregistree(nombreLots: number): string {
  return nombreLots === 1
    ? 'Réception enregistrée : 1 lot.'
    : `Réception enregistrée : ${nombreLots} lots.`;
}
```

5.2. Types exportés :

```ts
export interface LigneReceptionAEnregistrer {
  stockId: string;
  numeroLot: string | null;
  dateExpiration: string | null;
  sansPeremption: boolean;
  nombreBoites: number | null;
  quantiteUnites: number | null;
  coutAchatBoite: number | null;
}
export interface ReceptionAEnregistrer {
  id?: string;
  fournisseurId: string | null;
  reference: string | null;
  recueLe: Date;
  lignes: LigneReceptionAEnregistrer[];
}
export interface AvertissementReception {
  code: 'FICHE_NON_QUALIFIEE';
  stockId: string;
  nom: string;
  message: string;
}
export interface ReceptionEcrite {
  receptionId: string;
  cree: boolean;
  /** Une entrée par ligne, dans l'ordre reçu ; vide pour un rejeu. */
  lignes: { stockId: string; lotId: string; quantiteUm: number; soldeProduitApres: number }[];
  avertissements: AvertissementReception[];
}
```

Constante interne `OPTIONS_TRANSACTION_RECEPTION = { maxWait: 10_000, timeout: 30_000 }` ; `PAR_PAGE = 20`.

5.3. `async enregistrerDansTransaction(tx: Prisma.TransactionClient, acces: AccesPharmacie, entree: ReceptionAEnregistrer, ip: string | null = null): Promise<ReceptionEcrite>` (publique, réutilisée par l'import en PB14c ; l'appelant ouvre la transaction), dans cet ordre :

1. Point de vente : `tx.pointDeVente.findUnique({ where: { structureId_ordre: { structureId, ordre: 1 } } })` ; absent : `(await assurerPointDeVente(tx, acces.structure)).pointDeVente`.
2. Si `entree.id` : `tx.reception.findUnique({ where: { id }, select: { id: true, pointDeVenteId: true } })` ; existe et même point de vente : `return { receptionId: id, cree: false, lignes: [], avertissements: [] }` ; existe ailleurs : `ConflictException({ message: MESSAGE_IDENTIFIANT_RECEPTION, code: 'IDENTIFIANT_DEJA_UTILISE' })`.
3. Si `entree.fournisseurId` : `tx.fournisseur.findFirst({ where: { id, structureId, actif: true } })`, absent : `NotFoundException(MESSAGE_FOURNISSEUR_INTROUVABLE)`.
4. `entree.recueLe.getTime() > Date.now() + 5 * 60_000` : `BadRequestException({ message: MESSAGE_RECUE_DANS_LE_FUTUR, code: 'VALIDATION', champs: [{ champ: 'recueLe', contraintes: ['pasDansLeFutur'] }] })`.
5. Verrous de ligne (D570) : `ids` = identifiants distincts des lignes, triés (`sort()` par défaut) ; pour chaque `id` dans cet ordre : `tx.$queryRaw<{ id: string; coefficientBoite: number; qualifie: boolean; archiveLe: Date | null }[]>\`SELECT "id", "coefficientBoite", "qualifie", "archiveLe" FROM "StockMedicament" WHERE "id" = ${id} AND "structureId" = ${structureId} FOR NO KEY UPDATE\``. Fiches absentes : `NotFoundException({ message: MESSAGE_STOCK_INTROUVABLE_RECEPTION, code: 'STOCK_INTROUVABLE', details: absentes.map((stockId) => ({ stockId })) })`. Puis noms : `tx.stockMedicament.findMany({ where: { id: { in: ids } }, select: { id: true, medicament: { select: { nom: true } } } })`.
6. Préparation (jour = `jourConakry(new Date())`) : `preparerLigneReception` par ligne avec le `coefficientBoite` lu en 5. Refus groupés, dans cet ordre de priorité (le premier groupe non vide est levé, toutes ses lignes sont citées) :
   - `QUANTITE_REQUISE`, `QUANTITE_UNIQUE`, `QUANTITE_TROP_GRANDE`, `DATE_INVALIDE` : `BadRequestException({ message: <message de la première ligne en cause>, code: 'VALIDATION', champs })`, une entrée par ligne en cause : `{ champ: \`lignes.${i}.nombreBoites\`, contraintes: ['quantiteRequise' | 'quantiteUnique' | 'quantiteMaximale'] }` ou `{ champ: \`lignes.${i}.dateExpiration\`, contraintes: ['dateValide'] }` ; messages : `MESSAGE_QUANTITE_RECUE_REQUISE`, `MESSAGE_QUANTITE_RECUE_UNIQUE`, `MESSAGE_QUANTITE_RECUE_TROP_GRANDE`, `MESSAGE_DATE_INVALIDE` ;
   - `DATE_PEREMPTION_REQUISE` : `BadRequestException({ message: MESSAGE_DATE_PEREMPTION_REQUISE_RECEPTION, code: 'DATE_PEREMPTION_REQUISE', details: [{ stockId, nom }] })` (une entrée par ligne en cause, doublons de fiche conservés) ;
   - `DATE_PEREMPTION_PASSEE` : idem avec `MESSAGE_DATE_PEREMPTION_PASSEE` et `code: 'DATE_PEREMPTION_PASSEE'`.
7. Désarchivage (D570) : pour chaque fiche lue en 5 avec `archiveLe` non nul : `tx.stockMedicament.update({ where: { id }, data: { archiveLe: null } })` puis audit `{ userId, action: 'update', entityType: 'StockMedicament', entityId: id, ip: null, metadata: { avant: { archiveLe: <ISO> }, apres: { archiveLe: null } } }` (même forme que `upsertStock`). La ligne est déjà verrouillée (5) : aucun nouveau verrou après le consultatif.
8. `await this.mouvementsStock.verrouillerFiches(tx, ids)`.
9. Borne de l'agrégat : `tx.agregatStockProduit.findMany({ where: { pointDeVenteId, stockMedicamentId: { in: ids } } })` ; par fiche, solde + somme des `quantiteUm` de ses lignes `> ENTIER_MAX` : 400 `VALIDATION` avec `MESSAGE_QUANTITE_RECUE_TROP_GRANDE` et une entrée `{ champ: \`lignes.${i}.nombreBoites\`, contraintes: ['quantiteMaximale'] }` par ligne de ces fiches.
10. `const reception = await tx.reception.create({ data: { ...(entree.id ? { id: entree.id } : {}), pointDeVenteId, fournisseurId, reference, recueLe, auteurId: acces.user.id }, select: { id: true } })`.
11. Pour chaque ligne `i` dans l'ordre reçu : `creerLot(tx, { stockMedicamentId, pointDeVenteId, numeroLot, dateExpiration: preparee.dateExpiration ? jourVersDate(preparee.dateExpiration) : null, quantite: preparee.quantiteUm, coutUnitaire: preparee.coutUnitaire, coutAchatBoite: preparee.coutAchatBoite, coefficientReception: preparee.coefficientReception, fournisseurId, receptionId: reception.id, lotTechnique: false, auteurId: acces.user.id, pieceOrigineType: 'RECEPTION', pieceOrigineId: reception.id, motif: null, evenementId: \`reception:${reception.id}:${i}\`, dateReception: entree.recueLe })` ; garder `{ stockId, lotId: lot.id, quantiteUm, soldeProduitApres: reception.soldeProduit }`.
12. Audit : `{ userId, action: 'create', entityType: 'Reception', entityId: reception.id, ip, metadata: { nombreLignes, fournisseurId, quantiteTotale } }` (aucun coût, aucune référence de bon).
13. Avertissements (D573) : une entrée par fiche distincte non qualifiée (`qualifie` faux lu en 5), dans l'ordre de `ids` : `{ code: 'FICHE_NON_QUALIFIEE', stockId, nom, message: MESSAGE_FICHE_NON_QUALIFIEE }`.
14. `return { receptionId: reception.id, cree: true, lignes, avertissements }`.

Aucune alerte de stock, aucune notification (une réception n'abaisse jamais le stock).

5.4. `async enregistrer(structureId, userId, dto: CreerReceptionDto, ip?: string | null)` :

1. `acces = await this.accesPharmacie.verifier(structureId, userId)` ; `peutVoirMarge`.
2. `entree` depuis le DTO : `numeroLot` vide après rognage : null ; `recueLe` : `dto.recueLe ? new Date(dto.recueLe) : new Date()` ; booléens absents : faux ; nombres absents : null.
3. `ecrite = await this.prisma.$transaction((tx) => this.enregistrerDansTransaction(tx, acces, entree, ip ?? null), OPTIONS_TRANSACTION_RECEPTION)`.
4. Course (D571) : sur `estDoublonSur(erreur, 'Reception')` et `dto.id`, relire `this.prisma.reception.findUnique({ where: { id: dto.id }, select: { pointDeVenteId: true, pointDeVente: { select: { structureId: true } } } })` : même pharmacie, réponse de rejeu ; sinon 409 `IDENTIFIANT_DEJA_UTILISE`. Toute autre erreur est relancée.
5. Réponse : `{ data: masquerCouts({ ...(await this.presenterReception(this.prisma, receptionId)), cree, avertissements }, peutVoirMarge), message: cree ? messageReceptionEnregistree(nombreLots) : MESSAGE_RECEPTION_REJOUEE, success: true }`.

5.5. `private async presenterReception(client, receptionId)` (aussi utilisée par le détail) renvoie :

```ts
{
  id, reference, recueLe, createdAt, auteurId,
  fournisseur: { id, nom } | null,
  lots: [{ id, stockId, nom, numeroLot, dateExpiration /* AAAA-MM-JJ ou null */, quantiteRecue,
           coefficientReception, solde /* agrégat du lot, 0 s'il manque */, coutAchatBoite, coutUnitaire }],
}
```

Lots triés par `nom` (comparaison `<`), puis date (nulle d'abord, puis croissante), puis `numeroLot` (nul d'abord, puis `<`), puis `id`.

5.6. `async lister(structureId, userId, dto: ListerReceptionsDto)` : accès ; point de vente d'ordre 1 (absent : liste vide) ; `page = dto.page ?? 1` ; `tx`-less lecture `this.prisma.reception.findMany({ where: { pointDeVenteId }, orderBy: [{ recueLe: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 20, select: { id, reference, recueLe, createdAt, auteurId, fournisseur: { select: { id, nom } }, lots: { select: { quantiteRecue: true } } } })` et `count`. Élément : `{ id, reference, recueLe, createdAt, auteurId, fournisseur, nombreLots, quantiteTotale }`. Réponse `{ data: { receptions, page, parPage: 20, total }, message: \`${total} réception(s)\`, success: true }` (aucune clé de coût).

5.7. `async detail(structureId, userId, receptionId)` : accès ; réception du point de vente de la pharmacie (`where: { id, pointDeVente: { structureId } }`), sinon `NotFoundException(MESSAGE_RECEPTION_INTROUVABLE)` ; `data: masquerCouts(await this.presenterReception(...), peutVoirMarge)`, message `'Réception trouvée.'`.

5.8. Fournisseurs (D574) :

- `async listerFournisseurs(structureId, userId)` : accès ; `fournisseur.findMany({ where: { structureId, actif: true }, orderBy: [{ nom: 'asc' }, { id: 'asc' }], select: { id, nom, telephone, createdAt } })` ; message `\`${n} fournisseur(s)\``.
- `async creerFournisseur(structureId, userId, dto, ip?)` : accès ; dans une transaction : `findFirst({ where: { structureId, nom: { equals: dto.nom, mode: 'insensitive' } } })` existant : 409 `{ message: MESSAGE_FOURNISSEUR_EXISTANT, code: 'FOURNISSEUR_EXISTANT' }` ; création ; audit `create` `Fournisseur` `{ nom }` ; P2002 (`estDoublonSur(erreur, 'Fournisseur')`) traduit en même 409. Réponse `{ data: { id, nom, telephone, createdAt, cree: true }, message: 'Fournisseur enregistré.', success: true }`.

5.9. Lots (D575) :

- `async listerLots(structureId, userId, stockId)` : accès ; fiche `findFirst({ where: { id: stockId, structureId, archiveLe: null } })` sinon `NotFoundException(MESSAGE_FICHE_INTROUVABLE)` ; point de vente d'ordre 1 (absent : liste vide) ; `lireLotsCandidats(this.prisma, pointDeVenteId, [stockId])` puis tri `comparerFefo` ; élément : `{ id, numeroLot, dateExpiration, dateReception, quantite: solde, reliquat: reliquatLot(solde, coefficientReception), coefficientReception, lotTechnique, perime: estPerime(dateExpiration, jour), coutUnitaire }` (`dateExpiration` AAAA-MM-JJ ou null, `dateReception` ISO). Réponse `masquerCouts` ; message `\`${n} lot(s) en stock\``.
- `async corrigerDateLot(structureId, userId, lotId, dto: CorrigerLotDto, ip?)` :
  1. accès ; `motif = dto.motif?.trim() ?? ''` ; moins de 3 caractères : `BadRequestException({ message: MESSAGE_MOTIF_CORRECTION_LOT, code: 'MOTIF_REQUIS' })` ;
  2. `dto.dateExpiration` absente et `dto.sansPeremption !== true` : `BadRequestException({ message: MESSAGE_DATE_PEREMPTION_REQUISE_RECEPTION, code: 'DATE_PEREMPTION_REQUISE' })` (sans `details`) ; date présente et `!jourValide` : 400 `VALIDATION` `{ champ: 'dateExpiration', contraintes: ['dateValide'] }` avec `MESSAGE_DATE_INVALIDE`. Une date passée est permise (on corrige une date réelle) ;
  3. transaction : `lot = tx.lotStock.findFirst({ where: { id: lotId, pointDeVente: { structureId } }, select: { id, stockMedicamentId, dateExpiration } })`, absent : `NotFoundException(MESSAGE_LOT_INTROUVABLE)` ; `verrouillerFiches(tx, [lot.stockMedicamentId])` ; `avant = dateVersJour(lot.dateExpiration)` ou null ; `apres = dto.dateExpiration ?? null` ; égal : aucune écriture ; sinon `tx.lotStock.update({ where: { id }, data: { dateExpiration: apres ? jourVersDate(apres) : null } })` et audit `{ action: 'update', entityType: 'LotStock', entityId: lotId, ip, metadata: { avant: { dateExpiration: avant }, apres: { dateExpiration: apres }, motif } }` ;
  4. réponse : le lot relu sous la forme d'un élément de `listerLots` (solde 0 s'il est épuisé), `masquerCouts` ; message `'Date de péremption du lot corrigée.'` ou `'Aucune modification du lot.'`.

5.10. `private async peutVoirMarge(userId)` : comme `VenteService` (`getUserPermissions(userId)` contient `PERMISSIONS.MARGE_READ`).

### 6. `src/pharmacie/receptions/receptions.controller.ts` (nouveau)

Modèle de `src/pharmacie/points-de-vente.controller.ts` : `@ApiTags('Pharmacie : réceptions')`, `@ApiBearerAuth()`, `@Controller('pharmacie')`, `@UseGuards(AuthGuard, PermissionsGuard)` sur la classe, `@ApiParam` pour chaque paramètre de chemin.

| Méthode, chemin | Permission | Code HTTP | Service |
|---|---|---|---|
| `GET :structureId/fournisseurs` | `RECEPTION_WRITE` | 200 | `listerFournisseurs` |
| `POST :structureId/fournisseurs` | `RECEPTION_WRITE` | 200 (`@HttpCode`) | `creerFournisseur` (avec `@Ip()`) |
| `POST :structureId/receptions` | `RECEPTION_WRITE` | 200 | `enregistrer` (avec `@Ip()`) |
| `GET :structureId/receptions` | `RECEPTION_WRITE` | 200 | `lister` (`@Query() dto: ListerReceptionsDto`) |
| `GET :structureId/receptions/:receptionId` | `RECEPTION_WRITE` | 200 | `detail` |
| `GET :structureId/stock/:stockId/lots` | `STOCK_READ` | 200 | `listerLots` |
| `PATCH :structureId/lots/:lotId` | `RECEPTION_WRITE` | 200 | `corrigerDateLot` (avec `@Ip()`) |

`@ApiOperation` : `summary` court en français ; `description` de `POST receptions` : `"Une réception et un lot par ligne. Quantité : nombreBoites (multiplié par le nombre d'unités par boîte de la fiche) ou quantiteUnites. Coût par unité = coût d'achat de la boîte divisé par ce nombre, arrondi au GNF, figé sur le lot. Date de péremption obligatoire sauf sansPeremption (400 DATE_PEREMPTION_REQUISE), jamais passée (400 DATE_PEREMPTION_PASSEE). 404 STOCK_INTROUVABLE, 404 fournisseur, 409 IDENTIFIANT_DEJA_UTILISE. Coûts retirés sans marge:read."`.

### 7. `src/pharmacie/pharmacie.module.ts`

Ajouter `ReceptionsController` aux `controllers` (après `SessionsCaisseController`) et `ReceptionsService` aux `providers` (après `SessionsCaisseService`). Rien d'autre.

### 8. `src/pharmacie/receptions/receptions.http.spec.ts` (nouveau)

Mise en place copiée de `src/pharmacie/fiche-produit.http.spec.ts` (vrai `PermissionsGuard` et `PermissionsService`, Prisma et Redis simulés, même `ValidationPipe` que `main.ts`, `AllExceptionsFilter`), `ReceptionsService` simulé (`useValue` avec un `jest.fn()` par méthode, chacun résolu à `{ data: {}, message: 'ok', success: true }`). Profils : `titulaire` (PHARMACIE, `stock:read`, `stock:write`, `reception:write`, `marge:read`), `vendeur` (PHARMACIE, `stock:read`, `stock:write`, `vente:write`, `caisse:utiliser`). Tests exacts :

1. `permissions : le vendeur sans reception:write est refusé sur les routes de réception` : `it.each` sur `GET /pharmacie/s1/fournisseurs`, `POST /pharmacie/s1/fournisseurs`, `POST /pharmacie/s1/receptions`, `GET /pharmacie/s1/receptions`, `GET /pharmacie/s1/receptions/r1`, `PATCH /pharmacie/s1/lots/l1` (corps valide) : 403, service non appelé.
2. `permissions : la liste des lots exige stock:read seulement` : vendeur `GET /pharmacie/s1/stock/stk1/lots` : 200, `listerLots` appelé avec `('s1', 'vendeur', 'stk1')`.
3. `réception valide transmise au service` : titulaire, corps `{ lignes: [{ stockId: 'stk1', nombreBoites: 10, dateExpiration: '2027-12-31', coutAchatBoite: 1000 }] }` : 200, `enregistrer` appelé avec `('s1', 'titulaire', expect.objectContaining({ lignes: [expect.objectContaining({ stockId: 'stk1', nombreBoites: 10 })] }), expect.anything())`.
4. `validation du corps de réception` : `it.each` de `[corps, champ, contrainte]` : `{ lignes: [] }`, `lignes`, `arrayMinSize` ; `{}`, `lignes`, `isArray` ; `{ lignes: [{ stockId: 'stk1', nombreBoites: 0 }] }`, `lignes.0.nombreBoites`, `min` ; `{ lignes: [{ stockId: 'stk1', nombreBoites: 1.5 }] }`, `lignes.0.nombreBoites`, `isInt` ; `{ lignes: [{ stockId: 'stk1', nombreBoites: 1, dateExpiration: '31/12/2027' }] }`, `lignes.0.dateExpiration`, `matches` ; `{ lignes: [{ stockId: 'stk1', nombreBoites: 1, coutAchatBoite: -1 }] }`, `lignes.0.coutAchatBoite`, `min` ; `{ id: 'abc', lignes: [{ stockId: 'stk1', nombreBoites: 1 }] }`, `id`, `isUuid` ; `{ recueLe: 'hier', lignes: [{ stockId: 'stk1', nombreBoites: 1 }] }`, `recueLe`, `isIso8601` ; `{ lignes: [{ stockId: 'stk1', nombreBoites: 1, prix: 5 }] }`, `lignes.0.prix`, `whitelistValidation` : 400, `code` `VALIDATION`, `champs` contient `{ champ, contraintes: expect.arrayContaining([contrainte]) }`, service non appelé.
5. `validation du fournisseur` : `{ nom: 'A' }` : `nom`, `isLength` ; `{ nom: 'Sopharma', telephone: 'abc' }` : `telephone`, `matches`.
6. `page de la liste convertie en nombre` : `GET /pharmacie/s1/receptions?page=2` : `lister` appelé avec `('s1', 'titulaire', { page: 2 })` ; `?page=0` : 400 `VALIDATION` champ `page`.

### 9. `test/db/receptions.db-spec.ts` (nouveau)

Structure et préparation copiées de `test/db/qualification.db-spec.ts` (base vide, migrations jusqu'à `DERNIERE_MIGRATION_FORMAT_ACTUEL`, `chargerFormatActuel`, migrations restantes, `creerPrismaDeTest`, mêmes doublures `notifications`, `stockage`, `permissions`), avec les permissions : `RESPONSABLE` (`usr-admin-p1`) `['vente:write', 'caisse:utiliser', 'caisse:superviser', 'stock:write', 'reception:write', 'marge:read']`, tout autre identifiant `['vente:write', 'caisse:utiliser']`. Services : `mouvements`, `sessions`, `service = new VenteService(...)`, `fiches = new FicheProduitService(prisma, acces, mouvements)`, `receptions = new ReceptionsService(prisma, acces, mouvements, permissions)`. `describe('Réceptions, fournisseurs et lots, sur base de test (PB14a)')`.

Aides (jamais exportées) : `refus`, `sql`, `compter`, `soldeProduit(stockId)`, `soldeLot(lotId)`, `nombreVentes()`, `attentesConsultatives()`, `attendreAttentes(n)`, `tenirFiche(stockId)` copiées de `qualification.db-spec.ts` ; `nouvelleFiche({ coef?, qualifie?, prixBoite? })` (ids `med-recep-<n>`, `stk-recep-<n>`, catégorie `Test PB14`, nom `Produit réception <n>`, colonne `qualifie` posée par l'INSERT, défaut vrai) ; `recevoir(dto, user = RESPONSABLE)` = `receptions.enregistrer(PHARMACIE, user, dto, '127.0.0.1')` ; `vendre(dto)` comme dans `qualification.db-spec.ts` ; `jour(n)` comme dans `qualification.db-spec.ts`. Sauf mention contraire, une ligne de réception d'un test porte `dateExpiration: jour(300)` et une « réception de N » est `recevoir({ lignes: [{ stockId, nombreBoites: N, dateExpiration: jour(300) }] })`.

Tests (noms et assertions exacts) :

1. `réception par boîtes : lot au coefficient de la fiche, coût par unité arrondi, mouvement RECEPTION` : fiche coef 3 qualifiée ; `recevoir({ lignes: [{ stockId, numeroLot: ' A123 ', nombreBoites: 2, coutAchatBoite: 1000, dateExpiration: jour(200) }] })` : `data.cree` vrai, `message` `messageReceptionEnregistree(1)`, `data.lots` `[expect.objectContaining({ stockId, numeroLot: 'A123', dateExpiration: jour(200), quantiteRecue: 6, coefficientReception: 3, solde: 6, coutAchatBoite: 1000, coutUnitaire: 333 })]`, `data.avertissements` `[]`. En base : une `Reception` (auteur `RESPONSABLE`), un `LotStock` (`receptionId`, `lotTechnique` faux, `dateReception` = `recueLe` de la réception), un `MouvementStock` `{ type: 'RECEPTION', quantite: 6, pieceOrigineType: 'RECEPTION', pieceOrigineId: <receptionId>, evenementId: 'reception:<receptionId>:0' }`, `soldeProduit` 6, colonne `StockMedicament.quantite` toujours 0, audit `create` `Reception` avec `metadata` `{ nombreLignes: 1, fournisseurId: null, quantiteTotale: 6 }`.
2. `réception en unités : quantité telle quelle, boîte entamée si elle n'est pas un multiple` : fiche coef 10 qualifiée ; `{ quantiteUnites: 15, coutAchatBoite: 500, dateExpiration: jour(100) }` : lot `quantiteRecue` 15, `coutUnitaire` 50 ; une ligne `ConditionnementOuvert` ouverte pour ce lot (`unitesParConditionnement` 10).
3. `coût figé : changer la fiche ne change ni le lot ni le coût des ventes` : fiche coef 3 qualifiée, `prixBoite` 1500 ; réception 2 boîtes à 1000 ; `fiches.modifierFiche(PHARMACIE, RESPONSABLE, stockId, { coefficientBoite: 4, prixUnitaire: 2000 }, '127.0.0.1')` ; lot : `coefficientReception` 3, `coutUnitaire` 333 ; `vendre({ lignes: [{ stockId, quantite: 1 }] })` (une boîte de 4 unités, le lot en a 6) : allocation DEFINITIVE `coutUnitaire` 333 et `quantite` 4 ; `UPDATE "LotStock" SET "coutUnitaire" = 1 WHERE "id" = $1` par `sql` rejeté (le trigger lève une erreur, `rejects.toThrow()`).
4. `date de péremption obligatoire sauf sans péremption (A3), date passée refusée, rien n'est écrit` : (a) deux lignes, la seconde sans date : 400 `DATE_PEREMPTION_REQUISE`, `MESSAGE_DATE_PEREMPTION_REQUISE_RECEPTION`, `details` `[{ stockId: <seconde>, nom }]` ; (b) date `jour(-1)` : 400 `DATE_PEREMPTION_PASSEE`, `details` `[{ stockId, nom }]` ; (c) `'2027-02-30'` : 400 `VALIDATION`, `champs` `[{ champ: 'lignes.0.dateExpiration', contraintes: ['dateValide'] }]` ; (d) deux lignes datées, la première sans aucune quantité, la seconde avec `{ quantiteUnites: 1, nombreBoites: 1 }` : 400 `VALIDATION`, `message` `MESSAGE_QUANTITE_RECUE_REQUISE`, `champs` `[{ champ: 'lignes.0.nombreBoites', contraintes: ['quantiteRequise'] }, { champ: 'lignes.1.nombreBoites', contraintes: ['quantiteUnique'] }]` ; après (a) à (d) : nombre de `Reception` et de `LotStock` inchangés. (e) `sansPeremption: true` sans date : accepté, lot `dateExpiration` null ; date `jour(0)` : acceptée.
5. `fiche archivée désarchivée, fiche d'une autre pharmacie refusée` : fiche archivée (`archiveLe` posé par `sql`) : réception acceptée, `archiveLe` null, audit `update` `StockMedicament` `{ avant: { archiveLe: <ISO> }, apres: { archiveLe: null } }` ; une fiche de `str-pharma-2` (insérée par `sql`) : 404 `STOCK_INTROUVABLE`, `MESSAGE_STOCK_INTROUVABLE_RECEPTION`, `details` `[{ stockId }]`.
6. `idempotence : même identifiant rejoué sans doublon, identifiant d'une autre pharmacie refusé` : `id = randomUUID()` ; deux `recevoir` identiques : la seconde `data.cree` faux, `message` `MESSAGE_RECEPTION_REJOUEE`, mêmes `data.lots` ; un seul lot, `soldeProduit` inchangé. Deux `recevoir` simultanés (`Promise.all`) avec un autre `id` : tous deux aboutissent, un seul lot créé. Même `id` envoyé pour `str-pharma-2` par `usr-admin-p2` (`receptions.enregistrer('str-pharma-2', 'usr-admin-p2', ...)` avec une fiche de `str-pharma-2` insérée par `sql`) : 409 `IDENTIFIANT_DEJA_UTILISE`, `MESSAGE_IDENTIFIANT_RECEPTION`.
7. `fournisseurs : création, doublon insensible à la casse, fournisseur d'une autre pharmacie refusé` : `creerFournisseur({ nom: 'Sopharma', telephone: '+224 620 00 00 00' })` : `cree` vrai ; `{ nom: 'SOPHARMA' }` : 409 `FOURNISSEUR_EXISTANT`, `MESSAGE_FOURNISSEUR_EXISTANT` ; `listerFournisseurs` : un élément ; réception avec ce fournisseur : `data.fournisseur` `{ id, nom: 'Sopharma' }`, lot `fournisseurId` posé ; fournisseur de `str-pharma-2` (inséré par `sql`) : 404 `MESSAGE_FOURNISSEUR_INTROUVABLE`.
8. `lectures : liste paginée, détail, coûts masqués sans marge:read, avertissement fiche non qualifiée` : fiche non qualifiée coef 1 : réception : `data.avertissements` `[{ code: 'FICHE_NON_QUALIFIEE', stockId, nom, message: MESSAGE_FICHE_NON_QUALIFIEE }]` ; `lister(PHARMACIE, RESPONSABLE, {})` : `data.parPage` 20, `data.total` = nombre de réceptions en base pour le point de vente, première réception = la plus récente ; `detail(PHARMACIE, VENDEUR, id)` (permissions sans `marge:read`) : `cheminsCout(r.data)` vide ; `detail(PHARMACIE, RESPONSABLE, id)` : `data.lots[0].coutUnitaire` présent ; réception inconnue : 404 `MESSAGE_RECEPTION_INTROUVABLE`.
9. `lots d'une fiche : ordre FEFO, reliquat, périmé, coût masqué` : fiche coef 10 qualifiée ; réception de deux lignes (lot B `jour(300)` 20 unités, lot A `jour(100)` 15 unités) ; `UPDATE "LotStock" SET "dateExpiration" = <hier>` sur un troisième lot reçu `jour(50)` 10 unités (correction directe permise par le trigger) ; `listerLots(PHARMACIE, RESPONSABLE, stockId)` : trois lots, ordre périmé (hier), A, B ; A `reliquat` 5, B `reliquat` 0, le périmé `perime` vrai ; `listerLots(PHARMACIE, VENDEUR, stockId)` : `cheminsCout` vide ; fiche archivée : 404 `MESSAGE_FICHE_INTROUVABLE`.
10. `correction de date d'un lot : motif obligatoire, audit, rejeu sans écriture, lot d'une autre pharmacie introuvable` : sans motif : 400 `MOTIF_REQUIS` ; sans date ni `sansPeremption` : 400 `DATE_PEREMPTION_REQUISE` ; `{ dateExpiration: jour(400), motif: 'Erreur de saisie' }` : `message` `'Date de péremption du lot corrigée.'`, lot relu `dateExpiration` `jour(400)`, audit `update` `LotStock` `{ avant: { dateExpiration: <ancienne> }, apres: { dateExpiration: jour(400) }, motif: 'Erreur de saisie' }` ; même appel : `'Aucune modification du lot.'`, aucun audit de plus ; `{ sansPeremption: true, motif: 'Produit sans date' }` : date nulle ; lot d'une fiche de `str-pharma-2` : 404 `MESSAGE_LOT_INTROUVABLE`.
11. `concurrence : vente en attente puis réception, aucun interblocage` : fiche coef 1 qualifiée, `prixBoite` 1000, réception de 12 (lot L1). `tenirFiche` ; `await tenu` ; lancer `vendre({ lignes: [{ stockId, quantite: 2 }] })` ; `attendreAttentes(1)` ; lancer `recevoir({ lignes: [{ stockId, nombreBoites: 10, dateExpiration: jour(300) }] })` ; `attendreAttentes(2)` ; `liberer()` ; `Promise.allSettled` : les deux `fulfilled` ; `soldeLot(L1)` 10, `soldeProduit` 20.
12. `concurrence : réception en attente puis vente, la vente prend le stock reçu` : fiche sans stock ; `tenirFiche` ; lancer la réception de 10 ; `attendreAttentes(1)` ; lancer la vente de 2 ; `attendreAttentes(2)` ; `liberer()` : les deux `fulfilled` ; la vente n'a aucune allocation PROVISOIRE, une allocation DEFINITIVE de 2 sur le lot reçu ; `soldeProduit` 8.
13. `quantité maximale : la somme reçue ne peut pas dépasser la borne entière` : fiche coef 1, réception `{ quantiteUnites: 2147483000, sansPeremption: true }` ; seconde réception `{ nombreBoites: 1000, sansPeremption: true }` : 400 `VALIDATION`, `message` `MESSAGE_QUANTITE_RECUE_TROP_GRANDE`, `champs` `[{ champ: 'lignes.0.nombreBoites', contraintes: ['quantiteMaximale'] }]`, aucun lot de plus.
14. `invariants` : `verifierStock(base.client).totalAnomalies` vaut 0.

Les tests 11 et 12 doivent rester verts sur trois exécutions consécutives : ne pas les affaiblir.

### 10. `CLAUDE.md` du dépôt back

Ajouter, après la puce « Qualification d'une fiche (tranche pharmacie 1, PB13) », une puce « **Réceptions, fournisseurs et lots (tranche pharmacie 1, PB14a)** » qui dit, en une phrase par point : routes `GET`/`POST /pharmacie/:structureId/fournisseurs`, `POST`/`GET /pharmacie/:structureId/receptions`, `GET .../receptions/:receptionId`, `PATCH .../lots/:lotId` (`reception:write`) et `GET .../stock/:stockId/lots` (`stock:read`) ; une réception crée un lot et un mouvement `RECEPTION` par ligne (`evenementId` `reception:<id>:<index>`), quantité en boîtes (multipliées par le coefficient de la fiche, figé sur le lot) ou en unités, coût par unité = coût de la boîte divisé par le coefficient, arrondi au GNF et figé ; date de péremption obligatoire sauf `sansPeremption` (400 `DATE_PEREMPTION_REQUISE`), jamais passée (400 `DATE_PEREMPTION_PASSEE`), lignes dans `details` ; `id` client pour rejouer sans doublon (409 `IDENTIFIANT_DEJA_UTILISE`) ; fiche archivée désarchivée ; avertissement `FICHE_NON_QUALIFIEE` non bloquant ; verrous : lignes des fiches en `FOR NO KEY UPDATE` triées puis verrous consultatifs, ni poste ni caisse ; coûts retirés sans `marge:read` ; 409 `FOURNISSEUR_EXISTANT` (nom insensible à la casse) ; correction de date d'un lot motivée (400 `MOTIF_REQUIS`) et auditée. Résolution des ventes en attente de stock : PB14b.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (messages en français, actionnables, aucun tiret cadratin ni demi-cadratin nulle part). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Aucune migration, aucun `prisma generate`, jamais `prisma migrate dev`, `migrate reset` ni `db push` sur la base de dev. Ne jamais afficher ni écrire d'URL de base, de mot de passe ni de valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh` (modifié par les fins de ligne seulement). Ne pas commiter (le chef commite). Si une étape se révèle impossible telle qu'écrite (contrainte de base, type Prisma, ordre des verrous), s'arrêter en BLOCKED avec la commande et l'erreur, sans contournement.

Fichiers touchés attendus (et seulement eux) : `src/pharmacie/domaine/reception.ts` (nouveau), `src/pharmacie/domaine/reception.spec.ts` (nouveau), `src/pharmacie/dto/receptions.dto.ts` (nouveau), `src/pharmacie/receptions/receptions.service.ts` (nouveau), `src/pharmacie/receptions/receptions.controller.ts` (nouveau), `src/pharmacie/receptions/receptions.http.spec.ts` (nouveau), `src/pharmacie/pharmacie.module.ts`, `src/common/filters/codes-erreur.ts`, `src/common/filters/all-exceptions.filter.ts`, `test/db/receptions.db-spec.ts` (nouveau), `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/pharmacie/domaine/reception.ts src/pharmacie/domaine/reception.spec.ts src/pharmacie/dto/receptions.dto.ts src/pharmacie/receptions/receptions.service.ts src/pharmacie/receptions/receptions.controller.ts src/pharmacie/receptions/receptions.http.spec.ts src/pharmacie/pharmacie.module.ts src/common/filters/codes-erreur.ts src/common/filters/all-exceptions.filter.ts test/db/receptions.db-spec.ts` : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, dont `reception.spec.ts` (les 12 cas listés en 2) et `receptions.http.spec.ts` (6 tests, `it.each` compris).
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/receptions.db-spec.ts` (14 tests), et intouchés et verts tous les autres fichiers de `test/db/`. Relancer `docker compose exec -T backend npx jest --config ./test/db/jest-db.json --runInBand test/db/receptions.db-spec.ts` deux fois de plus : vert les deux fois.
5. `git status --porcelain` (depuis `back_medconnect`) ne liste que les fichiers de « Fichiers touchés attendus » (plus `docker-entrypoint.sh`, préexistant) ; `git diff --stat -- prisma test/db/instantanes` est vide.
6. `grep -rn "pharmacie.service" src/pharmacie/receptions src/pharmacie/domaine/reception.ts` : aucune ligne (pas d'import circulaire à venir) ; `grep -n "FOR UPDATE" src/pharmacie/receptions/receptions.service.ts` : aucune ligne ; `grep -c "FOR NO KEY UPDATE" src/pharmacie/receptions/receptions.service.ts` : 1.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées (`git diff -U0 | grep -P "[\x{2013}\x{2014}]"` vide, et de même sur les fichiers nouveaux).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

2026-10-27 | spécifié (codeur Sonnet, vérificateur Sonnet) | PASS | sans objet

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->

docker compose exec -T backend npx tsc --noEmit, eslint (10 fichiers), npm test, npm run test:db, receptions.db-spec.ts relancé | 0 erreur, 82 suites et 938 tests, 19 suites et 218 tests, 14/14 | commit « feat(pharmacie): réceptions, fournisseurs et lots (PB14a) » (rapports/PB14a-chef.md)
