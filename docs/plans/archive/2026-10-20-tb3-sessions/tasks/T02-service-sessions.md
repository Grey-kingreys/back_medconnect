# T02 - Service de sessions, codes d'erreur et drapeau

Tier: spécifié (agent implementeur-specifie)
Audience: non-dev pour les messages d'erreur (affichés au patient), dev pour le reste
Visuel: n/a
Background-safe: non, car docker compose exec sur l'arbre principal

Arbre de travail : `D:/souleymane/perso-archive-20260923/perso/medconnecte/back_medconnect`, branche `orch/tb3-sessions`. Ne commite pas : l'orchestrateur commite. Commandes `docker compose` lancées depuis `D:/souleymane/perso-archive-20260923/perso/medconnecte` ; le dépôt back est monté sur `/app` dans le conteneur `backend`.

Prérequis : T01 fait (modèle `Session` et enum `SessionClientType` dans `prisma/schema.prisma`, client Prisma régénéré). L'enum s'importe par `import { SessionClientType } from 'generated/prisma/enums';` (même forme que `Role` dans `src/demo/demo-mode.ts`).

## Spec

Lot TB3. Lire d'abord `docs/plans/runs/2026-10-20-tb3-sessions/decisions.md` (D02 à D07, D10, D12). Cette tâche crée le service de sessions et ses briques, SANS le brancher sur les routes (ce sera T03 et T04). `src/auth/auth.service.ts`, `src/auth/auth.controller.ts` et `src/structure/` ne sont PAS modifiés ici.

### 1. Catalogue des codes d'erreur : nouveau fichier `src/common/filters/codes-erreur.ts`

```ts
/**
 * Codes machine stables, renvoyés dans le champ `code` du corps d'erreur et lus
 * par l'application mobile. Le web ne lit que `message`. TB2 complétera ce catalogue.
 */
export const CODES_ERREUR = [
  'SESSION_EXPIREE',
  'SESSION_REVOQUEE',
  'REFRESH_REUTILISE',
  'COMPTE_DESACTIVE',
  'VALIDATION',
] as const;

export type CodeErreur = (typeof CODES_ERREUR)[number];

export function estCodeErreur(valeur: unknown): valeur is CodeErreur {
  return (
    typeof valeur === 'string' &&
    (CODES_ERREUR as readonly string[]).includes(valeur)
  );
}
```

### 2. Filtre global : `src/common/filters/all-exceptions.filter.ts`

- `interface CorpsErreur` gagne `code?: CodeErreur;`.
- Dans la branche `exception instanceof HttpException` (statut < 500 seulement), lire `code` dans l'objet de réponse quand `getResponse()` est un objet : `(reponse as { code?: unknown }).code`. Calculer le corps exactement comme aujourd'hui (aucune règle existante ne change), puis, si `estCodeErreur(code)`, ajouter `code` au corps renvoyé. Le plus simple : stocker le résultat des branches existantes dans une variable au lieu de `return` direct, ou extraire le calcul actuel dans une méthode privée `corpsHttp(exception)` et faire `const resultat = this.corpsHttp(exception); if (estCodeErreur(code)) resultat.code = code; return resultat;`. Pas d'autre changement.
- Le code n'est JAMAIS ajouté pour une erreur 500 ou une erreur Prisma.

Ajouter dans `src/common/filters/all-exceptions.filter.spec.ts` (sans modifier les tests existants) :
- `new UnauthorizedException({ message: 'Message projet', code: 'REFRESH_REUTILISE' })` donne `{ statusCode: 401, message: 'Message projet', error: 'Connexion expirée', code: 'REFRESH_REUTILISE' }` ;
- un code hors catalogue (`'INCONNU'`) n'apparaît pas dans le corps ;
- une exception à message texte simple n'a pas de champ `code`.

### 3. Drapeau : `src/config/env.validation.ts`

Ajouter à `RULES`, après `DEMO_RESET`, une règle sur le modèle de `DEMO_MODE` :

```ts
  // Sessions par appareil (TB3). Actives par défaut ; `false` revient à l'ancien
  // refresh unique par utilisateur (retour arrière, sans redéploiement).
  {
    key: 'SESSIONS_MULTI_APPAREILS',
    required: false,
    default: 'true',
    validate: (v) =>
      ['true', 'false'].includes(v.toLowerCase())
        ? null
        : "doit valoir 'true' ou 'false'",
  },
```

