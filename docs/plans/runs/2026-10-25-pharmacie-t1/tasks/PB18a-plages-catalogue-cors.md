# PB18a - Synchro desktop (1/4) : origines desktop du CORS, plages de tickets, photographie du catalogue

Tier: dur (codeur Sonnet selon l'arbitrage A2 ; fiche très détaillée, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages d'erreur lus par les vendeurs et le titulaire, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Première des quatre sous-fiches de PB18 (D630). Autonome, gate verte, commitée seule. Elle prépare ce dont le poste desktop a besoin AVANT de rejouer quoi que ce soit :

- l'origine du serveur local du desktop (`http://127.0.0.1:47613`, D440) acceptée par le CORS de l'API et de socket.io, par une variable `DESKTOP_ORIGINS` optionnelle validée au démarrage (D635) ;
- la réservation de plages de numéros de tickets par poste desktop : `POST /pharmacie/:structureId/postes/:posteId/plages` (D632) ;
- la photographie complète du catalogue avec ETag et compression : `GET /pharmacie/:structureId/synchro/catalogue?posteId=` (D633, D634), sans aucun coût (CA22 étendu) ;
- les deux routes dans l'inventaire CA22.

Réalité du terrain : le poste peut rester hors ligne des heures, la connexion est lente et payée au mégaoctet. D'où l'ETag (aucun octet si rien n'a changé), la compression brotli ou gzip, et une réponse de plage qui liste toujours les plages en cours (une réponse perdue ne fait perdre aucun numéro au poste).

**Aucune migration, aucun changement de `prisma/schema.prisma`.** Aucune nouvelle dépendance npm (`node:zlib`, `node:crypto`).

Décisions applicables : D423, D424, D427, D437, D440, D473, D482, D483, D554, D610, D630 à D635, D645.

### Contexte vérifié (ne pas re-découvrir)

- `src/main.ts` lignes 57 à 61 : `app.enableCors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true })`.
- `src/chat/chat.gateway.ts` lignes 26 à 32 : `@WebSocketGateway({ cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true } })` (évalué au chargement du module, avant la validation de configuration).
- `src/config/env.validation.ts` : tableau `RULES` (`{ key, required, validate?, default? }`), règles optionnelles `SWAGGER_ENABLED`, `DEMO_MODE`... ; `validateEnv` n'affiche jamais une valeur. Spec existant : `src/config/env.validation.spec.ts`.
- Modèles (M2) : `Poste { id, pointDeVenteId, code, libelle, type (WEB | DESKTOP | TECHNIQUE), appareilId, actif, derniereSequenceAppliquee, dernierContactLe, dernierEtat }`, `PlageTicket { id, posteId, pointDeVenteId, debut, fin (inclus), attribueeLe, attribueeParId }` (CHECK `fin >= debut`, aucun trigger), `CompteurTicket { pointDeVenteId (clé), prochainNumero }`, `ParametresPharmacie.taillePlageTickets` (défaut 1000). `Vente` a `@@unique([pointDeVenteId, numeroTicket])`. `EvenementSynchro { posteId, sequence, statut ... }` (immuable hors sortie de EN_ATTENTE).
- La vente web prend son numéro par `INSERT INTO "CompteurTicket" ... ON CONFLICT ("pointDeVenteId") DO UPDATE SET "prochainNumero" = "CompteurTicket"."prochainNumero" + 1 RETURNING "prochainNumero" - 1` (`vente.service.ts`, étape 9).
- `src/pharmacie/points-de-vente.service.ts` : `assurerPoste`, `PointsDeVenteService(prisma, accesPharmacie)`, `versParametresReponse` (fonction locale, non exportée), `referentiels` (modes actifs triés `ordre` puis `code`, champs `code, libelle, comptagePhysique, referenceAutorisee, ordre` ; coupures actives triées `ordre` puis `valeurFaciale` décroissante, champs `devise, valeurFaciale, type, ordre`). Contrôleur `PointsDeVenteController` (`@Controller('pharmacie')`, `AuthGuard` + `PermissionsGuard`). DTO dans `src/pharmacie/dto/points-de-vente.dto.ts`.
- Messages existants : `MESSAGE_POSTE_INCONNU` et `MESSAGE_IDENTIFIANT_DEJA_UTILISE` (`src/pharmacie/caisse/sessions-caisse.service.ts`) ; `estDoublonSur(erreur, 'Table')` (`src/pharmacie/stock/erreurs-base.ts`).
- `AccesPharmacieService.verifier(structureId, userId)` renvoie `{ user, structure }` avec `structure { id, type, adminId, isActive, nom, adresse, ville, telephone, logoFile { key } | null }` ; logo public = `storage.getPublicUrl(logoFile.key)` (voir `VenteService.pharmacieRecu`).
- `dateVersJour(date)` (`src/pharmacie/stock/lecture-stock.ts`) donne `AAAA-MM-JJ` ; `jourConakry(new Date())` (`src/pharmacie/jour-metier.ts`).
- Codes d'erreur : catalogue `src/common/filters/codes-erreur.ts` (`CODES_ERREUR`, une ligne de commentaire par code).
- CA22 : `test/etancheite-couts/routes-pharmacie.ts` (`ROUTES_PHARMACIE`) et `test/db/etancheite-couts.db-spec.ts` (`APPELS`, `retenir`, `c.en(methode, chemin)`, application de test construite avec les vrais contrôleurs et fournisseurs de `PharmacieModule` ; `StorageService` simulé par `{ getPublicUrl }`). Tout nouveau fournisseur de `PharmacieModule` y est instancié automatiquement : ses dépendances doivent être parmi `PrismaService`, `AccesPharmacieService`, `StorageService`, `PermissionsService` et les services du module.
- Modèle de test en base : `test/db/journee-cloturee.db-spec.ts` (`refus`, `jour(n)`, construction des services à la main, permissions simulées).

### 1. `src/config/origines-cors.ts` (nouveau)

```ts
/** Taille maximale d'un corps JSON (D636, branchée par PB18b). */
export const LIMITE_CORPS_JSON = '2mb';
export const MAX_ORIGINES_DESKTOP = 10;
const MOTIF_ORIGINE_DESKTOP = /^http:\/\/(127\.0\.0\.1|localhost):(\d{4,5})$/;

export function analyserOriginesDesktop(valeur: string | undefined): { origines: string[]; erreur: string | null }
export function validerOriginesDesktop(valeur: string): string | null   // = analyserOriginesDesktop(valeur).erreur
export function originesCors(env: Record<string, string | undefined>): string[]
```

`analyserOriginesDesktop` :
- `undefined` ou vide après `trim()` : `{ origines: [], erreur: null }` ;
- découpage sur `,`, `trim()` de chaque élément, éléments vides ignorés ;
- plus de 10 éléments : `erreur` = `doit contenir 10 origines au plus (actuellement N)` ;
- chaque élément doit correspondre au motif et avoir un port de 1024 à 65535, sinon `erreur` = `l'origine n°K est invalide : attendu http://127.0.0.1:<port> ou http://localhost:<port> (port 1024 à 65535)` (K à partir de 1 ; la première erreur rencontrée ; jamais la valeur elle-même dans le message) ;
- `origines` = éléments valides, sans doublon, dans l'ordre reçu (même si une erreur est signalée : la passerelle socket.io est évaluée avant la validation et ne doit jamais lever).

`originesCors(env)` = `[env.FRONTEND_URL || 'http://localhost:3000', ...analyserOriginesDesktop(env.DESKTOP_ORIGINS).origines]` sans doublon.

### 2. Branchements

- `src/config/env.validation.ts` : règle ajoutée juste après `SWAGGER_ENABLED`, avec un commentaire d'une ligne : `{ key: 'DESKTOP_ORIGINS', required: false, validate: validerOriginesDesktop }` (import depuis `./origines-cors`).
- `src/main.ts` : `app.enableCors({ origin: originesCors(process.env), credentials: true, exposedHeaders: ['ETag'] });` (commentaire : origine du front web et origines du serveur local du desktop, D635). Ne pas toucher au reste (la limite de corps vient en PB18b).
- `src/chat/chat.gateway.ts` : `origin: originesCors(process.env)` ; commentaire de la ligne 26 mis à jour (« origines du front et du poste desktop, comme l'API HTTP »). Aucune autre ligne.
- `../.env.example` (racine du monorepo) : sous `FRONTEND_URL`, ajouter `# Origines du serveur local de l'application Caisse pour Windows (liste séparée par des virgules, boucle locale seulement)` puis `DESKTOP_ORIGINS=http://127.0.0.1:47613,http://127.0.0.1:47614,http://127.0.0.1:47615`.
- `../compose.yml` (racine) : dans l'`environment` du service `backend`, sous `FRONTEND_URL`, `DESKTOP_ORIGINS: ${DESKTOP_ORIGINS:-}`.
  Ces deux fichiers appartiennent au dépôt racine : le chef les commite à part dans ce dépôt (le commit du back ne les contient pas).
- `CLAUDE.md` du back, section « Variables d'environnement » : après `SWAGGER_ENABLED (...)`, ajouter « `DESKTOP_ORIGINS` (optionnelle, origines du serveur local du desktop séparées par des virgules, chacune `http://127.0.0.1:<port>` ou `http://localhost:<port>`, 10 au plus, refusée au démarrage sinon ; absente : aucune origine desktop ; lue par le CORS HTTP et socket.io) ».

### 3. Plages : `src/pharmacie/synchro/plages.ts` (nouveau)

```ts
export interface PlageLue { id: string; debut: number; fin: number }
/** Plages non épuisées d'un poste (D632), par début croissant. */
export async function lirePlagesNonEpuisees(client: Pick<Prisma.TransactionClient, '$queryRaw'>, posteId: string): Promise<PlageLue[]>
```

SQL (un seul `$queryRaw`) :

```sql
SELECT p."id", p."debut", p."fin" FROM "PlageTicket" p
WHERE p."posteId" = ${posteId}
  AND NOT EXISTS (SELECT 1 FROM "Vente" v WHERE v."pointDeVenteId" = p."pointDeVenteId" AND v."posteId" = p."posteId" AND v."numeroTicket" = p."fin")
  AND NOT EXISTS (SELECT 1 FROM "PlageTicket" q JOIN "Vente" v2 ON v2."pointDeVenteId" = q."pointDeVenteId" AND v2."posteId" = q."posteId" AND v2."numeroTicket" BETWEEN q."debut" AND q."fin"
                  WHERE q."posteId" = p."posteId" AND q."debut" > p."fin")
ORDER BY p."debut" ASC, p."id" ASC
```

### 4. Plages : DTO, service, route

- `src/pharmacie/dto/points-de-vente.dto.ts` : `export class AttribuerPlageDto { @ApiProperty({ description: 'UUID généré par le poste (rejeu sans doublon)' }) @IsUUID('all') id: string; }`.
- `src/pharmacie/points-de-vente.service.ts` :
  - exporter `versParametresReponse` (mot `export` seulement) ;
  - constantes exportées : `MESSAGE_PLAGES_SUFFISANTES = "Ce poste a déjà deux séries de numéros de tickets en réserve : utilisez-les avant d'en demander une autre."`, `MESSAGE_PLAGE_POSTE_WEB = "Les numéros de tickets réservés servent seulement à l'application MedConnecte Caisse pour Windows."`, `TAILLE_PLAGE_DEFAUT = 1000` ;
  - `async attribuerPlage(structureId, userId, posteId, dto: AttribuerPlageDto, ip?: string): Promise<Reponse<{ id; debut; fin; taille; cree: boolean; plages: PlageLue[] }>>` :
    1. `const { user, structure } = await this.accesPharmacie.verifier(structureId, userId);`
    2. transaction `{ maxWait: 5_000, timeout: 15_000 }` :
       1. `SELECT p."id", p."pointDeVenteId", p."code", p."type"::text AS "type", p."actif" FROM "Poste" p JOIN "PointDeVente" pv ON pv."id" = p."pointDeVenteId" WHERE p."id" = ${posteId} AND pv."structureId" = ${structure.id} FOR UPDATE OF p` ; absent, `TECHNIQUE` ou inactif : 409 `POSTE_INCONNU` (`MESSAGE_POSTE_INCONNU`) ; `WEB` : 409 `POSTE_INCONNU` (`MESSAGE_PLAGE_POSTE_WEB`) ;
       2. `tx.plageTicket.findUnique({ where: { id: dto.id } })` : présente et du même poste : renvoyer `{ plage, cree: false }` (aller à l'étape 9) ; d'un autre poste : 409 `IDENTIFIANT_DEJA_UTILISE` (`MESSAGE_IDENTIFIANT_DEJA_UTILISE`) ;
       3. `lirePlagesNonEpuisees(tx, poste.id)` : 2 ou plus : 409 `PLAGES_SUFFISANTES` (`MESSAGE_PLAGES_SUFFISANTES`) ;
       4. `taille` = `taillePlageTickets` de `tx.parametresPharmacie.findUnique({ where: { structureId } })`, `TAILLE_PLAGE_DEFAUT` si absent ;
       5. `const [{ debut }] = await tx.$queryRaw<{ debut: number }[]>` : `INSERT INTO "CompteurTicket" ("pointDeVenteId", "prochainNumero") VALUES (${pv}, ${1 + taille}) ON CONFLICT ("pointDeVenteId") DO UPDATE SET "prochainNumero" = "CompteurTicket"."prochainNumero" + ${taille} RETURNING "prochainNumero" - ${taille} AS "debut"` (convertir par `Number`) ;
       6. `fin = debut + taille - 1` ;
       7. `tx.plageTicket.create({ data: { id: dto.id, posteId, pointDeVenteId, debut, fin, attribueeParId: user.id } })` ;
       8. audit `{ userId: user.id, action: 'create', entityType: 'PlageTicket', entityId: dto.id, ip: ip ?? null, metadata: { posteCode, debut, fin } }` ;
       9. `plages = await lirePlagesNonEpuisees(tx, poste.id)`.
    3. Un `P2002` sur `PlageTicket` (même identifiant envoyé en même temps par deux postes) : 409 `IDENTIFIANT_DEJA_UTILISE`.
    4. Réponse : `data` `{ id, debut, fin, taille: fin - debut + 1, cree, plages }` ; message `Numéros de tickets ${debut} à ${fin} réservés pour ce poste.` si créée, sinon `Ces numéros de tickets étaient déjà réservés pour ce poste.`
- `src/pharmacie/points-de-vente.controller.ts` : `@Post(':structureId/postes/:posteId/plages')`, `@RequirePermissions(PERMISSIONS.CAISSE_UTILISER)`, `@HttpCode(HttpStatus.OK)`, Swagger (« Réserver une série de numéros de tickets pour un poste desktop » ; description : idempotent par `id`, 409 `PLAGES_SUFFISANTES`, `POSTE_INCONNU`, `IDENTIFIANT_DEJA_UTILISE`), `@Ip() ip`.
- `codes-erreur.ts` : ajouter `// Deux séries de numéros de tickets déjà en réserve sur ce poste (409).` puis `'PLAGES_SUFFISANTES',` après `JOURNEE_NON_CLOTUREE`.

Ordre des verrous : poste puis compteur, aucun verrou de journée ni de caisse (D632, D639).

### 5. Photographie : `src/pharmacie/synchro/catalogue-synchro.service.ts` (nouveau)

`@Injectable() export class CatalogueSynchroService { constructor(prisma: PrismaService, accesPharmacie: AccesPharmacieService, storage: StorageService) }`.

Message exporté : `MESSAGE_CATALOGUE_POSTE_WEB = "La photographie du catalogue sert seulement à l'application MedConnecte Caisse pour Windows."`.

`async photographier(structureId: string, userId: string, posteId: string): Promise<CatalogueSynchro>` (type exporté, forme ci-dessous) :

1. `verifier` ; poste `findFirst({ where: { id: posteId, pointDeVente: { structureId } } })` : absent, `TECHNIQUE` ou inactif : 409 `POSTE_INCONNU` (`MESSAGE_POSTE_INCONNU`) ; `WEB` : 409 `POSTE_INCONNU` (`MESSAGE_CATALOGUE_POSTE_WEB`) (D645).
2. Si `parametresPharmacie` manque pour la pharmacie : `await this.prisma.$transaction((tx) => assurerPointDeVente(tx, structure))` (hors de la lecture, comme `calculerBilan`).
3. Une transaction `{ isolationLevel: 'RepeatableRead' }` en lecture seule :
   - `poste` relu (`derniereSequenceAppliquee`), `sequenceMaxRecue` = `max(derniereSequenceAppliquee, _max.sequence de EvenementSynchro du poste ?? 0)` ;
   - `plages = lirePlagesNonEpuisees(tx, posteId)` ; point de vente (`id`, `ordre`) ; paramètres ; modes et coupures actifs (mêmes `select` et tris que `referentiels`) ;
   - fiches `tx.stockMedicament.findMany({ where: { structureId, archiveLe: null }, select: { id, prixUnitaire, prixUnite, coefficientBoite, uniteMinimale, deconditionnable, medicament: { select: { id, nom, nomGenerique, categorie, formes, ordonnanceRequise } } } })` ;
   - quantités : `tx.agregatStockProduit.findMany({ where: { pointDeVenteId } })` (0 si absente) ;
   - lots : `tx.lotStock.findMany({ where: { pointDeVenteId, stockMedicament: { structureId, archiveLe: null }, agregat: { is: { quantite: { gt: 0 } } } }, select: { id, stockMedicamentId, numeroLot, dateExpiration, dateReception, coefficientReception, lotTechnique, agregat: { select: { quantite: true } } } })`. Jamais `coutUnitaire` ni `coutAchatBoite` dans un `select`.
4. Forme (clés dans cet ordre exact, la sérialisation sert à l'ETag) :

```ts
{
  // `jour` retiré par le chef à la validation (D662) : heure du serveur dans l'en-tête Date
  pharmacie: { id, nom, adresse, ville, telephone, logoUrl }, // nul si absent
  pointDeVente: { id, ordre },
  poste: { id, code, libelle, sequenceAppliquee, sequenceMaxRecue, plages: [{ id, debut, fin }] },
  parametres: ParametresReponse, // versParametresReponse
  modesPaiement: [...], coupures: [...],
  fiches: [{ stockId, medicamentId, nom, nomGenerique, categorie, formes, ordonnanceRequise, prixUnitaire, prixUnite, coefficientBoite, uniteMinimale, deconditionnable, quantite,
             lots: [{ id, numeroLot, dateExpiration /* AAAA-MM-JJ ou null */, dateReception /* ISO */, coefficientReception, solde, lotTechnique }] }],
}
```

Tri : fiches par `nom.localeCompare(autre, 'fr')` puis `stockId` ; lots : `dateExpiration` nulle d'abord, puis croissante, puis `dateReception` croissante, puis `id` (D473).

### 6. Réponse compressée : `src/pharmacie/synchro/reponse-compressee.ts` (nouveau, fonctions pures)

```ts
export function etagFaible(texte: string): string               // `W/"${sha256(texte utf8) en base64url}"`
export function correspondEtag(entete: string | undefined, etag: string): boolean
export function choisirEncodage(entete: string | undefined): 'br' | 'gzip' | 'identity'
export function compresserJson(texte: string, entete: string | undefined): { encodage: 'br' | 'gzip' | 'identity'; contenu: Buffer }
```

- `correspondEtag` : en-tête découpé sur `,`, chaque élément `trim()` ; vrai si un élément vaut `*`, ou si, préfixe `W/` retiré des deux côtés, il est égal à l'ETag (comparaison faible).
- `choisirEncodage` : jetons `nom;q=valeur` (casse ignorée) ; un jeton à `q=0` est exclu ; `br` s'il est accepté (ou `*`), sinon `gzip` s'il est accepté, sinon `identity` ; en-tête absent : `identity`.
- `compresserJson` : `br` = `brotliCompressSync(Buffer.from(texte), { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_SIZE_HINT]: taille } })` ; `gzip` = `gzipSync(..., { level: 6 })` ; `identity` = le tampon.

### 7. Route : `src/pharmacie/synchro/synchro.controller.ts` (nouveau)

`@ApiTags('Pharmacie : synchronisation') @ApiBearerAuth() @Controller('pharmacie') @UseGuards(AuthGuard, PermissionsGuard) export class SynchroController { constructor(private readonly catalogue: CatalogueSynchroService) }`.

```ts
@Get(':structureId/synchro/catalogue')
@RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
async photographie(@Req() req: RequestWithUser, @Param('structureId') structureId: string, @Query() query: CatalogueSynchroQueryDto,
                   @Headers('if-none-match') siAucun: string | undefined, @Headers('accept-encoding') encodages: string | undefined, @Res() res: Response): Promise<void>
```

Corps : `data = await this.catalogue.photographier(...)` ; `texte = JSON.stringify({ data, message: 'Catalogue du poste.', success: true })` ; `etag = etagFaible(texte)` ; en-têtes `ETag`, `Cache-Control: private, no-cache`, `Vary: Accept-Encoding` ; si `correspondEtag(siAucun, etag)` : `res.status(304).end()` ; sinon `compresserJson`, `Content-Type: application/json; charset=utf-8`, `Content-Encoding` si différent d'`identity`, `Content-Length`, `res.status(200).end(contenu)`. Les erreurs (`HttpException`) sont levées avant toute écriture sur `res` (le filtre global les traite). Swagger : « Photographie du catalogue pour un poste desktop » (description : sans coût, ETag et 304, compression br ou gzip, 409 `POSTE_INCONNU`). `import type { Response } from 'express'`.

DTO `src/pharmacie/dto/synchro.dto.ts` (nouveau) : `export class CatalogueSynchroQueryDto { @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(64) posteId: string; }`.

`PharmacieModule` : ajouter `SynchroController` et `CatalogueSynchroService`.

### 8. CA22

- `routes-pharmacie.ts` : `'POST /pharmacie/:structureId/postes/:posteId/plages'` et `'GET /pharmacie/:structureId/synchro/catalogue'`, classe `J`, `porteCout: false`, `exigeMarge: false`, à côté des routes de postes.
- `etancheite-couts.db-spec.ts`, `APPELS` : chaque appel enregistre d'abord son poste desktop `c.en('post', /pharmacie/${S}/postes).send({ type: 'DESKTOP', appareilId: `etancheite-desktop-${c.profil}` })` (idempotent), le retient (`retenir(c, 'posteDesktopId', r)`), puis : plages `c.en('post', .../postes/${posteDesktopId}/plages).send({ id: randomUUID() })` ; catalogue `c.en('get', .../synchro/catalogue?posteId=${posteDesktopId})`. Chaque appel renvoie ses deux réponses. Aucune autre ligne du fichier ne change.

### 9. Tests

`src/config/origines-cors.spec.ts` (nouveau) :
1. absente, vide ou espaces : aucune origine, aucune erreur.
2. `http://127.0.0.1:47613, http://localhost:47614` : deux origines, aucune erreur ; doublon retiré.
3. refus avec `erreur` non nulle et sans la valeur dans le message : `https://127.0.0.1:47613`, `http://192.168.1.2:47613`, `http://127.0.0.1:80`, `http://127.0.0.1:70000`, `http://127.0.0.1:47613/`, `http://exemple.com:47613` ; 11 origines valides.
4. `originesCors` : `FRONTEND_URL` d'abord (défaut `http://localhost:3000`), puis les origines desktop valides, sans doublon ; avec une entrée invalide, les valides sont gardées.

`src/config/env.validation.spec.ts` (cas ajoutés) : `DESKTOP_ORIGINS` absente acceptée ; liste valide acceptée ; invalide : `validateEnv` lève et le message contient `DESKTOP_ORIGINS` mais pas la valeur.

`src/pharmacie/synchro/reponse-compressee.spec.ts` (nouveau) :
1. `etagFaible` : déterministe, commence par `W/"`, change si un caractère change.
2. `correspondEtag` : égal, liste avec espaces, sans `W/`, `*`, absent ou différent faux.
3. `choisirEncodage` : `br, gzip` = br ; `gzip, deflate` = gzip ; `br;q=0, gzip` = gzip ; `deflate` = identity ; absent = identity ; `*` = br.
4. `compresserJson` : br et gzip décompressés (`brotliDecompressSync`, `gunzipSync`) redonnent le texte ; identity renvoie le texte tel quel.

`src/pharmacie/points-de-vente.http.spec.ts` (un cas ajouté) : `POST /pharmacie/:id/postes/:posteId/plages` avec `{ id: 'abc' }` : 400 `VALIDATION`, champ `id` ; le service simulé n'est pas appelé.

`test/db/plages-tickets.db-spec.ts` (nouveau, 10 tests, préparation calquée sur `journee-cloturee.db-spec.ts` : `AccesPharmacieService`, `PointsDeVenteService`, `SessionsCaisseService`, `MouvementsStockService`, `VenteService` ; postes desktop `D1` à `D4` (`appareilId` `desktop-pb18a-1` à `-4`) et un poste web `W` enregistrés par `postes.enregistrerPoste` ; aide `compteur()` = `prochainNumero` du point de vente ; aide `venteSql(posteId, numeroTicket)` qui insère une `Vente` minimale par SQL sur une caisse ouverte de ce poste (`sessions.ouvrir`), toutes colonnes non nulles renseignées, numéro `T1-<n sur 7 chiffres>`) :
1. « première plage prise sur le compteur » : `n0 = compteur()` ; `attribuerPlage(D1, id1)` : `debut` = n0, `fin` = n0 + 999, `taille` 1000, `cree` vrai, `plages` = `[{ id1, n0, n0 + 999 }]` ; `compteur()` = n0 + 1000 ; ligne `PlageTicket` avec `attribueeParId` ; une ligne d'audit `create` `PlageTicket`.
2. « rejeu du même identifiant » : même appel : `cree` faux, mêmes bornes, compteur inchangé, une seule ligne.
3. « identifiant d'un autre poste » : `attribuerPlage(D2, id1)` : 409 `IDENTIFIANT_DEJA_UTILISE`.
4. « deux plages au plus » : `id2` sur D1 réussit (`debut` = n0 + 1000) ; `id3` : 409 `PLAGES_SUFFISANTES` avec `MESSAGE_PLAGES_SUFFISANTES`, compteur inchangé.
5. « dernier numéro utilisé : la plage est épuisée » : `venteSql(D1, fin de la plage 1)` ; `attribuerPlage(D1, id3)` réussit ; `plages` = plage 2 et plage 3.
6. « une vente dans une plage plus récente épuise la précédente » : D2 reçoit deux plages p1, p2 ; `venteSql(D2, p2.debut)` ; `lirePlagesNonEpuisees(prisma, D2)` = `[p2]` ; une troisième plage pour D2 réussit.
7. « vente web après les plages : aucune collision » : une vente web (`service.creerVente`, fiche à lot) a un `numeroTicket` supérieur à la `fin` de toutes les plages et compris dans aucune.
8. « deux postes en même temps » : `Promise.all` des premières plages de D3 et D4 : bornes disjointes, compteur avancé d'exactement 2 × taille.
9. « taille réglée par la pharmacie » : `taillePlageTickets` = 100 par SQL ; une plage de D3 a `taille` 100 ; valeur rétablie à 1000.
10. « postes refusés » : W : 409 `POSTE_INCONNU` avec `MESSAGE_PLAGE_POSTE_WEB` ; D4 désactivé (`postes.modifierPoste(..., { actif: false })`) : 409 `POSTE_INCONNU` ; poste inexistant : 409 ; poste desktop de `str-pharma-2` appelé sur `str-pharma-1` : 409 `POSTE_INCONNU`.

`test/db/synchro-http.db-spec.ts` (nouveau, application HTTP construite exactement comme `etancheite-couts.db-spec.ts`, deux profils `titulaire` (`usr-admin-p1`) et `vendeur` (`usr-pharm-p1`) ; données : fiche F coefficient 10 reçue en deux lots de 5 boîtes chacun (`ReceptionsService.enregistrer`, coûts 5000 et 7000 par boîte, péremptions J+20 et J+200), puis la date du premier lot corrigée à J-3 (`corrigerDateLot`, motif) pour avoir un lot périmé ; fiche G archivée avec un lot ; fiche H dont l'unique lot est entièrement sorti (`SortiesStockService.enregistrer`) ; poste desktop D enregistré par `POST /postes`) :
1. « photographie sans aucun coût » : titulaire, `Accept-Encoding: gzip` : 200, `content-encoding` gzip, `etag` commençant par `W/"`, `cache-control` `private, no-cache`, `vary` contient `Accept-Encoding` ; `data.poste` (`code`, `sequenceAppliquee` 0, `sequenceMaxRecue` 0, `plages` vide) ; `data.parametres` a exactement les 7 clés de `ParametresReponse` ; fiche F : `quantite` 100, `lots` = lot périmé puis lot J+200 avec `solde` 50 chacun, `coefficientReception` 10 ; `cheminsCout(body)` vide pour le titulaire ET pour le vendeur (CA22 étendu).
2. « fiche archivée et lot épuisé exclus » : G absente ; H présente avec `lots` vide et `quantite` 0.
3. « 304 si rien n'a changé » : `If-None-Match` = l'ETag reçu : 304, corps vide ; une liste `"x", <etag>` donne aussi 304.
4. « l'ETag change avec le catalogue » : prix de F changé (`PATCH .../stock/:stockId/fiche` `{ prixUnitaire }`) : avec l'ancien ETag, 200 et ETag différent.
5. « encodage choisi » : `Accept-Encoding: br, gzip` : `content-encoding` br (le corps n'est pas lu ici, l'aller-retour est prouvé par le test unitaire) ; `Accept-Encoding: identity` : aucun `content-encoding`, corps JSON lisible.
6. « postes refusés » : poste web : 409 `POSTE_INCONNU` ; poste inexistant : 409 ; poste desktop désactivé : 409.
7. « plages et séquences dans la photographie » : après `POST .../postes/:D/plages` (`{ id }`, 200, `cree` vrai ; même `id` : 200, `cree` faux), la photographie liste cette plage ; une ligne `EvenementSynchro` EN_ATTENTE insérée par SQL pour D (séquence 5) donne `sequenceMaxRecue` 5 et `sequenceAppliquee` 0.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell ni par script. Ne jamais afficher ni écrire une URL de base, un mot de passe ou une valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés (et seulement eux) : `src/config/origines-cors.ts`, `src/config/origines-cors.spec.ts`, `src/config/env.validation.ts`, `src/config/env.validation.spec.ts`, `src/main.ts`, `src/chat/chat.gateway.ts`, `src/common/filters/codes-erreur.ts`, `src/pharmacie/synchro/plages.ts`, `src/pharmacie/synchro/catalogue-synchro.service.ts`, `src/pharmacie/synchro/reponse-compressee.ts`, `src/pharmacie/synchro/reponse-compressee.spec.ts`, `src/pharmacie/synchro/synchro.controller.ts`, `src/pharmacie/dto/synchro.dto.ts`, `src/pharmacie/dto/points-de-vente.dto.ts`, `src/pharmacie/points-de-vente.service.ts`, `src/pharmacie/points-de-vente.controller.ts`, `src/pharmacie/points-de-vente.http.spec.ts`, `src/pharmacie/pharmacie.module.ts`, `test/etancheite-couts/routes-pharmacie.ts`, `test/db/etancheite-couts.db-spec.ts`, `test/db/plages-tickets.db-spec.ts`, `test/db/synchro-http.db-spec.ts`, `CLAUDE.md`, et dans le dépôt racine `../.env.example`, `../compose.yml`.

## CLAUDE.md du back (puce à créer après celle de PB17c)

« **Synchronisation desktop (tranche pharmacie 1, PB18)** : `POST /pharmacie/:structureId/postes/:posteId/plages` (`caisse:utiliser`, 200, `{ id }` UUID du poste) réserve `taillePlageTickets` numéros sur `CompteurTicket` pour un poste DESKTOP actif (idempotent par `id`, 409 `IDENTIFIANT_DEJA_UTILISE` pour l'id d'un autre poste, 409 `PLAGES_SUFFISANTES` au-delà de deux plages non épuisées, 409 `POSTE_INCONNU` pour un poste web, technique, inactif ou inconnu) ; une plage est épuisée quand son dernier numéro ou un numéro d'une plage plus récente du poste est utilisé ; la réponse liste les plages en cours. `GET /pharmacie/:structureId/synchro/catalogue?posteId=` (`caisse:utiliser`) renvoie la photographie complète du catalogue pour un poste desktop actif (fiches non archivées, lots à solde positif périmés compris, paramètres, modes, coupures, pharmacie, plages en cours, `sequenceAppliquee` et `sequenceMaxRecue`), sans aucun coût même pour le titulaire, lue en lecture répétable, avec ETag faible (304 si `If-None-Match` correspond) et compression brotli ou gzip selon `Accept-Encoding` (D633, D634). CORS : `DESKTOP_ORIGINS` (D635). »

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint` sur chacun des fichiers `.ts` autorisés : aucune erreur (`chat.gateway.ts` : aucune erreur nouvelle sur la ligne touchée si le fichier porte une dette signalée).
3. `docker compose exec -T backend npm test` : tout vert.
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `plages-tickets` (10), `synchro-http` (7), `etancheite-couts` (inventaire égal aux routes montées, CA22 vert sur les deux nouvelles routes) ; tous les autres db-specs verts et inchangés.
5. `git status --porcelain` (back) ne liste que les fichiers autorisés du back (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes` vide ; à la racine, seuls `.env.example` et `compose.yml` ont changé pour cette fiche.
6. `grep -n "cout" src/pharmacie/synchro/catalogue-synchro.service.ts` : aucune occurrence.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-11-01 | dur (codeur Sonnet, vérificateur Sonnet) | PASS, validé par le chef (rapports/PB18a-verification.md, rapports/PB18a-chef.md) | code conforme ; `jour` retiré de la photographie et en-tête `Date` exposé par le CORS (D662) ; deux fichiers écrits par heredoc Bash relus par le chef, conformes

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
docker compose exec -T backend npx tsc --noEmit | 0 erreur | voir commit
docker compose exec -T backend npx eslint (18 fichiers .ts touchés) | 0 erreur, 1 avertissement préexistant (main.ts, `bootstrap()` non attendu) | voir commit
docker compose exec -T backend npm test | 97 suites, 1060 réussis, 3 ignorés, 0 échec | voir commit
docker compose exec -T backend npm run test:db | 31 suites, 354 réussis, 0 échec | voir commit
docker compose restart backend | démarrage propre, CORS : origine du front renvoyée, origine étrangère refusée, `Access-Control-Expose-Headers: ETag,Date` | voir commit
