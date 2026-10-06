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

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
