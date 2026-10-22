# B13 - Ventes en pharmacie : serveur complet (panier, reçu, annulation)

Tier: spécifié (agent implementeur-specifie)
Audience: mixte (API dev ; champ `message` des erreurs et des réponses, notifications de stock lus par des pharmaciens, non-dev, fournis mot pour mot ci-dessous)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec ; curl)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot7-back` (arbre principal ; ne pas créer de branche ; NE PAS COMMITER : le chef d'équipe commite après validation). Rien à modifier dans le dépôt racine, ni dans `front_medconnect` ou `mobile_medconnect`.
Spécification qui fait foi : `D:\souleymane\perso-archive-20260923\perso\medconnecte\SPEC-VENTES-PHARMACIE.md` (la lire en entier avant de commencer). Décisions de référence : `docs/plans/runs/2026-10-22-lot7/decisions.md`, D107 à D128. Cette fiche tranche tout ce que la spécification laisse ouvert : en cas d'écart apparent, suivre la fiche et le signaler dans le Return.

## Audit (état avant la tâche, établi par le chef d'équipe, à ne pas refaire)

1. `prisma/schema.prisma` : `StockMedicament` (l. 430 à 445) a `prixUnitaire Float?`, `quantite Int`, `disponible Boolean`, `dateExpiration DateTime?`, unicité `(medicamentId, structureId)`. `Medicament.ordonnanceRequise Boolean`. `Structure` (l. 159 à 216) : `nom`, `adresse?`, `ville?`, `telephone?`, `logoFileId?` + relation `logoFile StoredFile?`. `AuditLog` (l. 351 à 367) : `userId?`, `action`, `entityType`, `entityId`, `ip?`, `metadata Json?`. `Permission`, `AppRole`, `RolePermission` l. 37 à 68 (`Permission.id` a un `@default(uuid())` Prisma, PAS de défaut SQL). Dernière migration : `20261021150000_tb10b_sos_position_idempotence`. PostgreSQL 17 (`gen_random_uuid()` disponible).
2. `src/common/rbac/permissions.constants.ts` : catalogue `PERMISSIONS` et `PERMISSION_CATALOG` ; `DEFAULT_STRUCTURE_ROLES.PHARMACIE` = rôles « Pharmacien » (legacy PHARMACIEN) et « Administrateur de structure » (legacy STRUCTURE_ADMIN, sans stock). `RolesService.ensureRole` (`roles.service.ts` l. 77 à 106) n'applique les permissions d'un rôle de structure QU'À SA CRÉATION : ajouter une permission aux constantes ne la donne pas aux pharmacies existantes (dont celles du mode démo).
3. `src/common/rbac/permissions-type-structure.ts` : liste blanche `PERMISSIONS_AUTORISEES_PHARMACIE` appliquée si type = PHARMACIE ; autres types inchangés. Spec `permissions-type-structure.spec.ts` : l. 28 à 43 compare le résultat du filtre à des listes exactes (`toEqual`) ; l. 140 attend la clé de cache `perms:v2:user:u1`.
4. `src/common/rbac/permissions.service.ts` l. 28 : `CACHE_PREFIX = 'perms:v2:user:'` (TTL 300 s). `PermissionsGuard` exige TOUTES les permissions listées dans `@RequirePermissions`.
5. `src/common/filters/all-exceptions.filter.ts` : un `code` du catalogue `codes-erreur.ts` est recopié ; `champs` seulement pour VALIDATION ; `donnees` en liste blanche (`DONNEES_AUTORISEES`, l. 49) ; le champ `details` n'est JAMAIS recopié depuis l'exception (seulement le tableau de messages de validation, hors production). Interface `CorpsErreur` l. 74 à 82 (`details?: unknown` existe déjà).
6. `src/carnet-sante/sos-idempotence.ts` : `SOS_IDEMPOTENCE_HEURES` (24), `lireCleIdempotence(enTete)` (clé de 8 à 128 caractères `[A-Za-z0-9._:-]`, sinon null), `estConflitCleIdempotence(erreur)` (P2002 dont le message ou la meta contient `cleIdempotence`). Utilisation de référence : `carnet-sante.service.ts` l. 1444 à 1561.
7. `src/pharmacie/pharmacie.service.ts` : `updateStockQuantite` (l. 376 à 424) lit la quantité puis écrit `Math.max(0, ancienne + variation)` : mise à jour perdue en cas d'accès simultané. Alerte de stock bas : staff = `user.findMany({ where: { structureId, role: { in: ['PHARMACIEN', 'STRUCTURE_ADMIN'] } } })` puis `notificationsService.createManyNotifications(ids, { type: 'STOCK_ALERTE', titre: 'Stock critique', message })`. Import Excel : le prix est lu par `lireNombre` (l. 727 à 735, décimal accepté) et écrit tel quel (l. 770). `checkPharmacieAccess` est privé (l. 1001).
8. `src/pharmacie/dto/pharmacie.dto.ts` : `UpsertStockDto.prixUnitaire` en `@IsNumber() @Min(0)` (l. 100 à 104) ; `UpdateStockQuantiteDto.variation` en `@IsNumber()` (l. 117 à 120).
9. `src/pharmacie/pharmacie.module.ts` importe `AuthModule` et `NotificationsModule`. `StorageService` (`src/storage/storage.service.ts`, module `@Global`) expose `getPublicUrl(key)`. `RequestWithUser` (`src/auth/jwt.strategy.ts`) ne porte pas l'IP : utiliser le décorateur `@Ip()` de `@nestjs/common`.
10. Demo (pour l'appel réel) : `DEMO_MODE` est défini dans le `.env` racine ; Pharmacie de Kaloum (`pharmaKaloum`) avec le pharmacien Ousmane Keita (`ousmane.keita@demo.medconnecte.gn`) et l'administratrice Djénabou Baldé (`admin.kaloum@demo.medconnecte.gn`, STRUCTURE_ADMIN rattachée et admin de la pharmacie) ; stock démo avec prix entiers. La purge démo supprime les structures : les ventes doivent suivre en cascade (D110).
11. Tests : tous unitaires (Prisma simulé), lancés par `docker compose exec -T backend npx jest`. Modèle de test HTTP : `src/pharmacie/pharmacie-import-mode.http.spec.ts` (supertest, ValidationPipe de `main.ts`, `AllExceptionsFilter`).

## Spec

### 1. Prisma : `prisma/schema.prisma`

Ajouter, à la suite de `StockMedicament` (section pharmacie) :

```prisma
enum StatutVente {
  VALIDEE
  ANNULEE
}

