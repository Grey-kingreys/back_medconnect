# T05 - Documentation, variable d'environnement et parcours réel web plus mobile

Tier: spécifié (agent implementeur-specifie)
Audience: dev (documentation) ; non-dev vérifié sur les messages renvoyés par l'API
Visuel: n/a
Background-safe: non, car docker compose et appels réels à l'API locale

Arbre de travail : `D:/souleymane/perso-archive-20260923/perso/medconnecte/back_medconnect`, branche `orch/tb3-sessions`. Ne commite rien (ni le back, ni le dépôt racine) : l'orchestrateur commite. Commandes `docker compose` depuis `D:/souleymane/perso-archive-20260923/perso/medconnecte`.

Prérequis : T01 à T04 faits. Lire `docs/plans/runs/2026-10-20-tb3-sessions/decisions.md` en entier.

## Spec

### 1. `back_medconnect/CLAUDE.md`

a) Dans « Conventions importantes (pièges) », juste après la puce **Auth** existante, ajouter une puce **Sessions (TB3)** de 8 à 14 lignes qui dit, sans tiret cadratin ni demi-cadratin :
- une connexion = une ligne `Session` (modèle Prisma) = une famille de refresh ; refresh au format `<sessionId>.<secret>`, seul le sha256 du secret est stocké ; `SessionsService` (`src/auth/sessions.service.ts`) est le seul endroit qui émet, tourne ou révoque un refresh ;
- web : refresh uniquement dans le cookie httpOnly `refresh_token`, jamais dans le JSON ; mobile : en-tête `X-Client: mobile`, `deviceId` et `plateforme` obligatoires à la connexion, refresh envoyé et reçu dans le corps (`refreshToken`, `expiresIn`, `sessionId`), jamais de cookie ;
- rotation à chaque refresh, grâce de 30 s (l'ancien refresh renvoie le refresh courant), réutilisation hors grâce : session révoquée et 401 `REFRESH_REUTILISE` ;
- durées : jeton d'accès 15 min portant `sid` ; sessions glissantes de 30 jours (web, mobile patient) et 12 h (mobile autres rôles), Q11 révisable ;
- `POST /auth/logout` est public (refresh seul ou jeton d'accès) ;
- codes machine du champ `code` : catalogue `src/common/filters/codes-erreur.ts` ;
- hors TB3 (TB4) : liste et révocation des sessions, révocation au changement de mot de passe, contrôle de révocation dans `AuthGuard`.

b) Dans « Variables d'environnement », ajouter à la liste des « Autres » : `SESSIONS_MULTI_APPAREILS` (optionnelle, `true` par défaut, seules `true` ou `false` acceptées au démarrage ; `false` revient à l'ancien refresh unique par utilisateur, cookie seul, en-tête mobile ignoré ; retour arrière sans redéploiement).

c) Dans « Dette/risques spécifiques backend », remplacer la puce **Mobile** (« le refresh ne lit que le cookie... adaptations B01 et B02 ») par : sessions par appareil livrées (TB3) ; reste TB4 (révocation) ; la colonne `User.refreshToken` est conservée une version pour le retour arrière, à supprimer ensuite avec `AuthService.generateTokens` et `generateToken` ; les sessions expirées ou révoquées ne sont pas encore purgées.

### 2. Dépôt racine (D16 : modifier sans commiter)

- `D:/souleymane/perso-archive-20260923/perso/medconnecte/.env.example` : juste après `DEMO_RESET=false`, ajouter
  ```
  # Sessions par appareil (web et téléphones connectés en même temps). false = ancien
  # refresh unique par utilisateur (retour arrière en cas de problème). Défaut : true.
  SESSIONS_MULTI_APPAREILS=true
  ```
- `D:/souleymane/perso-archive-20260923/perso/medconnecte/compose.yml`, service `backend`, bloc `environment`, juste après la ligne `DEMO_RESET: ${DEMO_RESET:-false}` :
  ```
        # Sessions par appareil (TB3). false = ancien refresh unique (retour arrière)
        SESSIONS_MULTI_APPAREILS: ${SESSIONS_MULTI_APPAREILS:-true}
  ```
  (même indentation que les lignes voisines).
- Ne jamais lire ni modifier `.env` réel.

### 3. Parcours réel contre l'API locale (preuve section 14 de docs/ORCHESTRATOR.md)

