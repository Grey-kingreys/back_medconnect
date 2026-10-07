# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-06-p2-fonctionnalites | Branche: orch/p2-fonctionnalites | Parallélisme: 2 (worktree du run + 1 worktree de tâche sous .worktrees/) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-06-p2-fonctionnalites/ (niveau P2 du BACKLOG-PRIORISE racine ; front : run jumeau dans front_medconnect, tâches T05 à T10)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|

## Faites (preuve = commit)

- T02 SOS délai d'arrivée, anti-relance, diffusion ciblée (F5 + 12) : validé, 875266d
- T01 Ordonnance : medicamentId optionnel (F2) : validé, bbffd84
- T03 Déchiffrement : alerte structurée (19) : validé, 25f886d
- T04 Import Excel du stock pharmacie (F1) : validé, eb53eb9 (merge dans orch)

## Questions parquées

## Dernières décisions (5 max, historique complet dans decisions.md)

- D01 Délai SOS expiré : le patient relance lui-même, pas de rediffusion (révisable)
- D02 Anti-doublon d'alerte lancée : 5 minutes (révisable)
- D03 Délai annoncé : 1 à 240 minutes (révisable)
- D07 Import Excel : stock pharmacie, la quantité importée remplace le stock (révisable)
- D08 Import : 2 Mo, 1000 lignes, .xlsx, aperçu puis nouvel envoi (révisable)