// Vente au comptoir d'une pharmacie (lot 7). Jamais supprimée, seulement annulée.
// vendeurId, annuleeParId et les identifiants des lignes sont sans clé étrangère (D109) :
// un membre, un stock ou un médicament supprimé ne bloque rien et le reçu reste lisible.
model Vente {
  id                 String      @id @default(uuid())
  structureId        String
  structure          Structure   @relation(fields: [structureId], references: [id], onDelete: Cascade)
  numero             String      // V-AAAA-NNNNNN, séquence par pharmacie et par année
  vendeurId          String
  vendeurNom         String      // copie « Prénom Nom » au moment de la vente
  clientNom          String?
  clientTelephone    String?
  ordonnanceVerifiee Boolean     @default(false)
  total              Int         // GNF, entier
  statut             StatutVente @default(VALIDEE)
  annuleeLe          DateTime?
  annuleeParId       String?
  motifAnnulation    String?
  cleIdempotence     String?     // jamais renvoyée au client
  lignes             LigneVente[]
  createdAt          DateTime    @default(now())

  @@unique([structureId, numero])
  @@unique([structureId, cleIdempotence])
  @@index([structureId, createdAt])
}

model LigneVente {
  id                String @id @default(uuid())
  venteId           String
  vente             Vente  @relation(fields: [venteId], references: [id], onDelete: Cascade)
  medicamentId      String
  stockMedicamentId String
  nomMedicament     String // copie du nom au moment de la vente
  prixUnitaire      Int    // copie du prix du stock, GNF
  quantite          Int
  sousTotal         Int

  @@index([venteId])
}

// Compteur de numérotation des ventes, par pharmacie et par année (UTC = heure de Conakry).
model CompteurVente {
  structureId   String
  structure     Structure @relation(fields: [structureId], references: [id], onDelete: Cascade)
  annee         Int
  dernierNumero Int       @default(0)

  @@id([structureId, annee])
}
```

Dans `Structure`, après `medicaments StockMedicament[]`, ajouter :

```prisma
  // Ventes au comptoir et compteur de numérotation (pharmacies)
  ventes         Vente[]
  compteursVente CompteurVente[]
```

Dans `StockMedicament`, remplacer `prixUnitaire  Float?     // en GNF` par `prixUnitaire  Int?       // en GNF, entier (lot 7, arrondi à la migration)`. Ne rien changer d'autre au schéma.

### 2. Migration : `prisma/migrations/20261022120000_ventes_pharmacie/migration.sql`

1. Générer le DDL sans l'appliquer (Prisma 7.8.0 dans le conteneur, git absent du conteneur) : lire l'ancien schéma sur l'hôte avec `git -C back_medconnect show HEAD:prisma/schema.prisma`, l'écrire avec l'outil Write dans votre scratchpad, le copier dans le conteneur (`docker compose cp <fichier> backend:/tmp/schema-avant.prisma`), puis `docker compose exec -T backend npx prisma migrate diff --from-schema /tmp/schema-avant.prisma --to-schema prisma/schema.prisma --script`. Si cette version refuse ces options, `npx prisma migrate diff --help` donne les noms exacts. Ne jamais lancer `prisma migrate dev`, `db push` ni `migrate reset`.
2. Écrire le fichier avec l'outil Write (jamais par redirection shell). En tête, commentaire : `-- Ventes en pharmacie (lot 7, B13) : ventes, lignes, compteur de numérotation, prix du stock en entier.` puis `-- DDL généré par prisma migrate diff ; reprise des permissions écrite à la main.`
3. La conversion du prix DOIT arrondir. Si le diff produit un `ALTER COLUMN "prixUnitaire" SET DATA TYPE INTEGER` sans `USING`, le remplacer par :
   `ALTER TABLE "StockMedicament" ALTER COLUMN "prixUnitaire" SET DATA TYPE INTEGER USING ROUND("prixUnitaire")::INTEGER;`
4. Ajouter à la fin, à la main, la reprise des permissions (idempotente, D112) :

```sql
-- Permissions des ventes (D112) : catalogue, puis rôles existants des pharmacies.
-- RolesService n'applique les permissions d'un rôle de structure qu'à sa création.
INSERT INTO "Permission" ("id", "code", "libelle", "categorie")
VALUES
  (gen_random_uuid()::text, 'vente:read', 'Consulter les ventes de la pharmacie', 'Pharmacie'),
  (gen_random_uuid()::text, 'vente:write', 'Enregistrer une vente', 'Pharmacie'),
  (gen_random_uuid()::text, 'vente:annuler', 'Annuler une vente du jour', 'Pharmacie')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("appRoleId", "permissionId")
SELECT r."id", p."id"
FROM "AppRole" r
JOIN "Structure" s ON s."id" = r."structureId" AND s."type" = 'PHARMACIE'
JOIN "Permission" p ON (
  (r."nom" = 'Pharmacien' AND p."code" IN ('vente:read', 'vente:write'))
  OR (r."nom" = 'Administrateur de structure' AND p."code" IN ('vente:read', 'vente:write', 'vente:annuler'))
)
ON CONFLICT DO NOTHING;
```

   (`Permission.createdAt` a un défaut SQL `CURRENT_TIMESTAMP`, vérifié dans `20260628170000_add_rbac_permissions`.)
5. Appliquer puis régénérer : `docker compose exec -T backend npx prisma migrate deploy` puis `docker compose exec -T backend npx prisma generate`, puis `docker compose restart backend` et attendre que `docker compose logs --tail 50 backend` montre l'application démarrée.

### 3. Permissions

