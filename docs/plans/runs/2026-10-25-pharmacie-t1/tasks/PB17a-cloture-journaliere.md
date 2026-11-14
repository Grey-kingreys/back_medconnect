# PB17a - Clôture journalière : préparation, clôture, clôture forcée, liste

Tier: dur (codeur Sonnet selon l'arbitrage A2 ; fiche très détaillée, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages de succès et d'erreur lus par le titulaire, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Première des trois sous-fiches de PB17 (D612), commitées dans l'ordre : PB17a (cette fiche), PB17b (export CSV d'une journée clôturée), PB17c (verrou de la journée côté écrivains : refus `JOURNEE_CLOTUREE`, rattachement au jour suivant, CA20, courses). Chacune est autonome, garde la gate verte et est commitée seule.

PB17a livre :

- le module d'aide `src/pharmacie/caisse/journee.ts` (verrou consultatif de journée partagé ou exclusif, jour de rattachement, refus d'un jour clôturé), utilisé ici par la clôture et branché sur les écrivains par PB17c (D613, D615) ;
- trois outils de date purs ajoutés à `src/pharmacie/jour-metier.ts` ;
- les règles pures de la clôture `src/pharmacie/caisse/cloture-regles.ts` : postes attendus (D616), autorisation de forcer (D617), totaux par mode (D619) ;
- `ClotureService` et `ClotureController` : `GET /pharmacie/:structureId/caisse/clotures/:jour/preparation`, `POST /pharmacie/:structureId/caisse/clotures`, `GET /pharmacie/:structureId/caisse/clotures?mois=` (`cloture:gerer`) (D618, D620, D621) ;
- les codes d'erreur de la clôture, l'assainissement de leurs `details`, l'inventaire CA22 des trois routes ;
- les tests : clôture complète, clôture incomplète, clôture forcée qui enregistre le poste manquant (CA21 première moitié), caisse web qui bloque même en forçant, deux clôtures simultanées.

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate`** : `ClotureJournaliere`, `TotalClotureMode`, `SessionCaisse.clotureJournaliereId`, le trigger `session_caisse_proteger` (FERMEE vers INCLUSE_DANS_CLOTURE, seule `clotureJournaliereId` change) et les CHECK `ClotureJournaliere_forcage_check`, `TotalClotureMode_ecart_check`, `SessionCaisse_cloture_check` existent (M5, D514 à D516). Ne pas toucher aux migrations, aux retours arrière, aux instantanés `test/db/instantanes/`. Jamais `prisma migrate dev`, `migrate reset` ni `db push`. **Ne modifier ni `vente.service.ts`, ni `sessions-caisse.service.ts`, ni `receptions.service.ts`** : leur branchement sur la journée est PB17c.

Décisions applicables (`decisions.md`) : D435, D474, D483, D507, D514 à D517, D526 à D533, D554, D559, D606 à D608, et celles de cette fiche, D612 à D621, D623 (partie PB17a).

### Contexte vérifié (ne pas re-découvrir)

- `ClotureJournaliere` : `id` (uuid), `pointDeVenteId`, `jourMetier` (`@db.Date`), `clotureParId` (sans clé étrangère), `clotureeLe` (défaut now), `forcee` (défaut faux), `motifForcage?`, `postesManquants Json` (défaut `[]`), relations `sessions`, `totaux` ; `@@unique([pointDeVenteId, jourMetier])` (nom Prisma `pointDeVenteId_jourMetier`) ; immuable (trigger `journal_refuser_modification`) ; CHECK : `forcee` implique un motif non vide. Le commentaire du schéma `[{ posteId, code, libelle }]` est dépassé : le format est celui de D618 (ne pas modifier le schéma).
- `TotalClotureMode` : `clotureId`, `modePaiementId`, `theorique`, `compte?`, `ecart?`, `@@unique([clotureId, modePaiementId])` ; CHECK : `compte` et `ecart` nuls ensemble, sinon `ecart = compte - theorique` ; immuable.
- `SessionCaisse` : `pointDeVenteId`, `posteId` (relation `poste`), `utilisateurId?`, `utilisateurNom`, `statut` (`OUVERTE`, `FERMEE`, `INCLUSE_DANS_CLOTURE`), `technique`, `jourMetier` (`@db.Date`, jour d'ouverture, D435), `ouverteLe`, `fermeeLe?`, `clotureJournaliereId?`, relation `resultats` (`ResultatSessionMode` : `modePaiementId`, relation `modePaiement` avec `code`, `libelle`, `ordre`, puis `theorique`, `compte?`, `ecart?`, écrits à la fermeture pour chaque mode affiché, D531, D532 ; le compté des espèces n'est jamais nul puisque la fermeture exige un comptage). Les sessions techniques (`technique` vrai) sont exclues de toute clôture (D517).
- `Poste` : `id`, `pointDeVenteId`, `code`, `libelle`, `type` (`WEB`, `DESKTOP`, `TECHNIQUE`), `actif`, `dernierContactLe?`, `dernierEtat Json?` (`{ fileVide, sessionOuverte, versionApp }` écrit par PB18 à chaque synchro ; nul aujourd'hui partout).
- `ParametresPharmacie.debutCaisse` (`DateTime`, défaut instant de la migration, non modifiable par la route, D483) : jours antérieurs non clôturables.
- Point de vente : `prisma.pointDeVente.findUnique({ where: { structureId_ordre: { structureId, ordre: 1 } } })` ; création paresseuse `assurerPointDeVente(tx, structure)` (`src/pharmacie/point-de-vente.ts`, renvoie `{ pointDeVente, parametres, ... }`) comme `SessionsCaisseService.calculerBilan`.
- `AccesPharmacieService.verifier(structureId, userId)` renvoie `{ user: { id, nom, prenom, structureId }, structure: { id, nom, adminId, ... } }`. `Reponse<T>` (`src/pharmacie/points-de-vente.service.ts`) = `{ data, message, success: true }`.
- Outils existants : `jourConakry(d)`, `bornesDuJour(jour)` (`src/pharmacie/jour-metier.ts`) ; `jourVersDate`, `dateVersJour` (`src/pharmacie/stock/lecture-stock.ts`) ; `jourValide` (`src/pharmacie/domaine/reception.ts`) ; `MESSAGE_JOUR_INVALIDE` (`src/pharmacie/rapports/rapports.service.ts`) ; `estDoublonSur(erreur, 'ClotureJournaliere')` (`src/pharmacie/stock/erreurs-base.ts`) ; `formaterGnf` (`src/pharmacie/caisse/bilan-caisse.ts`).
- Verrous existants (D507, D527, D545, D554, D559) : ventes et annulations prennent poste, session (`FOR UPDATE`), puis `CompteurTicket` ou vente d'origine, puis verrous consultatifs des fiches ; la fermeture prend la session. Un verrou consultatif se prend par `$executeRaw` (jamais `$queryRaw`, qui échoue sur une colonne `void`, D507). Le verrou de journée (D613) est **le premier verrou** de toute transaction qui le prend : la clôture le prend en exclusif ici ; PB17c le fera prendre en partagé par les écrivains de caisse.
- Modèles à copier : `src/pharmacie/caisse/sessions-caisse.controller.ts` (gardes, Swagger, `@HttpCode(HttpStatus.OK)` sur les POST), `src/pharmacie/caisse/sessions-caisse.http.spec.ts` (module de test HTTP, filtre global, profils par en-tête `x-essai-user`), `src/pharmacie/dto/sessions-caisse.dto.ts` (`rognerTexte`, `@Matches`), `src/pharmacie/receptions/receptions.controller.ts` (`@Ip() ip`), audit `tx.auditLog.create` de `ReceptionsService` (lignes 507 à 525), `test/db/sessions-caisse.db-spec.ts` (préparation, `sql`, `compter`, `nouveauPoste`, `ouvrirSession`, `venteSql`, `paiementSql`, `venteEncaissee`, `coupures`), `test/db/qualification.db-spec.ts` (attente observée dans `pg_locks`).
- Ne jamais importer `src/pharmacie/pharmacie.service.ts` ni `src/pharmacie/vente.service.ts` depuis les fichiers créés ici.

### 1. `src/pharmacie/jour-metier.ts` (ajouts purs)

Ajouter, sans toucher aux deux fonctions existantes :

```ts
/** Jour suivant (AAAA-MM-JJ), fins de mois et d'année comprises. */
export function lendemain(jour: string): string;
/** Jour qui précède de n jours (n >= 0). */
export function joursAvant(jour: string, n: number): string;
/** « 30/10/2026 » pour un jour AAAA-MM-JJ. */
export function jourLisible(jour: string): string;
/** « 30/10/2026 à 14:05 » (heure de Conakry, UTC+0). */
export function instantLisible(d: Date): string;
```

Règles : `lendemain` et `joursAvant` calculent par `Date.UTC` puis `toISOString().slice(0, 10)` (aucune horloge) ; `jourLisible` découpe la chaîne (`AAAA-MM-JJ` vers `JJ/MM/AAAA`) ; `instantLisible` lit `getUTCDate`, `getUTCMonth`, `getUTCFullYear`, `getUTCHours`, `getUTCMinutes`, chiffres sur deux positions.

### 2. `src/pharmacie/caisse/journee.ts` (nouveau, aide partagée, D613, D615)

Imports permis : `ConflictException` de `@nestjs/common`, `type { Prisma }` de `generated/prisma/client`, `type { PrismaService }`, `../jour-metier`, `../stock/lecture-stock` (`jourVersDate`). Rien d'autre (ni service Nest, ni `vente.service.ts`).

```ts
type Client = PrismaService | Prisma.TransactionClient;

