# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-20-lot1 | Branche: orch/lot1-back | Parallélisme: 1 (tâches séquentielles, arbre principal) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-20-lot1/ (lot 1 du plan mobile côté back ; rapports des sous-agents dans rapports/ ; décisions dans decisions.md). Run précédent archivé : docs/plans/archive/2026-10-20-tb3-sessions/

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| B1 | TB4 révocation des sessions, compte désactivé, socket sessionRevoquee, purge | spécifié | validé par le chef d'équipe back (rapports/B1-chef.md) | 1 |

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|

## Questions parquées

- Porteur (reprise TB3) : retour arrière SESSIONS_MULTI_APPAREILS=false après une période à true réactive les anciens refresh encore valides dans User.refreshToken ; vider la colonne au premier démarrage avec le drapeau actif ?
- Porteur (reprise TB3) : durées Q11 et invalidation unique des sessions web au déploiement, à annoncer aux utilisateurs.

## Dernières décisions (5 max, historique complet dans decisions.md)

- D01 État d'accès lu dans Redis (30 s si valide, 16 min si révoqué), relu en base si absent ou Redis lent (révisable)
- D02 Changement de mot de passe : autres appareils déconnectés par défaut, option à false pour garder (révisable)
- D04 Socket : salles session:<sid> et utilisateur:<userId>, sessionRevoquee puis déconnexion 1 s après (révisable)
- D06 Purge horaire des sessions expirées ou révoquées depuis plus de 30 jours (révisable)
- D07 Nom d'une session web déduit du navigateur à la connexion, sans migration (révisable)
