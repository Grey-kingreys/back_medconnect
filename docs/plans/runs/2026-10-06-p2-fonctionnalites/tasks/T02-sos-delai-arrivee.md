# T02 - SOS : délai d'arrivée, anti-relance et diffusion ciblée (F5 + point 12)

Tier: dur (agent implementeur-dur)
Audience: non-dev pour les messages d'erreur et notifications ; dev pour l'API
Visuel: n/a
Background-safe: oui

## Spec

Contexte : `src/carnet-sante/carnet-sante.service.ts` (`createUrgence` vers la ligne 918, `takeCharge` vers 1050), contrôleur `src/carnet-sante/carnet-sante.controller.ts` (routes `sos`, vers la ligne 272), DTO `src/carnet-sante/dto/carnet-sante.dto.ts` (section Urgences), gateway `src/chat/chat.gateway.ts`, schéma `prisma/schema.prisma` (`model Urgence`, `model Structure`). Décisions déjà prises : `docs/plans/runs/2026-10-06-p2-fonctionnalites/decisions.md` (D01 à D05), à appliquer telles quelles.

1. **Schéma Prisma**, `model Urgence` : ajouter
   - `structurePriseEnChargeId String?` + relation `structurePriseEnCharge Structure? @relation("UrgencesPrisesEnCharge", fields: [structurePriseEnChargeId], references: [id], onDelete: SetNull)` (et le champ inverse `urgencesPrisesEnCharge Urgence[] @relation("UrgencesPrisesEnCharge")` dans `model Structure`) ;
   - `priseEnChargeParId String?` (identifiant du soignant, sans relation, pour ne pas toucher au modèle User) ;
   - `priseEnChargeAt DateTime?` ;
   - `delaiArriveeMinutes Int?` ;
   - un index `@@index([patientId, createdAt])`.
   Commentaires en français. Remplacer le commentaire obsolète « On pourrait ajouter structureId... ».
2. **Migration** : dossier `prisma/migrations/20261006120000_urgence_prise_en_charge/migration.sql`. Aucune base ne tourne : ne rien appliquer. Générer le SQL sans base, par exemple : extraire l'ancien schéma (`git show orch/base:prisma/schema.prisma > <scratch>/old.prisma`, fichier scratch hors du dépôt, c'est un fichier temporaire, pas un livrable) puis `npx --no-install prisma migrate diff --from-schema <old> --to-schema prisma/schema.prisma --script` (adapter les flags à Prisma 7 : `npx --no-install prisma migrate diff --help`). Écrire le résultat dans le fichier de migration avec l'outil Write. Si la génération est impossible, écrire le SQL à la main en suivant le style des migrations existantes (`prisma/migrations/20260725_rdv_validation/migration.sql`). Puis `npx --no-install prisma generate`.
3. **DTO** : `TakeChargeUrgenceDto { delaiArriveeMinutes: number }` avec `@Type(() => Number) @IsInt() @Min(1) @Max(240)` et messages de validation en français humain (ex. « Indiquez dans combien de minutes vos équipes arriveront (entre 1 et 240). »). Swagger `@ApiProperty`.
4. **takeCharge(urgenceId, userId, dto)** : le contrôleur passe `@Body() dto: TakeChargeUrgenceDto`. Le service enregistre statut `PRIS_EN_CHARGE`, `structurePriseEnChargeId` (= `user.structureId` ou la structure administrée, null si aucune), `priseEnChargeParId`, `priseEnChargeAt = now`, `delaiArriveeMinutes`. Notification patient : texte humain qui indique la structure et le délai (« Clinique X a pris en charge votre alerte. Les secours arrivent dans environ 15 minutes. »).
5. **Diffusion ciblée** : supprimer `this.chatGateway.server.emit('emergencyHandled', ...)` (broadcast à tous). Ajouter dans `chat.gateway.ts`, juste après `sendEmergencyAlert` et sur son modèle, une méthode `sendEmergencyHandled(userIds: string[], data)` qui émet `emergencyHandled` aux seuls sockets de ces utilisateurs. Destinataires : le patient, les membres des 5 structures les plus proches de la position de l'urgence (même calcul que dans `createUrgence` : extraire ce calcul dans une méthode privée du service réutilisée par les deux méthodes, sans changer son comportement), les membres de la structure qui prend en charge, et le soignant lui-même ; dédoublonnés. Payload : `{ urgenceId, structureName, handledAt, delaiArriveeMinutes, finDelaiAt }` (champs existants conservés, deux ajoutés). Changement minimal dans la gateway : ce fichier est aussi modifié par un autre chantier.
6. **createUrgence : anti-relance**, avant toute création : lire la dernière urgence du patient avec statut `LANCE` ou `PRIS_EN_CHARGE` (la plus récente).
   - `PRIS_EN_CHARGE` et `priseEnChargeAt + delaiArriveeMinutes` dans le futur : refuser (`ConflictException`) avec un message humain qui nomme la structure si connue et donne le temps restant arrondi à la minute supérieure, et dit quoi faire (« Votre alerte a été prise en charge par Clinique X. Les secours sont attendus dans environ 7 minutes. Si personne n'est arrivé d'ici là, vous pourrez relancer une alerte. »).
   - `LANCE` créée il y a moins de `SOS_ANTI_DOUBLON_MINUTES` (constante exportée valant 5) : refuser (`ConflictException`) avec message humain (« Votre alerte a déjà été envoyée aux établissements proches. Vous pourrez en relancer une dans environ 3 minutes. »).
   - Sinon : comportement actuel inchangé (D04 : l'ancienne alerte n'est pas modifiée).
   Le temps restant doit aussi être lisible par le front : utiliser une exception dont la réponse JSON garde `message` (string) et ajoute `peutRelancerA` (date ISO). Vérifier que la forme de réponse reste compatible avec le front (`message` lu par `ApiError`).
