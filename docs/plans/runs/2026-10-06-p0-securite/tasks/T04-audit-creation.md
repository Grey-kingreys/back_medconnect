# T04 - Audit des créations : lire response.data.id

Tier: spécifié (agent implementeur-specifie)
Audience: dev
Visuel: n/a
Background-safe: oui

## Spec

Backlog P0 point 4. Constat vérifié : `src/common/interceptors/audit.interceptor.ts`, méthode `resoudreCible`, ligne `const entityId = segments[2] ?? response?.id;`. Or les services du carnet renvoient `{ data, message, success }` : l'ID créé est dans `response.data.id`, donc aucune création médicale (POST /carnet-sante/consultations, ordonnances, analyses, vaccinations, profil-medical) n'est journalisée.

À faire :
1. Remplacer par `segments[2] ?? response?.data?.id ?? response?.id` (garder le repli `response.id`), avec un commentaire français d'une ligne expliquant l'enveloppe `{ data, message, success }`.
2. Créer `src/common/interceptors/audit.interceptor.spec.ts` (Jest, sans base : `PrismaService` mocké avec `auditLog.create: jest.fn().mockResolvedValue({})`). Construire un `ExecutionContext` factice (`getType: () => 'http'`, `switchToHttp().getRequest()` renvoyant `{ method: 'POST', originalUrl: '/carnet-sante/consultations', route: { path: '/carnet-sante/consultations' }, user: { userId: 'u1' }, ip: '1.2.3.4' }`) et un `CallHandler` `{ handle: () => of({ success: true, data: { id: 'c1' }, message: 'ok' }) }`. Souscrire (`lastValueFrom`), attendre la micro-tâche (l'écriture est `void`), puis vérifier que `auditLog.create` a été appelé avec `data` contenant `{ userId: 'u1', action: 'create', entityType: 'Consultation', entityId: 'c1', ip: '1.2.3.4' }`. Cas supplémentaires : réponse plate `{ id: 'c2' }` journalisée avec `entityId: 'c2'` (repli) ; GET `/carnet-sante/consultations` sans ID (liste) : pas d'écriture ; erreur 403 sur `/carnet-sante/consultations/c3` : écriture `action: 'denied'`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors non demandés. Aucun tiret cadratin ni demi-cadratin dans les lignes ajoutées. Commentaires en français. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas committer.

## Done when

- `npx --no-install tsc --noEmit` : 0 erreur.
- `npx --no-install eslint src/common/interceptors/audit.interceptor.ts src/common/interceptors/audit.interceptor.spec.ts` : 0 erreur.
- `npx --no-install jest src/common/interceptors` : vert, avec le test « un POST de création écrit un AuditLog » qui échoue si on remet `response?.id` seul (le vérifier une fois et le dire dans le Return).
- `npm test` : tout vert.

## Return

Liste des fichiers modifiés ou créés + preuve (commande lancée, résultat en une ligne) par done-condition. Ou un bloc BLOCKED. Pas de prose.

## Tentative 2 : propreté eslint des fichiers touchés (décision D05)

La logique est validée et ne doit pas changer. Le pre-commit lance eslint sur chaque fichier indexé et refuse le commit à la moindre erreur ; `--no-verify` est interdit. Convention du projet : tout fichier touché doit être propre, dette préexistante comprise.

Fichier à rendre propre : `src/common/interceptors/audit.interceptor.ts` (21 erreurs `no-unsafe-assignment` et `no-unsafe-member-access`, toutes sur des valeurs `any` : `request`, `response`, `error`, `request.user`).

Règles :
1. Aucun changement de comportement. Les tests existants et `audit.interceptor.spec.ts` restent verts sans modification de leurs assertions.
2. Corriger par typage minimal et local : par exemple une interface locale `RequeteAuditee` (champs `method`, `ip?`, `user?: { userId?: string }`, `route?: { path?: string }`, `url?`, `originalUrl?`) passée à `getRequest<RequeteAuditee>()`, `response: unknown` lu via une petite garde de type, `error: unknown` lu via `(error as { status?: number })?.status`. Pas de nouveau fichier partagé, pas de refactor au-delà.
3. En dernier recours seulement, `// eslint-disable-next-line <règle> -- <raison en français>` sur une ligne précise. Jamais de désactivation à l'échelle du fichier.
4. Ne jamais utiliser `git stash` (la pile est partagée entre worktrees, décision D06). Ne jamais committer.

Done when (tentative 2) :
- `npx --no-install eslint src/common/interceptors/audit.interceptor.ts src/common/interceptors/audit.interceptor.spec.ts` : 0 erreur.
- `npx --no-install tsc --noEmit` : 0 erreur ; `npm test` : tout vert.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-06 | spécifié | logique ok, tests ok | eslint : 21 erreurs préexistantes dans audit.interceptor.ts bloquent le pre-commit
2026-10-07 | orchestrateur (reprise, exécution directe D07) | validé | tentative 2 trouvée faite sur disque, aucune retouche

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
npx --no-install eslint src/common/interceptors/audit.interceptor.ts src/common/interceptors/audit.interceptor.spec.ts | 0 erreur, 0 warning | a3ade27
npx --no-install tsc --noEmit | 0 erreur | a3ade27
npm test (worktree de tâche) | 4 suites, 38 tests verts | a3ade27
mutation `segments[2] ?? corps?.id` puis jest src/common/interceptors | 1 échec (« un POST de création écrit un AuditLog »), code restauré | a3ade27
merge --no-ff dans orch/p0-securite | sans conflit | eac400a