`src/common/rbac/permissions.constants.ts` :
- Dans `PERMISSIONS`, bloc Pharmacie, après `CATALOGUE_MANAGE` : `VENTE_READ: 'vente:read'`, `VENTE_WRITE: 'vente:write'`, `VENTE_ANNULER: 'vente:annuler'`.
- Dans `PERMISSION_CATALOG`, juste après la ligne `CATALOGUE_MANAGE`, les trois entrées avec EXACTEMENT les libellés de la migration (`Consulter les ventes de la pharmacie`, `Enregistrer une vente`, `Annuler une vente du jour`), catégorie `Pharmacie`.
- `DEFAULT_STRUCTURE_ROLES.PHARMACIE` : « Pharmacien » reçoit `VENTE_READ`, `VENTE_WRITE` (ajoutés après `CATALOGUE_WRITE`) ; « Administrateur de structure » reçoit `VENTE_READ`, `VENTE_WRITE`, `VENTE_ANNULER` (ajoutés en tête de sa liste). HOPITAL et CLINIQUE : rien.

`src/common/rbac/permissions-type-structure.ts` (D111) :
- `PERMISSIONS_AUTORISEES_PHARMACIE` : ajouter `VENTE_READ`, `VENTE_WRITE`, `VENTE_ANNULER` juste après `CATALOGUE_MANAGE` (même ordre que le catalogue, pour que le filtre de `ALL_PERMISSION_CODES` reste égal à la liste blanche).
- Exporter `PERMISSIONS_RESERVEES_PHARMACIE: readonly PermissionCode[] = [VENTE_READ, VENTE_WRITE, VENTE_ANNULER]`.
- `filtrerPermissionsSelonTypeStructure` : type PHARMACIE, inchangé (liste blanche) ; tout autre cas (HOPITAL, CLINIQUE, `null`) : retirer les codes de `PERMISSIONS_RESERVEES_PHARMACIE`, le reste inchangé. Mettre à jour le commentaire d'en-tête du fichier en une phrase.

`src/common/rbac/permissions.service.ts` : `CACHE_PREFIX = 'perms:v3:user:'`, commentaire au-dessus : `// v3 : permissions de vente réservées aux pharmacies (B13) ; le changement de préfixe ignore les anciennes entrées au déploiement.` (remplace le commentaire v2).

Mettre à jour `src/common/rbac/permissions-type-structure.spec.ts` en conséquence (listes attendues, clé `perms:v3:user:u1`) et ajouter : (a) HOPITAL dont le rôle contient `vente:read` et `carnet:read` : seul `carnet:read` reste ; (b) PHARMACIE : les trois `vente:*` sont conservés ; (c) `null` : `vente:*` retirés.

### 4. Codes d'erreur et filtre

`src/common/filters/codes-erreur.ts`, à la fin du tableau, avec un commentaire d'une ligne chacun :
- `STOCK_INSUFFISANT` : Stock insuffisant pour au moins une ligne de la vente (409), lignes dans `details`.
- `MEDICAMENT_EXPIRE` : Médicament périmé dans la vente (400), lignes dans `details`.
- `PRIX_MANQUANT` : Médicament sans prix dans la vente (400), lignes dans `details`.
- `ORDONNANCE_NON_CONFIRMEE` : Médicament sur ordonnance vendu sans confirmation de l'ordonnance (400), lignes dans `details`.
- `STOCK_INTROUVABLE` : Ligne de stock absente de cette pharmacie (404), lignes dans `details`.
- `VENTE_DEJA_ANNULEE` : Vente déjà annulée (409).
- `ANNULATION_HORS_DELAI` : Vente d'un autre jour, annulation impossible (409).

`src/common/filters/all-exceptions.filter.ts` (D119) :
- Constante `CODES_AVEC_DETAILS: ReadonlySet<CodeErreur>` = les 5 premiers codes ci-dessus.
- Dans `construireCorps`, branche HttpException, à côté du traitement de `champs` : si `resultat.code` est dans `CODES_AVEC_DETAILS` et `brut.details` est un tableau, `resultat.details = assainirDetails(brut.details)`.
- `assainirDetails(brut: unknown[])` (fonction locale du fichier) : garde au plus 50 éléments ; pour chaque objet, ne recopie que `stockId` (string), `nom` (string), `disponible` (number), `demande` (number) présents avec le bon type ; un élément qui n'est pas un objet est ignoré.
- Ajouter dans `all-exceptions.filter.spec.ts` : (a) un 409 `STOCK_INSUFFISANT` avec `details: [{ stockId: 's1', nom: 'Doliprane', disponible: 0, demande: 2, secret: 'x' }]` ressort avec `details` sans `secret` ; (b) un 400 sans code portant `details` ne recopie pas `details` (hors validation).

### 5. DTO : `src/pharmacie/dto/vente.dto.ts` (nouveau)

```ts
export class LigneVenteDto {
  stockId: string;   // @IsString() @IsNotEmpty()
  quantite: number;  // @IsInt() @Min(1) @Max(10000)
}
export class CreerVenteDto {
  lignes: LigneVenteDto[];          // @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => LigneVenteDto)
  clientNom?: string;               // @IsOptional() @IsString() @MaxLength(100)
  clientTelephone?: string;         // @IsOptional() @IsString() @MaxLength(30)
  ordonnanceVerifiee?: boolean;     // @IsOptional() @IsBoolean()
}
export class AnnulerVenteDto {
  motif: string;                    // @IsString() @Transform(trim) @Length(3, 300)
}
export class ListerVentesQueryDto {
  date?: string;                    // @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  page?: number;                    // @IsOptional() @Type(() => Number) @IsInt() @Min(1)
}
```

Décorateurs Swagger `@ApiProperty` / `@ApiPropertyOptional` avec exemples (`stockId` exemple UUID, `quantite` 2, `clientNom` « Mamadou Bah », `clientTelephone` « +224 621 00 00 00 », `motif` « Erreur de quantité », `date` « 2026-10-22 »). `@Transform` de `class-transformer` : `({ value }) => (typeof value === 'string' ? value.trim() : value)`. Pas d'entrée dans `MESSAGES_REGLES` (D128).

Dans `src/pharmacie/dto/pharmacie.dto.ts` (D122) : `UpsertStockDto.prixUnitaire` passe à `@IsOptional() @IsInt({ message: 'Le prix unitaire doit être un nombre entier de francs guinéens, sans décimales.' }) @Min(0) @Max(2147483647)` ; `UpdateStockQuantiteDto.variation` passe à `@IsInt({ message: 'La variation doit être un nombre entier.' })`. Rien d'autre.

