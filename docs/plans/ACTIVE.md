# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-06-p1-beta | Branche: orch/p1-beta | Parallélisme: 5 (1 seul sur l'arbre principal, les autres en worktree) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-06-p1-beta/ (backlog P1 : points 8, 9, 10, 13b, 14, 15 côté back ; T12 dépôt parent et T13 dépôts IA indexés ici aussi ; front : voir ACTIVE.md de front_medconnect)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| T01 | Point 8 : ne plus exposer le dossier médical à l'accueil | spécifié | à faire | 0 |
| T02 | Point 9 : retirer les données de santé des logs | spécifié | à faire | 0 |
| T03 | Point 10 : contrôle d'accès consultation, analyses, vaccinations | dur | à faire | 0 |
| T04 | Point 15 : Swagger hors prod + limite sur l'inscription | spécifié | à faire | 0 |
| T05 | Point 15 : filtre d'exceptions global en français | dur | à faire | 0 |
| T06 | Point 15 : DTO validés (chat, statut urgence) | spécifié | à faire | 0 |
| T07 | Point 14 : en-tête secret vers les services IA | spécifié | à faire | 0 |
| T08 | Point 13 : CI GitHub Actions du back | spécifié | à faire | 0 |
| T12 | Point 13 : sauvegarde PostgreSQL (dépôt parent) | spécifié | à faire | 0 |
| T13 | Point 14 : seuil et secret partagé (dépôts IA) | spécifié | à faire | 0 |

## Faites (preuve = commit)

## Questions parquées

## Dernières décisions (5 max, historique complet dans decisions.md)
