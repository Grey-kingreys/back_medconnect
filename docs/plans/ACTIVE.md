# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-06-p1-beta | Branche: orch/p1-beta | Parallélisme: 5 (1 seul sur l'arbre principal, les autres en worktree) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-06-p1-beta/ (backlog P1 : points 8, 9, 10, 13b, 14, 15 côté back ; T12 dépôt parent et T13 dépôts IA indexés ici aussi ; front : voir ACTIVE.md de front_medconnect)
État: toutes les tâches validées ; run en attente de revue du porteur (merge vers la branche principale et archivage sur sa demande)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|

## Faites (preuve = commit)

- T01 point 8 : accueil sans dossier médical (a93a25e, merge 0e6a354)
- T02 point 9 : logs sans données de santé ni numéro de téléphone (59f9c79, merge 12dc401)
- T03 point 10 : contrôle d'accès consultation, analyses, vaccinations (df35cf7)
- T04 point 15 : Swagger fermé en production, limite sur l'inscription (8392d17, merge 4033dbf)
- T05 point 15 : filtre d'exceptions global en français (3700d72, merge efe7c54)
- T06 point 15 : corps validés conversation et statut d'alerte SOS (df801c3, merge 7655a36)
- T07 point 14 : en-tête secret partagé vers les services IA (2f9ed06, merge 081dc29)
- T08 point 13 : CI GitHub Actions du back (edebc60, merge d77ae60)
- T12 point 13 : script de sauvegarde PostgreSQL, dépôt parent (4c345a2 sur orch/p1-beta du parent)
- T13 point 14 : seuil et secret partagé, dépôts IA (medconnect-ai d1ff2ba, medconnect-urgence 7982a2d, non poussés)

## Questions parquées

- Limiteur de débit Redis (point 15) : bloquer ou laisser passer si Redis tombe ? (D02)
- `.env.example` et `compose.yml` du parent (périmètre P0) : ajouter `AI_SHARED_SECRET` et `SWAGGER_ENABLED` (optionnelles) (D09)

## Dernières décisions (5 max, historique complet dans decisions.md)

- D09 variables optionnelles non reportées dans `.env.example` ni `compose.yml` (périmètre P0) (plan)
- D10 tirets reformatés par prettier remplacés par des virgules dans deux chaînes dev (convention)
- D11 imports inutilisés retirés plutôt que désactivés dans les fichiers touchés (défaut, révisable)
- D12 DTO de statut SOS et de conversation validés sur les enums Prisma (défaut, révisable)
- D13 script de sauvegarde en LF dans git, `.gitattributes` du parent encore non commité (défaut, révisable)
