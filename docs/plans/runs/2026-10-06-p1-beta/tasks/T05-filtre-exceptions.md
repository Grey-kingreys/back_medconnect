# T05 - Point 15 : filtre d'exceptions global en français, sans fuite technique

Tier: dur (agent implementeur-dur)
Audience: non-dev pour le champ `message` (affiché tel quel par le front) ; dev pour le reste de la réponse et les logs
Visuel: n/a
Background-safe: oui

## Spec

Constat (vérifié) : aucun filtre d'exceptions n'existe (`grep -rn "@Catch\|ExceptionFilter" src` : 0 résultat). Conséquences :
- erreurs inattendues (Prisma, réseau, bug) : réponse Nest par défaut `{"statusCode":500,"message":"Internal server error"}` en anglais ;
- erreurs de validation du `ValidationPipe` global (`src/main.ts`) : messages class-validator par défaut en anglais (« motif should not be empty », « property x should not exist ») ; aucun DTO ne définit de message français ;
- limite de débit : « ThrollerException: Too Many Requests » en anglais ; route inconnue : « Cannot GET /x » ; corps trop gros : erreur 413 anglaise.
Le front (`front_medconnect/src/lib/api_auth.ts`, lignes 105 à 120) affiche `body.message` (chaîne, ou premier élément si tableau). Le format de réponse `{ statusCode, message, error }` doit donc être conservé.

Lire avant d'écrire : docs/ORCHESTRATOR.md section 1 et section 14 (termes interdits, vocabulaire utilisateur).

À faire :
1. Créer `src/common/filters/all-exceptions.filter.ts` : un filtre `@Catch()` qui ne traite que le contexte HTTP (`host.getType() === 'http'` ; pour tout autre contexte, ne rien changer au comportement par défaut, par exemple en relançant via `BaseExceptionFilter` ou en retournant sans écrire). Réponse JSON `{ statusCode, message, error }`, avec :
   - `HttpException` dont le message est une **chaîne rédigée par le projet** (cas courant : `ForbiddenException("Vous n'êtes pas autorisé...")`) : statut et message conservés tels quels ;
   - 400 du `ValidationPipe` (message en tableau) : `message` = « Certaines informations saisies sont manquantes ou invalides. Vérifiez le formulaire puis réessayez. » ; hors production seulement, ajouter `details` (le tableau d'origine) pour aider le développeur du front ;
   - 429 (`ThrottlerException`) : « Trop de tentatives en peu de temps. Patientez une minute puis réessayez. » ;
   - 404 de route inconnue (message commençant par « Cannot ») : « Cette page ou cette information est introuvable. » ;
   - 413 : « Le document envoyé est trop volumineux. » ;
   - autres messages Nest par défaut en anglais (« Forbidden resource », « Unauthorized », « Bad Request », « Not Found », etc., c'est-à-dire un message égal au libellé HTTP standard) : remplacer par un message français selon le statut, en reprenant le tableau « Vocabulaire utilisateur » de docs/ORCHESTRATOR.md section 14 (401 : « Votre connexion a expiré, reconnectez-vous. » ; 403 : « Vous n'avez pas accès à cette information. » ; 404 : « Cette page ou cette information est introuvable. » ; 400 : message de validation ci-dessus) ;
   - erreurs Prisma connues (importer les classes d'erreur depuis le client généré `generated/prisma/...`, vérifier le chemin exact d'export de `PrismaClientKnownRequestError` dans `generated/prisma`) : `P2002` : 409 « Cette information existe déjà. » ; `P2025` : 404 « Cette information est introuvable. » ; `P2003` : 400 « Cette opération fait référence à une information qui n'existe pas. » ;
   - tout le reste (exception non HTTP, 5xx) : 500, « Le service est momentanément indisponible, réessayez dans quelques instants. », et log `error` serveur avec nom, message et pile de l'exception, la méthode et la route (sans le corps de la requête, sans en-têtes).
   - `error` : libellé court en français (exemples : « Requête invalide », « Accès refusé », « Introuvable », « Trop de tentatives », « Erreur interne »). Aucun nom de classe, code Prisma ou pile dans la réponse.
2. L'enregistrer globalement dans `src/main.ts` (`app.useGlobalFilters(...)`), juste après les pipes globaux, avec un commentaire en français. Ne pas toucher à `src/app.module.ts` (un autre niveau de priorité le modifie).
3. Tests `src/common/filters/all-exceptions.filter.spec.ts` (ArgumentsHost et Response simulés) : un cas par règle ci-dessus (message projet conservé, validation en tableau, 429, route inconnue, 403 anglais par défaut, P2002, erreur inconnue en 500 sans fuite de son message).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Ne pas modifier les messages des exceptions existantes dans les services. Règles d'audience, typographiques et de langue : docs/ORCHESTRATOR.md (messages et commentaires en français, aucun tiret cadratin ni demi-cadratin). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas commiter : l'orchestrateur commite.

## Done when

- `npx --no-install tsc --noEmit` : 0 erreur ; `npx --no-install eslint src/common/filters/*.ts src/main.ts` : 0 erreur (procédure D07 de `docs/plans/runs/2026-10-06-p1-beta/decisions.md` pour la dette préexistante de `main.ts`) ; `npm test` : tout vert, nouveaux cas inclus.
- Grep des termes interdits de docs/ORCHESTRATOR.md section 14 dans les chaînes de messages du filtre : 0 résultat.

## Return

Liste des fichiers créés ou modifiés + preuves (commandes lancées, résultat en une ligne chacune). Ou un bloc BLOCKED. Pas de prose.

## Historique

2026-10-06 | dur | succès | libellé 400 « Saisie invalide » (« requête » est un terme interdit) ; 413 Express non vérifié par appel réel

## Validation

tsc --noEmit ; eslint filtre + main.ts ; npm test | 0 erreur ; 0 erreur (1 avertissement préexistant) ; 4 suites, 45 tests verts | voir commit de la tâche