Ajouter dans `src/config/env.validation.spec.ts` : absente, la variable prend `'true'` ; `'peut-etre'` est refusée ; `'FALSE'` est acceptée. Suivre le style des tests existants du fichier.

### 4. Constantes : nouveau fichier `src/auth/sessions.constants.ts`

```ts
import { SessionClientType } from 'generated/prisma/enums';

/** Fenêtre de grâce de l'ancien refresh après rotation (refresh concurrents, réponse perdue). */
export const GRACE_REFRESH_MS = 30_000;
/** Durée de vie du jeton d'accès. */
export const DUREE_ACCES = '15m';
export const DUREE_ACCES_SECONDES = 15 * 60;
/** Session glissante de 30 jours (web tous rôles, mobile patient). Q11, révisable. */
export const DUREE_SESSION_LONGUE_MS = 30 * 24 * 60 * 60 * 1000;
/** Session glissante de 12 h (mobile, rôles autres que patient). Q11, révisable. */
export const DUREE_SESSION_COURTE_MS = 12 * 60 * 60 * 1000;
export const NOM_COOKIE_REFRESH = 'refresh_token';

export type RaisonRevocation = 'DECONNEXION' | 'REUTILISATION' | 'NOUVELLE_CONNEXION';

/** Messages affichés à l'utilisateur final (audience non-dev). */
export const MESSAGES_SESSION = {
  expiree: 'Votre connexion a expiré, reconnectez-vous.',
  revoquee: 'Vous avez été déconnecté. Reconnectez-vous pour continuer.',
  reutilisee:
    "Vous avez été déconnecté. Si ce n'est pas vous, changez votre mot de passe.",
  compteDesactive: "Votre compte a été désactivé. Contactez l'administrateur.",
  appareilManquant: "Mettez à jour l'application pour vous connecter.",
} as const;

/** Sessions par appareil actives sauf si SESSIONS_MULTI_APPAREILS vaut `false`. */
export function estSessionsMultiAppareilsActif(
  valeur: string | undefined = process.env.SESSIONS_MULTI_APPAREILS,
): boolean {
  return (valeur ?? '').trim().toLowerCase() !== 'false';
}

/** Durée glissante d'une session selon le type de client et le rôle (Q11, révisable). */
export function dureeSession(clientType: SessionClientType, role: string): number {
  if (clientType === SessionClientType.MOBILE && role !== 'PATIENT') {
    return DUREE_SESSION_COURTE_MS;
  }
  return DUREE_SESSION_LONGUE_MS;
}
```

(Adapter la mise en forme à prettier ; le contenu reste celui-ci.)

### 5. Service : nouveau fichier `src/auth/sessions.service.ts`

`@Injectable() export class SessionsService`, constructeur `(private readonly prisma: PrismaService, private readonly jwtService: JwtService, private readonly encryption: EncryptionService)` (imports : `src/common/services/prisma.service`, `@nestjs/jwt`, `src/common/services/encryption.service`). `private readonly logger = new Logger(SessionsService.name)`.

Types exportés :

```ts
export interface InfosClient {
  type: SessionClientType;
  deviceId?: string;
  plateforme?: string;
  nomAppareil?: string;
  versionApp?: string;
}
export interface UtilisateurJeton {
  id: string;
  role: string;
  structureId?: string | null;
}
export interface JetonsSession {
  access_token: string;
  refreshToken: string;
  expiresIn: number; // secondes, DUREE_ACCES_SECONDES
  sessionId: string | null; // null en mode ancien (drapeau false)
  dureeMs: number; // durée restante de la session, sert au maxAge du cookie
}
```

Fonctions internes (privées au module, non exportées) : `sha256(v: string): string` (hex) ; `egal(a: string, b: string): boolean` qui compare deux hex par `crypto.timingSafeEqual` après contrôle de longueur ; `nouveauSecret()` = `crypto.randomBytes(32).toString('hex')` ; `erreur(code: CodeErreur, message: string)` qui renvoie `new UnauthorizedException({ message, code })`.

Format du refresh : `` `${session.id}.${secret}` ``. Analyse : `/^([0-9a-f-]{36})\.([0-9a-f]{64})$/i`.