/** Clé du verrou consultatif des journées d'une pharmacie. */
export function cleVerrouJournees(structureId: string): string; // `medconnecte:journees:${structureId}`

/** Écrivain de caisse : verrou partagé, PREMIÈRE instruction de sa transaction (réentrant). */
export async function verrouillerJourneesPartage(tx: Prisma.TransactionClient, structureId: string): Promise<void>;
// await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${cleVerrouJournees(structureId)}, 0))`;

/** Clôture : verrou exclusif, PREMIÈRE instruction de sa transaction. */
export async function verrouillerJourneesExclusif(tx: Prisma.TransactionClient, structureId: string): Promise<void>;
// await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cleVerrouJournees(structureId)}, 0))`;

export async function estJourCloture(client: Client, pointDeVenteId: string, jour: string): Promise<boolean>;
// findUnique ClotureJournaliere where pointDeVenteId_jourMetier { pointDeVenteId, jourMetier: jourVersDate(jour) }, select id

export function messageJourneeCloturee(jour: string): string;
// `La journée du ${jourLisible(jour)} est clôturée : plus rien ne peut y être enregistré. Les corrections se font sur la journée en cours.`
export function messageCaisseJourneeCloturee(jour: string): string;
// `Cette caisse compte pour la journée du ${jourLisible(jour)}, déjà clôturée : elle ne peut plus rien enregistrer. Encaissez sur un autre poste ; elle sera fermée quand ce poste aura envoyé ses ventes.`
export function messageReceptionJourneeCloturee(jour: string): string;
// `La journée du ${jourLisible(jour)} est clôturée : une réception ne peut plus y être datée. Indiquez la date d'aujourd'hui.`

/** 409 JOURNEE_CLOTUREE si le jour est clôturé. */
export async function exigerJourOuvert(client: Client, pointDeVenteId: string, jour: string, message?: string): Promise<void>;
// throw new ConflictException({ message: message ?? messageJourneeCloturee(jour), code: 'JOURNEE_CLOTUREE' })

/** Jour de rattachement d'une écriture faite maintenant : aujourd'hui s'il n'est pas clôturé, sinon le lendemain (D615). */
export async function jourDeRattachement(client: Client, pointDeVenteId: string, maintenant: Date): Promise<{ jour: string; jourReel: string }>;
// jourReel = jourConakry(maintenant) ; jour = (await estJourCloture(client, pv, jourReel)) ? lendemain(jourReel) : jourReel
```

Un lendemain n'est jamais clôturé (la clôture refuse un jour futur, D620) : une seule lecture suffit.

### 3. `src/pharmacie/caisse/cloture-regles.ts` (nouveau, règles pures, D616, D617, D619)

Imports permis : `../jour-metier` (`instantLisible`) seulement. Aucune horloge, aucun Nest, aucun Prisma.

```ts
export type RaisonPosteAttendu = 'SESSION_OUVERTE' | 'FILE_NON_VIDE' | 'SYNCHRO_INCOMPLETE';

export interface PosteCaisse {
  id: string; code: string; libelle: string;
  type: 'WEB' | 'DESKTOP';
  actif: boolean;
  dernierContactLe: Date | null;
  dernierEtat: unknown;
}
export interface SessionOuverteDuJour { id: string; posteId: string; utilisateurNom: string }

export interface PosteManquant {
  posteId: string; posteCode: string; libelle: string;
  type: 'WEB' | 'DESKTOP';
  raison: RaisonPosteAttendu;
  sessionId: string | null;
  utilisateurNom: string | null;
  /** ISO 8601 ou null. */
  dernierContactLe: string | null;
}
export interface PosteAttendu extends PosteManquant { message: string }

export function lireFileVide(etat: unknown): boolean | null;
export function postesAttendus(entree: {
  /** 00:00 UTC du jour à clôturer. */
  debutJour: Date;
  postes: PosteCaisse[];
  /** Sessions OUVERTE non techniques dont le jourMetier est le jour à clôturer. */
  sessionsOuvertes: SessionOuverteDuJour[];
  /** Postes DESKTOP qui ont une pièce de jourMetier entre J-7 et J inclus. */
  postesAyantVendu: ReadonlySet<string>;
}): PosteAttendu[];
export function forcageAutorise(attendus: PosteManquant[]): boolean;
export function versPosteManquant(a: PosteAttendu): PosteManquant;