### 6. Service : `src/pharmacie/vente.service.ts` (nouveau, `@Injectable() VenteService`)

Dépendances : `PrismaService`, `NotificationsService`, `StorageService` (`src/storage/storage.service`). `Logger` Nest. Constantes du fichier : `PRIX_MAX = 2147483647`, `VENTES_PAR_PAGE = 50`, `SEUIL_STOCK_BAS = 10`, `OPTIONS_TRANSACTION_VENTE = { maxWait: 5_000, timeout: 15_000 }`. Réutiliser `SOS_IDEMPOTENCE_HEURES`, `lireCleIdempotence`, `estConflitCleIdempotence` depuis `src/carnet-sante/sos-idempotence` (D113, pas de copie).

Fonctions locales du fichier (exportées pour les tests) :
- `jourConakry(d: Date): string` = `d.toISOString().slice(0, 10)` (Conakry = UTC+0).
- `bornesDuJour(jour: string): { debut: Date; fin: Date }` = `[jourT00:00:00.000Z, jour+1 T00:00:00.000Z)`.
- `formaterNumero(annee: number, n: number): string` = `` `V-${annee}-${String(n).padStart(6, '0')}` ``.

#### 6.1 Accès commun `verifierPharmacie(structureId, userId)` (privé)

Lit l'utilisateur (`id`, `nom`, `prenom`, `structureId`) et la structure (`id`, `type`, `adminId`, `nom`, `adresse`, `ville`, `telephone`, `logoFile: { select: { key: true } }`).
- Structure absente : `NotFoundException('Cette pharmacie est introuvable.')`.
- Utilisateur absent, ou ni `user.structureId === structureId` ni `structure.adminId === userId`, ou `structure.type !== 'PHARMACIE'` : `ForbiddenException("Vous n'avez pas accès aux ventes de cette pharmacie.")` (le filtre ajoute PERMISSION_REFUSEE).
- Retourne `{ user, structure }`.

`pharmacieRecu(structure)` (privé) → `{ id, nom, adresse, ville, telephone, logoUrl }` avec `logoUrl = logoFile ? storage.getPublicUrl(logoFile.key) : null` (champs absents = `null`).

#### 6.2 Forme renvoyée (création, rejeu, détail, annulation) : `presenterVente(vente, pharmacie)`

```
{
  id, numero, statut,                       // statut : 'VALIDEE' | 'ANNULEE'
  createdAt,                                // Date (sérialisée en ISO)
  total, ordonnanceVerifiee,
  clientNom, clientTelephone,               // string | null
  vendeur: { id: vendeurId, nom: vendeurNom },
  annuleeLe, annuleeParId, motifAnnulation, // null tant que VALIDEE
  lignes: [{ id, stockId: stockMedicamentId, medicamentId, nomMedicament, prixUnitaire, quantite, sousTotal }],
  pharmacie: { id, nom, adresse, ville, telephone, logoUrl }
}
```

`cleIdempotence` n'est JAMAIS renvoyée. Ordre des lignes : celui que renvoie `include: { lignes: true }`, aucun tri imposé.

#### 6.3 `creerVente(structureId, userId, dto: CreerVenteDto, enTeteIdempotence?: string, ip?: string | null)`

