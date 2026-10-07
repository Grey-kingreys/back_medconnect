# T03 - Statut de rendez-vous : permission, propriété, DTO validé

Tier: spécifié (agent implementeur-specifie)
Audience: non-dev pour les messages d'erreur renvoyés ; dev pour le reste
Visuel: n/a
Background-safe: oui

## Spec

Backlog P0 point 3. Constat vérifié : `POST /carnet-sante/rendez-vous/:id/status` (`src/carnet-sante/carnet-sante.controller.ts`, méthode `updateRendezVousStatus`, vers la ligne 238) n'a ni permission, ni contrôle de propriété ; le statut vient de `@Body('status') status: string` sans validation et est casté `as any` dans `CarnetSanteService.updateRendezVousStatus` (vers la ligne 744). Enum Prisma `AppointmentStatus` : PROGRAMME, CONFIRME, ANNULE, TERMINE, EN_ATTENTE, REFUSE. Consommateur front : `front_medconnect/src/lib/api_carnet.ts` envoie `{ status }` (valeurs CONFIRME, ANNULE, TERMINE).

À faire :
1. DTO dans `src/carnet-sante/dto/carnet-sante.dto.ts` : `UpdateRendezVousStatusDto` avec `status` validé par `@IsEnum(AppointmentStatus)` (importer l'enum depuis le client Prisma généré comme le font déjà les autres DTO du fichier s'ils le font ; sinon `import { AppointmentStatus } from 'generated/prisma/client'`) et `@ApiProperty` avec `enum`. Message de validation en vocabulaire utilisateur : « Ce statut de rendez-vous n'est pas reconnu. »
2. Contrôleur : remplacer `@Body('status') status: string` par `@Body() dto: UpdateRendezVousStatusDto`, passer `req.user.userId`, `req.user.structureId` au service (même façon que `validerRendezVous` juste au-dessus). Pas de `@RequirePermissions` sur la route : le patient, qui n'a pas `rendezvous:write`, doit pouvoir annuler son propre rendez-vous (décision D03).
3. Service `updateRendezVousStatus(rvId, status: AppointmentStatus, actorId, actorStructureId?)` :
   - charger le RDV (`id, patientId, medecinId, structureId, status`) ; absent : `NotFoundException('Rendez-vous introuvable.')` (même message que `respondToRendezVous`).
   - si `actorId === rv.patientId` : seul `ANNULE` est permis, sinon `ForbiddenException("Vous pouvez seulement annuler votre rendez-vous.")`.
   - sinon l'acteur doit avoir la permission `PERMISSIONS.RENDEZVOUS_WRITE` (via `PermissionsService.hasPermissions`, injecter `PermissionsService` dans `CarnetSanteService` s'il ne l'est pas déjà ; vérifier que le module le fournit, le module RBAC est probablement global) ET être soit `rv.medecinId`, soit membre de la structure du RDV (`rv.structureId` non nul et égal à `actorStructureId`). Sinon `ForbiddenException("Vous n'avez pas accès à ce rendez-vous.")`.
   - mise à jour avec le statut typé (plus de `as any`).
   - garder le format de retour actuel `{ data, message, success }`.
   Attention : si le constructeur de `CarnetSanteService` change, mettre à jour `src/carnet-sante/carnet-sante.service.spec.ts` (il instancie le service avec des arguments positionnels) sans casser ses tests existants.
4. Tests Jest dans `src/carnet-sante/carnet-sante.service.spec.ts` (nouveau `describe('updateRendezVousStatus')`) : patient annule son RDV (ok) ; patient tente TERMINE (Forbidden) ; tiers sans lien (Forbidden, `rendezVous.update` non appelé) ; soignant d'une autre structure avec la permission (Forbidden) ; médecin du RDV (ok) ; membre de la structure du RDV avec permission (ok) ; membre de la structure sans permission (Forbidden) ; RDV inexistant (NotFound). Et un test de validation du DTO avec `class-validator` (`validate(plainToInstance(UpdateRendezVousStatusDto, { status: 'PIRATE' }))` renvoie une erreur ; `'ANNULE'` passe).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors non demandés. Discipline de code : réutiliser l'existant. Règles d'audience et de langue : docs/ORCHESTRATOR.md sections 1, 4, 5, 14 (pas d'enum brut dans les messages). Aucun tiret cadratin ni demi-cadratin dans les lignes ajoutées. Commentaires en français. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas committer.

## Done when

