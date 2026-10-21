# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-21-lot4 | Branche: orch/lot4-back | Parallélisme: 1 (tâches séquentielles, arbre principal) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-21-lot4/ (lot 4 côté back, robustesse vue sur le déploiement de dev Render ; rapports des sous-agents dans rapports/ ; décisions dans decisions.md, numérotation continuée depuis le lot 3). Runs précédents à archiver : docs/plans/runs/2026-10-20-lot1/ (B1 à B3), docs/plans/runs/2026-10-20-lot2/ (B4 = f605421, B5 = a8c245c), docs/plans/runs/2026-10-21-lot3/ (B6 = 05e6b5b, B7 = 3a28867)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| B8 | Redis en rediss:// pour BullMQ ; échec d'email sans 500 ni état à moitié créé (structure 201 invitationEnvoyee, renvoi 503 EMAIL_INDISPONIBLE, membre, mot de passe oublié) (tasks/B8-redis-tls-echec-email.md) | spécifié | à faire | 0 |

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|
| B6 | TB10b qualité de position et idempotence du SOS (lot 3) | 05e6b5b |
| B7 | Réalignement AuditLog sur la migration 20260704 (lot 3) | 3a28867 |

## Questions parquées

- Porteur (reprise TB3) : retour arrière SESSIONS_MULTI_APPAREILS=false après une période à true réactive les anciens refresh encore valides dans User.refreshToken ; vider la colonne au premier démarrage avec le drapeau actif ?
- Porteur (reprise TB3) : durées Q11 et invalidation unique des sessions web au déploiement, à annoncer aux utilisateurs.
- Porteur (B2, D18) : Redis arrêté, l'email et le SMS au proche d'un SOS sont perdus (journalisés seulement) ; ajouter un envoi direct de secours ?
- Porteur (B4, Q04) : numéros d'urgence de Guinée (SAMU, pompiers, police) ; seul « 15 » est servi tant que Q04 n'est pas tranchée (D29).
- Orchestrateur principal (B8, D68 et D71) : le front doit lire `data.invitationEnvoyee` et afficher le message renvoyé (création de structure et de membre), et le code EMAIL_INDISPONIBLE du renvoi d'invitation.

## Dernières décisions (5 max, historique complet dans decisions.md)

- D68 Structure créée malgré l'échec de l'invitation : 201, invitationEnvoyee false, message de renvoi (user)
- D69 Renvoi d'invitation en échec : 503 EMAIL_INDISPONIBLE, ancien jeton remis en base (user, révisable)
- D70 Le filtre global laisse passer une 503 portant un code du catalogue (révisable)
- D71 Création de membre : envoi attendu, invitationEnvoyee, message honnête en échec (révisable)
- D72 Mot de passe oublié : échec d'email journalisé, réponse générique au lieu d'un 500 (révisable)
