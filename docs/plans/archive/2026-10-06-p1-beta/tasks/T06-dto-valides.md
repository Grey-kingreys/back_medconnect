# T06 - Point 15 : corps validés (démarrage de conversation, statut d'urgence)

Tier: spécifié (agent implementeur-specifie)
Audience: dev (DTO) ; messages de validation : régime non-dev (en français)
Visuel: n/a
Background-safe: oui

## Spec

Constat (vérifié) : trois endpoints lisent un corps non validé (le `ValidationPipe` global ne valide ni un type littéral ni un primitif extrait par `@Body('champ')`) :
- `src/chat/chat.controller.ts` : `POST /chat/conversations/start`, `@Body() body: { targetId: string, type: 'PRIVE' | 'STRUCTURE' }` ;
- `src/carnet-sante/carnet-sante.controller.ts:298` : `POST /carnet-sante/sos/:id/status`, `@Body('status') status: string`, passé tel quel à `prisma.urgence.update` (`updateUrgenceStatus(id, status: any)`, `carnet-sante.service.ts`, fin de fichier) ;
- `POST rendez-vous/:id/status` : **hors périmètre** (traité par le point 3 du niveau P0, décision D01). Ne pas y toucher.

À faire :
1. Créer `src/chat/dto/start-conversation.dto.ts` : `StartConversationDto` avec `targetId` (`@IsUUID()`, vérifier dans `prisma/schema.prisma` que les identifiants utilisateur et structure sont bien des uuid ; sinon `@IsString() @IsNotEmpty()`) et `type` (`@IsIn(['PRIVE', 'STRUCTURE'])` ou `@IsEnum` sur l'enum Prisma correspondant s'il existe, à vérifier dans le schéma). Décorateurs `@ApiProperty` comme dans les DTO existants (`src/carnet-sante/dto/carnet-sante.dto.ts`). Messages de validation en français via l'option `message` (exemple : « Le destinataire de la conversation est invalide. », « Le type de conversation est invalide. »).
2. Dans `chat.controller.ts`, typer le corps avec ce DTO. Rien d'autre (un autre niveau modifie ce module : changement minimal).
3. Ajouter `UpdateUrgenceStatusDto` dans `src/carnet-sante/dto/carnet-sante.dto.ts` (à la suite des DTO d'urgence existants) : `status` avec `@IsEnum(UrgenceStatus)` (enum Prisma `UrgenceStatus` : LANCE, PRIS_EN_CHARGE, TERMINE, ANNULE ; vérifier comment les autres DTO importent les enums Prisma), message français « Le statut de l'alerte est invalide. ».
4. Dans le contrôleur, `updateUrgenceStatus(@Param('id') id: string, @Body() dto: UpdateUrgenceStatusDto)` puis `this.carnetSanteService.updateUrgenceStatus(id, dto.status)`. Dans le service, typer le paramètre `status` avec `UrgenceStatus` au lieu de `any`. Aucun autre changement de logique.
5. Vérifier par grep dans le front en lecture seule (`D:/souleymane/perso-archive-20260923/perso/medconnecte/front_medconnect/src`) que les appels à ces deux routes envoient bien `{ targetId, type }` et `{ status }` avec des valeurs compatibles ; sinon, le signaler dans le Return (ne pas modifier le front).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Règles typographiques et de langue : docs/ORCHESTRATOR.md (messages et commentaires en français, aucun tiret cadratin ni demi-cadratin). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas commiter : l'orchestrateur commite.

## Done when

- `npx --no-install tsc --noEmit` : 0 erreur ; `npx --no-install eslint <fichiers touchés>` : 0 erreur, procédure D07 de `docs/plans/runs/2026-10-06-p1-beta/decisions.md` (dette préexistante : contrôleur carnet environ 96 erreurs, service environ 280 ; si T03 est déjà mergé, le service est déjà propre) ; `npm test` : vert.
- Test : `src/chat/dto/start-conversation.dto.spec.ts` et un test équivalent pour `UpdateUrgenceStatusDto` avec `validate()` de class-validator (valeur valide acceptée, type ou statut inconnu rejeté, `targetId` absent rejeté).
- Grep `@Body('status')` dans `src/carnet-sante/carnet-sante.controller.ts` : 1 seul résultat restant (celui des rendez-vous, hors périmètre).

## Return

Liste des fichiers créés ou modifiés + preuves (commandes lancées, résultat en une ligne chacune). Ou un bloc BLOCKED. Pas de prose.

## Historique

2026-10-07 | orchestrateur (reprise, D08) | succès | identifiants uuid confirmés dans le schéma ; enums Prisma (D12) ; front : `startConversation` envoie `{ targetId, type }` compatible, aucune page n'appelle `sos/:id/status`

## Validation

tsc --noEmit ; eslint des 7 fichiers ; npm test ; grep `@Body('status')` du contrôleur carnet | 0 erreur ; 0 erreur (42 avertissements) ; 7 suites, 56 tests verts ; 1 résultat (rendez-vous, hors périmètre) | df801c3, merge 7655a36
