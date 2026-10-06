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

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
