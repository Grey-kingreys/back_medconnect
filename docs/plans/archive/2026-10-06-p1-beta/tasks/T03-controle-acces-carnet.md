# T03 - Point 10 : contrôle d'accès consultation, analyses, vaccinations

Tier: dur (agent implementeur-dur)
Audience: mixte : messages d'erreur visibles = non-dev (vocabulaire de docs/ORCHESTRATOR.md section 14)
Visuel: n/a
Background-safe: oui

## Spec

Fichier : `src/carnet-sante/carnet-sante.service.ts`. Lire d'abord `checkAccess` (lignes 46 à 102), `getPatientCarnetForDoctor` (106 à 218) et `createConsultation` (303 et suivantes).

Constat 1 (vérifié) : `createConsultation` accepte `dto.structureId` sans contrôle d'appartenance. `checkAccess` valide le périmètre patient avec la structure du JWT, puis la consultation est enregistrée avec `structureId: dto.structureId || structureId`. Un soignant (médecin traitant, ou membre d'une structure autorisée) peut donc rattacher une consultation à un établissement dont il n'est pas membre, qui la verra ensuite dans sa vue filtrée par structure.

Correctif attendu :
- Quand l'acteur n'est pas le patient lui-même : l'établissement enregistré doit être l'établissement **réel** de l'acteur en base (`user.structureId`, pas seulement le JWT). Si `dto.structureId` est fourni et différent de cet établissement réel : `ForbiddenException` avec un message humain, par exemple « Vous ne pouvez enregistrer une consultation que pour votre propre établissement de santé. ». Si l'acteur n'a pas d'établissement : `structureId` enregistré à `null` (sauf `dto.structureId` fourni, alors refus).
- Éviter une requête en double : `checkAccess` lit déjà `actor.structureId` ; il est acceptable de lui faire renvoyer aussi `actorStructureId` (champ additionnel dans l'objet retourné), sans changer son comportement pour les autres appelants.
- Patient qui saisit sa propre consultation (`actorId === patientId`) : comportement inchangé (décision D04, révisable).
- Garder la vérification d'existence de la structure déjà présente.

Constat 2 (vérifié) : dans `getPatientCarnetForDoctor`, quand l'acteur n'est pas médecin traitant (accès via une structure autorisée), les consultations et ordonnances sont filtrées par structure, mais **pas** les analyses ni les vaccinations, ni les compteurs `stats`.

Correctif attendu :
- Analyses et vaccinations : pour une structure autorisée (non médecin traitant), ne renvoyer que celles dont l'auteur est membre de cette structure : filtre Prisma `medecin: { structureId }` (ces tables n'ont pas de `structureId`, décision D03 révisable ; pas de migration).
- Compteurs `stats` : appliquer les mêmes filtres que les listes (consultations, ordonnances, analyses, vaccinations), pour ne pas révéler le volume du carnet hors périmètre.
- Médecin traitant : inchangé (voit tout).
- Mettre à jour le commentaire trompeur « Analyses et Vaccinations : Médecin traitant comme structure autorisée ».

Tests : compléter `src/carnet-sante/carnet-sante.service.spec.ts` (Prisma simulé, voir la forme existante) avec au moins : (a) médecin d'une structure A qui crée une consultation avec `dto.structureId = B` : refus 403 ; (b) même médecin sans `dto.structureId` : consultation enregistrée avec A ; (c) vue structure autorisée : les appels `resultatAnalyse.findMany` et `vaccination.findMany` reçoivent le filtre `medecin: { structureId }`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Ne pas toucher aux méthodes rendez-vous ni urgences (autres niveaux de priorité y travaillent). Règles d'audience, typographiques et de langue : docs/ORCHESTRATOR.md (messages et commentaires en français, aucun tiret cadratin ni demi-cadratin). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas commiter : l'orchestrateur commite.

## Done when

- `npx --no-install tsc --noEmit` : 0 erreur.
- `npx --no-install eslint src/carnet-sante/carnet-sante.service.ts src/carnet-sante/carnet-sante.service.spec.ts` : 0 erreur, en appliquant la procédure D07 de `docs/plans/runs/2026-10-06-p1-beta/decisions.md` (le service porte environ 280 erreurs préexistantes dont environ 200 de formatage : `eslint --fix`, puis désactivation ciblée et documentée des règles de typage restantes en tête de fichier).
- `npm test` : tout vert, les 3 nouveaux cas inclus.

## Return

Liste des fichiers modifiés + preuve (commandes lancées, résultat en une ligne chacune). Ou un bloc BLOCKED. Pas de prose.

## Historique

2026-10-06 | dur | succès | -

## Validation

tsc --noEmit ; eslint service + spec ; npm test | 0 erreur ; 0 erreur (dette désactivée en tête selon D07) ; 3 suites, 37 tests verts | voir commit de la tâche