export interface ResultatPourCloture {
  sessionId: string; mode: string; libelle: string; ordre: number;
  theorique: number; compte: number | null;
}
export interface TotalCloture {
  mode: string; libelle: string;
  theorique: number; compte: number | null; ecart: number | null;
  sessionsNonRapprochees: number;
}
export function totauxCloture(resultats: ResultatPourCloture[]): TotalCloture[];
```

Règles exactes :

1. `lireFileVide(etat)` : `etat` objet non nul, pas un tableau, `typeof etat.fileVide === 'boolean'` : cette valeur ; sinon `null`.
2. `postesAttendus` : au plus une entrée par poste, raison choisie dans cet ordre de priorité :
   - `SESSION_OUVERTE` : le poste (WEB ou DESKTOP, actif ou non) porte une session de `sessionsOuvertes` ; `sessionId` et `utilisateurNom` de la session ;
   - sinon, pour un poste `DESKTOP` **actif** seulement : `FILE_NON_VIDE` si `lireFileVide(dernierEtat) === false` ;
   - sinon, `DESKTOP` actif : `SYNCHRO_INCOMPLETE` si `postesAyantVendu.has(id)` et que la synchro n'est pas complète depuis le début du jour, c'est-à-dire **non** (`dernierContactLe !== null` et `dernierContactLe >= debutJour` et `lireFileVide(dernierEtat) === true`) ;
   - un poste WEB n'est attendu que pour `SESSION_OUVERTE` ; un poste inactif seulement pour `SESSION_OUVERTE`.
   `sessionId` et `utilisateurNom` valent `null` hors `SESSION_OUVERTE` ; `dernierContactLe` = `toISOString()` ou `null`. Tri par `posteCode` (comparaison de chaînes `<`).
3. Messages (`message`), `contact` = `instantLisible(dernierContactLe)` ou `jamais` :
   - `SESSION_OUVERTE` WEB : `` `La caisse de ${utilisateurNom} est encore ouverte sur ${libelle} (${code}) : elle doit être fermée avec le comptage du tiroir.` `` ;
   - `SESSION_OUVERTE` DESKTOP : `` `La caisse de ${utilisateurNom} est encore ouverte sur ${libelle} (${code}) : ses ventes ne sont peut-être pas toutes arrivées.` `` ;
   - `FILE_NON_VIDE` : `` `${libelle} (${code}) a encore des ventes à envoyer (dernier contact : ${contact}).` `` ;
   - `SYNCHRO_INCOMPLETE` : `` `${libelle} (${code}) a vendu ces derniers jours mais n'a pas envoyé ses ventes depuis le début de la journée (dernier contact : ${contact}).` ``.
4. `forcageAutorise(attendus)` : `attendus.length > 0 && attendus.every((a) => a.type === 'DESKTOP')`.
5. `versPosteManquant` : copie sans `message`, clés dans l'ordre de l'interface.
6. `totauxCloture` : un total par mode présent dans `resultats`, triés par `ordre` puis `mode` (`<`) ; `theorique` = somme ; `sessionsNonRapprochees` = nombre de résultats du mode avec `compte === null` et `theorique !== 0` ; `compte` = `null` si `sessionsNonRapprochees > 0`, sinon somme des `compte ?? 0` ; `ecart` = `compte === null ? null : compte - theorique`. Liste vide : `[]`.

### 4. `src/pharmacie/dto/clotures.dto.ts` (nouveau)

Calqué sur `sessions-caisse.dto.ts` (même `rognerTexte`, recopié localement) :

```ts
export class CloturerJourneeDto {
  @ApiProperty({ example: '2026-10-30', description: 'Jour métier à clôturer, AAAA-MM-JJ' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  jour: string;

  @ApiPropertyOptional({ description: 'Clôturer sans attendre les postes desktop attendus (motif obligatoire)' })
  @IsOptional() @IsBoolean()
  forcer?: boolean;

  @ApiPropertyOptional({ maxLength: 500, example: 'Poste D1 en panne, ventes saisies demain' })
  @IsOptional() @Transform(rognerTexte) @IsString() @MaxLength(500)
  motifForcage?: string;
}

export class ListerCloturesQueryDto {
  @ApiPropertyOptional({ example: '2026-10', description: 'Mois AAAA-MM (défaut : mois en cours)' })
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  mois?: string;
}
```

### 5. `src/pharmacie/caisse/clotures.service.ts` (nouveau)

`@Injectable() export class ClotureService`, constructeur `(prisma: PrismaService, accesPharmacie: AccesPharmacieService)`.

Constantes et messages exportés :