1. `docker compose up -d backend` puis `docker compose restart backend` ; attendre que `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/auth/verify` renvoie 401 (API prête), en réessayant toutes les 3 s au plus 40 fois.
2. Écrire avec l'outil Write un script bash `D:/tmp/tb3-parcours.sh` (hors dépôt), lancé par `bash D:/tmp/tb3-parcours.sh`, qui utilise `curl` vers `http://localhost:3001` et `node -e` pour lire le JSON (pas de `jq`). Le script :
   - génère un email de test `tb3-<horodatage>@example.test` et un mot de passe de test aléatoire conforme (8 à 50 caractères, une majuscule, une minuscule, un chiffre) ; ne les affiche JAMAIS ;
   - (A) `POST /auth/register` web avec un cookie jar `D:/tmp/tb3-web.cookies` ; vérifie : 201, `data.access_token` présent, `data.refreshToken` ABSENT, cookie `refresh_token` posé ;
   - (B) `POST /auth/login` mobile : en-tête `X-Client: mobile`, corps avec email, mot de passe, `deviceId: "tb3-appareil-test-01"`, `plateforme: "android"`, `nomAppareil: "Test TB3"`, `versionApp: "0.1.0"`, SANS cookie jar ; vérifie 200, présence de `refreshToken`, `expiresIn` = 900, `sessionId`, et absence d'en-tête `Set-Cookie` ;
   - (C) mobile sans `deviceId` : 400 et `code` = `VALIDATION` ;
   - (D) refresh web (cookie jar, sans corps) : 200, `data` sans `refreshToken` ; refresh mobile avec le refresh de (B) : 200, nouveau `refreshToken` R1 ;
   - (E) deux refresh mobiles SIMULTANÉS avec R1 (deux `curl` lancés en arrière-plan, puis `wait`) : les deux 200 et le même `refreshToken` R2 ;
   - (F) GET `/auth/me` avec le jeton d'accès web, puis avec le jeton d'accès mobile : 200 tous les deux (web et mobile connectés en même temps) ;
   - (G) attendre 32 s, rejouer R1 : 401 `code` = `REFRESH_REUTILISE` et `message` = « Vous avez été déconnecté. Si ce n'est pas vous, changez votre mot de passe. » ; puis R2 : 401 `SESSION_REVOQUEE` ; puis refresh web : toujours 200 (la session web n'est pas touchée) ;
   - (H) nouvelle connexion mobile (même `deviceId`), puis `POST /auth/logout` mobile avec seulement `{ refreshToken }` (sans `Authorization`) : 200 ; refresh avec ce même refresh : 401 `SESSION_REVOQUEE` ;
   - (I) logout web (cookie jar et `Authorization: Bearer` du jeton web) : 200 ; refresh web ensuite : 401 ;
   - (J) ancien format de cookie (`refresh_token=` suivi de 80 caractères hex) : 401 `SESSION_EXPIREE` ;
   - affiche une ligne `OK <étape>` ou `ECHEC <étape> : <statut> <code>` par vérification, jamais de jeton ni de mot de passe, et se termine par le nombre d'échecs (code de sortie 0 seulement si 0 échec).
3. Le compte de test reste en base (pas de suppression physique de données) ; noter son email dans le Return pour que l'orchestrateur puisse le désactiver plus tard.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Aucun tiret cadratin ni demi-cadratin. Aucun code applicatif modifié dans cette tâche : si le parcours échoue, NE PAS corriger le code, retourner BLOCKED avec l'étape, le statut, le `code` et la cause probable (fichier et ligne). Aucun secret ni mot de passe dans la sortie, le Return ou un fichier du dépôt.

## Done when

- `grep -c "SESSIONS_MULTI_APPAREILS" back_medconnect/CLAUDE.md` au moins 1, `grep -c "X-Client" back_medconnect/CLAUDE.md` au moins 1, et `grep -n "le refresh ne lit que le cookie" back_medconnect/CLAUDE.md` ne renvoie rien.
- `grep -c "SESSIONS_MULTI_APPAREILS" .env.example compose.yml` : 1 dans chaque (depuis la racine).
- `bash D:/tmp/tb3-parcours.sh` : code de sortie 0, toutes les lignes `OK`, de A à J.
- `docker compose exec -T backend npx jest` : toutes les suites passent ; `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `git -C back_medconnect status --porcelain` ne liste que `CLAUDE.md` ; `git status --porcelain` à la racine ne liste, en plus de l'état initial (`medconnect-ai/`, `medconnect-urgence/`), que `.env.example` et `compose.yml`.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne, dont la dernière ligne du script de parcours) + email du compte de test. Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
