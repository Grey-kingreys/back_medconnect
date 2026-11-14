# PB15a - Sorties manuelles de stock, file d'anomalies, correction de date de lot relue sous verrou

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages d'erreur, de succès et libellés d'anomalies lus par les pharmaciens, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Première des trois sous-fiches de PB15 (D583) : PB15a (cette fiche), puis PB15b (inventaire par lot), puis PB15c (import Excel d'un inventaire). Chacune est autonome et commitée seule.

PB15a livre :

- `POST /pharmacie/:structureId/stock/sorties` : sortie manuelle d'un lot (périmé, cassé, perdu, retour fournisseur, autre), raison obligatoire, attribuée (D584, D585) ;
- `GET /pharmacie/:structureId/anomalies` : file d'anomalies paginée ; une anomalie `STOCK_NEGATIF` dit si le stock de la vente a depuis été rattaché à un lot (D586) ;
- `PATCH /pharmacie/:structureId/anomalies/:anomalieId` : traitement avec commentaire, une seule fois (D587) ;
- le correctif de la réserve 1 de `rapports/PB14a-chef.md` : `corrigerDateLot` relit le lot après `verrouillerFiches` (D588).

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate`** : `Anomalie`, `MouvementStock` (types `PEREMPTION`, `PERTE`, `RETOUR`, pièce `SORTIE_MANUELLE`) existent (M2, M4). Ne pas toucher aux migrations, aux retours arrière, aux instantanés `test/db/instantanes/`, ni aux fichiers `test/db/*.db-spec.ts` existants. Jamais `prisma migrate dev`, `migrate reset` ni `db push`.

Décisions applicables (`decisions.md`) : D466, D507, D510, D537, D548, D554, D559, D570, D571, D575, D577, et celles de cette fiche, D583 à D588.

### Contexte vérifié (ne pas re-découvrir)

- `MouvementsStockService` (`src/pharmacie/stock/mouvements-stock.service.ts`) : seul écrivain du journal ; `verrouillerFiches(tx, ids)` ; `ecrire(tx, MouvementAEcrire)` (reprend le verrou de sa fiche, traduit le CHECK `AgregatStockLot_quantite_check` en 409 `STOCK_LOT_NEGATIF`, renvoie `{ mouvement, soldeLot, soldeProduit }`). `SORTIE_MANUELLE` est dans `PIECES_AVEC_MOTIF` (motif non vide obligatoire, sinon `RangeError`) ; le mouvement d'une sortie a toujours un lot.
- `Anomalie` : `pointDeVenteId`, `type` (`TypeAnomalie`, 13 valeurs), `statut` (`OUVERTE`, `TRAITEE`), `attribueeAId?`, `pieceType`, `pieceId?`, `details` (Json), `creeLe`, `traiteeLe?`, `traiteeParId?`, `commentaireTraitement?` ; aucun trigger d'immuabilité ; index `(pointDeVenteId, statut, creeLe)`.
- Anomalie `STOCK_NEGATIF` (vente, `vente.service.ts` étape 16) : `pieceType` `'VENTE'`, `pieceId` = id de la vente, `attribueeAId` = `Structure.adminId`, `details { stockId, nom, quantiteProvisoire, soldeProduit, posteCode, utilisateurId, utilisateurNom, jourMetier }`. Une ligne de vente par unité affichée : une même vente peut porter deux anomalies pour la même fiche (BOITE et UNITE).
- Rattachement : `AllocationLot` `statut` `PROVISOIRE` (quantité positive, sans lot) tant que le stock manque ; la résolution (PB14b) la passe à `REMPLACEE` et crée une `DEFINITIVE` par lot et une `PROVISOIRE` du reste. Une vente annulée garde ses provisoires (D548) : elle a une pièce liée (`Vente.pieceLiee`, relation `"PieceLiee"`) de `typePiece` `ANNULATION`. `LigneVente` porte `venteId` et `stockMedicamentId`.
- `AccesPharmacieService.verifier(structureId, userId)` renvoie `{ user: { id, nom, prenom, structureId }, structure }`. Nom affiché d'un utilisateur : `` `${prenom} ${nom}`.trim() `` (règle de la vente).
- `jourConakry` (`src/pharmacie/jour-metier.ts`), `estPerime`, `ENTIER_MAX` (`src/pharmacie/domaine/reception.ts`), `dateVersJour` (`src/pharmacie/stock/lecture-stock.ts`), `estDoublonSur(erreur, modele)` (`src/pharmacie/stock/erreurs-base.ts`), `masquerCouts`, `cheminsCout` (`src/pharmacie/masquer-couts.ts`).
- Modèles à copier : `src/pharmacie/receptions/receptions.controller.ts` (gardes, Swagger), `src/pharmacie/receptions/receptions.http.spec.ts` (module de test HTTP), `src/pharmacie/dto/receptions.dto.ts` (`rognerTexte`, `ListerReceptionsDto`), `test/db/receptions.db-spec.ts` et `test/db/resolution.db-spec.ts` (préparation, `refus`, `sql`, `compter`, `tenirFiche`, `attendreAttentes`).
- Ne jamais importer `src/pharmacie/pharmacie.service.ts` depuis les fichiers créés ici (PB15c fera dépendre `PharmacieService` de services de PB15, D534).

### 1. `src/common/filters/codes-erreur.ts`

Ajouter à la fin de `CODES_ERREUR` :

```ts
  // Anomalie déjà traitée : un traitement ne se fait qu'une fois (409).
  'ANOMALIE_DEJA_TRAITEE',
```

### 2. `src/pharmacie/domaine/sortie.ts` (nouveau, règles pures, D584)

```ts
export const RAISONS_SORTIE = [
  'PERIME',
  'CASSE',
  'PERDU',
  'RETOUR_FOURNISSEUR',
  'AUTRE',
] as const;
export type RaisonSortie = (typeof RAISONS_SORTIE)[number];

export const LIBELLES_RAISON_SORTIE: Record<RaisonSortie, string> = {
  PERIME: 'Périmé',
  CASSE: 'Cassé ou abîmé',
  PERDU: 'Perdu ou volé',
  RETOUR_FOURNISSEUR: 'Retour au fournisseur',
  AUTRE: 'Autre',
};

/** Type du mouvement de stock d'une sortie. */
export function typeMouvementSortie(
  raison: RaisonSortie,
): 'PEREMPTION' | 'PERTE' | 'RETOUR' {
  if (raison === 'PERIME') return 'PEREMPTION';
  if (raison === 'RETOUR_FOURNISSEUR') return 'RETOUR';
  return 'PERTE';
}

export type MotifSortie =
  | { ok: true; motif: string }
  | { ok: false; code: 'RAISON_REQUISE' | 'COMMENTAIRE_REQUIS' };

/**
 * Motif enregistré sur le mouvement : AUTRE exige un commentaire de 3 caractères
 * au moins (le motif est ce commentaire) ; les autres raisons donnent leur libellé,
 * suivi de « : commentaire » si un commentaire non vide est donné.
 */
export function motifSortie(
  raison: RaisonSortie | null,
  commentaire: string | null,
): MotifSortie {
  if (raison === null) return { ok: false, code: 'RAISON_REQUISE' };
  const texte = (commentaire ?? '').trim();
  if (raison === 'AUTRE') {
    return texte.length < 3
      ? { ok: false, code: 'COMMENTAIRE_REQUIS' }
      : { ok: true, motif: texte };
  }
  const libelle = LIBELLES_RAISON_SORTIE[raison];
  return { ok: true, motif: texte ? `${libelle} : ${texte}` : libelle };
}
```

### 3. `src/pharmacie/domaine/anomalies.ts` (nouveau, règles pures, D586)

```ts
import type { TypeAnomalie } from 'generated/prisma/enums';

export const LIBELLES_ANOMALIE: Record<TypeAnomalie, string> = {
  STOCK_NEGATIF: 'Vente sans stock',
  ECART_INVENTAIRE: "Écart d'inventaire",
  CONDITIONNEMENT_CONCURRENT: 'Deux boîtes entamées du même lot',
  REMONTEE_APRES_CLOTURE: 'Vente remontée après la clôture',
  ECART_CAISSE: 'Écart de caisse',
  FOND_NON_COMPTE: 'Fond de caisse non compté',
  PLAGE_EPUISEE: 'Numéros de tickets épuisés',
  PRIX_DIVERGENT: 'Prix différent du prix enregistré',
  ORDONNANCE_NON_CONFIRMEE: 'Ordonnance non confirmée',
  VENTE_UNITE_INTERDITE: "Vente à l'unité interdite",
  PRODUIT_ARCHIVE: 'Médicament archivé vendu',
  EVENEMENT_REJETE: 'Opération de caisse rejetée',
  SEQUENCE_MANQUANTE: 'Opération de caisse manquante',
};

export type EtatRattachement =
  | 'EN_ATTENTE'
  | 'PARTIELLE'
  | 'RATTACHEE'
  | 'VENTE_ANNULEE';

export interface Rattachement {
  etat: EtatRattachement;
  /** Unités vendues sans stock (somme des anomalies de la vente pour cette fiche). */
  quantiteInitiale: number;
  /** Unités encore en attente de stock (allocations PROVISOIRE). */
  quantiteEnAttente: number;
  message: string;
}

/** État du rattachement d'une vente sans stock (D586). */
export function etatRattachement(e: {
  quantiteInitiale: number;
  quantiteEnAttente: number;
  venteAnnulee: boolean;
}): Rattachement {
  const quantiteInitiale = Math.max(e.quantiteInitiale, e.quantiteEnAttente);
  const base = { quantiteInitiale, quantiteEnAttente: e.quantiteEnAttente };
  if (e.venteAnnulee) {
    return {
      ...base,
      etat: 'VENTE_ANNULEE',
      message: 'Cette vente a été annulée : aucun stock à rattacher.',
    };
  }
  if (e.quantiteEnAttente <= 0) {
    return {
      ...base,
      etat: 'RATTACHEE',
      message:
        "Le stock de cette vente a depuis été rattaché à un lot : il reste seulement à vérifier puis classer l'anomalie.",
    };
  }
  if (e.quantiteEnAttente < quantiteInitiale) {
    return {
      ...base,
      etat: 'PARTIELLE',
      message: `Une partie de cette vente attend encore du stock : ${e.quantiteEnAttente} unité(s).`,
    };
  }
  return {
    ...base,
    etat: 'EN_ATTENTE',
    message:
      "Cette vente attend encore du stock : enregistrez la réception ou faites l'inventaire de ce médicament.",
  };
}
```

### 4. `src/pharmacie/dto/inventaires.dto.ts` (nouveau ; PB15b y ajoutera l'inventaire)

```ts
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RAISONS_SORTIE, type RaisonSortie } from '../domaine/sortie';