```ts
export const OPTIONS_TRANSACTION_CLOTURE = { maxWait: 10_000, timeout: 30_000 };
export const MESSAGE_JOUR_FUTUR = "Cette journée n'a pas encore eu lieu : elle ne peut pas être clôturée.";
export const MESSAGE_MOTIF_FORCAGE_REQUIS = 'Indiquez pourquoi vous clôturez sans attendre ces postes (3 caractères au moins).';
export function messageJourAvantDebutCaisse(debut: string): string;
// `La caisse est utilisée depuis le ${jourLisible(debut)} : les journées précédentes ne se clôturent pas.`
export function messageJourneeDejaCloturee(jour: string): string;
// `La journée du ${jourLisible(jour)} est déjà clôturée.`
export function messageClotureIncomplete(jour: string, attendus: PosteManquant[]): string;
// `La journée du ${jourLisible(jour)} ne peut pas encore être clôturée. ${entete} : ${liste}.` (révisé par le chef, D627)
// entete = n === 1 ? 'Poste à attendre' : `${n} postes à attendre` ; liste = nommerPostes(attendus)
// nommerPostes (non exporté) : par poste `${libelle} (caisse de ${utilisateurNom})` si utilisateurNom, sinon `${libelle}` ; joints par ', '
export function messageCaissesAFermer(caisses: PosteManquant[]): string;
// n === 1 : `Fermez d'abord cette caisse ouverte sur un navigateur : ${liste}. Une caisse ouverte sur un navigateur se ferme avec le comptage du tiroir, même quand on force la clôture.`
// n > 1  : `Fermez d'abord ces caisses ouvertes sur un navigateur : ${liste}. ...` (même suite) ; liste = `${utilisateurNom} (${posteCode})` joints par ', '
```

Types de réponse exportés :

```ts
export interface SessionResume {
  id: string; posteId: string; posteCode: string; posteLibelle: string;
  posteType: 'WEB' | 'DESKTOP';
  utilisateurId: string; utilisateurNom: string;
  statut: 'OUVERTE' | 'FERMEE' | 'INCLUSE_DANS_CLOTURE';
  ouverteLe: Date; fermeeLe: Date | null;
}
export interface ClotureReponse {
  id: string; jour: string; clotureeLe: Date;
  clotureParId: string; clotureParNom: string | null;
  forcee: boolean; motifForcage: string | null;
  postesManquants: PosteManquant[];
  nombreSessions: number;
  totaux: { mode: string; libelle: string; theorique: number; compte: number | null; ecart: number | null }[];
}
export interface PreparationCloture {
  jour: string;
  cloture: ClotureReponse | null;
  sessions: SessionResume[];
  sessionsOuvertes: SessionResume[];
  postesAttendus: PosteAttendu[];
  totaux: TotalCloture[];
  peutCloturer: boolean;
  peutForcer: boolean;
}
```

#### 5.1 Méthodes privées

- `contexte(structure)` : point de vente d'ordre 1 et `parametresPharmacie.findUnique({ where: { structureId } })` ; l'un absent : `await this.prisma.$transaction((tx) => assurerPointDeVente(tx, structure))` puis relecture ; renvoie `{ pointDeVenteId, debutCaisse: dateVersJour(parametres.debutCaisse) }`.
- `validerJour(jour, debutCaisse)`, dans cet ordre, chacune `BadRequestException` :
  1. `!jourValide(jour)` : `{ message: MESSAGE_JOUR_INVALIDE, code: 'VALIDATION', champs: [{ champ: 'jour', contraintes: ['dateValide'], message: MESSAGE_JOUR_INVALIDE }] }` ;
  2. `jour > jourConakry(new Date())` : même forme, contrainte `jourFutur`, `MESSAGE_JOUR_FUTUR` ;
  3. `jour < debutCaisse` : `{ message: messageJourAvantDebutCaisse(debutCaisse), code: 'JOUR_AVANT_DEBUT_CAISSE' }`.
- `lireEtat(client, pointDeVenteId, jour, verrouiller: boolean)` :
  1. si `verrouiller` : `` await tx.$queryRaw`SELECT "id" FROM "SessionCaisse" WHERE "pointDeVenteId" = ${pv} AND "jourMetier" = ${jourVersDate(jour)} AND NOT "technique" ORDER BY "id" FOR UPDATE` `` ;
  2. `sessions = sessionCaisse.findMany({ where: { pointDeVenteId, jourMetier: jourVersDate(jour), technique: false }, include: { poste: true }, orderBy: [{ ouverteLe: 'asc' }, { id: 'asc' }] })` ;
  3. `postes = poste.findMany({ where: { pointDeVenteId, type: { in: ['WEB', 'DESKTOP'] } } })` ;
  4. `vendus = vente.findMany({ where: { pointDeVenteId, jourMetier: { gte: jourVersDate(joursAvant(jour, 7)), lte: jourVersDate(jour) }, poste: { type: 'DESKTOP' } }, select: { posteId: true }, distinct: ['posteId'] })` ;
  5. `attendus = postesAttendus({ debutJour: jourVersDate(jour), postes, sessionsOuvertes: sessions OUVERTE, postesAyantVendu: new Set(vendus.map((v) => v.posteId)) })` ;
  6. renvoie `{ sessions, attendus }`.
- `resultatsDe(client, sessionIds)` : `resultatSessionMode.findMany({ where: { sessionCaisseId: { in: sessionIds } }, include: { modePaiement: true } })` converti en `ResultatPourCloture` (`mode` = code, `libelle`, `ordre`, `theorique`, `compte`), plus la table `code -> modePaiementId` pour l'écriture des totaux.
- `versSessionResume(s)` : champs de `SessionResume` (`utilisateurId` non nul hors session technique).
- `presenterCloture(cloture, clotureParNom)` : `cloture` lue avec `include: { totaux: { include: { modePaiement: true } }, _count: { select: { sessions: true } } }` ; `jour = dateVersJour(jourMetier)`, `postesManquants` = la colonne JSON telle quelle (`as unknown as PosteManquant[]`), `nombreSessions = _count.sessions`, `totaux` triés par `modePaiement.ordre` puis `code` : `{ mode, libelle, theorique, compte, ecart }`.
- `nomsUtilisateurs(ids)` : `user.findMany({ where: { id: { in } }, select: { id, prenom, nom } })` vers `Map(id, `${prenom} ${nom}`.trim())`.

#### 5.2 `preparer(structureId: string, userId: string, jour: string): Promise<Reponse<PreparationCloture>>`

1. `{ structure } = await accesPharmacie.verifier(...)` ; `{ pointDeVenteId, debutCaisse } = await contexte(structure)` ; `validerJour(jour, debutCaisse)`.
2. `cloture = clotureJournaliere.findUnique({ where: { pointDeVenteId_jourMetier: { pointDeVenteId, jourMetier: jourVersDate(jour) } }, include: ... })`.
3. Journée clôturée : `sessions` = sessions non techniques du jour (même requête que `lireEtat` point 2) ; `totaux = totauxCloture(resultats des sessions dont clotureJournaliereId = cloture.id)` ; `postesAttendus: []`, `peutCloturer: false`, `peutForcer: false`, `cloture: presenterCloture(...)` ; message `` `La journée du ${jourLisible(jour)} est clôturée.` ``.
4. Sinon `lireEtat(prisma, pv, jour, false)` ; `totaux = totauxCloture(resultats des sessions FERMEE)` ; `peutCloturer = attendus.length === 0` ; `peutForcer = forcageAutorise(attendus)` ; `cloture: null` ; message `` `Préparation de la clôture du ${jourLisible(jour)}.` ``.
5. `sessionsOuvertes` = sous-liste `statut === 'OUVERTE'` de `sessions`. Aucune écriture (hors `assurerPointDeVente` du contexte).

#### 5.3 `cloturer(structureId: string, userId: string, dto: CloturerJourneeDto, ip: string | null): Promise<Reponse<ClotureReponse>>`

Hors transaction :

1. `{ user, structure } = verifier(...)` ; contexte ; `validerJour(dto.jour, debutCaisse)`.
2. `forcer = dto.forcer === true` ; `motif = dto.motifForcage?.trim() ?? ''` ; `forcer && motif.length < 3` : `BadRequestException({ message: MESSAGE_MOTIF_FORCAGE_REQUIS, code: 'MOTIF_REQUIS' })`.

Puis `prisma.$transaction(async (tx) => ..., OPTIONS_TRANSACTION_CLOTURE)` :

3. `await verrouillerJourneesExclusif(tx, structureId)` (première instruction).
4. `estJourCloture(tx, pv, jour)` : `ConflictException({ message: messageJourneeDejaCloturee(jour), code: 'JOURNEE_DEJA_CLOTUREE' })`.
5. `{ sessions, attendus } = await lireEtat(tx, pv, jour, true)`.
6. `attendus.length > 0` :
   - `!forcer` : `ConflictException({ message: messageClotureIncomplete(jour, attendus), code: 'CLOTURE_INCOMPLETE', details: attendus })` ;
   - `forcer && !forcageAutorise(attendus)` : `web = attendus.filter((a) => a.type === 'WEB')` ; `ConflictException({ message: messageCaissesAFermer(web), code: 'CAISSES_A_FERMER', details: web })`.
7. `forcee = attendus.length > 0` ; `manquants = forcee ? attendus.map(versPosteManquant) : []`.
8. `cloture = tx.clotureJournaliere.create({ data: { pointDeVenteId, jourMetier: jourVersDate(jour), clotureParId: user.id, forcee, motifForcage: forcee ? motif : null, postesManquants: manquants as unknown as Prisma.InputJsonValue } })`.
9. `fermees = sessions.filter((s) => s.statut === 'FERMEE').map((s) => s.id)` ; si non vide : `r = tx.sessionCaisse.updateMany({ where: { id: { in: fermees }, statut: 'FERMEE' }, data: { statut: 'INCLUSE_DANS_CLOTURE', clotureJournaliereId: cloture.id } })` ; `r.count !== fermees.length` : `throw new Error('Clôture : sessions modifiées pendant la clôture.')` (impossible sous les verrous, garde-fou). Les sessions OUVERTE (desktop, forçage) restent OUVERTE, sans `clotureJournaliereId`.
10. `totaux = totauxCloture(resultatsDe(tx, fermees))` ; `tx.totalClotureMode.createMany({ data: totaux.map((t) => ({ clotureId: cloture.id, modePaiementId, theorique: t.theorique, compte: t.compte, ecart: t.ecart })) })` (rien si vide).
11. Audit : `tx.auditLog.create({ data: { userId: user.id, action: 'create', entityType: 'ClotureJournaliere', entityId: cloture.id, ip, metadata: { jour, forcee, nombreSessions: fermees.length, postesManquants: manquants.map((m) => m.posteCode) } } })` (jamais le motif).
12. Relecture avec `include` de `presenterCloture`, `clotureParNom = `${user.prenom} ${user.nom}`.trim()`.

Autour de la transaction : `estDoublonSur(erreur, 'ClotureJournaliere')` : même 409 `JOURNEE_DEJA_CLOTUREE` ; toute autre erreur relancée.

Messages de succès (`jl = jourLisible(jour)`) :
- forcée : `` `Journée du ${jl} clôturée sans ${n} poste(s) : ${nommerPostes(manquants)}. Leurs ventes envoyées plus tard seront rattachées à la journée en cours.` `` (postes nommés comme dans `messageClotureIncomplete`, D627) ;
- `forcer` demandé sans poste attendu : `` `Journée du ${jl} clôturée. Aucun poste n'était attendu : la clôture n'a pas eu besoin d'être forcée.` `` (`forcee` faux, motif non enregistré) ;
- sinon : `` `Journée du ${jl} clôturée.` ``.

