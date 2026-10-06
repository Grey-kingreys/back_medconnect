# Décisions - run 2026-10-06-p1-beta

Append-only. Une ligne par décision. Consulter par grep avant toute question.

Format : `D<NN> | AAAA-MM-JJ | <décision> | <pourquoi> | tranché par : plan, convention, défaut (révisable) ou user | tâches : T..`

D01 | 2026-10-06 | Statut de rendez-vous (`POST rendez-vous/:id/status`) non traité ici | le point 3 (P0) couvre permission, propriété et validation du statut de cet endpoint ; éviter un conflit de merge | plan | T06
D02 | 2026-10-06 | Limiteur de débit Redis parqué | pas de stockage Redis prêt à l'emploi dans les dépendances ; un stockage maison impose de choisir le comportement si Redis tombe (bloquer ou laisser passer), choix réservé au porteur | défaut (révisable) | T04
D03 | 2026-10-06 | Analyses et vaccinations filtrées pour une structure autorisée via l'établissement actuel de leur auteur (`medecin.structureId`) | ces tables n'ont pas de `structureId` ; une migration est hors périmètre P1 | défaut (révisable) | T03
D04 | 2026-10-06 | Patient qui saisit sa propre consultation : `structureId` du corps conservé tel quel | comportement existant, auto-déclaration du patient sur son propre carnet | défaut (révisable) | T03
D05 | 2026-10-06 | Secret partagé IA : variable `AI_SHARED_SECRET`, en-tête `X-MedConnecte-Secret`, contrôle désactivé si la variable est absente ; `/` et `/health` restent publics | ne rien casser au déploiement actuel (Hugging Face) | défaut (révisable) | T07, T13
D06 | 2026-10-06 | Service urgence : seuil de similarité gardé à 0.3, rendu configurable par `SEUIL_SIMILARITE` | ce dépôt n'a pas de config.json et la similarité cosinus n'est pas une probabilité : le 0.5 de la config du diagnostic ne s'y applique pas | défaut (révisable) | T13
D07 | 2026-10-06 | Lint des fichiers touchés (le pre-commit lint tout fichier indexé) : 1) `npx --no-install eslint --fix <fichier>` (formatage prettier, déterministe) ; 2) corriger les erreurs restantes sur les lignes touchées par la tâche ; 3) pour la dette préexistante non corrigeable automatiquement (règles `no-unsafe-*`, `no-explicit-any`, etc.), un seul commentaire `/* eslint-disable <règles exactes> */` en tête de fichier, précédé de « Dette de typage préexistante, backlog points 21 et 22 » | sans cela aucun commit ne passe sur ces fichiers ; la désactivation ciblée et documentée évite un refactor hors tâche et limite les conflits avec les autres niveaux | défaut (révisable) | toutes