const rognerTexte = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreerSortieStockDto {
  @ApiPropertyOptional({ description: 'Identifiant choisi par le client pour rejouer sans doublon' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ description: 'Identifiant de la fiche de stock' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  stockId: string;

  @ApiProperty({ description: 'Identifiant du lot sorti' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  lotId: string;

  @ApiProperty({ enum: ['BOITE', 'UNITE'], description: "BOITE : boîtes du lot (unités par boîte du lot) ; UNITE : unités minimales" })
  @IsIn(['BOITE', 'UNITE'])
  unite: 'BOITE' | 'UNITE';

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Max(1000000000)
  quantite: number;

  @ApiPropertyOptional({ enum: RAISONS_SORTIE, description: 'Obligatoire (400 MOTIF_REQUIS sinon)' })
  @IsOptional()
  @IsIn(RAISONS_SORTIE)
  raison?: RaisonSortie;

  @ApiPropertyOptional({ example: 'Flacon tombé', description: 'Précision, obligatoire pour AUTRE (3 caractères au moins)' })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(300)
  commentaire?: string;
}
```

### 5. `src/pharmacie/dto/anomalies.dto.ts` (nouveau)

- `TYPES_ANOMALIE` : tableau `as const` des 13 valeurs de `TypeAnomalie` dans l'ordre du schéma.
- `ListerAnomaliesDto` : `statut?` (`@IsOptional() @IsIn(['OUVERTE', 'TRAITEE'])`, défaut appliqué par le service : `OUVERTE`), `type?` (`@IsOptional() @IsIn(TYPES_ANOMALIE)`), `page?` (copie exacte de `ListerReceptionsDto.page` : `@Type(() => Number) @IsInt() @Min(1) @Max(10000)`).
- `TraiterAnomalieDto` : `commentaire: string` (`@IsString() @Transform(rognerTexte) @MaxLength(500)`, Swagger exemple « Stock recompté, vente confirmée »), longueur minimale contrôlée par le service.

### 6. `src/pharmacie/inventaires/sorties.service.ts` (nouveau, D584, D585)

Constantes exportées (texte exact) :

```ts
export const MESSAGE_RAISON_SORTIE_REQUISE =
  'Choisissez la raison de la sortie : périmé, cassé ou abîmé, perdu ou volé, retour au fournisseur, ou autre.';
export const MESSAGE_COMMENTAIRE_SORTIE_REQUIS =
  'Précisez la raison de la sortie en quelques mots (3 caractères au moins).';
export const MESSAGE_LOT_INTROUVABLE_SORTIE =
  'Ce lot est introuvable pour ce médicament.';
export const MESSAGE_SORTIE_QUANTITE_TROP_GRANDE =
  'La quantité sortie est trop grande. Vérifiez la quantité.';
export const MESSAGE_IDENTIFIANT_SORTIE =
  'Cet identifiant est déjà utilisé par une autre sortie de stock.';
export const MESSAGE_SORTIE_ENREGISTREE = 'Sortie de stock enregistrée.';
export const MESSAGE_SORTIE_REJOUEE =
  'Cette sortie de stock était déjà enregistrée.';
export function messageSortieLotInsuffisante(solde: number): string {
  return `Ce lot n'a que ${solde} unité(s) en stock : la sortie ne peut pas dépasser ce stock.`;
}
```

`@Injectable() export class SortiesStockService`, constructeur `(prisma: PrismaService, accesPharmacie: AccesPharmacieService, mouvementsStock: MouvementsStockService)`. Options de transaction `{ maxWait: 10_000, timeout: 30_000 }`.

`async enregistrer(structureId, userId, dto: CreerSortieStockDto, ip?: string | null)` :

1. `acces = verifier(structureId, userId)`.
2. `motifSortie(dto.raison ?? null, dto.commentaire ?? null)` : `RAISON_REQUISE` : `BadRequestException({ message: MESSAGE_RAISON_SORTIE_REQUISE, code: 'MOTIF_REQUIS' })` ; `COMMENTAIRE_REQUIS` : idem avec `MESSAGE_COMMENTAIRE_SORTIE_REQUIS`. Rien n'est lu en base avant ces refus.
3. `idSortie = dto.id ?? randomUUID()` ; `evenementId = \`sortie:${idSortie}\``.
4. Transaction :
   a. Point de vente d'ordre 1 de la structure (`findUnique`, `structureId_ordre`) ; absent : 404 `MESSAGE_LOT_INTROUVABLE_SORTIE` (aucun lot sans point de vente).
   b. Rejeu : `tx.mouvementStock.findUnique({ where: { evenementId }, select: { id: true, pointDeVenteId: true } })` ; trouvé et même point de vente : renvoyer `{ evenementId, cree: false }` ; trouvé ailleurs : `ConflictException({ message: MESSAGE_IDENTIFIANT_SORTIE, code: 'IDENTIFIANT_DEJA_UTILISE' })`.
   c. `tx.lotStock.findFirst({ where: { id: dto.lotId, stockMedicamentId: dto.stockId, pointDeVenteId }, select: { id: true } })` ; absent : `NotFoundException(MESSAGE_LOT_INTROUVABLE_SORTIE)` (lot d'une autre fiche, d'une autre pharmacie ou inexistant).
   d. `mouvementsStock.verrouillerFiches(tx, [dto.stockId])`.
   e. Relire le lot sous le verrou : `coefficientReception`, `agregat { quantite }` ; `solde = agregat?.quantite ?? 0`.
   f. `quantiteUm = dto.unite === 'BOITE' ? dto.quantite * coefficientReception : dto.quantite` ; `quantiteUm > ENTIER_MAX` : `BadRequestException({ message: MESSAGE_SORTIE_QUANTITE_TROP_GRANDE, code: 'VALIDATION', champs: [{ champ: 'quantite', contraintes: ['quantiteMaximale'] }] })`.
   g. `quantiteUm > solde` : `ConflictException({ message: messageSortieLotInsuffisante(solde), code: 'STOCK_LOT_NEGATIF' })` (testé avant écriture, le CHECK reste le filet).
   h. `ecrit = mouvementsStock.ecrire(tx, { evenementId, pointDeVenteId, stockMedicamentId: dto.stockId, lotId: dto.lotId, type: typeMouvementSortie(dto.raison), quantite: -quantiteUm, pieceOrigineType: 'SORTIE_MANUELLE', pieceOrigineId: idSortie, motif, auteurId: acces.user.id })`.
   i. Audit : `auditLog.create({ userId, action: 'create', entityType: 'MouvementStock', entityId: ecrit.mouvement.id, ip: ip ?? null, metadata: { type, quantite: quantiteUm, stockId, lotId, raison } })` (jamais le commentaire).
   j. Renvoyer `{ evenementId, cree: true }`.
5. `catch` de la transaction : si `dto.id` et `estDoublonSur(erreur, 'MouvementStock')` (course sur `evenementId`) : relire hors transaction le mouvement de cet `evenementId` avec `pointDeVente { structureId }` ; même structure : `{ evenementId, cree: false }`, sinon 409 `IDENTIFIANT_DEJA_UTILISE` ; toute autre erreur est relancée.
6. Réponse : `{ data: { ...presentee, cree }, message: cree ? MESSAGE_SORTIE_ENREGISTREE : MESSAGE_SORTIE_REJOUEE, success: true as const }` où `presentee` = lecture (hors transaction) du mouvement par `evenementId` : `{ id: pieceOrigineId, mouvementId, stockId, nom (medicament.nom de la fiche), lotId, numeroLot, dateExpiration (AAAA-MM-JJ ou null), perime (estPerime, jour de Conakry), type, motif, quantite (= -mouvement.quantite), soldeLot (agrégat actuel du lot), soldeProduit (agrégat produit actuel du point de vente), auteurId, createdAt (horodatageServeur) }`. Aucune clé de coût (ne pas lire `coutUnitaire`).

Aucune alerte de stock bas, aucun refus pour une fiche archivée, un lot périmé ou non périmé, un lot technique (D585).

### 7. `src/pharmacie/anomalies/anomalies.service.ts` (nouveau, D586, D587)

Constantes exportées :

```ts
export const MESSAGE_ANOMALIE_INTROUVABLE = 'Cette anomalie est introuvable.';
export const MESSAGE_ANOMALIE_DEJA_TRAITEE =
  'Cette anomalie a déjà été traitée.';
export const MESSAGE_COMMENTAIRE_TRAITEMENT_REQUIS =
  'Indiquez ce qui a été vérifié ou fait (3 caractères au moins).';
export const MESSAGE_ANOMALIE_TRAITEE = 'Anomalie traitée.';
```

`@Injectable() export class AnomaliesService`, constructeur `(prisma: PrismaService, accesPharmacie: AccesPharmacieService)`. `PAR_PAGE = 20`.

Élément présenté (type exporté `ElementAnomalie`) :

```ts
{
  id, type, libelle: LIBELLES_ANOMALIE[type], statut, creeLe,
  pieceType, pieceId, details,
  attribueeA: { id, nom } | null,
  traiteeLe, traiteePar: { id, nom } | null, commentaireTraitement,
  rattachement: Rattachement | null, // non nul seulement pour STOCK_NEGATIF
}
```

Méthode privée `presenter(client, lignes)` (lignes Prisma d'`Anomalie`) :

- Noms : `user.findMany({ where: { id: { in: <attribueeAId et traiteeParId non nuls, dédoublonnés> } }, select: { id, nom, prenom } })`, nom = `` `${prenom} ${nom}`.trim() `` ; identifiant sans utilisateur : `{ id, nom: 'Utilisateur inconnu' }`.
- Rattachement des `STOCK_NEGATIF` : `venteIds` = `pieceId` non nuls ; clé d'un groupe `${venteId}:${details.stockId}` ;
  - `quantiteInitiale` : `anomalie.findMany({ where: { type: 'STOCK_NEGATIF', pieceId: { in: venteIds } }, select: { pieceId, details } })` (toutes, pas seulement la page), somme des `details.quantiteProvisoire` (nombre, sinon 0) par clé ;
  - `quantiteEnAttente` : `allocationLot.findMany({ where: { statut: 'PROVISOIRE', quantite: { gt: 0 }, ligneVente: { venteId: { in: venteIds } } }, select: { quantite, ligneVente: { select: { venteId, stockMedicamentId } } } })`, somme par clé (0 si aucune) ;
  - `venteAnnulee` : ventes de `venteIds` dont `pieceLiee` est de `typePiece` `ANNULATION` (`vente.findMany({ where: { id: { in: venteIds }, pieceLiee: { is: { typePiece: 'ANNULATION' } } }, select: { id: true } })`) ;
  - `rattachement = etatRattachement({ quantiteInitiale, quantiteEnAttente, venteAnnulee })`.
- Ordre des éléments conservé.

`async lister(structureId, userId, dto: ListerAnomaliesDto)` : `verifier` ; point de vente d'ordre 1 (absent : liste vide, `total` 0, `ouvertes` 0) ; `where = { pointDeVenteId, statut: dto.statut ?? 'OUVERTE', ...(dto.type ? { type: dto.type } : {}) }` ; `findMany` trié `[{ creeLe: 'desc' }, { id: 'desc' }]`, `skip (page - 1) * 20`, `take 20` ; `total = count(where)` ; `ouvertes = count({ pointDeVenteId, statut: 'OUVERTE' })`. Réponse `{ data: { anomalies, page, parPage: 20, total, ouvertes }, message: \`${total} anomalie(s)\`, success: true as const }`.

`async traiter(structureId, userId, anomalieId, dto: TraiterAnomalieDto, ip?)` :

1. `{ user } = verifier(...)`.
2. `commentaire = dto.commentaire.trim()` ; moins de 3 caractères : `BadRequestException({ message: MESSAGE_COMMENTAIRE_TRAITEMENT_REQUIS, code: 'MOTIF_REQUIS' })`.
3. `anomalie.findFirst({ where: { id: anomalieId, pointDeVente: { structureId } } })` ; absente : `NotFoundException(MESSAGE_ANOMALIE_INTROUVABLE)`.
4. `statut === 'TRAITEE'` : `ConflictException({ message: MESSAGE_ANOMALIE_DEJA_TRAITEE, code: 'ANOMALIE_DEJA_TRAITEE' })`.
5. Transaction : `updateMany({ where: { id: anomalieId, statut: 'OUVERTE' }, data: { statut: 'TRAITEE', traiteeLe: new Date(), traiteeParId: user.id, commentaireTraitement: commentaire } })` ; `count !== 1` : même 409 (course : une seule réussite) ; audit `{ action: 'update', entityType: 'Anomalie', entityId, ip, metadata: { type, avant: { statut: 'OUVERTE' }, apres: { statut: 'TRAITEE' } } }` (jamais le commentaire).
6. Réponse `{ data: <élément relu et présenté>, message: MESSAGE_ANOMALIE_TRAITEE, success: true as const }`.

Aucun traitement automatique d'une `STOCK_NEGATIF` rattachée (D586).

### 8. `src/pharmacie/anomalies/anomalies.controller.ts` (nouveau)

`@ApiTags('Pharmacie : anomalies') @ApiBearerAuth() @Controller('pharmacie') @UseGuards(AuthGuard, PermissionsGuard)`, chaque route `@RequirePermissions(PERMISSIONS.ANOMALIE_GERER)` :

- `@Get(':structureId/anomalies')` `lister(req, structureId, @Query() dto: ListerAnomaliesDto)`, summary « File d'anomalies de la pharmacie », description « 20 par page, les plus récentes d'abord. statut OUVERTE par défaut, filtre type. Une anomalie STOCK_NEGATIF porte rattachement (etat EN_ATTENTE, PARTIELLE, RATTACHEE ou VENTE_ANNULEE) : le stock a-t-il depuis été rattaché à un lot. ouvertes = nombre d'anomalies à traiter. » ;
- `@Patch(':structureId/anomalies/:anomalieId')` `traiter(req, structureId, anomalieId, @Body() dto: TraiterAnomalieDto, @Ip() ip)`, summary « Traiter une anomalie », description « Commentaire obligatoire (3 à 500 caractères, 400 MOTIF_REQUIS). Une seule fois : 409 ANOMALIE_DEJA_TRAITEE. ».

### 9. `src/pharmacie/inventaires/inventaires.controller.ts` (nouveau ; PB15b y ajoutera l'inventaire)

`@ApiTags('Pharmacie : inventaires et sorties') @ApiBearerAuth() @Controller('pharmacie') @UseGuards(AuthGuard, PermissionsGuard)`, constructeur `(sorties: SortiesStockService)`.

- `@Post(':structureId/stock/sorties') @HttpCode(HttpStatus.OK) @RequirePermissions(PERMISSIONS.STOCK_WRITE)` `enregistrerSortie(req, structureId, @Body() dto: CreerSortieStockDto, @Ip() ip)`, summary « Sortie manuelle d'un lot (périmé, cassé, perdu, retour fournisseur) », description « raison obligatoire (400 MOTIF_REQUIS) : PERIME (mouvement PEREMPTION), CASSE, PERDU, AUTRE (PERTE, AUTRE exige un commentaire), RETOUR_FOURNISSEUR (RETOUR). Quantité en BOITE (unités par boîte du lot) ou UNITE. 404 lot introuvable pour ce médicament, 409 STOCK_LOT_NEGATIF au-delà du stock du lot, id client pour rejouer sans doublon (409 IDENTIFIANT_DEJA_UTILISE). Pièce SORTIE_MANUELLE attribuée, sans coût. ».

### 10. `src/pharmacie/pharmacie.module.ts`

Ajouter `InventairesController` et `AnomaliesController` aux contrôleurs, `SortiesStockService` et `AnomaliesService` aux fournisseurs. Rien d'autre.

### 11. `src/pharmacie/receptions/receptions.service.ts` (correctif D588, seul changement)

Dans `corrigerDateLot`, la transaction devient :

```ts
    const modifie = await this.prisma.$transaction(async (tx) => {
      const lot = await tx.lotStock.findFirst({
        where: { id: lotId, pointDeVente: { structureId } },
        select: { id: true, stockMedicamentId: true },
      });
      if (!lot) throw new NotFoundException(MESSAGE_LOT_INTROUVABLE);
      await this.mouvementsStock.verrouillerFiches(tx, [lot.stockMedicamentId]);
      // Relu sous le verrou : l'audit « avant » est juste même si une autre correction vient d'aboutir
      const relu = await tx.lotStock.findUniqueOrThrow({
        where: { id: lotId },
        select: { dateExpiration: true },
      });
      const avant = relu.dateExpiration ? dateVersJour(relu.dateExpiration) : null;
```

le reste de la transaction (comparaison `avant === apres`, mise à jour, audit) est inchangé.

### 12. Tests unitaires

12.1. `src/pharmacie/domaine/sortie.spec.ts` : `describe('Règles de la sortie manuelle')` :
1. `type de mouvement par raison` : PERIME `PEREMPTION`, CASSE `PERTE`, PERDU `PERTE`, RETOUR_FOURNISSEUR `RETOUR`, AUTRE `PERTE`.
2. `raison absente refusée` : `motifSortie(null, 'x')` `{ ok: false, code: 'RAISON_REQUISE' }`.
3. `AUTRE exige un commentaire de 3 caractères` : `motifSortie('AUTRE', '  ab ')` `COMMENTAIRE_REQUIS` ; `motifSortie('AUTRE', ' Don au dispensaire ')` `{ ok: true, motif: 'Don au dispensaire' }`.
4. `libellé et commentaire` : `motifSortie('CASSE', null)` motif `'Cassé ou abîmé'` ; `motifSortie('CASSE', ' flacon tombé ')` motif `'Cassé ou abîmé : flacon tombé'` ; `motifSortie('PERIME', '')` motif `'Périmé'`.

12.2. `src/pharmacie/domaine/anomalies.spec.ts` : `describe('Rattachement des ventes sans stock')` :
1. `en attente` : `{ 2, 2, false }` etat `EN_ATTENTE`, message exact.
2. `partielle` : `{ 3, 1, false }` etat `PARTIELLE`, message `'Une partie de cette vente attend encore du stock : 1 unité(s).'`.
3. `rattachée` : `{ 2, 0, false }` etat `RATTACHEE`.
4. `vente annulée prioritaire` : `{ 2, 2, true }` etat `VENTE_ANNULEE`.
5. `quantité initiale jamais inférieure à l'attente` : `{ 0, 2, false }` `quantiteInitiale` 2, etat `EN_ATTENTE`.
6. `un libellé par type` : `Object.keys(LIBELLES_ANOMALIE)` a 13 entrées, aucune vide.

12.3. `src/pharmacie/inventaires/inventaires.http.spec.ts` (copie du montage de `receptions.http.spec.ts`, `SortiesStockService` simulé `{ enregistrer: jest.fn() }`, profils `titulaire` `['stock:read', 'stock:write', 'inventaire:write', 'anomalie:gerer']`, `lecteur` `['stock:read']`) :
1. `permissions : stock:write exigé pour une sortie` : `lecteur` : 403 `PERMISSION_REFUSEE`, service non appelé.
2. `sortie valide transmise au service` : corps `{ stockId: 's', lotId: 'l', unite: 'BOITE', quantite: 2, raison: 'PERIME' }` : 200, `enregistrer` appelé avec `('s1', 'titulaire', objet égal au corps, ip)` (`expect.objectContaining`).
3. `validation du corps de sortie` : `unite: 'CARTON'` (`unite`), `quantite: 0` (`quantite`), `raison: 'VOLE'` (`raison`), champ inconnu `type: 'PERTE'` (refusé par `forbidNonWhitelisted`) : 400 `VALIDATION` avec le champ attendu dans `champs` ; corps sans `raison` : 200 (le service décide, `MOTIF_REQUIS`).

12.4. `src/pharmacie/anomalies/anomalies.http.spec.ts` (même montage, `AnomaliesService` simulé `{ lister, traiter }`, profils `titulaire` avec `anomalie:gerer`, `vendeur` `['stock:read', 'stock:write', 'vente:write', 'caisse:utiliser']`) :
1. `permissions : anomalie:gerer exigé` : vendeur 403 sur GET et PATCH.
2. `filtres convertis et validés` : `?statut=TRAITEE&type=STOCK_NEGATIF&page=2` : service reçoit `{ statut: 'TRAITEE', type: 'STOCK_NEGATIF', page: 2 }` ; `?statut=FERMEE` et `?type=AUTRE` : 400 `VALIDATION`.
3. `traitement : commentaire exigé par le corps` : corps `{}` : 400 `VALIDATION` sur `commentaire` ; `{ commentaire: 'x'.repeat(501) }` : 400 ; `{ commentaire: 'Recompté' }` : 200, `traiter` appelé.

### 13. `test/db/sorties-anomalies.db-spec.ts` (nouveau)

Préparation copiée de `test/db/resolution.db-spec.ts` (base, doublures, `VenteService`, `ReceptionsService`, `sql`, `compter`, `pointDeVente`, `nouvelleFiche` avec un paramètre `{ coef?: number }` qui écrit `coefficientBoite`, `recevoir`, `recevoirBoites`, `vendre`, `annuler`, `soldeLot`, `soldeProduit`, `attendreAttentes`, `tenirFiche`) et `refus` copié de `test/db/receptions.db-spec.ts`, plus `sorties = new SortiesStockService(prisma, acces, mouvements)` et `anomalies = new AnomaliesService(prisma, acces)`. Préfixes : médicaments `med-sortie-<n>`, fiches `stk-sortie-<n>`, catégorie `'Test PB15a'`. Permissions doublées : `RESPONSABLE` `['vente:write', 'caisse:utiliser', 'stock:write', 'reception:write', 'marge:read', 'anomalie:gerer']`, `VENDEUR` `['vente:write', 'caisse:utiliser', 'stock:write']`. Aides `sortir(dto, user = VENDEUR)` et `lotDe(receptionRep)` (premier lot). `describe('Sorties manuelles et file d\'anomalies, sur base de test (PB15a)')`. Tests exacts :

1. `CA13 manuel : la sortie d'un lot périmé exige une raison, puis mouvement PEREMPTION attribué` : fiche coef 10, réception 3 boîtes, date du lot corrigée à `jour(-5)` par `receptions.corrigerDateLot` ; sortie sans `raison` : 400 `MOTIF_REQUIS`, `MESSAGE_RAISON_SORTIE_REQUISE`, nombre de `MouvementStock` inchangé ; sortie `{ unite: 'BOITE', quantite: 1, raison: 'PERIME' }` : `data` `toMatchObject({ type: 'PEREMPTION', motif: 'Périmé', quantite: 10, soldeLot: 20, perime: true, auteurId: VENDEUR, cree: true })` ; mouvement en base `{ type: 'PEREMPTION', quantite: -10, pieceOrigineType: 'SORTIE_MANUELLE', pieceOrigineId: data.id, evenementId: 'sortie:' + data.id }`.
2. `raisons : cassé, perdu, retour fournisseur et autre` : quatre sorties de 1 unité : types `PERTE`, `PERTE`, `RETOUR`, `PERTE` ; motifs `'Cassé ou abîmé : flacon tombé'`, `'Perdu ou volé'`, `'Retour au fournisseur'`, `'Don au dispensaire'` ; `AUTRE` sans commentaire : 400 `MOTIF_REQUIS`, `MESSAGE_COMMENTAIRE_SORTIE_REQUIS`.
3. `sortie au-delà du stock du lot refusée sans écriture` : lot de 5, sortie de 6 unités : 409 `STOCK_LOT_NEGATIF`, message `messageSortieLotInsuffisante(5)` ; `soldeLot` 5.
4. `lot d'une autre fiche ou d'une autre pharmacie : 404` : lot de la fiche A avec `stockId` de B : 404 `MESSAGE_LOT_INTROUVABLE_SORTIE` ; `sortir(..., RESPONSABLE_AUTRE)` sur `AUTRE_PHARMACIE` avec ce lot : 404.
5. `idempotence de la sortie` : même `id` deux fois : un seul mouvement d'`evenementId` `sortie:<id>`, seconde réponse `cree: false`, message `MESSAGE_SORTIE_REJOUEE`, `soldeLot` diminué une fois ; deux appels simultanés (`Promise.all`) d'un nouvel `id` : un mouvement, une réponse `cree: true` et une `cree: false`.
6. `fiche archivée : sortie acceptée` : `archiveLe` posé par `sql`, sortie `PERIME` de 1 : 200 ; `archiveLe` toujours non nul.
7. `vente sans stock : rattachement EN_ATTENTE, PARTIELLE puis RATTACHEE, statut inchangé` : fiche sans stock, vente de 2 : `anomalies.lister(PHARMACIE, RESPONSABLE, {})` contient l'anomalie `STOCK_NEGATIF` de `pieceId` = vente, `libelle` `'Vente sans stock'`, `attribueeA` `{ id: RESPONSABLE, nom: 'Fatoumata Camara' }`, `rattachement` `toMatchObject({ etat: 'EN_ATTENTE', quantiteInitiale: 2, quantiteEnAttente: 2 })` ; réception de 1 : `PARTIELLE`, `quantiteEnAttente` 1 ; réception de 5 : `RATTACHEE`, `quantiteEnAttente` 0 ; `statut` toujours `OUVERTE`.
8. `vente sans stock annulée : VENTE_ANNULEE` : vente de 2 sans stock puis `annuler` : `rattachement.etat` `VENTE_ANNULEE`.
9. `traitement une seule fois` : `traiter(..., { commentaire: 'ab' })` : 400 `MOTIF_REQUIS` ; `{ commentaire: ' Stock recompté ' }` : `data` `toMatchObject({ statut: 'TRAITEE', traiteePar: { id: RESPONSABLE, nom: 'Fatoumata Camara' }, commentaireTraitement: 'Stock recompté' })`, `traiteeLe` non nul ; second traitement : 409 `ANOMALIE_DEJA_TRAITEE` ; liste par défaut sans elle, liste `statut: 'TRAITEE'` avec elle ; un audit `update` `Anomalie` sans clé `commentaire` dans `metadata`.
10. `traitement simultané : une réussite et un refus` : nouvelle anomalie, deux `traiter` en `Promise.allSettled` : un `fulfilled`, un `rejected` en 409 `ANOMALIE_DEJA_TRAITEE`.
11. `anomalie d'une autre pharmacie` : anomalie insérée par `sql` sur le point de vente de `AUTRE_PHARMACIE` : `traiter` par `RESPONSABLE` sur `PHARMACIE` : 404 `MESSAGE_ANOMALIE_INTROUVABLE` ; absente de la liste de `PHARMACIE`.
12. `filtres et pagination` : 22 anomalies `ECART_CAISSE` insérées par `sql` (`details '{}'`) : `type: 'ECART_CAISSE'` page 1 : 20 éléments, `total` 22, `parPage` 20 ; page 2 : 2 ; `ouvertes` = nombre d'anomalies `OUVERTE` du point de vente (`compter`) ; tri `creeLe` décroissant.
13. `correction de date simultanée : l'audit « avant » est relu sous le verrou (réserve PB14a)` : lot reçu daté `jour(300)` ; `tenirFiche(stockId)` ; `await tenu` ; correction vers `jour(200)` lancée, `attendreAttentes(1)` ; correction vers `jour(100)` lancée, `attendreAttentes(2)` ; `liberer()` ; les deux aboutissent ; audits `update` `LotStock` du lot triés par `createdAt` : `audits[0].metadata.avant.dateExpiration` = `jour(300)` et `audits[1].metadata.avant.dateExpiration` = `audits[0].metadata.apres.dateExpiration` (rouge sans le correctif 11).
14. `aucune donnée de coût` : réception avec `coutAchatBoite`, sortie et liste d'anomalies : `cheminsCout(data)` vide pour l'une et l'autre.
15. `invariants` : `verifierStock(base.client).totalAnomalies` vaut 0.

### 14. `CLAUDE.md` du dépôt back

Ajouter après la puce PB14c une puce « **Sorties manuelles et file d'anomalies (tranche pharmacie 1, PB15a)** » qui dit, une phrase par point : `POST /pharmacie/:structureId/stock/sorties` (`stock:write`), raison obligatoire (`PERIME` donne un mouvement `PEREMPTION`, `CASSE`, `PERDU` et `AUTRE` un `PERTE`, `RETOUR_FOURNISSEUR` un `RETOUR` ; `AUTRE` exige un commentaire ; 400 `MOTIF_REQUIS`), quantité en boîtes du lot ou en unités, jamais au-delà du stock du lot (409 `STOCK_LOT_NEGATIF`), pièce `SORTIE_MANUELLE` attribuée, `id` client pour rejouer ; `GET /pharmacie/:structureId/anomalies` et `PATCH .../anomalies/:anomalieId` (`anomalie:gerer`), file paginée, statut `OUVERTE` par défaut, `rattachement` sur les `STOCK_NEGATIF` (le stock de la vente a-t-il depuis été rattaché), traitement avec commentaire une seule fois (409 `ANOMALIE_DEJA_TRAITEE`) ; la correction de date d'un lot relit le lot sous le verrou de sa fiche.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (messages en français, actionnables, aucun tiret cadratin ni demi-cadratin nulle part). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Aucune migration, aucun `prisma generate`, jamais `prisma migrate dev`, `migrate reset` ni `db push` sur la base de dev. Ne jamais afficher ni écrire d'URL de base, de mot de passe ni de valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh`. Ne pas commiter (le chef commite). Si une étape se révèle impossible telle qu'écrite, s'arrêter en BLOCKED avec la commande et l'erreur, sans contournement.

Fichiers touchés attendus (et seulement eux) : `src/common/filters/codes-erreur.ts`, `src/pharmacie/domaine/sortie.ts`, `src/pharmacie/domaine/sortie.spec.ts`, `src/pharmacie/domaine/anomalies.ts`, `src/pharmacie/domaine/anomalies.spec.ts`, `src/pharmacie/dto/inventaires.dto.ts`, `src/pharmacie/dto/anomalies.dto.ts`, `src/pharmacie/inventaires/sorties.service.ts`, `src/pharmacie/inventaires/inventaires.controller.ts`, `src/pharmacie/inventaires/inventaires.http.spec.ts`, `src/pharmacie/anomalies/anomalies.service.ts`, `src/pharmacie/anomalies/anomalies.controller.ts`, `src/pharmacie/anomalies/anomalies.http.spec.ts`, `src/pharmacie/pharmacie.module.ts`, `src/pharmacie/receptions/receptions.service.ts`, `test/db/sorties-anomalies.db-spec.ts`, `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint <les 16 fichiers .ts de la liste>` : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, dont `sortie.spec.ts` (4), `anomalies.spec.ts` (6), `inventaires.http.spec.ts` (3), `anomalies.http.spec.ts` (3).
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/sorties-anomalies.db-spec.ts` (15 tests), et `receptions.db-spec.ts`, `resolution.db-spec.ts`, `non-regression-lectures.db-spec.ts` verts et inchangés.
5. `git status --porcelain` (depuis `back_medconnect`) ne liste que les fichiers attendus (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes` vide ; `git diff -- src/pharmacie/receptions/receptions.service.ts` ne touche que la transaction de `corrigerDateLot`.
6. Écritures de stock : `grep -n "mouvementStock.create\|lotStock.create\|lotStock.update" src/pharmacie/inventaires src/pharmacie/anomalies -r` : aucune ligne.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées (`git diff -U0 | grep -P "[\x{2013}\x{2014}]"` vide, et de même sur les fichiers nouveaux).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-27 | spécifié (Sonnet) | PASS | vérificateur Sonnet PASS avec lacunes de couverture ; deux tests DB ajoutés par le chef (vente sans stock en boîte et en unité sur la même fiche, plafond de l'entier maximal)

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
tsc, eslint, npm test, npm run test:db (docker compose exec -T backend) | 0 erreur ; 962 unitaires et 255 test:db verts (sorties-anomalies 17) | voir rapports/PB15a-chef.md et le commit PB15a