#### 5.4 `lister(structureId: string, userId: string, query: ListerCloturesQueryDto): Promise<Reponse<{ mois: string; clotures: ClotureReponse[] }>>`

`mois = query.mois ?? jourConakry(new Date()).slice(0, 7)` ; bornes `[mois-01, 1er du mois suivant[` par `jourVersDate` ; contexte ; `findMany({ where: { pointDeVenteId, jourMetier: { gte, lt } }, include: ..., orderBy: { jourMetier: 'asc' } })` ; noms par `nomsUtilisateurs` ; message `` `${n} clôture(s) en ${mois}.` ``.

### 6. `src/pharmacie/caisse/clotures.controller.ts` (nouveau)

`@ApiTags('Pharmacie : clôture')`, `@ApiBearerAuth()`, `@Controller('pharmacie')`, `@UseGuards(AuthGuard, PermissionsGuard)`, chaque route `@RequirePermissions(PERMISSIONS.CLOTURE_GERER)` :

- `@Get(':structureId/caisse/clotures/:jour/preparation')` : `preparer(structureId, req.user.userId, jour)`. Swagger : « Préparation de la clôture d'une journée : sessions, caisses encore ouvertes, postes attendus nommés (session ouverte, ventes à envoyer, synchro incomplète, D616), totaux par mode des caisses fermées, peutCloturer, peutForcer ; pour une journée clôturée, la clôture. 400 VALIDATION (dateValide, jourFutur), 400 JOUR_AVANT_DEBUT_CAISSE. »
- `@Post(':structureId/caisse/clotures')`, `@HttpCode(HttpStatus.OK)`, corps `CloturerJourneeDto`, `@Ip() ip` : `cloturer(structureId, req.user.userId, dto, ip)`. Swagger : « Clôture la journée : caisses fermées incluses, totaux par mode figés. 409 CLOTURE_INCOMPLETE (details : postes attendus) sans forcer ; forcer avec motif (400 MOTIF_REQUIS) seulement si tous les postes attendus sont des postes desktop, sinon 409 CAISSES_A_FERMER ; 409 JOURNEE_DEJA_CLOTUREE. »
- `@Get(':structureId/caisse/clotures')`, `@Query() query: ListerCloturesQueryDto` : `lister(...)`. Swagger : « Clôtures du mois (AAAA-MM, défaut mois en cours). »

### 7. `src/pharmacie/pharmacie.module.ts`

`ClotureController` dans `controllers` (après `RapportsController`), `ClotureService` dans `providers` (après `RapportsService`). Rien d'autre.

### 8. Codes d'erreur et filtre

`src/common/filters/codes-erreur.ts`, ajouter à la fin de `CODES_ERREUR`, avec un commentaire d'une ligne chacun :

- `'JOURNEE_CLOTUREE'` : journée clôturée, plus aucune écriture n'y est possible ; la correction se fait sur la journée en cours (409).
- `'JOURNEE_DEJA_CLOTUREE'` : journée déjà clôturée (409).
- `'CLOTURE_INCOMPLETE'` : postes attendus avant la clôture (409), postes dans `details`.
- `'CAISSES_A_FERMER'` : caisses ouvertes sur un navigateur, à fermer même pour forcer la clôture (409), caisses dans `details`.
- `'JOUR_AVANT_DEBUT_CAISSE'` : journée antérieure à la mise en place de la caisse, non clôturable (400).

`src/common/filters/all-exceptions.filter.ts` : ajouter `'CLOTURE_INCOMPLETE'` et `'CAISSES_A_FERMER'` à `CODES_AVEC_DETAILS` ; dans `assainirDetails`, après la recopie de `demande`, recopier les clés chaînes (`typeof === 'string'`) `posteId`, `posteCode`, `libelle`, `type`, `raison`, `sessionId`, `utilisateurNom`, `dernierContactLe`, `message` ; une valeur nulle ou d'un autre type n'est pas recopiée. Rien d'autre ne change.

### 9. Inventaire CA22 (D606, D623)

- `test/etancheite-couts/routes-pharmacie.ts` : ajouter `'GET /pharmacie/:structureId/caisse/clotures/:jour/preparation'`, `'POST /pharmacie/:structureId/caisse/clotures'`, `'GET /pharmacie/:structureId/caisse/clotures'`, chacune `{ classe: J, porteCout: false, exigeMarge: false }`.
- `test/db/etancheite-couts.db-spec.ts` : constante de module après `jour` : `const JOUR_CLOTURE: Record<Profil, () => string> = { titulaire: () => jour(-10), vendeur: () => jour(-11) };` ; en tête de `preparerDonnees()` : `await sql('UPDATE "ParametresPharmacie" SET "debutCaisse" = now() - interval \'60 days\' WHERE "structureId" = $1', [S]);` ; trois entrées d'`APPELS` : préparation `GET /pharmacie/${S}/caisse/clotures/${JOUR_CLOTURE[c.profil]()}/preparation`, clôture `POST /pharmacie/${S}/caisse/clotures` corps `{ jour: JOUR_CLOTURE[c.profil]() }`, liste `GET /pharmacie/${S}/caisse/clotures?mois=${JOUR_CLOTURE[c.profil]().slice(0, 7)}`. Chaque profil clôture un jour sans activité différent (la journée vide se clôture, D620). Rien d'autre ne change dans ces deux fichiers.

### 10. Tests unitaires

`src/pharmacie/jour-metier.spec.ts` (nouveau, 4 tests) :
1. `lendemain('2026-10-30')` = `'2026-10-31'`, `('2026-10-31')` = `'2026-11-01'`, `('2026-12-31')` = `'2027-01-01'`, `('2028-02-28')` = `'2028-02-29'`.
2. `joursAvant('2026-11-03', 7)` = `'2026-10-27'`, `joursAvant('2026-10-30', 0)` = `'2026-10-30'`.
3. `jourLisible('2026-10-05')` = `'05/10/2026'`.
4. `instantLisible(new Date('2026-10-30T09:05:00.000Z'))` = `'30/10/2026 à 09:05'`.