Méthodes publiques :

**`signerAcces(payload: { userId: string; role: string; structureId?: string; sid?: string }): string`**
`this.jwtService.sign(payload, { secret: process.env.JWT_SECRET, expiresIn: DUREE_ACCES })`. N'inclure `structureId` et `sid` que s'ils sont définis.

**`async ouvrir(user: UtilisateurJeton, client: InfosClient): Promise<JetonsSession>`**
- Drapeau inactif (`!estSessionsMultiAppareilsActif()`) : ancien comportement. `refresh = crypto.randomBytes(40).toString('hex')` ; `prisma.user.update({ where: { id: user.id }, data: { refreshToken: sha256(refresh), refreshTokenExpires: new Date(Date.now() + DUREE_SESSION_LONGUE_MS) } })` ; retourner `{ access_token: signerAcces({ userId, role, structureId: user.structureId ?? undefined }), refreshToken: refresh, expiresIn, sessionId: null, dureeMs: DUREE_SESSION_LONGUE_MS }`. Aucun accès à `prisma.session`.
- Sinon :
  1. si `client.type === MOBILE` et `client.deviceId` : `prisma.session.updateMany({ where: { userId: user.id, deviceId: client.deviceId, revokedAt: null }, data: { revokedAt: maintenant, revokedReason: 'NOUVELLE_CONNEXION' } })` ;
  2. `secret = nouveauSecret()`, `dureeMs = dureeSession(client.type, user.role)` ;
  3. `prisma.session.create({ data: { userId, clientType: client.type, platform, deviceId, deviceName: nomAppareil, appVersion: versionApp, refreshHash: sha256(secret), expiresAt: maintenant + dureeMs } })` ; pour un client WEB, `platform`, `deviceId`, `deviceName`, `appVersion` valent `null` ;
  4. retourner `{ access_token: signerAcces({ userId, role, structureId: user.structureId ?? undefined, sid: session.id }), refreshToken: `${session.id}.${secret}`, expiresIn: DUREE_ACCES_SECONDES, sessionId: session.id, dureeMs }`.

**`async renouveler(refresh: string, clientType: SessionClientType): Promise<JetonsSession>`**
- Drapeau inactif : ancien comportement de `AuthService.refreshAccessToken` sans le cookie : `prisma.user.findFirst({ where: { refreshToken: sha256(refresh), refreshTokenExpires: { gt: new Date() }, isActive: true } })` ; absent : `erreur('SESSION_EXPIREE', MESSAGES_SESSION.expiree)` ; sinon nouveau refresh 40 octets, `user.update` du hash et de l'expiration (+30 j), retour `{ access_token, refreshToken, expiresIn, sessionId: null, dureeMs: DUREE_SESSION_LONGUE_MS }`.
- Sinon, dans cet ordre :
  1. analyse du format ; échec : `SESSION_EXPIREE` (aucune lecture en base) ;
  2. `session = prisma.session.findUnique({ where: { id }, include: { user: { select: { id: true, role: true, structureId: true, isActive: true } } } })` ; absente : `SESSION_EXPIREE` ;
  3. contrôles (fonction privée `controler(session, clientType)`, réutilisée en 6) : `session.clientType !== clientType` : `SESSION_EXPIREE` sans révocation ; `revokedAt` non nul : `SESSION_REVOQUEE` (`MESSAGES_SESSION.revoquee`) ; `expiresAt <= maintenant` : `SESSION_EXPIREE` ; `!session.user.isActive` : `COMPTE_DESACTIVE` (`MESSAGES_SESSION.compteDesactive`) ;
  4. `h = sha256(secret)`. Si `egal(h, session.refreshHash)` : rotation. `nouveau = nouveauSecret()`, `dureeMs = dureeSession(session.clientType, session.user.role)`, puis
     `prisma.session.updateMany({ where: { id, refreshHash: h, revokedAt: null }, data: { refreshHash: sha256(nouveau), previousRefreshHash: h, graceUntil: maintenant + GRACE_REFRESH_MS, graceSecretEnc: this.encryption.encrypt(nouveau), lastUsedAt: maintenant, expiresAt: maintenant + dureeMs } })`.
     Si `count === 1` : retourner les jetons (`refreshToken: `${id}.${nouveau}``, `sid: id`, rôle et structure lus sur `session.user`, `dureeMs`).
     Si `count === 0` (un refresh concurrent a tourné entre-temps) : relire la session (même `findUnique`) une seule fois, refaire les contrôles du point 3, puis passer au point 5 avec la session relue.
  5. Grâce : si `session.previousRefreshHash` et `egal(h, session.previousRefreshHash)` et `session.graceUntil > maintenant` : `courant = this.encryption.decrypt(session.graceSecretEnc ?? '')` ; si `courant` ne vérifie pas `/^[0-9a-f]{64}$/` : log warn `Secret de grâce illisible pour la session ${id}` puis `SESSION_EXPIREE`. Sinon `prisma.session.update({ where: { id }, data: { lastUsedAt: maintenant } })` et retourner les jetons avec `refreshToken: `${id}.${courant}`` (le MÊME refresh que celui déjà émis par la rotation) et `dureeMs = expiresAt - maintenant`. Aucune nouvelle rotation.
  6. Sinon, réutilisation : `prisma.session.update({ where: { id }, data: { revokedAt: maintenant, revokedReason: 'REUTILISATION' } })`, `this.logger.warn(`Réutilisation d'un ancien jeton de renouvellement : session ${id} révoquée (utilisateur ${session.userId})`)` (jamais la valeur du jeton), puis `erreur('REFRESH_REUTILISE', MESSAGES_SESSION.reutilisee)`.