7. **Nouvelle route patient** `GET /carnet-sante/sos/en-cours` (déclarée avant les routes `sos/:id`, garde existante du contrôleur, aucune permission spéciale) : renvoie `{ success, data, message }` avec `data` = la dernière urgence `LANCE` ou `PRIS_EN_CHARGE` du patient connecté, enrichie de `structurePriseEnCharge: { id, nom } | null`, `finDelaiAt` (ISO ou null) et `peutRelancerA` (ISO ou null, selon les règles du point 6), ou `data: null` si aucune.
8. **Tests unitaires** dans un **nouveau** fichier `src/carnet-sante/carnet-sante.urgence.spec.ts` (ne pas modifier `carnet-sante.service.spec.ts`), construction du service comme dans le spec existant (9 dépendances, mocks inertes). Couvrir au minimum : refus si prise en charge et délai non expiré (message contient le temps restant) ; acceptation si délai expiré ; refus si alerte lancée il y a moins de 5 minutes ; acceptation au-delà ; `takeCharge` enregistre structure, heure, délai ; `takeCharge` n'appelle plus `server.emit` global et appelle `sendEmergencyHandled` avec le patient dans les destinataires ; validation du DTO (0 et 241 refusés, 15 accepté) via `class-validator`.
9. **Journalisation** : ne jamais journaliser coordonnées, nom ou téléphone du patient (convention existante : seulement des identifiants).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (sections 1, 2, 4, 14). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Ne pas toucher `getAiEmergencyInstructions`, `getActiveUrgences`, `updateUrgenceStatus` ni le reste de la gateway (autres chantiers). Aucun tiret cadratin ou demi-cadratin dans les lignes ajoutées. Aucun commit.

## Done when

- `npx --no-install prisma validate` OK, `npx --no-install prisma generate` OK, migration présente.
- `npx --no-install tsc --noEmit` sans erreur.
- `npx --no-install eslint` sur les fichiers touchés : 0 erreur introduite (comparer avec `git stash`-free : lancer eslint et signaler les erreurs préexistantes séparément si le fichier en avait déjà).
- `npm test` vert, nouveau spec inclus.
- `grep -n "server.emit('emergencyHandled'" src` : 0 résultat.

## Return

Fichiers modifiés et créés + preuves (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

## Validation