`src/pharmacie/caisse/cloture-regles.spec.ts` (nouveau, 9 tests ; `debutJour = new Date('2026-10-30T00:00:00.000Z')`, fabrique `poste(o)` avec défauts `type: 'DESKTOP'`, `actif: true`, `dernierContactLe: null`, `dernierEtat: null`) :
1. `lireFileVide` : `{ fileVide: true }` vrai, `{ fileVide: false }` faux, `null`, `[]`, `{}`, `{ fileVide: 'non' }`, `'x'` : `null`.
2. « session ouverte, web et desktop » : W1 et D1 portent chacun une session ouverte : deux entrées `SESSION_OUVERTE` avec `sessionId`, `utilisateurNom`, messages exacts des deux variantes, triées D1 puis W1.
3. « file non vide » : D2 actif, `dernierEtat: { fileVide: false }`, contact le 29 à 18:00 : `FILE_NON_VIDE`, `sessionId` null, message contient `29/10/2026 à 18:00` ; même poste inactif : aucune entrée.
4. « synchro incomplète » : D3 dans `postesAyantVendu`, contact le 29 à 23:00 avec file vide : `SYNCHRO_INCOMPLETE` ; contact nul : message contient `jamais`.
5. « synchro complète depuis le début du jour » : D4 dans `postesAyantVendu`, contact le 30 à 08:00, `{ fileVide: true }` : aucune entrée ; même contact sans `dernierEtat` (file inconnue) : `SYNCHRO_INCOMPLETE`.
6. « poste qui n'a pas vendu » : D5 hors `postesAyantVendu`, jamais contacté : aucune entrée ; W2 web sans session, file non vide : aucune entrée.
7. « priorité » : D6 avec session ouverte et `{ fileVide: false }` : une seule entrée, `SESSION_OUVERTE`.
8. `forcageAutorise` : `[]` faux ; desktop seuls vrai ; un web parmi eux faux ; `versPosteManquant` retire `message` et garde les 8 clés.
9. `totauxCloture` : deux sessions, ESPECES (ordre 1) théoriques 300 000 et 100 000, comptés 290 000 et 100 000 ; ORANGE_MONEY (ordre 2) 50 000 compté 50 000 et 0 compté nul ; MTN_MOMO (ordre 3) 20 000 compté nul : ESPECES `{ theorique: 400000, compte: 390000, ecart: -10000, sessionsNonRapprochees: 0 }`, ORANGE_MONEY `{ 50000, 50000, 0, 0 }` (le théorique nul non relevé compte 0), MTN_MOMO `{ 20000, null, null, 1 }` ; ordre des modes ESPECES, ORANGE_MONEY, MTN_MOMO même si l'entrée est mélangée ; `totauxCloture([])` = `[]`.

`src/pharmacie/caisse/clotures.http.spec.ts` (nouveau, 8 tests ; module calqué sur `sessions-caisse.http.spec.ts`, `ClotureService` simulé `{ preparer, cloturer, lister }`, `AllExceptionsFilter` global, `ValidationPipe` du projet ; profils `titulaire` (`cloture:gerer`), `vendeur` (`caisse:utiliser`, `caisse:superviser`)) :
1. vendeur `GET /pharmacie/s1/caisse/clotures/2026-10-30/preparation` : 403, service non appelé.
2. titulaire, même route : 200, `preparer` appelé avec `('s1', 'titulaire', '2026-10-30')`.
3. titulaire `POST /pharmacie/s1/caisse/clotures` `{ jour: '2026-10-30', forcer: true, motifForcage: '  Poste D1 en panne  ' }` : 200, `cloturer` appelé avec `('s1', 'titulaire', { jour: '2026-10-30', forcer: true, motifForcage: 'Poste D1 en panne' }, expect.anything())`.
4. `{ jour: '30/10/2026' }` : 400, `code` `VALIDATION`, `champs` contient `{ champ: 'jour', contraintes: ['matches'] }`.
5. `{ jour: '2026-10-30', forcer: 'oui' }` : 400 `VALIDATION`, champ `forcer`, `isBoolean` ; `{ jour: '2026-10-30', autre: 1 }` : 400.
6. `GET /pharmacie/s1/caisse/clotures?mois=2026-13` : 400 `VALIDATION`, champ `mois`, `matches` ; `?mois=2026-10` : 200, `lister` appelé avec `('s1', 'titulaire', { mois: '2026-10' })`.
7. `cloturer` rejette `new ConflictException({ code: 'CLOTURE_INCOMPLETE', message: 'm', details: [{ posteId: 'p1', posteCode: 'D1', libelle: 'Poste D1', type: 'DESKTOP', raison: 'SESSION_OUVERTE', sessionId: 's-1', utilisateurNom: 'Mamadou Diallo', dernierContactLe: null, message: 'La caisse...', secret: 'x' }] })` : 409, `body.code` `CLOTURE_INCOMPLETE`, `body.details` égal à `[{ posteId: 'p1', posteCode: 'D1', libelle: 'Poste D1', type: 'DESKTOP', raison: 'SESSION_OUVERTE', sessionId: 's-1', utilisateurNom: 'Mamadou Diallo', message: 'La caisse...' }]`.
8. `cloturer` rejette `ConflictException({ code: 'JOURNEE_DEJA_CLOTUREE', message: 'La journée du 30/10/2026 est déjà clôturée.', details: [{ posteId: 'p1' }] })` : 409, message conservé, pas de `details`.

`src/common/filters/all-exceptions.filter.spec.ts` : un test ajouté, calqué sur « LOT_REQUIS recopie les lots » : 409 `CAISSES_A_FERMER` avec un élément portant les 9 clés chaînes, `dernierContactLe` nul et une clé `secret` : `details` = les 8 clés chaînes non nulles, sans `dernierContactLe` ni `secret`.

### 11. `test/db/clotures.db-spec.ts` (nouveau, 13 tests)

