# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-20-lot1 | Branche: orch/lot1-back | Parallélisme: 1 (tâches séquentielles, arbre principal) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-20-lot1/ (lot 1 du plan mobile côté back ; rapports des sous-agents dans rapports/ ; décisions dans decisions.md). Run précédent archivé : docs/plans/archive/2026-10-20-tb3-sessions/

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| B3 | TB2 codes d'erreur stables (champs, donnees, PERMISSION_REFUSEE), SOS réservé au patient, annulation de rendez-vous contrôlée (tasks/B3-codes-erreur-controles.md) | spécifié | à faire | 0 |

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|
| B1 | TB4 révocation des sessions, compte désactivé, socket sessionRevoquee, purge | 0e58e81 |
| B2 | TB1 limiteur par utilisateur, stockage Redis, SOS permissif si Redis tombe | cd0b4a8 |

## Questions parquées

- Porteur (reprise TB3) : retour arrière SESSIONS_MULTI_APPAREILS=false après une période à true réactive les anciens refresh encore valides dans User.refreshToken ; vider la colonne au premier démarrage avec le drapeau actif ?
- Porteur (reprise TB3) : durées Q11 et invalidation unique des sessions web au déploiement, à annoncer aux utilisateurs.
- Porteur (B2, D18) : Redis arrêté, l'email et le SMS au proche d'un SOS sont perdus (journalisés seulement) ; ajouter un envoi direct de secours ?

## Dernières décisions (5 max, historique complet dans decisions.md)

- D21 `champs` de VALIDATION = nom et clés de contraintes, jamais la valeur, aussi en production (révisable)
- D22 Toute 403 sans code reçoit PERMISSION_REFUSEE dans le filtre (révisable)
- D24 SOS réservé au rôle PATIENT, contrôle dans le contrôleur (révisable)
- D25 Annulation patient permise depuis PROGRAMME, EN_ATTENTE, CONFIRME ; 409 TRANSITION_INTERDITE sinon (révisable)
- D26 Branche soignant de updateRendezVousStatus non contrôlée dans B3 (révisable)
