# T02 - Tests unitaires de AuthService

Tier: spécifié (agent implementeur-specifie)
Audience: n/a
Visuel: n/a
Background-safe: oui

Worktree de travail : `D:/souleymane/perso-archive-20260923/perso/medconnecte/.worktrees/back-p3-T02` (branche `task/T02-tests-auth`, node_modules et client Prisma déjà installés). Ne travaille que là. Ne commite pas : l'orchestrateur commite.

## Spec

Point 20 du backlog (socle de tests). Créer **un nouveau fichier** `src/auth/auth.service.spec.ts`. **Ne modifier aucun fichier existant** (ni `auth.service.ts`, ni configuration Jest, ni package.json) : d'autres niveaux modifient l'auth en parallèle.

S'inspirer du style de `src/carnet-sante/carnet-sante.service.spec.ts` : instanciation directe du service avec des doublures (`as never`), pas de module Nest, pas de base de données, pas de réseau. Lire `src/auth/auth.service.ts` en entier et ses dépendances de constructeur.

Couvrir au minimum (comportement **actuel**, sans le juger ; si un comportement paraît être un bug, le tester tel quel et ajouter un commentaire `// Comportement actuel : ...` plutôt que de corriger) :
- `login` : identifiants inconnus refusés ; mot de passe faux refusé (bcrypt réel avec un hash généré dans le test, ou mock de bcrypt) ; compte désactivé ou non validé refusé si le service le gère ; succès : tokens générés, cookie de refresh posé sur `res` (doublure `{ cookie: jest.fn() }`), interaction avec le service anti-brute-force (`login-throttle.service.ts`) si injecté.
- `register` : email déjà pris refusé ; succès : mot de passe haché (jamais stocké en clair), rôle par défaut.
- `refreshAccessToken` : token invalide ou révoqué refusé ; succès : nouveau couple de tokens.
- `logout` : révocation ou effacement du cookie.
- `forgotPassword` : ne révèle pas si l'email existe (même réponse dans les deux cas) si c'est le comportement actuel ; `resetPassword` avec token expiré refusé.
- `generateTokens` : payload attendu (userId, role, structureId selon le code).

Vérifier par les assertions que les messages d'erreur levés sont des exceptions Nest attendues (type) ; ne pas figer le texte complet des messages, seulement le type d'exception.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Commentaires en français. Aucun tiret cadratin ni demi-cadratin. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Aucune valeur de secret réelle : utiliser des chaînes factices (`'secret-de-test'`), ne jamais lire de fichier `.env*`.

## Done when

Dans le worktree :
- `npx --no-install jest src/auth/auth.service.spec.ts` : tous les tests passent, au moins 12 tests.
- `npm test` : toutes les suites passent.
- `npx --no-install tsc --noEmit` : aucune erreur.
- `npx --no-install eslint src/auth/auth.service.spec.ts` : aucune erreur.
- `git status --porcelain` ne montre que `src/auth/auth.service.spec.ts`.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

## Validation