**`async fermer(entree: { refresh?: string; sid?: string; userId?: string }): Promise<void>`**
Ne lève jamais d'exception pour un jeton inconnu ou invalide.
- Drapeau inactif : si `userId`, `prisma.user.update({ where: { id: userId }, data: { refreshToken: null, refreshTokenExpires: null } })` ; fin.
- Sinon : identifier la session : (a) si `refresh` a le bon format et que la session existe et que `sha256(secret)` égale `refreshHash`, ou égale `previousRefreshHash` avec `graceUntil > maintenant` : cette session ; (b) sinon si `sid` et `userId` : la session `sid` si son `userId` égale `userId`. Si une session est identifiée : `prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: maintenant, revokedReason: 'DECONNEXION' } })`.

**`poserCookie(res: Response, refreshToken: string, dureeMs: number): void`** : `res.cookie(NOM_COOKIE_REFRESH, refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict', maxAge: dureeMs })` (mêmes options qu'aujourd'hui dans `auth.service.ts`).

**`effacerCookie(res: Response): void`** : `res.clearCookie(NOM_COOKIE_REFRESH)`.

`maintenant` = `new Date()` lu une fois par appel (les tests utilisent `jest.useFakeTimers` et `jest.setSystemTime`).

### 6. Module : `src/auth/auth.module.ts`

Ajouter `SessionsService` à `providers` et à `exports`. `EncryptionService` est fourni globalement par `SecurityModule` : ne pas l'ajouter aux providers. Ne rien changer d'autre (le `expiresIn` est traité en T03).

### 7. Tests : nouveau fichier `src/auth/sessions.service.spec.ts`

Style de `src/auth/auth.service.spec.ts` : instanciation directe `new SessionsService(prisma as never, jwtService as never, encryption as never)`, doublures jest, aucune base. `encryption = { encrypt: jest.fn((v: string) => `chiffre:${v}`), decrypt: jest.fn((v: string) => v.replace(/^chiffre:/, '')) }`. `jwtService = { sign: jest.fn().mockReturnValue('jwt-de-test') }`. `prisma = { session: { create, findUnique, update, updateMany }, user: { update, findFirst } }`. `process.env.JWT_SECRET = 'secret-de-test'` en `beforeAll`. Remettre `process.env.SESSIONS_MULTI_APPAREILS` à `undefined` dans `afterEach`, et `jest.useRealTimers()`.

