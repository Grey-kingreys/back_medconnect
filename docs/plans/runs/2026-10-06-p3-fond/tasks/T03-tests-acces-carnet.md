# T03 - Tests unitaires du contrôle d'accès au carnet (checkAccess)

Tier: spécifié (agent implementeur-specifie)
Audience: n/a
Visuel: n/a
Background-safe: oui

Worktree de travail : `D:/souleymane/perso-archive-20260923/perso/medconnecte/.worktrees/back-p3-T03` (branche `task/T03-tests-acces-carnet`, node_modules et client Prisma déjà installés). Ne travaille que là. Ne commite pas : l'orchestrateur commite.

## Spec

Point 20 du backlog. Créer **un nouveau fichier** `src/carnet-sante/carnet-sante.access.spec.ts`. **Ne modifier aucun fichier existant**, en particulier ni `carnet-sante.service.ts` ni `carnet-sante.service.spec.ts` : le niveau P1 corrige le contrôle d'accès en parallèle (décision D01 : on fige le comportement actuel).

Reprendre le style de `src/carnet-sante/carnet-sante.service.spec.ts` (instanciation directe de `CarnetSanteService` avec 9 dépendances, seules les méthodes Prisma utiles mockées). Appeler la méthode privée `checkAccess(actorId, patientId, structureId?, mode?)` via un cast typé localement (par exemple `(service as unknown as { checkAccess: (...) => Promise<...> }).checkAccess`), et ajouter un ou deux tests via une méthode publique qui l'utilise (par exemple `getPatientCarnetForDoctor` ou une création) pour montrer que le refus remonte.

Cas à couvrir (comportement actuel, lignes 58 à 104 environ) :
1. Le patient sur son propre dossier : accès, `isMedecinTraitant: false`, aucune requête Prisma.
2. Patient inexistant : `NotFoundException`.
3. Médecin traitant : accès, `isMedecinTraitant: true`.
4. Acteur d'une structure autorisée par le patient (`structureId` du token égal à `actor.structureId` en base, `autorisationStructure` trouvée) : accès, `isMedecinTraitant: false`.
5. `structureId` du token différent de l'appartenance réelle en base (membre retiré) : `ForbiddenException`, et `autorisationStructure.findUnique` non appelé.
6. Structure de l'acteur sans autorisation du patient : `ForbiddenException`.
7. Aucun `structureId` et pas médecin traitant : `ForbiddenException`.
8. Message de refus différent selon `mode` (`lecture` contient « consulter », `ecriture` contient « modifier »), et `ecriture` par défaut.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Commentaires en français, en tête de fichier un commentaire qui explique que ces tests figent le comportement au 2026-10-06 et devront suivre la correction du point 10 (structure non membre, filtrage des analyses et vaccinations). Aucun tiret cadratin ni demi-cadratin. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell.

## Done when

Dans le worktree :
- `npx --no-install jest src/carnet-sante/carnet-sante.access.spec.ts` : tous les tests passent, au moins 9 tests.
- `npm test` : toutes les suites passent.
- `npx --no-install tsc --noEmit` : aucune erreur.
- `npx --no-install eslint src/carnet-sante/carnet-sante.access.spec.ts` : aucune erreur.
- `git status --porcelain` ne montre que ce nouveau fichier.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

## Validation
