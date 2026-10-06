# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-06-p1-beta | Branche: orch/p1-beta | Parallélisme: 5 (1 seul sur l'arbre principal, les autres en worktree) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-06-p1-beta/ (backlog P1 : points 8, 9, 10, 13b, 14, 15 côté back ; T12 dépôt parent et T13 dépôts IA indexés ici aussi ; front : voir ACTIVE.md de front_medconnect)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| T01 | Point 8 : ne plus exposer le dossier médical à l'accueil | spécifié | validé (merge en cours) | 2 |
| T02 | Point 9 : retirer les données de santé des logs | spécifié | à faire | 0 |
| T04 | Point 15 : Swagger hors prod + limite sur l'inscription | spécifié | à faire | 0 |
| T05 | Point 15 : filtre d'exceptions global en français | dur | validé (merge en cours) | 1 |
| T06 | Point 15 : DTO validés (chat, statut urgence) | spécifié | à faire | 0 |
| T07 | Point 14 : en-tête secret vers les services IA | spécifié | à faire | 0 |
| T08 | Point 13 : CI GitHub Actions du back | spécifié | à faire | 0 |
| T12 | Point 13 : sauvegarde PostgreSQL (dépôt parent) | spécifié | à faire | 0 |
| T13 | Point 14 : seuil et secret partagé (dépôts IA) | spécifié | à faire | 0 |

## Faites (preuve = commit)

- T03 point 10 : contrôle d'accès consultation, analyses, vaccinations (commit de la tâche sur orch/p1-beta)

## Questions parquées

- Limiteur de débit Redis (point 15) : bloquer ou laisser passer si Redis tombe ? (D02)

## Dernières décisions (5 max, historique complet dans decisions.md)

- D03 analyses et vaccinations filtrées via l'établissement de leur auteur (révisable)
- D04 patient : structure saisie conservée sur sa propre consultation (révisable)
- D05 secret IA `AI_SHARED_SECRET`, en-tête `X-MedConnecte-Secret`, inactif si absent (révisable)
- D06 seuil urgence 0.3 configurable par `SEUIL_SIMILARITE` (révisable)
- D07 lint des fichiers touchés : `eslint --fix` puis désactivation ciblée et documentée de la dette (révisable)
