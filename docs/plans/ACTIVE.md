# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-20-lot2 | Branche: orch/lot2-back | Parallélisme: 1 (tâches séquentielles, arbre principal) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-20-lot2/ (lot 2 du plan mobile côté back ; rapports des sous-agents dans rapports/ ; décisions dans decisions.md, numérotation continuée depuis le lot 1). Run précédent : docs/plans/runs/2026-10-20-lot1/ (B1, B2, B3 faits, B3 = 9b73836 ; à archiver)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| B4 | TB5 version minimale (garde 426 VERSION_OBSOLETE), GET /app/version, GET /app/config, numéro d'urgence centralisé (tasks/B4-version-configuration-publique.md) | spécifié | à faire | 0 |
| B5 | TB17 un numéro de téléphone par compte : normalisation E.164 partagée, colonne dérivée + index unique partiel, script de doublons, 409 TELEPHONE_DEJA_UTILISE (tasks/B5-telephone-unique.md) | spécifié | à faire | 0 |

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|

## Questions parquées

- Porteur (reprise TB3) : retour arrière SESSIONS_MULTI_APPAREILS=false après une période à true réactive les anciens refresh encore valides dans User.refreshToken ; vider la colonne au premier démarrage avec le drapeau actif ?
- Porteur (reprise TB3) : durées Q11 et invalidation unique des sessions web au déploiement, à annoncer aux utilisateurs.
- Porteur (B2, D18) : Redis arrêté, l'email et le SMS au proche d'un SOS sont perdus (journalisés seulement) ; ajouter un envoi direct de secours ?
- Porteur (B4, Q04) : numéros d'urgence de Guinée (SAMU, pompiers, police) ; seul « 15 » est servi tant que Q04 n'est pas tranchée (D29).

## Dernières décisions (5 max, historique complet dans decisions.md)

- D28 Module `src/configuration-publique/`, routes publiques `/app/version` et `/app/config` sans limiteur (révisable)
- D40 Unicité du téléphone par colonne dérivée `telephoneNormalise` (trigger SQL) et index unique partiel ; D41 la migration ne change aucune valeur existante (révisable)
- D29 Un seul numéro d'urgence (`NUMERO_URGENCE_MEDICALE`, défaut 15) en liste extensible, source `src/config/numeros-urgence.ts` (révisable)
- D31 Garde 426 seulement si X-Client mobile, X-Plateforme android ou ios et X-App-Version lisible ; sinon la requête passe (révisable)
- D33 Variables au format strict, refusées au démarrage si malformées ; absentes, défauts tolérants (révisable)
- D35 X-Api-Version non traité dans B4 (révisable)