Préparation calquée sur `test/db/sessions-caisse.db-spec.ts` (base vide, migrations jusqu'à `DERNIERE_MIGRATION_FORMAT_ACTUEL`, `chargerFormatActuel`, migrations après ; services à la main : `AccesPharmacieService`, `SessionsCaisseService` (permissions simulées : `RESPONSABLE` a `caisse:utiliser`, `caisse:superviser`, `cloture:gerer` ; `VENDEUR` a `caisse:utiliser`), `PointsDeVenteService`, `ClotureService`). Constantes `PHARMACIE = 'str-pharma-1'`, `VENDEUR = 'usr-pharm-p1'`, `RESPONSABLE = 'usr-admin-p1'`, `AUTRE = 'usr-admin-p2'`. Recopier `refus`, `sql`, `compter`, `nouveauPoste` (paramètre `type` ajouté, défaut `'WEB'`), `coupures`, `ouvrirSession`, `venteSql`, `paiementSql`, `venteEncaissee`. `jour(n)` = jour UTC décalé de n jours. Dans le `beforeAll`, après les migrations : `UPDATE "ParametresPharmacie" SET "debutCaisse" = now() - interval '30 days' WHERE "structureId" = 'str-pharma-1'`. `pv1` = point de vente d'ordre 1.

Aides propres au fichier :
- `sessionSql({ posteId, jourMetier, statut, utilisateurId = VENDEUR, utilisateurNom = 'Mamadou Diallo' })` : `INSERT INTO "SessionCaisse" ("id","pointDeVenteId","posteId","utilisateurId","utilisateurNom","jourMetier","ouverteLe","evenementOuvertureId") VALUES ($1,$2,$3,$4,$5,$6::date,$6::date + time '08:00',$1)` puis, si `statut` vaut `FERMEE` : `UPDATE "SessionCaisse" SET "statut" = 'FERMEE', "fermeeLe" = "ouverteLe" + interval '10 hours', "evenementFermetureId" = 'fermeture:' || "id" WHERE "id" = $1` ; renvoie l'identifiant (`ses-essai-<uuid>`).
- `resultatSql(sessionId, codeMode, theorique, compte)` : `INSERT INTO "ResultatSessionMode" ("id","sessionCaisseId","modePaiementId","theorique","compte","ecart") SELECT $1,$2,m."id",$4,$5,CASE WHEN $5::int IS NULL THEN NULL ELSE $5::int - $4::int END FROM "ModePaiement" m WHERE m."code" = $3`.
- `preparer(j)` = `clotures.preparer(PHARMACIE, RESPONSABLE, j)`, `cloturer(dto)` = `clotures.cloturer(PHARMACIE, RESPONSABLE, dto, '127.0.0.1')`.

Les tests s'exécutent dans l'ordre du fichier ; le test 13 reste le dernier (il crée des postes desktop qui seraient attendus ailleurs).

1. « journée vide » : `preparer(jour(-20))` : `cloture` null, `sessions` `[]`, `postesAttendus` `[]`, `totaux` `[]`, `peutCloturer` vrai, `peutForcer` faux.
2. « jours refusés » : `jour(-31)` : 400 `JOUR_AVANT_DEBUT_CAISSE` (message contient `jourLisible(jour(-30))`) ; `jour(1)` : 400 `VALIDATION`, contrainte `jourFutur` ; `'2026-02-30'` : contrainte `dateValide` ; les trois aussi par `cloturer` ; aucune ligne `ClotureJournaliere`.
3. « clôture complète d'aujourd'hui » : poste web, `ouvrirSession(poste, VENDEUR, { 20000: 5 })` (fond 100 000) ; `venteEncaissee(s, 200000)` ; `venteEncaissee(s, 50000, 'ORANGE_MONEY')` ; fermeture par `sessions.fermer(PHARMACIE, VENDEUR, s, { comptageFermeture: { coupures: coupures({ 20000: 14, 10000: 1 }), releves: [{ mode: 'ORANGE_MONEY', montant: 50000 }] }, commentaire: 'Billet de 10 000 manquant' })` (compté 290 000, théorique 300 000) ; `preparer(jour(0))` : la session en `sessions` avec statut `FERMEE`, `postesAttendus` `[]`, `peutCloturer` vrai, totaux ESPECES `{ theorique: 300000, compte: 290000, ecart: -10000, sessionsNonRapprochees: 0 }` et ORANGE_MONEY `{ 50000, 50000, 0, 0 }` ; `cloturer({ jour: jour(0) })` : message `Journée du <jl> clôturée.`, `forcee` faux, `motifForcage` null, `postesManquants` `[]`, `nombreSessions` 1, `totaux` égaux à ceux de la préparation sans `sessionsNonRapprochees`, `clotureParNom` `'Fatoumata Camara'` (responsable de la fixture) ; en base : session `INCLUSE_DANS_CLOTURE` avec `clotureJournaliereId` ; lignes `TotalClotureMode` égales ; une ligne `AuditLog` `create` `ClotureJournaliere` dont `metadata` vaut `{ jour, forcee: false, nombreSessions: 1, postesManquants: [] }`.
4. « préparation d'une journée clôturée » : `preparer(jour(0))` : `cloture.id` celui du test 3, `peutCloturer` faux, `peutForcer` faux, `postesAttendus` `[]`, `totaux` identiques (ESPECES et ORANGE_MONEY).
5. « déjà clôturée » : `cloturer({ jour: jour(0) })` : 409 `JOURNEE_DEJA_CLOTUREE`, message `La journée du <jl> est déjà clôturée.` ; toujours une seule clôture pour ce jour.
6. « aide de journée » : `jourDeRattachement(prisma, pv1, new Date())` = `{ jour: lendemain(jour(0)), jourReel: jour(0) }` ; `exigerJourOuvert(prisma, pv1, jour(0))` rejette 409 `JOURNEE_CLOTUREE` avec `messageJourneeCloturee(jour(0))` ; `exigerJourOuvert(prisma, pv1, jour(-5))` résout ; `jourDeRattachement(prisma, pv1, new Date(Date.now() - 86_400_000))` = `{ jour: jour(-1), jourReel: jour(-1) }`.
7. « clôture incomplète : poste desktop avec caisse ouverte » : poste `DESKTOP` D (via `postes.enregistrerPoste(PHARMACIE, RESPONSABLE, { type: 'DESKTOP', appareilId })`), `sessionSql({ posteId: D, jourMetier: jour(-5), statut: 'OUVERTE' })` ; poste web W, `sessionSql` FERMEE au même jour avec `resultatSql(.., 'ESPECES', 80000, 80000)` ; `preparer(jour(-5))` : `postesAttendus` = une entrée `{ posteId: D, type: 'DESKTOP', raison: 'SESSION_OUVERTE', sessionId, utilisateurNom: 'Mamadou Diallo' }`, `peutCloturer` faux, `peutForcer` vrai, `sessionsOuvertes` de longueur 1 ; `cloturer({ jour: jour(-5) })` : 409 `CLOTURE_INCOMPLETE`, message exact `La journée du <jl> ne peut pas encore être clôturée. Poste à attendre : <libellé de D> (caisse de Mamadou Diallo).` (D627), `details` de longueur 1 avec `raison` `SESSION_OUVERTE` ; aucune ligne `ClotureJournaliere` pour ce jour, la session web reste `FERMEE`.
8. « forcer sans motif » : `cloturer({ jour: jour(-5), forcer: true })` et `motifForcage: '  a '` : 400 `MOTIF_REQUIS`, rien écrit.
9. « CA21 : clôture forcée qui enregistre le poste manquant » : `cloturer({ jour: jour(-5), forcer: true, motifForcage: 'Poste D en panne' })` : `forcee` vrai, `motifForcage` `'Poste D en panne'`, `postesManquants` = `[{ posteId: D, posteCode, libelle, type: 'DESKTOP', raison: 'SESSION_OUVERTE', sessionId, utilisateurNom: 'Mamadou Diallo', dernierContactLe: null }]` (8 clés exactement, sans `message`), message contient `clôturée sans 1 poste(s) : <libellé de D> (caisse de Mamadou Diallo).` (D627) ; en base : la session desktop reste `OUVERTE` avec `clotureJournaliereId` nul, la session web `INCLUSE_DANS_CLOTURE`, un seul `TotalClotureMode` ESPECES `{ theorique: 80000, compte: 80000, ecart: 0 }` ; `nombreSessions` 1 ; l'audit porte `postesManquants: [<code de D>]` et aucune clé `motif`.
10. « une caisse web ouverte bloque même en forçant » : poste web W2, `sessionSql({ posteId: W2, jourMetier: jour(-6), statut: 'OUVERTE' })` ; `preparer(jour(-6))` : `peutForcer` faux, entrée `type` `WEB` ; `cloturer({ jour: jour(-6) })` : 409 `CLOTURE_INCOMPLETE` ; `cloturer({ jour: jour(-6), forcer: true, motifForcage: 'Vendeur parti' })` : 409 `CAISSES_A_FERMER`, message `messageCaissesAFermer(...)` qui contient `Mamadou Diallo (` ; rien écrit.
11. « forcer sans poste attendu » : `cloturer({ jour: jour(-7), forcer: true, motifForcage: 'Par précaution' })` : 200, `forcee` faux, `motifForcage` null, message de la variante « n'a pas eu besoin d'être forcée ».
12. « deux clôtures simultanées » : `Promise.allSettled([cloturer({ jour: jour(-8) }), cloturer({ jour: jour(-8) })])` : une réussite, un rejet 409 `JOURNEE_DEJA_CLOTUREE` ; une seule ligne pour ce jour. Puis « la clôture attend une écriture en cours » : transaction de test qui prend `verrouillerJourneesPartage(tx, PHARMACIE)` et attend une promesse ; `cloturer({ jour: jour(-9) })` lancé ; attente observée (`pg_locks`, `locktype = 'advisory' AND NOT granted`, au moins 1, aide `attendreAttentes` recopiée de `qualification.db-spec.ts`) ; la clôture n'est pas résolue tant que la transaction de test tient le verrou ; libération : la clôture réussit. Liste : `lister(PHARMACIE, RESPONSABLE, { mois: jour(0).slice(0, 7) })` contient la clôture du test 3, triée par jour ; `lister` du mois de `jour(-8)` contient `jour(-8)` ; `AUTRE` sur `PHARMACIE` : 403.
13. « règles des postes attendus en base » (dernier) : `D2` desktop actif, `UPDATE "Poste" SET "dernierEtat" = '{"fileVide": false}', "dernierContactLe" = now() - interval '1 day'` : `preparer(jour(-12))` le liste `FILE_NON_VIDE` ; `D3` desktop actif avec une session FERMEE de `jour(-14)` (sessionSql) et une vente SQL sur cette session (`venteSql`), jamais contacté : `preparer(jour(-12))` le liste `SYNCHRO_INCOMPLETE` ; `UPDATE "Poste" SET "dernierContactLe" = now(), "dernierEtat" = '{"fileVide": true}' WHERE id = D3` : il n'est plus listé ; `D2` passé inactif (`actif = false`) : plus listé ; la session technique de reprise (`technique` vrai) n'apparaît dans aucune préparation (`preparer` du `jourMetier` de la session technique s'il est >= `jour(-30)`, sinon assertion sautée et commentée).

### 12. `CLAUDE.md` du dépôt back

Ajouter une puce après celle de PB16b : « **Clôture journalière (tranche pharmacie 1, PB17a)** : `GET /pharmacie/:structureId/caisse/clotures/:jour/preparation`, `POST /pharmacie/:structureId/caisse/clotures` (`{ jour, forcer?, motifForcage? }`, 200) et `GET .../caisse/clotures?mois=AAAA-MM` (`cloture:gerer`). Jours clôturables de `debutCaisse` à aujourd'hui, dans n'importe quel ordre, journée vide comprise (400 `JOUR_AVANT_DEBUT_CAISSE`, 400 `VALIDATION` `jourFutur`). Postes attendus (D616) : caisse encore ouverte sur le jour, poste desktop à file non vide, poste desktop qui a vendu dans les 7 jours sans synchro complète depuis le début du jour ; 409 `CLOTURE_INCOMPLETE` (postes dans `details`). Forcer exige un motif (400 `MOTIF_REQUIS`) et n'est permis que si tous les postes attendus sont desktop : une caisse ouverte sur un navigateur se ferme avec le comptage (409 `CAISSES_A_FERMER`). La clôture passe les caisses fermées du jour en `INCLUSE_DANS_CLOTURE`, fige `TotalClotureMode` (compté nul si une caisse n'a pas de relevé pour un mode qu'elle a encaissé) et consigne les postes manquants (`posteId`, `posteCode`, `libelle`, `type`, `raison`, `sessionId`, `utilisateurNom`, `dernierContactLe`) ; une caisse desktop ouverte reste ouverte. 409 `JOURNEE_DEJA_CLOTUREE`. Verrou consultatif de journée `medconnecte:journees:<structureId>` pris en exclusif en tête de la clôture (`src/pharmacie/caisse/journee.ts`, D613). »

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell ni par script (ni `cat >`, ni `tee`, ni `sed -i`, ni `node -e`, ni `python`) : le hook de garde ne voit pas les écritures faites par Bash. Ne jamais afficher ni écrire une URL de base, un mot de passe ou une valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh` (fins de ligne seulement, jamais commité). Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés (et seulement eux) : `src/pharmacie/jour-metier.ts`, `src/pharmacie/jour-metier.spec.ts`, `src/pharmacie/caisse/journee.ts`, `src/pharmacie/caisse/cloture-regles.ts`, `src/pharmacie/caisse/cloture-regles.spec.ts`, `src/pharmacie/caisse/clotures.service.ts`, `src/pharmacie/caisse/clotures.controller.ts`, `src/pharmacie/caisse/clotures.http.spec.ts`, `src/pharmacie/dto/clotures.dto.ts`, `src/pharmacie/pharmacie.module.ts`, `src/common/filters/codes-erreur.ts`, `src/common/filters/all-exceptions.filter.ts`, `src/common/filters/all-exceptions.filter.spec.ts`, `test/etancheite-couts/routes-pharmacie.ts`, `test/db/etancheite-couts.db-spec.ts`, `test/db/clotures.db-spec.ts`, `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint` sur les fichiers autorisés `.ts` : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, dont `jour-metier.spec.ts` (4), `cloture-regles.spec.ts` (9), `clotures.http.spec.ts` (8), le test ajouté au filtre, et `etancheite-couts.spec.ts` (inventaire égal aux routes découvertes).
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/clotures.db-spec.ts` (13) et `test/db/etancheite-couts.db-spec.ts` (avec les trois routes) ; les autres db-specs verts et inchangés.
5. `git status --porcelain` (depuis `back_medconnect`) ne liste que les fichiers autorisés (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes src/pharmacie/vente.service.ts src/pharmacie/caisse/sessions-caisse.service.ts src/pharmacie/receptions` vide.
6. Règles pures : `grep -n "new Date(\|Date.now\|@nestjs\|generated/prisma" src/pharmacie/caisse/cloture-regles.ts` : aucune ligne ; `grep -n "new Date()\|Date.now" src/pharmacie/jour-metier.ts` : aucune ligne.
7. Verrou en tête : dans `clotures.service.ts`, `verrouillerJourneesExclusif` est la première instruction de la transaction de `cloturer` (relecture du chef).
8. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-31 | dur (codeur Sonnet, vérificateur Sonnet) | PASS, validé par le chef (rapports/PB17a-verification.md, rapports/PB17a-chef.md) | remarque 1 : test db 4 compare aussi ORANGE_MONEY ; remarque 2 : messages de clôture incomplète et de clôture forcée nommés par libellé du poste et vendeur (D627) ; remarque 3 (`utilisateurId` vide sans utilisateur) laissée, sans effet

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
docker compose exec -T backend npx tsc --noEmit | 0 erreur | voir commit
docker compose exec -T backend npx eslint (16 fichiers .ts de la fiche) | 0 erreur, 0 avertissement | voir commit
docker compose exec -T backend npm test | 94 suites, 1024 réussis, 3 ignorés, 0 échec | voir commit
docker compose exec -T backend npm run test:db | 27 suites, 322 réussis, 0 échec | voir commit
