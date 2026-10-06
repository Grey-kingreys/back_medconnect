# T01 - Ordonnance : `medicamentId` optionnel dans les lignes (F2, côté back)

Tier: spécifié (agent implementeur-specifie)
Audience: non-dev pour les messages d'erreur ; dev pour l'API
Visuel: n/a
Background-safe: oui

## Spec

Contexte : `src/carnet-sante/dto/carnet-sante.dto.ts` (`MedicamentOrdonnanceDto`, `CreateOrdonnanceDto`, section Ordonnance vers la ligne 135) et `src/carnet-sante/carnet-sante.service.ts` (`createOrdonnance`, chiffrement de `JSON.stringify(dto.medicaments)` vers la ligne 424). Décision D06 dans `docs/plans/runs/2026-10-06-p2-fonctionnalites/decisions.md`.

1. `MedicamentOrdonnanceDto` : ajouter `medicamentId?: string` avec `@ApiPropertyOptional({ description: 'Identifiant du médicament dans le catalogue, absent pour une saisie libre' }) @IsOptional() @IsUUID('4', { message: '...' })`. Message en français humain.
2. `CreateOrdonnanceDto.medicaments` : ajouter `@ValidateNested({ each: true })` (et `@ArrayMinSize(1)` avec message « Ajoutez au moins un médicament à l'ordonnance. ») pour que chaque ligne soit réellement validée. Les messages `@IsNotEmpty` de `nom`, `dosage`, `duree` deviennent humains (« Indiquez le nom du médicament. », « Indiquez la posologie. », « Indiquez la durée du traitement. »).
3. `createOrdonnance` : si des lignes portent un `medicamentId`, vérifier en une seule requête (`prisma.medicament.findMany({ where: { id: { in: ids } }, select: { id: true } })`) qu'ils existent ; sinon `BadRequestException` « Un médicament de l'ordonnance n'est plus dans le catalogue. Retirez-le puis choisissez-le à nouveau, ou saisissez son nom librement. ». Le `medicamentId` est conservé tel quel dans le JSON chiffré (aucune migration, format de chiffrement inchangé). Placer la vérification au début de la méthode, changement minimal et localisé (fichier modifié aussi par d'autres chantiers).
4. Tests : nouveau fichier `src/carnet-sante/dto/carnet-sante.dto.spec.ts` avec `class-validator` + `class-transformer` (`plainToInstance` puis `validate`) : ligne sans `medicamentId` acceptée ; ligne avec UUID accepté ; `medicamentId: 'abc'` refusé ; ligne sans `dosage` refusée ; tableau vide refusé.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Règles d'audience, typographiques et de langue : docs/ORCHESTRATOR.md (sections 1, 4, 14). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas toucher d'autres méthodes du service. Aucun tiret cadratin ou demi-cadratin dans les lignes ajoutées. Aucun commit.

## Done when

- `npx --no-install tsc --noEmit` sans erreur ; `npm test` vert avec le nouveau spec ; eslint des fichiers touchés sans erreur introduite.

## Return

Fichiers modifiés et créés + preuves (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

## Validation