1. `verifierPharmacie`.
2. Doublons : si deux lignes ont le même `stockId` → `BadRequestException({ message: "Un même médicament ne peut apparaître qu'une fois dans la vente. Regroupez les quantités sur une seule ligne.", code: 'VALIDATION', champs: [{ champ: 'lignes', contraintes: ['stockUnique'] }] })`.
3. Idempotence, comme le SOS (D113) : `cle = lireCleIdempotence(enTete)` ; en-tête présent, non vide et mal formé : `logger.warn('vente.cle_idempotence_ignoree format invalide')` et on continue sans clé. Si `cle` : `findUnique({ where: { structureId_cleIdempotence: { structureId, cleIdempotence: cle } }, include: { lignes: true } })` ; trouvée et `createdAt` dans les 24 h → retourner la réponse de rejeu (point 7) ; trouvée et plus ancienne → `update` qui met `cleIdempotence: null` sur l'ancienne, log `vente.cle_idempotence_expiree venteId=<id>`, et on continue.
4. Transaction interactive `this.prisma.$transaction(async (tx) => { ... }, OPTIONS_TRANSACTION_VENTE)`, dans cet ordre exact :
   a. Compteur (verrou de ligne qui sérialise les ventes d'une pharmacie, D120) : `annee = new Date().getUTCFullYear()` ; `const [{ dernierNumero }] = await tx.$queryRaw<{ dernierNumero: number }[]>` sur `INSERT INTO "CompteurVente" ("structureId", "annee", "dernierNumero") VALUES (${structureId}, ${annee}, 1) ON CONFLICT ("structureId", "annee") DO UPDATE SET "dernierNumero" = "CompteurVente"."dernierNumero" + 1 RETURNING "dernierNumero"` (tagged template `Prisma.sql` implicite de `$queryRaw`, paramètres liés, jamais `$queryRawUnsafe`).
   b. Lecture des stocks : `tx.stockMedicament.findMany({ where: { id: { in: ids }, structureId }, include: { medicament: { select: { id: true, nom: true, ordonnanceRequise: true } } } })`.
   c. Refus, dans cet ordre, un seul code par réponse, toutes les lignes concernées dans `details` (D114) :
      - Lignes dont le stock n'est pas trouvé : `NotFoundException({ message, code: 'STOCK_INTROUVABLE', details: [{ stockId }] })`, message : 1 ligne « Un médicament du panier n'est plus dans le stock de la pharmacie. Retirez-le du panier puis validez de nouveau. » ; plusieurs « Certains médicaments du panier ne sont plus dans le stock de la pharmacie. Retirez-les du panier puis validez de nouveau. »
      - Périmés (D117) : `dateExpiration !== null && jourConakry(dateExpiration) < jourConakry(maintenant)` → `BadRequestException({ message, code: 'MEDICAMENT_EXPIRE', details: [{ stockId, nom }] })`, message : 1 « Vente impossible : « <nom> » est périmé. Retirez-le du panier. » ; plusieurs « Vente impossible : <n> médicaments du panier sont périmés. Retirez-les du panier. »
      - Sans prix (D116) : `prixUnitaire === null || prixUnitaire <= 0` → `BadRequestException({ message, code: 'PRIX_MANQUANT', details: [{ stockId, nom }] })`, message : 1 « Vente impossible : « <nom> » n'a pas de prix. Ajoutez son prix dans le stock puis validez de nouveau. » ; plusieurs « Vente impossible : <n> médicaments du panier n'ont pas de prix. Ajoutez leur prix dans le stock puis validez de nouveau. »
      - Ordonnance : au moins une ligne avec `medicament.ordonnanceRequise` et `dto.ordonnanceVerifiee !== true` → `BadRequestException({ message: "Ce panier contient un médicament vendu sur ordonnance. Cochez « J'ai vu l'ordonnance » pour valider la vente.", code: 'ORDONNANCE_NON_CONFIRMEE', details: [{ stockId, nom }] })` (toutes les lignes sur ordonnance).
   d. Montants : `sousTotal = prixUnitaire * quantite`, `total = somme`. Si `total > PRIX_MAX` : `BadRequestException({ message: 'Le montant total de la vente est trop élevé. Divisez-la en plusieurs ventes.', code: 'VALIDATION', champs: [{ champ: 'lignes', contraintes: ['totalMaximal'] }] })` (D121).
   e. Création : `tx.vente.create({ data: { structureId, numero: formaterNumero(annee, dernierNumero), vendeurId: user.id, vendeurNom: `${user.prenom} ${user.nom}`.trim(), clientNom: dto.clientNom?.trim() || null, clientTelephone: dto.clientTelephone?.trim() || null, ordonnanceVerifiee: dto.ordonnanceVerifiee === true, total, cleIdempotence: cle, lignes: { create: [...] } }, include: { lignes: true } })`. Lignes dans l'ordre du corps : `medicamentId`, `stockMedicamentId`, `nomMedicament: medicament.nom`, `prixUnitaire`, `quantite`, `sousTotal`. Créer la vente AVANT les décréments : un rejeu simultané de la même clé échoue ici (P2002) avant de toucher au stock.
   f. Décréments atomiques, lignes triées par `stockId` croissant (ordre de verrouillage stable, pas d'interblocage) : `tx.stockMedicament.updateMany({ where: { id: stockId, structureId, quantite: { gte: quantite } }, data: { quantite: { decrement: quantite } } })` ; `count === 0` → ligne insuffisante. Après TOUTES les lignes, s'il y en a : relire leurs quantités (`tx.stockMedicament.findMany`) et lever `ConflictException({ message, code: 'STOCK_INSUFFISANT', details: [{ stockId, nom, disponible, demande }] })` ; message : 1 « Le stock ne suffit plus pour « <nom> » : il en reste <disponible>. Ajustez la quantité puis validez de nouveau. » ; plusieurs « Le stock ne suffit plus pour <n> médicaments du panier. Ajustez les quantités puis validez de nouveau. » L'exception annule toute la transaction (compteur, vente, autres décréments).
   g. `tx.stockMedicament.updateMany({ where: { id: { in: ids }, structureId, quantite: 0 }, data: { disponible: false } })`.
   h. Quantités après : `tx.stockMedicament.findMany({ where: { id: { in: ids } }, select: { id: true, quantite: true } })` ; `avant = apres + quantite vendue`.
   i. Audit (D127) : `tx.auditLog.create({ data: { userId, action: 'create', entityType: 'Vente', entityId: vente.id, ip: ip ?? null, metadata: { numero, total, nombreLignes } } })`.
   j. Retourner `{ vente, passages }` où `passages` = lignes avec `avant >= SEUIL_STOCK_BAS && apres < SEUIL_STOCK_BAS` (`nom`, `apres`).
5. Hors transaction : si l'erreur est un conflit de clé (`cle && estConflitCleIdempotence(erreur)`) → relire la vente par `(structureId, cle)` avec `include: { lignes: true }`, log `vente.rejeu_concurrent venteId=<id>`, retourner la réponse de rejeu ; sinon relancer l'erreur.
6. Après validation : alerte de stock bas (D126), dans un `try/catch` qui journalise `vente.alerte_stock_echec venteId=<id>` et n'échoue jamais : si `passages` non vide, staff = même requête que `updateStockQuantite`, puis UNE notification par médicament : `{ type: 'STOCK_ALERTE', titre: 'Stock critique', message }`, message `Le stock de "<nom>" est épuisé.` si `apres === 0`, sinon `Le stock de "<nom>" est descendu à <apres> unités.` Log `vente.creee venteId=<id> numero=<numero>` (jamais de nom ni téléphone de client dans les journaux).
7. Réponses (statut 201 dans les deux cas, D113) :
   - création : `{ data: presenterVente(...), message: `Vente enregistrée (${numero}).`, success: true }` ;
   - rejeu : `{ data: { ...presenterVente(...), rejeu: true }, message: 'Cette vente était déjà enregistrée.', success: true }` (log `vente.rejeu venteId=<id>`). Le corps du rejeu est ignoré.

#### 6.4 `listerVentes(structureId, userId, query: ListerVentesQueryDto)`

`verifierPharmacie`. `jour = query.date ?? jourConakry(new Date())` ; si `query.date` n'est pas une vraie date (ex. `2026-02-31` : `new Date(jour + 'T00:00:00.000Z')` invalide OU `jourConakry` de cette date différent de `jour`) → `BadRequestException({ message: 'La date doit être une date valide au format AAAA-MM-JJ.', code: 'VALIDATION', champs: [{ champ: 'date', contraintes: ['dateValide'] }] })`. `page = query.page ?? 1`. Filtre `{ structureId, createdAt: { gte: debut, lt: fin } }`. En parallèle : `count` (→ `nombre`, toutes les ventes du jour, D125), `aggregate({ _sum: { total: true }, where: { ...filtre, statut: 'VALIDEE' } })` (→ `totalJour`, 0 si null), `findMany` (`orderBy: { createdAt: 'desc' }`, `skip`, `take: VENTES_PAR_PAGE`, `include: { lignes: { select: { quantite: true } } }`).

Réponse : `{ data: { date: jour, totalJour, nombre, page, parPage: 50, totalPages: Math.max(1, Math.ceil(nombre / 50)), ventes: [{ id, numero, createdAt, statut, total, nombreArticles (somme des quantités), vendeur: { id, nom }, clientNom }] }, message: `${nombre} vente(s) le ${jour}.`, success: true }`.

#### 6.5 `detailVente(structureId, venteId, userId)`

`verifierPharmacie` ; `findFirst({ where: { id: venteId, structureId }, include: { lignes: true } })` ; absente → `NotFoundException('Cette vente est introuvable.')`. Réponse `{ data: presenterVente(...), message: 'Vente trouvée.', success: true }`.

#### 6.6 `annulerVente(structureId, venteId, userId, dto: AnnulerVenteDto, ip?: string | null)`

`verifierPharmacie` ; transaction interactive (mêmes options) :
1. `findFirst({ where: { id: venteId, structureId }, include: { lignes: true } })` ; absente → 404 « Cette vente est introuvable. »
2. `statut === 'ANNULEE'` → `ConflictException({ message: 'Cette vente a déjà été annulée.', code: 'VENTE_DEJA_ANNULEE' })` (testé AVANT le délai, D124).
3. `jourConakry(createdAt) !== jourConakry(maintenant)` → `ConflictException({ message: "Une vente ne peut être annulée que le jour même. Celle-ci date d'un autre jour.", code: 'ANNULATION_HORS_DELAI' })`.
4. Passage conditionnel : `tx.vente.updateMany({ where: { id, structureId, statut: 'VALIDEE' }, data: { statut: 'ANNULEE', annuleeLe: maintenant, annuleeParId: userId, motifAnnulation: dto.motif } })` ; `count === 0` (annulation simultanée) → même 409 `VENTE_DEJA_ANNULEE`.
5. Remise en stock, lignes triées par `stockMedicamentId` : `tx.stockMedicament.updateMany({ where: { id: stockMedicamentId, structureId }, data: { quantite: { increment: quantite }, disponible: true } })` ; `count === 0` (ligne de stock supprimée depuis) → compter dans `lignesNonRemises`.
6. Audit : `tx.auditLog.create({ data: { userId, action: 'annuler', entityType: 'Vente', entityId: id, ip: ip ?? null, metadata: { numero, total, lignesNonRemises } } })` (jamais le motif ni le client).
7. Relire la vente avec ses lignes. Réponse `{ data: presenterVente(...), message, success: true }`, message `Vente ${numero} annulée. Les quantités ont été remises en stock.` si `lignesNonRemises === 0`, sinon `Vente ${numero} annulée. ${lignesNonRemises} médicament(s) n'étai(en)t plus dans le stock et n'y ont pas été remis.` ; log `vente.annulee venteId=<id>`.

### 7. Contrôleur : `src/pharmacie/vente.controller.ts` (nouveau)

`@ApiTags('Pharmacie : ventes')`, `@Controller('pharmacie')`, `@UseGuards(AuthGuard, PermissionsGuard)` et `@ApiBearerAuth()` sur la classe. Routes (paramètres `structureId`, `venteId` par `@Param`, utilisateur par `@Req() req: RequestWithUser`, IP par `@Ip() ip: string`) :

| Méthode et chemin | Permission | Code HTTP | Service |
|---|---|---|---|
| `POST :structureId/ventes` | `PERMISSIONS.VENTE_WRITE` | 201 (`@HttpCode(HttpStatus.CREATED)`) | `creerVente(structureId, req.user.userId, dto, enTete, ip)`, `@Headers('idempotency-key') enTete?: string` |
| `GET :structureId/ventes` | `PERMISSIONS.VENTE_READ` | 200 | `listerVentes(structureId, req.user.userId, query)` avec `@Query() query: ListerVentesQueryDto` |
| `GET :structureId/ventes/:venteId` | `PERMISSIONS.VENTE_READ` | 200 | `detailVente(...)` |
| `POST :structureId/ventes/:venteId/annuler` | `PERMISSIONS.VENTE_ANNULER` | 200 (`@HttpCode(HttpStatus.OK)`) | `annulerVente(structureId, venteId, req.user.userId, dto, ip)` |

Swagger : `@ApiOperation` (résumé et description courte), `@ApiHeader` `Idempotency-Key` sur la création (même texte que le SOS, adapté : « Clé unique par panier (8 à 128 caractères parmi lettres, chiffres, . _ : -), par exemple un UUID. Un renvoi avec la même clé dans les 24 h renvoie la même vente sans second retrait du stock. Clé mal formée : ignorée. »), `@ApiResponse` pour 400, 404, 409 avec les codes. Aucun `any`.

`src/pharmacie/pharmacie.module.ts` : ajouter `VenteController` aux `controllers` (APRÈS `PharmacieController`) et `VenteService` aux `providers`. Rien d'autre.

### 8. Correctifs du stock : `src/pharmacie/pharmacie.service.ts`

`updateStockQuantite` (D123), en gardant signature, réponse, textes et alerte actuels :
- après `checkPharmacieAccess`, une transaction interactive : `tx.$queryRaw<{ quantite: number; notes: string | null }[]>` sur `SELECT "quantite", "notes" FROM "StockMedicament" WHERE "id" = ${stockId} AND "structureId" = ${structureId} FOR UPDATE` ; aucune ligne → `NotFoundException('Stock non trouvé')` ; `newQuantite = Math.max(0, ancienne + dto.variation)` ; `tx.stockMedicament.update` (mêmes `data` et `include` qu'aujourd'hui, `notes: dto.notes?.trim() || notes`) ; la transaction renvoie `{ ancienne, updated, newQuantite }`.
- l'alerte (hors transaction) garde sa condition `newQuantite < 10 && ancienne >= 10` et son texte.

Import Excel (D122), dans `analyserImportStock` : après le contrôle actuel du prix, si le prix est valide, l'arrondir (`Math.round`) ; s'il dépasse 2147483647 après arrondi, raison de rejet « Le prix unitaire est trop grand. Vérifiez le montant (exemple : 35000). » ; la ligne acceptée porte le prix arrondi (aperçu et import). Ne rien changer d'autre dans ce fichier.

### 9. Tests Jest

Nouveau `src/pharmacie/vente.service.spec.ts`, Prisma simulé par un faux EN MÉMOIRE (pas de `jest.fn` qui renvoie des valeurs figées pour le stock) : un tableau de stocks, un tableau de ventes, un compteur ; `$transaction(cb)` prend un instantané profond de l'état, exécute `cb(tx)` et RESTAURE l'instantané si `cb` lève (simulation du rollback) ; `stockMedicament.updateMany` évalue réellement `quantite.gte`, `decrement`, `increment` sur l'état ; `$queryRaw` du compteur incrémente le compteur ; `vente.create` lève une `Prisma.PrismaClientKnownRequestError` P2002 dont le message contient `cleIdempotence` si la clé existe déjà pour la pharmacie. Le faux ne sérialise PAS les transactions : il doit laisser les `await` s'entrelacer pour que le test de concurrence soit réel. `NotificationsService` et `StorageService` simulés (`getPublicUrl` → `https://cdn.test/<key>`). Cas obligatoires, numérotés dans les titres :
1. vente nominale : 201, numéro `V-<annee>-000001`, total et sous-totaux corrects, stock décrémenté, `pharmacie` avec `logoUrl`, audit `create` écrit, `cleIdempotence` absente de la réponse ;
2. deux ventes simultanées (`Promise.all`, clés différentes) de la dernière boîte (quantité 1) : exactement une réussit, l'autre rejette en 409 `STOCK_INSUFFISANT` avec `details[0]` = `{ stockId, nom, disponible: 0, demande: 1 }`, stock final 0 et `disponible` false, une seule vente enregistrée ;
3. rejeu de la même clé : même `id`, `rejeu: true`, stock décrémenté une seule fois, une seule vente ;
4. rejeu concurrent de la même clé (`Promise.all`) : une seule vente, les deux réponses ont le même `id`, stock décrémenté une fois ;
5. clé de plus de 24 h : nouvelle vente, ancienne vente sans clé ;
6. chaque refus : `STOCK_INTROUVABLE` (404), `MEDICAMENT_EXPIRE` (date d'hier refusée, date du jour acceptée), `PRIX_MANQUANT` (null et 0), `ORDONNANCE_NON_CONFIRMEE` (puis acceptée avec `ordonnanceVerifiee: true`), doublon de `stockId` (400 VALIDATION champ `lignes`), total au-delà de 2147483647 (400 VALIDATION) ; dans chaque cas, stock, compteur et ventes inchangés ;
7. stock insuffisant sur une ligne parmi deux : 409, AUCUNE des deux lignes décrémentée ;
8. numérotation : deux ventes successives → `000001` puis `000002` ; un refus entre les deux ne consomme pas de numéro ;
9. alerte de stock bas : passage de 12 à 8 → une notification « est descendu à 8 unités » ; passage à 0 → « est épuisé » ; échec de `createManyNotifications` → la vente réussit quand même ;
10. annulation : statut ANNULEE, `annuleeLe`, `annuleeParId`, motif enregistré, stock remis, `disponible` true, audit `annuler` sans motif ;
11. annulation déjà faite → 409 `VENTE_DEJA_ANNULEE` (même si la vente date d'hier) ; vente d'hier → 409 `ANNULATION_HORS_DELAI` ; ligne de stock supprimée → annulation réussie, `lignesNonRemises` = 1 dans l'audit et message adapté ;
12. accès : utilisateur d'une autre pharmacie → 403 ; structure de type HOPITAL → 403 ; vente d'une autre pharmacie en détail → 404 ;
13. liste : `totalJour` ne compte que les VALIDEE, `nombre` compte tout, `nombreArticles`, date invalide `2026-02-31` → 400 VALIDATION champ `date`.

Nouveau `src/pharmacie/vente.http.spec.ts` (modèle `pharmacie-import-mode.http.spec.ts`, supertest, même ValidationPipe, `AllExceptionsFilter`) avec le VRAI `PermissionsGuard` et le VRAI `PermissionsService` (Redis simulé : `get` → null, `set` → 'OK' ; Prisma simulé : `user.findUnique` renvoie un rôle et un type de structure selon le cas) et `VenteService` simulé :
1. membre d'un HOPITAL dont le rôle contient `vente:read`, `vente:write`, `vente:annuler` : `GET /pharmacie/s1/ventes` et `POST /pharmacie/s1/ventes` → 403, `code: 'PERMISSION_REFUSEE'`, service jamais appelé ;
2. pharmacien (PHARMACIE, `vente:read` et `vente:write`) : `POST .../ventes/v1/annuler` → 403 ; `POST .../ventes` → 201 et l'en-tête `Idempotency-Key` est transmis au service ;
3. corps invalides → 400 `VALIDATION` : `lignes` vide, `quantite` 0, `quantite` 1.5, champ inconnu, `motif` de 2 caractères, `date=22-10-2026` ;
4. le service lève un 409 `STOCK_INSUFFISANT` avec `details` : la réponse HTTP porte `details` filtré.

Tests du correctif : dans un nouveau `src/pharmacie/pharmacie.stock-quantite.spec.ts` : la quantité vient de la ligne verrouillée (`$queryRaw`), plancher 0, 404 si aucune ligne, alerte seulement au franchissement du seuil. Et dans `pharmacie.import.spec.ts` : un prix `1500.6` est accepté et arrondi à `1501`.

Adapter les specs existantes que ces changements cassent (listes de permissions, clé de cache), sans affaiblir leurs assertions.

### 10. Appel réel de bout en bout (obligatoire)

Contre le back local (`http://localhost:3001`, ou le port publié par `docker compose port backend 3001`), avec `curl`. Jamais de jeton, de cookie ni de clé dans le Return : seulement statut HTTP et champs utiles.
1. `GET /auth/demo/comptes` ; `POST /auth/demo/connexion` `{ "userId": <id d'Ousmane Keita> }` → jeton d'accès (lire le nom du champ dans la réponse). Mode démo inactif (404) : Return BLOCKED, ne pas modifier `.env`.
2. `GET /auth/me` : `data.permissions` contient `vente:read` et `vente:write`, pas `vente:annuler`. `GET /pharmacie/stock/<structureId>` : choisir un médicament avec prix, non périmé, quantité 2 ou plus ; noter sa quantité initiale.
3. `POST /pharmacie/<structureId>/ventes` avec `Idempotency-Key: <uuid>` et 1 ligne de quantité 1 → 201, numéro, total, `pharmacie`. Rejouer la même requête → 201, même `id`, `rejeu: true` ; le stock n'a baissé que de 1.
4. Concurrence réelle : ramener un médicament à 1 par `PATCH /pharmacie/stock/<structureId>/<stockId>/quantite`, lancer deux `POST` simultanés (clés différentes, `&` puis `wait`) de quantité 1 → un 201 et un 409 `STOCK_INSUFFISANT` avec `details`.
5. Un refus : `ORDONNANCE_NON_CONFIRMEE` (médicament à ordonnance, sinon `PRIX_MANQUANT` ou `MEDICAMENT_EXPIRE` selon le stock démo), statut et `code`.
6. `GET /pharmacie/<structureId>/ventes` → `totalJour`, `nombre` ; `GET .../ventes/<id>` → même forme que la création.
7. Avec le pharmacien : `POST .../ventes/<id>/annuler` → 403. Connexion de Djénabou Baldé (admin de la pharmacie) : annulation `{ "motif": "Erreur de quantité" }` → 200, stock remis ; seconde annulation → 409 `VENTE_DEJA_ANNULEE`.
8. Connexion d'un médecin démo d'hôpital : `GET /pharmacie/<structureId>/ventes` → 403 `PERMISSION_REFUSEE`.
9. Remettre les quantités modifiées à leur valeur initiale (PATCH). Les ventes créées restent (pas de suppression).

### 11. Documentation : `back_medconnect/CLAUDE.md`

Dans « Conventions importantes (pièges) », après la puce « SOS : qualité de la position et idempotence (TB10b) », ajouter une puce **Ventes en pharmacie (B13, lot 7)** qui décrit le contrat EXACT, sans rien omettre : les 4 routes, permissions et codes HTTP ; l'en-tête `Idempotency-Key` et le rejeu (`rejeu: true`, 201) ; le corps de création (`lignes[].stockId`, `lignes[].quantite` 1 à 10000, 1 à 50 lignes, `clientNom` 100, `clientTelephone` 30, `ordonnanceVerifiee`) ; la forme de réponse complète de la section 6.2 avec les valeurs de `statut` (`VALIDEE`, `ANNULEE`) ; la réponse de liste (section 6.4) ; le corps d'annulation (`motif` 3 à 300) ; chaque code d'erreur avec son statut et la forme de `details` (`stockId`, `nom`, `disponible`, `demande`) ; l'ordre des refus ; les règles (prix du stock, prix 0 = manquant, périmé = avant le jour à Conakry UTC+0, quantité seule, annulation le jour même par `vente:annuler`, remise en stock) ; numérotation `V-AAAA-NNNNNN` ; prix du stock désormais entier (`@IsInt`, import arrondi) ; permissions `vente:*` réservées aux pharmacies, cache `perms:v3`. Mettre aussi à jour la puce « Permissions selon le type de structure (B10) » : liste blanche avec les trois `vente:*`, retrait de `vente:*` hors pharmacie, cache `perms:v3:user:<id>`. Pas de tiret cadratin ni demi-cadratin.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Précisions : commentaires et journaux en français ; aucun `any` ni `eslint-disable` dans les nouveaux fichiers ; aucune donnée de client (nom, téléphone) ni motif dans les journaux ; ne pas toucher à `roles.service.ts`, au catalogue de médicaments, à `upsertStock` (hors DTO) ni aux routes existantes ; ne pas exécuter `prisma migrate dev`, `db push` ni `migrate reset`.

## Done when

Toutes les commandes depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :
1. `docker compose exec -T backend npx prisma migrate status` : base à jour, migration `20261022120000_ventes_pharmacie` appliquée ; `docker compose exec -T backend npx prisma validate` : sortie 0.
2. `docker compose exec -T backend npx tsc --noEmit` : sortie 0.
3. `docker compose exec -T backend npx eslint` sur les SEULS fichiers touchés par la tâche : `src/pharmacie/vente.service.ts src/pharmacie/vente.controller.ts src/pharmacie/dto/vente.dto.ts src/pharmacie/vente.service.spec.ts src/pharmacie/vente.http.spec.ts src/pharmacie/pharmacie.stock-quantite.spec.ts src/pharmacie/pharmacie.module.ts src/pharmacie/pharmacie.service.ts src/pharmacie/dto/pharmacie.dto.ts src/pharmacie/pharmacie.import.spec.ts src/common/rbac/permissions.constants.ts src/common/rbac/permissions-type-structure.ts src/common/rbac/permissions-type-structure.spec.ts src/common/rbac/permissions.service.ts src/common/filters/codes-erreur.ts src/common/filters/all-exceptions.filter.ts src/common/filters/all-exceptions.filter.spec.ts` : 0 erreur (avertissements préexistants tolérés s'ils sont hors des lignes ajoutées ; la dette des autres fichiers ne compte pas).
4. `docker compose exec -T backend npx jest` : 0 échec, et les 13 cas de `vente.service.spec.ts` et les 4 cas de `vente.http.spec.ts` présents et verts.
5. `git -C back_medconnect diff -U0 | grep -nP '^\+.*[\x{2013}\x{2014}]'` et la même recherche sur les nouveaux fichiers : aucune ligne.
6. Appel réel de la section 10 fait, les 9 étapes consignées dans le Return (une ligne chacune : requête, statut, champs clés), sans jeton.
7. `back_medconnect/CLAUDE.md` contient la puce « Ventes en pharmacie (B13, lot 7) » avec tous les éléments de la section 11.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

Liste exacte des fichiers créés ou modifiés (pour le staging ciblé), sortie en une ligne de chaque commande du Done when, les 9 lignes de l'appel réel, et tout écart à la fiche avec sa raison.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
docker compose exec -T backend npx tsc --noEmit | sortie 0 | commit B13 (feat(pharmacie))
docker compose exec -T backend npx eslint <17 fichiers de la tâche> | sortie 0, aucun avertissement | commit B13
docker compose exec -T backend npx jest | 59 suites, 689 passés, 3 ignorés, 0 échec | commit B13
appel réel (chef d'équipe, port 3101) | création 201, rejeu 201 même id, concurrence 201 + 409 STOCK_INSUFFISANT, ordonnance 400, annulation pharmacien 403, admin 200 puis 409, médecin 403 | commit B13