Cas obligatoires (un `it` chacun au minimum), chaque erreur vérifiée par type `UnauthorizedException` ET par `getResponse()` contenant le `code` attendu :
1. `ouvrir` web : `session.create` reçoit `clientType: 'WEB'`, `refreshHash` = sha256 du secret (jamais le secret), champs appareil `null` ; refresh au format `<id>.<64 hex>` ; `sign` appelé avec `sid` et `expiresIn: '15m'` ; `dureeMs` 30 jours ; aucun `updateMany`.
2. `ouvrir` mobile PATIENT : champs appareil enregistrés ; `updateMany` de révocation `NOUVELLE_CONNEXION` filtré sur `userId` ET `deviceId` ; durée 30 jours.
3. `ouvrir` mobile MEDECIN : durée 12 h.
4. `renouveler` nominal : rotation (`updateMany` filtré sur l'ancien hash, `previousRefreshHash` = ancien hash, `graceUntil` = maintenant + 30 s, `graceSecretEnc` chiffré, `expiresAt` repoussé) ; nouveau refresh différent de l'ancien.
5. Deux refresh simultanés avec le même jeton : premier `updateMany` `{ count: 1 }`, second `{ count: 0 }` puis relecture d'une session déjà tournée (en grâce) : les DEUX appels réussissent et renvoient le MÊME refresh.
6. Réponse perdue : ancien refresh rejoué 10 s après la rotation (en grâce) : succès, refresh courant renvoyé, aucune révocation.
7. Réutilisation hors grâce (ancien refresh rejoué 31 s après) : `update` avec `revokedReason: 'REUTILISATION'`, erreur `REFRESH_REUTILISE`.
8. Secret inconnu sur une session vivante : même révocation, `REFRESH_REUTILISE`.
9. Format invalide : `SESSION_EXPIREE` et `findUnique` jamais appelé ; session absente : `SESSION_EXPIREE` ; session révoquée : `SESSION_REVOQUEE` ; session expirée : `SESSION_EXPIREE` ; compte désactivé : `COMPTE_DESACTIVE` ; session WEB présentée en MOBILE : `SESSION_EXPIREE` sans révocation.
10. Grâce avec secret chiffré illisible (`decrypt` renvoie ` [Donnée illisible] `) : `SESSION_EXPIREE`.
11. Web et mobile en même temps : une session web et une session mobile du même utilisateur ; 24 h plus tard (`jest.setSystemTime`), le renouvellement de chacune réussit ; l'ouverture mobile n'a pas révoqué la session web (le `updateMany` de révocation porte sur le `deviceId`).
12. `fermer` : par refresh valide, révocation `DECONNEXION` ; par `sid` et `userId` concordants ; `sid` d'un autre utilisateur : rien ; refresh inconnu : ne lève rien et ne révoque rien.
13. Drapeau `SESSIONS_MULTI_APPAREILS='false'` : `ouvrir` écrit `user.update` (`refreshToken` haché) sans toucher `prisma.session`, `sessionId` null ; `renouveler` passe par `user.findFirst`.
14. `estSessionsMultiAppareilsActif` et `dureeSession` (dans le même fichier de spec) : absente ou `'true'` actif, `'false'` et `' FALSE '` inactif ; WEB MEDECIN 30 j, MOBILE PATIENT 30 j, MOBILE MEDECIN 12 h.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Commentaires en français, aucun tiret cadratin ni demi-cadratin. Aucun secret réel, jamais de lecture de `.env*`. Les messages destinés à l'utilisateur sont exactement ceux de `MESSAGES_SESSION`. Ne pas toucher `auth.service.ts`, `auth.controller.ts`, `src/structure/`, `src/demo/`.

## Done when

Depuis `D:/souleymane/perso-archive-20260923/perso/medconnecte` :
- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `docker compose exec -T backend npx eslint src/common/filters/codes-erreur.ts src/common/filters/all-exceptions.filter.ts src/common/filters/all-exceptions.filter.spec.ts src/config/env.validation.ts src/config/env.validation.spec.ts src/auth/sessions.constants.ts src/auth/sessions.service.ts src/auth/sessions.service.spec.ts src/auth/auth.module.ts` : 0 erreur.
- `docker compose exec -T backend npx jest src/auth/sessions.service.spec.ts src/common/filters/all-exceptions.filter.spec.ts src/config/env.validation.spec.ts` : tout vert, au moins 20 tests dans `sessions.service.spec.ts`.
- `docker compose exec -T backend npx jest` : toutes les suites passent.
- `git -C back_medconnect status --porcelain` ne liste que les 9 fichiers ci-dessus.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
