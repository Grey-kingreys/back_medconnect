# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-21-lot3 | Branche: orch/lot3-back | Parallélisme: 1 (tâches séquentielles, arbre principal) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-21-lot3/ (lot 3 du plan mobile côté back ; rapports des sous-agents dans rapports/ ; décisions dans decisions.md, numérotation continuée depuis le lot 2). Runs précédents à archiver : docs/plans/runs/2026-10-20-lot1/ (B1 à B3), docs/plans/runs/2026-10-20-lot2/ (B4 = f605421, B5 = a8c245c)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| B6 | TB10b géolocalisation du SOS : precision, horodatagePosition, source ; position trop ancienne ou trop imprécise non utilisée ; position approximative signalée ; Idempotency-Key (tasks/B6-sos-position-idempotence.md) | spécifié | à faire | 0 |
| B7 | Réalignement AuditLog de schema.prisma sur la migration 20260704 (onUpdate NoAction, 3 @@index), migrate diff vide, aucune migration (tasks/B7-realignement-auditlog.md) | mécanique | à faire | 0 |

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|
| B4 | TB5 version minimale, /app/version, /app/config (lot 2) | f605421 |
| B5 | TB17 un numéro de téléphone par compte (lot 2) | a8c245c |

## Questions parquées

- Porteur (reprise TB3) : retour arrière SESSIONS_MULTI_APPAREILS=false après une période à true réactive les anciens refresh encore valides dans User.refreshToken ; vider la colonne au premier démarrage avec le drapeau actif ?
- Porteur (reprise TB3) : durées Q11 et invalidation unique des sessions web au déploiement, à annoncer aux utilisateurs.
- Porteur (B2, D18) : Redis arrêté, l'email et le SMS au proche d'un SOS sont perdus (journalisés seulement) ; ajouter un envoi direct de secours ?
- Porteur (B4, Q04) : numéros d'urgence de Guinée (SAMU, pompiers, police) ; seul « 15 » est servi tant que Q04 n'est pas tranchée (D29).

## Dernières décisions (5 max, historique complet dans decisions.md)

- D52 Position SOS de plus de 15 min ou de précision > 2 000 m enregistrée mais non utilisée ; 500 à 2 000 m utilisée et signalée (user)
- D54 Horodatage en avance de plus de 5 min ignoré, la position est jugée sur sa précision (révisable)
- D56 Position inutilisable : pas de lien de position au proche, relance immédiate possible (révisable)
- D59 Idempotence SOS par colonne unique (patientId, cleIdempotence) et bilan JSONB, sans Redis (révisable)
- D61 cleIdempotence et bilanDiffusion exclus de toutes les réponses SOS (révisable)
