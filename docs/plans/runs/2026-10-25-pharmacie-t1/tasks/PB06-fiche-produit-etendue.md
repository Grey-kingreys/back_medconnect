# PB06 - Fiche produit étendue, migration M3

Tier: spécifié (agent implementeur-specifie : codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: dev (API) ; trois messages renvoyés au front et affichés (non-dev, textes imposés ci-dessous)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Jalon J1 : aucun changement de comportement visible pour les utilisateurs existants (une route ajoutée, des colonnes ajoutées aux réponses, aucune lecture ni écriture existante modifiée). Cette tâche :

1. ajoute à `StockMedicament` les colonnes de la fiche produit (plan 1.2) : `uniteMinimale`, `coefficientBoite`, `prixUnite`, `deconditionnable`, `toleranceInventaire`, `qualifie`, `archiveLe`, `createdAt`, l'enum `UniteMinimale` et quatre contraintes CHECK, par la migration M3 `20261026110000_pharmacie_t1_fiche_produit` et son retour arrière ;
2. ajoute la route `PATCH /pharmacie/:structureId/stock/:stockId/fiche` (contrôleur, service et DTO dédiés) : modification des deux prix, de l'unité minimale, du coefficient, du déconditionnement, de la tolérance et de la qualification, **sans aucune conversion de stock** ; avertissement d'écart de prix non bloquant ; refus d'un prix à l'unité sur une fiche non déconditionnable ; refus d'un changement de coefficient sur une fiche non qualifiée qui a du stock ;
3. passe `UpsertStockDto.quantite` en `@IsInt`.

`PharmacieService`, `PharmacieController`, `VenteService` et leurs specs ne sont pas modifiés. Les nouvelles colonnes apparaissent d'elles-mêmes dans les réponses de stock (les lectures utilisent `include`, qui renvoie toutes les colonnes) : rien à coder pour cela, un test le vérifie.

Décisions qui encadrent la tâche (lire par grep dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D402, D409, D410, D411, D412, D432, D456, D457, D466, D472, D480, D485 à D492.

### Contexte vérifié (ne pas re-découvrir)

- `model StockMedicament` (`prisma/schema.prisma`, vers la ligne 439) : `id`, `medicamentId`, `structureId`, `quantite Int @default(0)`, `prixUnitaire Int?` (prix de la boîte, D409), `disponible`, `dateExpiration`, `notes`, `updatedAt`, `@@unique([medicamentId, structureId])`. Le fichier `schema.prisma` a des fins de ligne CRLF : conserver celles du fichier.
- `AccesPharmacieService.verifier(structureId, userId)` (`src/pharmacie/acces-pharmacie.service.ts`) renvoie `{ user: { id, nom, prenom, structureId }, structure: { id, type, adminId, isActive, nom, ... } }` ou lève 404 / 403 (D464).
- `assurerPointDeVente(tx, { id, nom })` (`src/pharmacie/point-de-vente.ts`) renvoie `{ pointDeVente, parametres }` ; modèle de lecture paresseuse des paramètres dans une transaction : `PointsDeVenteService.modifierParametres` (`src/pharmacie/points-de-vente.service.ts`, vers la ligne 253). L'interface `Reponse<T>` (`{ data: T; message: string; success: true }`) est exportée par `points-de-vente.service.ts`.
- `avertissementEcartPrix(prixBoite: number | null, prixUnite: number | null, coefficientBoite: number, seuilPct: number): AvertissementPrix | null` et l'interface `AvertissementPrix { code: 'ECART_PRIX'; ecartPct: number }` sont exportées par `src/pharmacie/domaine/prix.ts` (D472 : avertissement si `abs(prixUnite x coefficient - prixBoite) x 100 > seuilPct x prixBoite`, aucun si un des prix est nul ou 0, `ecartPct` arrondi). Ne pas modifier ce fichier.
- `cheminsCout(donnees)` est exporté par `src/pharmacie/masquer-couts.ts` (D466).
- Erreurs à code : corps `{ message, code }` passé à l'exception, code présent dans `CODES_ERREUR` (`src/common/filters/codes-erreur.ts`). Validation : `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`, `exceptionFactory: fabriquerErreurValidation`), réponse 400 `{ code: 'VALIDATION', champs: [{ champ, contraintes }] }` où `contraintes` liste les noms des contraintes (`isInt`, `min`, `isIn`, `whitelistValidation`...).
- `PermissionsGuard` exige toutes les permissions de `@RequirePermissions` ; `PERMISSIONS.STOCK_WRITE` existe (`src/common/rbac/permissions.constants.ts`) ; `stock:*` sont retirées aux hôpitaux (B10).
- Audit : écriture directe `tx.auditLog.create({ data: { userId, action, entityType, entityId, ip, metadata } })`, modèle `PointsDeVenteService.modifierPoste`.
- Harnais (PB01) : `test/db/harnais.ts` exporte `creerBaseVide`, `supprimerBaseDeTest`, `appliquerMigrations(client, { apres?, jusqua? })`, `appliquerRetourArriere(client, nom)`, `creerPrismaDeTest`, `fermerPrismaDeTest`, `DOSSIER_MIGRATIONS`, `DOSSIER_RETOURS_ARRIERE`, `DERNIERE_MIGRATION_FORMAT_ACTUEL`. Jeu `chargerFormatActuel(client)` (`test/db/fixtures/format-actuel.ts`), qui renvoie `{ aujourdhui, fiches, ventes }` ; fiches utilisées ici, toutes dans `str-pharma-1` : `stk-01` (`med-01`, quantité 0, prix 1500), `stk-02` (`med-02`, quantité 1, prix nul), `stk-03` (`med-03`, quantité 9, prix 2500), `stk-05` (`med-05`, quantité 11, prix 12000), `stk-06` (`med-06`, quantité 240, prix 1500) ; 40 fiches au total. Utilisateurs : `usr-admin-p1` et `usr-pharm-p1` (`str-pharma-1`), `usr-admin-p2` et `usr-pharm-p2` (`str-pharma-2`), `usr-admin-h1` (`str-hopital-1`). Modèles de specs : `test/db/m2-points-de-vente.db-spec.ts` (fonction `lignesSql`, test statique `BEGIN;`/`COMMIT;`, retour arrière) et `test/db/points-de-vente.db-spec.ts` (`beforeAll`, `afterAll`, fonctions `refus` et `sql`).
- Garde de dérive (D480) : `test/db/schema-derive.db-spec.ts` exige que `prisma/schema.prisma` corresponde exactement aux migrations ; elle valide la section 1 avec la section 2.
- Instantanés PB02 (`test/db/instantanes/`) : la comparaison ne porte que sur les clés figées, les colonnes ajoutées ne les cassent pas ; ils doivent rester inchangés.
- Le texte de M3 et du retour arrière ci-dessous a été exécuté par le chef sur une base jetable (toutes les migrations existantes, deux fiches au format d'avant) : haut (valeurs par défaut sur les fiches existantes), quatre refus par les CHECK attendus, une mise à jour valide acceptée, bas (colonnes d'origine, type et contraintes retirés, quantités et prix intacts), haut de nouveau, puis `prisma migrate diff --from-config-datasource --to-schema <schéma de la section 1> --exit-code` à 0 (aucune dérive, CHECK compris).

### 1. Schéma Prisma (`prisma/schema.prisma`)

Dans `model StockMedicament`, remplacer les lignes

```prisma
  notes         String?

  updatedAt DateTime @updatedAt

  @@unique([medicamentId, structureId])
}
```

par exactement (le bloc se termine par l'enum, placé juste après le modèle et avant `enum StatutVente`) :

```prisma
  notes         String?

  // Fiche produit étendue (tranche pharmacie 1, PB06, M3) : prixUnitaire = prix de la boîte (D409)
  uniteMinimale       UniteMinimale @default(UNITE)
  coefficientBoite    Int           @default(1)
  prixUnite           Int?
  deconditionnable    Boolean       @default(false)
  toleranceInventaire Int?
  qualifie            Boolean       @default(false)
  archiveLe           DateTime?
  createdAt           DateTime      @default(now())

  updatedAt DateTime @updatedAt

  @@unique([medicamentId, structureId])
}

// Unité minimale de vente d'une fiche produit (PB06, D410)
enum UniteMinimale {
  COMPRIME
  GELULE
  ML
  SACHET
  GRAMME
  AMPOULE
  UNITE
}
```

Puis `docker compose exec -T backend npx prisma generate`.

### 2. Migration M3 et retour arrière

Créer `prisma/migrations/20261026110000_pharmacie_t1_fiche_produit/migration.sql`, contenu exact (fin de fichier : un saut de ligne après `COMMIT;`) :

```sql
-- Tranche pharmacie 1, fiche produit étendue (PB06, M3, D402, D409 à D411, D485 à D492).
-- DDL généré par prisma migrate diff (schéma de PB05 vers schéma de PB06) ; contraintes CHECK écrites à la main.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- Aucune reprise : chaque fiche existante prend les valeurs par défaut (UNITE, coefficient 1,
-- prix à l'unité nul, non déconditionnable, non qualifiée, non archivée).
BEGIN;

-- CreateEnum
CREATE TYPE "UniteMinimale" AS ENUM ('COMPRIME', 'GELULE', 'ML', 'SACHET', 'GRAMME', 'AMPOULE', 'UNITE');

-- AlterTable
ALTER TABLE "StockMedicament" ADD COLUMN     "archiveLe" TIMESTAMP(3),
ADD COLUMN     "coefficientBoite" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deconditionnable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prixUnite" INTEGER,
ADD COLUMN     "qualifie" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "toleranceInventaire" INTEGER,
ADD COLUMN     "uniteMinimale" "UniteMinimale" NOT NULL DEFAULT 'UNITE';

-- Contraintes de la fiche (plan 1.2, D488)
ALTER TABLE "StockMedicament" ADD CONSTRAINT "StockMedicament_coefficientBoite_check" CHECK ("coefficientBoite" >= 1);
ALTER TABLE "StockMedicament" ADD CONSTRAINT "StockMedicament_prixUnite_deconditionnable_check" CHECK ("deconditionnable" OR "prixUnite" IS NULL);
ALTER TABLE "StockMedicament" ADD CONSTRAINT "StockMedicament_prixUnite_check" CHECK ("prixUnite" IS NULL OR "prixUnite" > 0);
ALTER TABLE "StockMedicament" ADD CONSTRAINT "StockMedicament_toleranceInventaire_check" CHECK ("toleranceInventaire" IS NULL OR "toleranceInventaire" >= 0);

COMMIT;
```

Créer `prisma/retours-arriere/20261026110000_pharmacie_t1_fiche_produit.down.sql`, contenu exact (fin de fichier : un saut de ligne après `COMMIT;`) :

```sql
-- Retour arrière de 20261026110000_pharmacie_t1_fiche_produit (PB06, M3).
-- Retire les contraintes, les colonnes et le type ajoutés par M3 (pertes : unité minimale,
-- coefficient, prix à l'unité, déconditionnement, tolérance, qualification, archivage et date
-- de création des fiches). Le prix de la boîte (prixUnitaire) et la quantité ne sont pas
-- touchés. À appliquer après le retour des migrations suivantes, dans l'ordre inverse, puis
-- redéployer le code précédent. Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

ALTER TABLE "StockMedicament" DROP CONSTRAINT "StockMedicament_toleranceInventaire_check";
ALTER TABLE "StockMedicament" DROP CONSTRAINT "StockMedicament_prixUnite_check";
ALTER TABLE "StockMedicament" DROP CONSTRAINT "StockMedicament_prixUnite_deconditionnable_check";
ALTER TABLE "StockMedicament" DROP CONSTRAINT "StockMedicament_coefficientBoite_check";

ALTER TABLE "StockMedicament" DROP COLUMN "archiveLe",
DROP COLUMN "coefficientBoite",
DROP COLUMN "createdAt",
DROP COLUMN "deconditionnable",
DROP COLUMN "prixUnite",
DROP COLUMN "qualifie",
DROP COLUMN "toleranceInventaire",
DROP COLUMN "uniteMinimale";

DROP TYPE "UniteMinimale";

COMMIT;
```

Ne pas modifier `prisma/retours-arriere/README.md`.

### 3. Codes d'erreur (`src/common/filters/codes-erreur.ts`)

À la fin du tableau `CODES_ERREUR`, juste après `'POSTE_TYPE_DIFFERENT',`, ajouter :

```ts
  // Prix à l'unité sur une fiche produit qui ne se vend pas à l'unité (400).
  'PRIX_UNITE_SANS_DECONDITIONNEMENT',
  // Coefficient d'une fiche non qualifiée qui a du stock changé sans conversion (400).
  'CONVERSION_REQUISE',
```

Ne pas toucher `CODES_AVEC_DETAILS` (ces codes ne portent pas de `details`).

### 4. DTO

**a. `src/pharmacie/dto/pharmacie.dto.ts`** (modifier) : dans `UpsertStockDto`, remplacer uniquement

```ts
  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(0)
  quantite: number;
```

par

```ts
  @ApiProperty({ example: 50 })
  @IsInt({ message: 'La quantité doit être un nombre entier.' })
  @Min(0)
  quantite: number;
```

Si `IsNumber` n'est plus utilisé dans le fichier, le retirer de l'import (sinon le garder). Rien d'autre dans ce fichier.

**b. `src/pharmacie/dto/fiche-produit.dto.ts`** (créer), contenu exact :

```ts
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { UniteMinimale } from 'generated/prisma/enums';

/** Unités minimales de vente (enum UniteMinimale, D410). */
export const UNITES_MINIMALES = [
  'COMPRIME',
  'GELULE',
  'ML',
  'SACHET',
  'GRAMME',
  'AMPOULE',
  'UNITE',
] as const satisfies readonly UniteMinimale[];

/** Plus grand entier enregistrable (colonne Int de PostgreSQL). */
const ENTIER_MAX = 2147483647;

/** Champ facultatif qui ne peut pas valoir null (colonne non nulle). */
const siPresent = (_objet: object, valeur: unknown): boolean =>
  valeur !== undefined;

/**
 * Modification de la fiche produit (PB06, D485 à D490). Aucun champ obligatoire ;
 * null efface prixUnitaire, prixUnite ou toleranceInventaire. La conversion du
 * stock (conversionStock) arrive en PB13.
 */
export class ModifierFicheDto {
  @ApiPropertyOptional({
    example: 35000,
    nullable: true,
    description: 'Prix de vente de la boîte en GNF ; null retire le prix.',
  })
  @IsOptional()
  @IsInt({
    message:
      'Le prix de la boîte doit être un nombre entier de francs guinéens, sans décimales.',
  })
  @Min(0)
  @Max(ENTIER_MAX)
  prixUnitaire?: number | null;

  @ApiPropertyOptional({
    example: 2000,
    nullable: true,
    description:
      "Prix de vente d'une unité minimale en GNF, saisi séparément, jamais calculé ; null retire le prix. Exige une fiche déconditionnable.",
  })
  @IsOptional()
  @IsInt({
    message:
      "Le prix à l'unité doit être un nombre entier de francs guinéens, sans décimales.",
  })
  @Min(1)
  @Max(ENTIER_MAX)
  prixUnite?: number | null;

  @ApiPropertyOptional({
    example: 20,
    description: 'Nombre d’unités minimales par boîte (1 à 10 000).',
  })
  @ValidateIf(siPresent)
  @IsInt()
  @Min(1)
  @Max(10000)
  coefficientBoite?: number;

  @ApiPropertyOptional({ enum: UNITES_MINIMALES, example: 'COMPRIME' })
  @ValidateIf(siPresent)
  @IsIn(UNITES_MINIMALES)
  uniteMinimale?: UniteMinimale;

  @ApiPropertyOptional({
    example: true,
    description: 'Vrai si le médicament se vend aussi à l’unité.',
  })
  @ValidateIf(siPresent)
  @IsBoolean()
  deconditionnable?: boolean;

  @ApiPropertyOptional({
    example: 2,
    nullable: true,
    description:
      "Écart d'inventaire toléré en unités minimales (0 à 1 000 000) ; null vaut 0.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  toleranceInventaire?: number | null;

  @ApiPropertyOptional({
    example: true,
    description:
      'Seule la valeur true est acceptée : le titulaire confirme unité et coefficient. La qualification ne se retire pas.',
  })
  @ValidateIf(siPresent)
  @IsIn([true])
  qualifie?: true;
}
```

(Le formateur Prettier peut réagencer les imports ou les lignes : seul le contenu compte.)

### 5. Service (créer `src/pharmacie/fiche-produit.service.ts`)

Exports et signatures exacts :

```ts
export const MESSAGE_FICHE_INTROUVABLE =
  'Ce médicament est introuvable dans le stock de cette pharmacie.';
export const MESSAGE_PRIX_UNITE_SANS_DECONDITIONNEMENT =
  "Un prix à l'unité n'est possible que si ce médicament se vend aussi à l'unité. Activez la vente à l'unité ou retirez le prix à l'unité.";
export const MESSAGE_CONVERSION_REQUISE =
  "Ce médicament a du stock : précisez comment convertir le stock existant avant de changer le nombre d'unités par boîte.";

const INCLUDE_FICHE = {
  medicament: { select: { id: true, nom: true, categorie: true } },
} satisfies Prisma.StockMedicamentInclude;

export type FicheAvecMedicament = Prisma.StockMedicamentGetPayload<{
  include: typeof INCLUDE_FICHE;
}>;
export type FicheReponse = FicheAvecMedicament & {
  avertissements: AvertissementPrix[];
};

@Injectable()
export class FicheProduitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
  ) {}

  async modifierFiche(
    structureId: string,
    userId: string,
    stockId: string,
    dto: ModifierFicheDto,
    ip?: string,
  ): Promise<Reponse<FicheReponse>>;
}
```

Imports : `BadRequestException`, `Injectable`, `NotFoundException` de `@nestjs/common` ; `import type { Prisma, StockMedicament } from 'generated/prisma/client'` ; `PrismaService` (`src/common/services/prisma.service`) ; `AccesPharmacieService` (`./acces-pharmacie.service`) ; `assurerPointDeVente` (`./point-de-vente`) ; `type Reponse` (`./points-de-vente.service`) ; `avertissementEcartPrix`, `type AvertissementPrix` (`./domaine/prix`) ; `ModifierFicheDto` (`./dto/fiche-produit.dto`).

Constantes locales :

```ts
type ChampFiche =
  | 'prixUnitaire'
  | 'prixUnite'
  | 'coefficientBoite'
  | 'uniteMinimale'
  | 'deconditionnable'
  | 'toleranceInventaire'
  | 'qualifie';

const CHAMPS_FICHE: ChampFiche[] = [
  'prixUnitaire',
  'prixUnite',
  'coefficientBoite',
  'uniteMinimale',
  'deconditionnable',
  'toleranceInventaire',
  'qualifie',
];

/** Valeurs avant et après d'une modification, écrites dans le journal d'audit. */
type ValeursFiche = Record<string, string | number | boolean | null>;
```

Algorithme de `modifierFiche`, dans cet ordre :

1. `const { user, structure } = await this.accesPharmacie.verifier(structureId, userId);`
2. Tout le reste dans `this.prisma.$transaction(async (tx) => { ... })` :
   a. Verrou : `` const verrou = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "StockMedicament" WHERE "id" = ${stockId} AND "structureId" = ${structure.id} FOR UPDATE`; `` ; si `verrou.length === 0` : `throw new NotFoundException(MESSAGE_FICHE_INTROUVABLE)`.
   b. `const existante = await tx.stockMedicament.findUniqueOrThrow({ where: { id: stockId }, include: INCLUDE_FICHE });`
   c. État voulu (`Pick<StockMedicament, ChampFiche>`) : pour `prixUnitaire`, `prixUnite`, `toleranceInventaire` : `dto.<champ> !== undefined ? dto.<champ> : existante.<champ>` (un `null` reçu efface) ; pour `coefficientBoite`, `uniteMinimale`, `deconditionnable`, `qualifie` : `dto.<champ> ?? existante.<champ>`.
   d. Règle du prix à l'unité (D490), sur l'état voulu : si `!voulus.deconditionnable && voulus.prixUnite !== null` : `throw new BadRequestException({ message: MESSAGE_PRIX_UNITE_SANS_DECONDITIONNEMENT, code: 'PRIX_UNITE_SANS_DECONDITIONNEMENT' })`.
   e. Règle du coefficient sans conversion (D487), sur l'état enregistré : si `voulus.coefficientBoite !== existante.coefficientBoite && !existante.qualifie && existante.quantite !== 0` : `throw new BadRequestException({ message: MESSAGE_CONVERSION_REQUISE, code: 'CONVERSION_REQUISE' })`.
   f. Paramètres : `const parametres = (await tx.parametresPharmacie.findUnique({ where: { structureId: structure.id } })) ?? (await assurerPointDeVente(tx, structure)).parametres;`
   g. `const changes = CHAMPS_FICHE.filter((c) => voulus[c] !== existante[c]);` ; si `changes.length === 0` : renvoyer `{ fiche: existante, seuil: parametres.seuilAvertissementPrixPct, modifiee: false }`.
   h. Sinon : `avant` et `apres` (`ValeursFiche`) remplis pour chaque champ de `changes` avec `existante[c]` et `voulus[c]` ; `const fiche = await tx.stockMedicament.update({ where: { id: stockId }, data: voulus, include: INCLUDE_FICHE });` ; `await tx.auditLog.create({ data: { userId: user.id, action: 'update', entityType: 'StockMedicament', entityId: stockId, ip: ip ?? null, metadata: { avant, apres } } });` ; renvoyer `{ fiche, seuil: parametres.seuilAvertissementPrixPct, modifiee: true }`.
3. Hors transaction : `const avertissement = avertissementEcartPrix(fiche.prixUnitaire, fiche.prixUnite, fiche.coefficientBoite, seuil);` puis renvoyer `{ data: { ...fiche, avertissements: avertissement ? [avertissement] : [] }, message: modifiee ? 'Fiche produit enregistrée.' : 'Aucune modification de la fiche produit.', success: true }`.

Aucun `console.log`, aucune notification, aucune lecture ni écriture de `quantite`, `disponible`, `dateExpiration`, `notes` ou `archiveLe` (sauf la lecture de `quantite` en 2e).

### 6. Contrôleur et module

**a. `src/pharmacie/fiche-produit.controller.ts`** (créer), sur le modèle de `points-de-vente.controller.ts` :

```ts
@ApiTags('Pharmacie & Médicaments')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class FicheProduitController {
  constructor(private readonly fiches: FicheProduitService) {}

  @Patch(':structureId/stock/:stockId/fiche')
  @RequirePermissions(PERMISSIONS.STOCK_WRITE)
  @ApiOperation({
    summary: 'Modifier la fiche produit (prix, unité, coefficient)',
    description:
      "Prix de la boîte et prix à l'unité indépendants, jamais recalculés l'un depuis l'autre ; avertissement ECART_PRIX non bloquant au-delà du seuil de la pharmacie. 400 PRIX_UNITE_SANS_DECONDITIONNEMENT si un prix à l'unité reste sur une fiche non déconditionnable ; 400 CONVERSION_REQUISE si le coefficient change sur une fiche non qualifiée qui a du stock. Aucune conversion de stock.",
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'stockId', description: 'Identifiant de la fiche (StockMedicament)' })
  modifierFiche(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('stockId') stockId: string,
    @Body() dto: ModifierFicheDto,
    @Ip() ip: string,
  ) {
    return this.fiches.modifierFiche(structureId, req.user.userId, stockId, dto, ip);
  }
}
```

Imports comme `points-de-vente.controller.ts` (seulement ceux utilisés). Pas de `@HttpCode` : 200 par défaut pour un PATCH.

**b. `src/pharmacie/pharmacie.module.ts`** (modifier) : importer `FicheProduitController` et `FicheProduitService` ; ajouter `FicheProduitController` à la fin de `controllers` et `FicheProduitService` dans `providers` juste après `PointsDeVenteService`. Rien d'autre.

### 7. Tests

Noms exacts. Aucun `console.log`, aucune assertion sur une URL, aucun `it.only` ni `it.skip`.

**a. `src/pharmacie/dto/pharmacie.dto.spec.ts`** (créer), `describe('UpsertStockDto : quantité entière')`, avec `plainToInstance(UpsertStockDto, corps)` (`class-transformer`) puis `validate(...)` (`class-validator`), corps de base `{ medicamentId: 'med-1', quantite: <valeur> }` :
1. `'1. quantité décimale refusée (isInt)'` : `quantite: 2.5` : une erreur sur la propriété `quantite` dont `constraints` a la clé `isInt` et le message `'La quantité doit être un nombre entier.'`.
2. `'2. quantité négative refusée (min)'` : `quantite: -1` : erreur sur `quantite`, clé `min`.
3. `'3. quantité entière acceptée'` : `quantite: 3` : aucune erreur.

**b. `src/pharmacie/fiche-produit.http.spec.ts`** (créer), modèle exact de `points-de-vente.http.spec.ts` (vrai `PermissionsGuard`, vrai `PermissionsService`, Prisma et Redis simulés, `AuthGuard` remplacé par l'en-tête `x-essai-user`, même `ValidationPipe` et `AllExceptionsFilter`), contrôleur `FicheProduitController`, `FicheProduitService` simulé (`modifierFiche` résolu en `{ data: {}, message: 'ok', success: true }` dans `beforeEach`, `mockClear` avant). Profils : `hopital` (`HOPITAL`, `['stock:read', 'stock:write']`), `lecteur` (`PHARMACIE`, `['stock:read', 'vente:read']`), `pharmacien` (`PHARMACIE`, `['stock:read', 'stock:write', 'vente:read', 'vente:write', 'caisse:utiliser']`). Route : `PATCH /pharmacie/s1/stock/k1/fiche`. `describe('Fiche produit (HTTP)')` :
1. `'1. membre d un hôpital : 403 PERMISSION_REFUSEE'` : corps `{ prixUnite: 100 }` : 403, `code` `PERMISSION_REFUSEE`, `modifierFiche` non appelé.
2. `'2. pharmacie sans stock:write : 403'` : profil `lecteur`, même corps : 403, non appelé.
3. `'3. pharmacien : tous les champs transmis au service, null compris'` : corps `{ prixUnitaire: 2000, prixUnite: null, coefficientBoite: 10, uniteMinimale: 'COMPRIME', deconditionnable: true, toleranceInventaire: 2, qualifie: true }` : 200 ; `modifierFiche` appelé une fois avec `('s1', 'pharmacien', 'k1', expect.objectContaining({ prixUnitaire: 2000, prixUnite: null, coefficientBoite: 10, uniteMinimale: 'COMPRIME', deconditionnable: true, toleranceInventaire: 2, qualifie: true }), expect.any(String))`.
4. `'4. corps vide accepté'` : `{}` : 200, appelé avec `('s1', 'pharmacien', 'k1', expect.any(Object), expect.any(String))`.
5. `'5. valeurs refusées (VALIDATION), aucun appel'` : en `pharmacien`, chaque corps répond 400, `code` `VALIDATION`, et `champs` contient une entrée dont `champ` vaut le champ indiqué et dont `contraintes` contient la contrainte indiquée : `{ prixUnite: 0 }` (`prixUnite`, `min`) ; `{ prixUnite: 12.5 }` (`prixUnite`, `isInt`) ; `{ prixUnitaire: -1 }` (`prixUnitaire`, `min`) ; `{ coefficientBoite: 0 }` (`coefficientBoite`, `min`) ; `{ coefficientBoite: 10001 }` (`coefficientBoite`, `max`) ; `{ coefficientBoite: null }` (`coefficientBoite`, `isInt`) ; `{ uniteMinimale: 'BOITE' }` (`uniteMinimale`, `isIn`) ; `{ deconditionnable: 'oui' }` (`deconditionnable`, `isBoolean`) ; `{ toleranceInventaire: -1 }` (`toleranceInventaire`, `min`) ; `{ qualifie: false }` (`qualifie`, `isIn`) ; `{ conversionStock: 'MULTIPLIER' }` (`conversionStock`, `whitelistValidation`) ; `{ quantite: 5 }` (`quantite`, `whitelistValidation`) ; `modifierFiche` jamais appelé.

**c. `test/db/m3-fiche-produit.db-spec.ts`** (créer), `describe('Migration M3, fiche produit étendue (PB06)')`. Constantes : `M1 = '20261026090000_pharmacie_t1_permissions'`, `M2 = '20261026100000_pharmacie_t1_points_de_vente'`, `M3 = '20261026110000_pharmacie_t1_fiche_produit'`, `COLONNES_AVANT = ['dateExpiration', 'disponible', 'id', 'medicamentId', 'notes', 'prixUnitaire', 'quantite', 'structureId', 'updatedAt']`, `PAR_DEFAUT = 'SELECT count(*)::int AS n FROM "StockMedicament" WHERE "uniteMinimale" = \'UNITE\' AND "coefficientBoite" = 1 AND "prixUnite" IS NULL AND NOT "deconditionnable" AND "toleranceInventaire" IS NULL AND NOT "qualifie" AND "archiveLe" IS NULL'`. Fonctions locales : `lignesSql(fichier)` (identique à `m2-points-de-vente.db-spec.ts`), `compter(client, sql)`, `colonnes(client)` = `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'StockMedicament' ORDER BY column_name` (renvoie les noms), `fiches(client)` = `SELECT "id", "quantite", "prixUnitaire" FROM "StockMedicament" ORDER BY "id"`. `beforeAll` : `creerBaseVide`, `appliquerMigrations(client, { jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL })`, `resume = await chargerFormatActuel(client)`, `appliquees = await appliquerMigrations(client, { apres: DERNIERE_MIGRATION_FORMAT_ACTUEL, jusqua: M3 })` (jamais au-delà de M3). `afterAll` : `supprimerBaseDeTest` (modèle de `m2-points-de-vente.db-spec.ts`). Tests, dans cet ordre :
1. `'la migration et son retour arrière commencent par BEGIN; et finissent par COMMIT; (D456)'` (même forme que le test 1 de M2, fichiers de M3).
2. `'M3 haut : appliquée après M2, les 40 fiches prennent les valeurs par défaut, quantités et prix intacts'` : `appliquees` `toEqual([M1, M2, M3])` ; `compter(PAR_DEFAUT)` vaut 40 ; `fiches(client)` `toEqual(resume.fiches.map((f) => ({ id: f.id, quantite: f.quantite, prixUnitaire: f.prixUnitaire })).sort((a, b) => (a.id < b.id ? -1 : 1)))` ; `SELECT count(*)::int AS n FROM "StockMedicament" WHERE "createdAt" > now() - interval '10 minutes'` vaut 40.
3. `'M3 haut : enum UniteMinimale dans l ordre du plan'` : `SELECT enum_range(NULL::"UniteMinimale")::text AS r` : `r` vaut `'{COMPRIME,GELULE,ML,SACHET,GRAMME,AMPOULE,UNITE}'`.
4. `'M3 haut : les quatre contraintes refusent une fiche incohérente'` : sur `stk-06`, chaque requête rejette avec l'objet d'erreur `toMatchObject({ constraint: <nom> })` : `UPDATE "StockMedicament" SET "coefficientBoite" = 0 WHERE "id" = 'stk-06'` (`StockMedicament_coefficientBoite_check`) ; `UPDATE "StockMedicament" SET "prixUnite" = 100 WHERE "id" = 'stk-06'` (`StockMedicament_prixUnite_deconditionnable_check`) ; `UPDATE "StockMedicament" SET "deconditionnable" = true, "prixUnite" = 0 WHERE "id" = 'stk-06'` (`StockMedicament_prixUnite_check`) ; `UPDATE "StockMedicament" SET "toleranceInventaire" = -1 WHERE "id" = 'stk-06'` (`StockMedicament_toleranceInventaire_check`) ; puis `UPDATE "StockMedicament" SET "deconditionnable" = true, "prixUnite" = 100, "coefficientBoite" = 20, "toleranceInventaire" = 0 WHERE "id" = 'stk-06'` réussit (`rowCount` 1).
5. `'retour arrière : haut, bas, haut sur la base chargée'` : `avant = await fiches(client)` ; `appliquerRetourArriere(client, M3)` ; `colonnes(client)` `toEqual(COLONNES_AVANT)` ; `SELECT count(*)::int AS n FROM pg_type WHERE typname = 'UniteMinimale'` vaut 0 ; `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = '"StockMedicament"'::regclass AND contype = 'c'` vaut 0 ; `fiches(client)` `toEqual(avant)` ; `SELECT count(*)::int AS n FROM "PointDeVente"` vaut 3 (M2 intacte) ; `appliquerMigrations(client, { apres: M2, jusqua: M3 })` `toEqual([M3])` ; `compter(PAR_DEFAUT)` vaut 40 (la fiche `stk-06` modifiée au test 4 revient aux valeurs par défaut).

**d. `test/db/fiche-produit.db-spec.ts`** (créer), `describe('Fiche produit étendue sur base de test (PB06)')`. `beforeAll` : base, migrations jusqu'au format, `chargerFormatActuel`, `appliquerMigrations(client, { apres: DERNIERE_MIGRATION_FORMAT_ACTUEL })` (toutes), `prisma = creerPrismaDeTest(base)`, `acces = new AccesPharmacieService(prisma)`, `service = new FicheProduitService(prisma, acces)`, `pharmacie = new PharmacieService(prisma, new NotificationsService(prisma), acces)`. `afterAll` : `fermerPrismaDeTest` puis `supprimerBaseDeTest` (modèle de `points-de-vente.db-spec.ts`). Fonctions locales `refus` et `sql` identiques à `points-de-vente.db-spec.ts`, et `fiche(id)` = `SELECT "prixUnitaire", "prixUnite", "coefficientBoite", "uniteMinimale"::text AS "uniteMinimale", "deconditionnable", "toleranceInventaire", "qualifie", "quantite", "updatedAt" FROM "StockMedicament" WHERE "id" = $1` (première ligne). Les tests partagent la base, dans cet ordre :
1. `'CA3 : modifier le prix de la boîte ne change pas le prix à l unité'` : `service.modifierFiche('str-pharma-1', 'usr-admin-p1', 'stk-06', { deconditionnable: true, prixUnite: 100 }, '127.0.0.1')` : `data.prixUnite` 100, `data.prixUnitaire` 1500, `data.deconditionnable` vrai, `message` `'Fiche produit enregistrée.'` ; puis `{ prixUnitaire: 2000 }` : `data.prixUnitaire` 2000, `data.prixUnite` 100 ; en base `fiche('stk-06')` : `prixUnitaire` 2000, `prixUnite` 100.
2. `'CA3 : modifier le prix à l unité ne change pas le prix de la boîte'` : `{ prixUnite: 150 }` sur `stk-06` : `data.prixUnite` 150, `data.prixUnitaire` 2000 ; en base identique.
3. `'CA3 : l upsert du stock change le prix de la boîte sans toucher au prix à l unité ni à la fiche'` : `pharmacie.upsertStock('str-pharma-1', 'usr-admin-p1', { medicamentId: 'med-06', quantite: 240, prixUnitaire: 2500 })` : `data.prixUnitaire` 2500, `data.prixUnite` 150 ; en base `fiche('stk-06')` : `prixUnitaire` 2500, `prixUnite` 150, `deconditionnable` vrai, `coefficientBoite` 1, `uniteMinimale` `'UNITE'`, `qualifie` faux.
4. `'avertissement ECART_PRIX au-delà du seuil de 25 %, aucun en deçà ni à la frontière, jamais bloquant'` : sur `stk-01` (quantité 0) : `{ prixUnitaire: 2000, coefficientBoite: 10, deconditionnable: true, prixUnite: 200 }` : `data.avertissements` `toEqual([])`, `data.coefficientBoite` 10 ; `{ prixUnite: 250 }` : `[]` (écart de 25 % exactement) ; `{ prixUnite: 251 }` : `toEqual([{ code: 'ECART_PRIX', ecartPct: 26 }])` et en base `prixUnite` 251 ; `{ prixUnite: 150 }` : `[]` ; `{ prixUnite: 149 }` : `[{ code: 'ECART_PRIX', ecartPct: 26 }]` ; puis `UPDATE "ParametresPharmacie" SET "seuilAvertissementPrixPct" = 50 WHERE "structureId" = 'str-pharma-1'` ; `modifierFiche(..., 'stk-01', {})` : `data.avertissements` `[]`, `message` `'Aucune modification de la fiche produit.'` ; remettre le seuil à 25 par `UPDATE`.
5. `'refus : prix à l unité sur une fiche non déconditionnable (400 PRIX_UNITE_SANS_DECONDITIONNEMENT), rien n est écrit'` : `refus(service.modifierFiche('str-pharma-1', 'usr-admin-p1', 'stk-03', { prixUnite: 100 }))` : statut 400, `corps` `toMatchObject({ code: 'PRIX_UNITE_SANS_DECONDITIONNEMENT', message: MESSAGE_PRIX_UNITE_SANS_DECONDITIONNEMENT })`, en base `stk-03` `prixUnite` nul ; `refus(... 'stk-01', { deconditionnable: false })` : même statut et code, en base `stk-01` `deconditionnable` vrai et `prixUnite` 149 ; `modifierFiche(... 'stk-01', { deconditionnable: false, prixUnite: null })` réussit : `data.deconditionnable` faux, `data.prixUnite` nul.
6. `'refus : coefficient changé sur une fiche non qualifiée qui a du stock (400 CONVERSION_REQUISE), accepté après qualification sans conversion'` : `refus(... 'stk-05', { coefficientBoite: 20 })` : statut 400, `corps` `toMatchObject({ code: 'CONVERSION_REQUISE', message: MESSAGE_CONVERSION_REQUISE })`, en base `coefficientBoite` 1 ; `refus(... 'stk-05', { coefficientBoite: 20, qualifie: true })` : même refus (la règle lit l'état enregistré), en base `qualifie` faux ; `modifierFiche(... 'stk-05', { uniteMinimale: 'COMPRIME', qualifie: true })` : `data.qualifie` vrai, `data.uniteMinimale` `'COMPRIME'` ; puis `{ coefficientBoite: 20 }` : `data.coefficientBoite` 20 ; en base `quantite` toujours 11 (aucune conversion).
7. `'audit : seuls les champs changés, aucune écriture sans changement'` : `modifierFiche('str-pharma-1', 'usr-pharm-p1', 'stk-02', { toleranceInventaire: 2, uniteMinimale: 'GELULE' }, '127.0.0.1')` ; une seule ligne `AuditLog` (`entityType` `'StockMedicament'`, `entityId` `'stk-02'`) : `action` `'update'`, `userId` `'usr-pharm-p1'`, `metadata` `toEqual({ avant: { uniteMinimale: 'UNITE', toleranceInventaire: null }, apres: { uniteMinimale: 'GELULE', toleranceInventaire: 2 } })` ; `updatedAt` en base relevé ; même appel une seconde fois : `message` `'Aucune modification de la fiche produit.'`, toujours une seule ligne d'audit pour `stk-02`, `updatedAt` inchangé (`getTime()` égal).
8. `'réponse : fiche complète, médicament et avertissements, aucune clé de coût'` : `r = await service.modifierFiche('str-pharma-1', 'usr-admin-p1', 'stk-02', {})` : `r.data` a les propriétés `id`, `quantite`, `prixUnitaire`, `uniteMinimale`, `coefficientBoite`, `prixUnite`, `deconditionnable`, `toleranceInventaire`, `qualifie`, `archiveLe`, `createdAt`, `medicament`, `avertissements` (`toHaveProperty` pour chacune) ; `Object.keys(r.data.medicament).sort()` `toEqual(['categorie', 'id', 'nom'])`, `r.data.medicament.id` `'med-02'` ; `cheminsCout(r.data)` `toEqual([])`.
9. `'lecture du stock : les champs de la fiche sont renvoyés pour chaque fiche'` : `pharmacie.getStockPharmacie('str-pharma-1', 'usr-admin-p1')` : chaque élément de `data.stocks` a les propriétés `uniteMinimale`, `coefficientBoite`, `prixUnite`, `deconditionnable`, `toleranceInventaire`, `qualifie` ; l'élément d'`id` `'stk-05'` a `coefficientBoite` 20, `qualifie` vrai, `uniteMinimale` `'COMPRIME'`.
10. `'accès : hôpital, membre d une autre pharmacie, fiche d une autre pharmacie ou inconnue'` : `refus(service.modifierFiche('str-hopital-1', 'usr-admin-h1', 'stk-01', {}))` statut 403 ; `refus(service.modifierFiche('str-pharma-1', 'usr-pharm-p2', 'stk-01', {}))` statut 403 ; `refus(service.modifierFiche('str-pharma-2', 'usr-admin-p2', 'stk-01', { qualifie: true }))` statut 404, `corps` `toMatchObject({ message: MESSAGE_FICHE_INTROUVABLE })`, en base `stk-01` `qualifie` faux ; `refus(service.modifierFiche('str-pharma-1', 'usr-admin-p1', 'stk-inconnu', {}))` statut 404.
11. `'concurrence : deux modifications simultanées des deux prix, aucune perdue'` : `Promise.all([service.modifierFiche('str-pharma-1', 'usr-admin-p1', 'stk-06', { prixUnite: 300 }), service.modifierFiche('str-pharma-1', 'usr-admin-p1', 'stk-06', { prixUnitaire: 4000 })])` ; en base `stk-06` : `prixUnite` 300, `prixUnitaire` 4000.

### 8. Documentation (`CLAUDE.md` du dépôt back)

Insérer, juste avant la ligne qui commence par `- **Validation** globale : `, la puce suivante (une seule ligne dans le fichier, texte exact) :

```
- **Fiche produit étendue (tranche pharmacie 1, PB06)** : migration `20261026110000_pharmacie_t1_fiche_produit` (M3, retour arrière dans `prisma/retours-arriere/`) : `StockMedicament` gagne `uniteMinimale` (enum `UniteMinimale` : `COMPRIME`, `GELULE`, `ML`, `SACHET`, `GRAMME`, `AMPOULE`, `UNITE`, défaut `UNITE`), `coefficientBoite` (unités par boîte, défaut 1, au moins 1), `prixUnite` (prix d'une unité, nul ou positif, permis seulement si `deconditionnable`), `deconditionnable` (défaut faux), `toleranceInventaire` (unités, nul ou positif), `qualifie` (défaut faux), `archiveLe` et `createdAt` ; `prixUnitaire` garde son nom et vaut le prix de la boîte. Les deux prix sont indépendants : aucun n'est jamais calculé depuis l'autre. `PATCH /pharmacie/:structureId/stock/:stockId/fiche` (`stock:write`, `FicheProduitController`, accès par `AccesPharmacieService`) : corps `{ prixUnitaire?, prixUnite?, coefficientBoite?, uniteMinimale?, deconditionnable?, toleranceInventaire?, qualifie? }` (`null` efface `prixUnitaire`, `prixUnite` ou `toleranceInventaire` ; `qualifie` n'accepte que `true`) ; réponse `data` = fiche avec `medicament { id, nom, categorie }` et `avertissements: [{ code: "ECART_PRIX", ecartPct }]` (non bloquant, seuil `seuilAvertissementPrixPct` des paramètres) ; 400 `PRIX_UNITE_SANS_DECONDITIONNEMENT` (prix à l'unité sur une fiche non déconditionnable), 400 `CONVERSION_REQUISE` (coefficient changé sur une fiche non qualifiée qui a du stock, aucune conversion avant PB13), 404 « Ce médicament est introuvable dans le stock de cette pharmacie. » ; modification sous verrou de ligne, auditée (`update`, `StockMedicament`, avant et après des champs changés), aucune écriture sans changement. `UpsertStockDto.quantite` est un entier (`@IsInt`) ; l'upsert ne touche jamais `prixUnite` ni les autres champs de fiche. Les lectures de stock renvoient ces colonnes.
```

Rien d'autre dans `CLAUDE.md`.

### Cas limites (déjà tranchés, ne pas rediscuter)

- Retirer le déconditionnement d'une fiche qui a un prix à l'unité sans retirer ce prix : 400 `PRIX_UNITE_SANS_DECONDITIONNEMENT` (jamais d'effacement implicite, D490).
- Changer le coefficient et poser `qualifie: true` dans la même requête sur une fiche non qualifiée qui a du stock : refusé (D487 lit l'état enregistré) ; il faut qualifier d'abord.
- Quantité de la fiche : elle ne peut pas être négative aujourd'hui (l'existant écrête à 0) ; la règle de D487 teste `quantite !== 0`, donc une quantité nulle laisse changer le coefficient librement.
- Corps vide ou valeurs identiques : aucune écriture, aucun audit, réponse 200 avec la fiche, ses avertissements et le message « Aucune modification de la fiche produit. ».
- Paramètres absents pour la pharmacie : créés par `assurerPointDeVente` dans la transaction (seuil par défaut 25).
- Fiche archivée (`archiveLe` non nul) : aucun chemin ne l'archive encore ; aucun filtre ici (PB08 tranche, D491).
- Les réponses publiques (recherche, détail catalogue) renvoient aussi les nouvelles colonnes par leur `include` : accepté jusqu'aux `select` explicites de PB08 (D491) ; aucune n'est un coût.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Spécifiques : français partout (commentaires, noms de tests, messages) ; aucun tiret cadratin ni demi-cadratin ; aucun `eslint-disable`, aucun `any`, aucun `console.log` ; ne pas toucher `package.json`, `package-lock.json`, le harnais (`test/db/harnais.ts`, fichiers existants de `test/db/fixtures/`), les instantanés (`test/db/instantanes/`, ne jamais lancer `MAJ_INSTANTANES=1`), `src/pharmacie/domaine/`, `src/pharmacie/pharmacie.service.ts`, `src/pharmacie/pharmacie.controller.ts`, les specs existantes ; aucun commit (le chef commite) ; ne jamais afficher ni écrire d'URL de base, de mot de passe ou de valeur de `.env`. Si le texte SQL ou Prisma de cette fiche ne passe pas tel quel (`prisma validate`, harnais, garde de dérive), s'arrêter en BLOCKED avec la sortie (masquée) au lieu de l'adapter.

Fichiers touchés (liste fermée) :
- créés : `prisma/migrations/20261026110000_pharmacie_t1_fiche_produit/migration.sql`, `prisma/retours-arriere/20261026110000_pharmacie_t1_fiche_produit.down.sql`, `src/pharmacie/dto/fiche-produit.dto.ts`, `src/pharmacie/dto/pharmacie.dto.spec.ts`, `src/pharmacie/fiche-produit.service.ts`, `src/pharmacie/fiche-produit.controller.ts`, `src/pharmacie/fiche-produit.http.spec.ts`, `test/db/m3-fiche-produit.db-spec.ts`, `test/db/fiche-produit.db-spec.ts` ;
- modifiés : `prisma/schema.prisma`, `src/pharmacie/dto/pharmacie.dto.ts`, `src/pharmacie/pharmacie.module.ts`, `src/common/filters/codes-erreur.ts`, `CLAUDE.md`.

## Done when

Toutes les commandes depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (conteneur `backend` démarré), chacune avec un code de sortie 0 :

1. `docker compose exec -T backend npx prisma generate` puis `docker compose exec -T backend npx prisma validate`
2. `docker compose exec -T backend npx tsc --noEmit`
3. `docker compose exec -T backend npx eslint src/pharmacie/dto/fiche-produit.dto.ts src/pharmacie/dto/pharmacie.dto.ts src/pharmacie/dto/pharmacie.dto.spec.ts src/pharmacie/fiche-produit.service.ts src/pharmacie/fiche-produit.controller.ts src/pharmacie/fiche-produit.http.spec.ts src/pharmacie/pharmacie.module.ts src/common/filters/codes-erreur.ts test/db/m3-fiche-produit.db-spec.ts test/db/fiche-produit.db-spec.ts` (aucune erreur ni avertissement ; ces fichiers existants sont propres avant modification, vérifié par le chef)
4. `docker compose exec -T backend npm test` : toutes les suites passent (73) ; réussis = 841 + 8 (3 + 5) ; aucun test supprimé ni ignoré en plus des 3 actuels.
5. `docker compose exec -T backend npm run test:db` : 8 suites vertes (harnais 11, PB02 9, M1 6, M2 7, points de vente 14, dérive 1, M3 5, fiche produit 11, soit 64 tests) ; instantanés PB02 inchangés (`git status --short test/db/instantanes` vide, depuis `back_medconnect`).
6. Aucune base `mc_test_` restante : `docker compose exec -T backend node -e "const {Client}=require('pg');const u=new URL(process.env.DATABASE_URL);u.pathname='/postgres';const c=new Client({connectionString:u.toString()});c.connect().then(()=>c.query(\"select count(*)::int n from pg_database where datname like 'mc_test_%'\")).then(r=>{console.log(r.rows[0].n);return c.end()})"` affiche `0`.
7. M3 s'applique à la base de développement au redémarrage : `docker compose restart backend`, puis, une fois l'API démarrée (`docker compose logs --tail 50 backend` montre le démarrage de Nest sans erreur de migration), `docker compose exec -T backend node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query(\"select count(*)::int n from _prisma_migrations where finished_at is not null and rolled_back_at is null and migration_name = '20261026110000_pharmacie_t1_fiche_produit'\")).then(r=>{console.log(r.rows[0].n);return c.end()})"` affiche `1`, et `docker compose exec -T backend sh -c 'npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code >/dev/null 2>&1; echo $?'` affiche `0`.
8. `LC_ALL=C.UTF-8 grep -rnP "\x{2013}|\x{2014}" <fichiers touchés>` ne renvoie rien.
9. `git status --short` (depuis `back_medconnect`) ne liste que les fichiers de la liste fermée (plus `docs/plans/`, tenu par l'orchestrateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-25 | spécifié (codeur Sonnet, vérificateur Sonnet) | réussi, validé par le chef |

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
tsc, eslint (10 fichiers), npm test, npm run test:db, migrate diff base de dev | 0 erreur ; 73 suites, 849 réussis, 3 ignorés ; 8 suites, 64 tests ; diff 0 | commit « feat(pharmacie): fiche produit étendue ... (PB06) » (hash : voir git log, inconnu avant le commit)