- `npx --no-install tsc --noEmit` : 0 erreur.
- `npx --no-install eslint` sur les fichiers touchés : 0 erreur (signaler toute erreur préexistante distincte de vos lignes).
- `npx --no-install jest src/carnet-sante` : tous verts, cas du point 4 présents.
- `npm test` : tout vert.
- `grep -n "status as any" src/carnet-sante/carnet-sante.service.ts` : plus de résultat dans `updateRendezVousStatus`.

## Return

Liste des fichiers modifiés + preuve (commande lancée, résultat en une ligne) par done-condition. Ou un bloc BLOCKED. Pas de prose.

## Tentative 2 : propreté eslint des fichiers touchés (décision D05)

La logique est validée et ne doit pas changer. Le pre-commit lance eslint sur chaque fichier indexé et refuse le commit à la moindre erreur ; `--no-verify` est interdit. Convention du projet : tout fichier touché doit être propre, dette préexistante comprise.

Fichiers à rendre propres (erreurs actuelles) :
- `src/carnet-sante/dto/carnet-sante.dto.ts` : 298 (294 prettier, 2 `no-unused-vars`, 2 `no-unsafe-return`)
- `src/carnet-sante/carnet-sante.service.ts` : 269 (202 prettier, 66 `no-unsafe-*`, 1 `no-unsafe-enum-comparison`)
- `src/carnet-sante/carnet-sante.controller.ts` : 58 (16 prettier, 41 `no-unsafe-member-access` sur `req: any`, 1 `no-unused-vars`)
- `src/carnet-sante/carnet-sante.service.spec.ts` : 3 prettier

Règles :
1. Commencer par `npx --no-install eslint --fix` sur ces 4 fichiers (prettier, formatage pur), puis relancer eslint pour voir le reste.
2. Aucun changement de comportement. Tous les tests restent verts sans modification de leurs assertions.
3. Contrôleur : remplacer `@Req() req: any` par le type existant `RequestWithUser` de `src/auth/jwt.strategy.ts` (réutiliser, ne pas créer de nouveau type). Si une signature de service attend `string | undefined` et reçoit `string | null | undefined`, adapter au point d'appel (`?? undefined`) plutôt que de changer le service.
4. Service : typage minimal et local des valeurs `any` (paramètres `any` des helpers de déchiffrement, retours Prisma, `catch (e)`), en préférant les types Prisma générés (`generated/prisma/client`) ou `unknown` avec garde. Pour `no-unsafe-enum-comparison`, comparer à la valeur de l'enum Prisma.
5. DTO : variables ou imports inutilisés retirés uniquement s'ils sont vraiment inutilisés dans le fichier ; `no-unsafe-return` des `@Transform` : typer le paramètre (`({ value }: { value: unknown })`) et le retour.
6. En dernier recours seulement, `// eslint-disable-next-line <règle> -- <raison en français>` sur une ligne précise. Jamais de désactivation à l'échelle du fichier.
7. Ne jamais utiliser `git stash` (pile partagée entre worktrees, décision D06). Ne jamais committer. Ne jamais écrire de fichier par redirection shell (`cat >>` interdit : la tentative 1 l'a fait, ne pas recommencer).

Done when (tentative 2) :
- `npx --no-install eslint` sur les 4 fichiers : 0 erreur (les warnings sont tolérés).
- `npx --no-install tsc --noEmit` : 0 erreur ; `npm test` : tout vert.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-06 | spécifié | logique ok, tests ok (44) | eslint : dette préexistante (plus de 600 erreurs) dans les fichiers touchés bloque le pre-commit ; écriture du DTO par cat >> (consigne violée, contenu correct)
2026-10-07 | orchestrateur (reprise, exécution directe D07) | validé après correction | la tentative 2 (eslint --fix et typage) avait introduit un second appel `aiService.predictMaladie` dans `createAutoDiagnostic` (double appel IA, résultat ignoré) : supprimé, commentaire « 2. Appel à l'IA » restauré ; tiret cadratin d'un exemple Swagger reformaté remplacé par « ; » (D08)

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
npx --no-install eslint (dto, service, controller, service.spec, module) | 0 erreur, 1 warning préexistant (no-floating-promises, service.ts) | c3387be
npx --no-install tsc --noEmit | 0 erreur | c3387be
npm test (worktree de tâche) | 3 suites, 44 tests verts (8 cas updateRendezVousStatus + 2 DTO) | c3387be
grep -n "status as any" src/carnet-sante/carnet-sante.service.ts | aucun résultat | c3387be
merge --no-ff dans orch/p0-securite | sans conflit | 4e79d05
