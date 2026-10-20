# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-20-tb3-sessions | Branche: orch/tb3-sessions | Parallélisme: 1 (tâches séquentielles, arbre principal) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-20-tb3-sessions/ (lot TB3 du plan mobile, adaptations B01 et B02 ; décisions dans decisions.md)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| T03 | Connexion, inscription, démo et invitation par session d'appareil | spécifié | parqué, code non commité dans l'arbre ; livré par T99 (D19) | 3 |
| T04 | Refresh et déconnexion, web par cookie et mobile par le corps | spécifié | absorbé par T99 (D19) | 0 |
| T99 | Corrections de la revue de sécurité : T03 et T04 ensemble, secret de grâce effacé | spécifié | à faire (prochaine) | 0 |
| T05 | Documentation, variable d'environnement et parcours réel | spécifié | à faire (après T99) | 0 |

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|
| T01 | Modèle Prisma Session et migration additive | 6620169 |
| T02 | Service de sessions, codes d'erreur et drapeau | 2f7b489 |

## Questions parquées

- T03 : régression web si commité seul (User.refreshToken plus écrit, encore lu par refreshAccessToken). Tranché par D19 : livraison commune T03, T04, T99.
- Revue de sécurité : graceSecretEnc jamais effacé. Tranché par D20, corrigé en T99.
- Porteur : retour arrière SESSIONS_MULTI_APPAREILS=false après une période à true réactive les anciens refresh encore valides dans User.refreshToken (30 j) ; vider la colonne au premier démarrage avec le drapeau actif ?
- Porteur : durées Q11 (D03) et invalidation unique des sessions web au déploiement (D13), à annoncer aux utilisateurs.

## Dernières décisions (5 max, historique complet dans decisions.md)

- D19 T03 et T04 livrés dans un seul commit avec T99 (révisable)
- D20 graceSecretEnc effacé à la révocation et purgé toutes les 60 s après la grâce (révisable)
- D21 Secret inconnu avec un identifiant de session valide : révocation acceptée (révisable)
- D05 Grâce 30 s : l'ancien refresh renvoie le refresh courant chiffré par EncryptionService (révisable)
- D12 Drapeau SESSIONS_MULTI_APPAREILS (défaut true), false = ancien refresh unique
