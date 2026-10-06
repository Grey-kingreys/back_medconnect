# T05 - compose.yml : transmettre R2_* et SUPER_ADMIN_* au backend (dépôt parent)

Tier: mécanique (agent mecanique)
Audience: dev
Visuel: n/a
Background-safe: oui

Dépôt : parent de déploiement, worktree `D:/souleymane/perso-archive-20260923/perso/medconnecte/.worktrees/parent-p0` (branche `orch/p0-securite`). Ce dépôt n'a pas de hooks ni de docs/plans : la tâche est suivie dans le run du back.

## Spec

Backlog P0 point 6. Constat vérifié : `back_medconnect/src/config/env.validation.ts` exige au boot `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_PUBLIC`, `R2_BUCKET_PRIVATE`, `R2_PUBLIC_URL` (URL http ou https), `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (12 caractères minimum). Le service `backend` de `compose.yml` (bloc `environment`, vers les lignes 68 à 92) ne les transmet pas : la prod via compose ne démarre pas.

À faire, dans le worktree parent uniquement :
1. `compose.yml`, service `backend`, bloc `environment` : ajouter après le bloc « Intégrations externes » deux groupes commentés en français :
   - `# Stockage objets Cloudflare R2 (obligatoire au boot, cf. back_medconnect/src/config/env.validation.ts)` puis les 6 variables sous la forme `R2_ACCOUNT_ID: ${R2_ACCOUNT_ID}` (même style que les lignes existantes, sans valeur par défaut).
   - `# Compte super administrateur initial (obligatoire au boot)` puis `SUPER_ADMIN_EMAIL: ${SUPER_ADMIN_EMAIL}` et `SUPER_ADMIN_PASSWORD: ${SUPER_ADMIN_PASSWORD}`.
2. `.env.example` (racine du worktree) : ajouter deux sections commentées équivalentes, avec les 8 noms de variables et des valeurs vides ou des exemples manifestement factices (ex. `R2_PUBLIC_URL=https://cdn.exemple.com`, `SUPER_ADMIN_EMAIL=admin@exemple.com`, `SUPER_ADMIN_PASSWORD=` avec un commentaire « 12 caractères minimum »). Suivre le style des sections existantes du fichier. Ne jamais mettre de vrai secret.
3. Ne pas modifier `compose.prod.yml` ni `compose.override.yml` sauf si le service `backend` y redéfinit `environment` de façon à masquer ces variables (le vérifier et le dire dans le Return).
4. Ne lire aucun fichier `.env` réel (seulement `.env.example`).
Aucun tiret cadratin ni demi-cadratin dans les lignes ajoutées.

## Contraintes

Faire uniquement ce qui est demandé. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas committer. Ne pas modifier docs/plans/ du back.

## Done when

- `grep -cE "^\s+(R2_[A-Z_]+|SUPER_ADMIN_[A-Z_]+): \\$\{" compose.yml` vaut 8.
- `grep -cE "^(R2_|SUPER_ADMIN_)[A-Z_]+=" .env.example` vaut 8.
- `docker compose --env-file .env.example -f compose.yml config --quiet` (lancé depuis le worktree parent) : code retour 0 (si Docker est indisponible, le dire).

## Return

Fichiers modifiés + preuve (commande lancée, résultat en une ligne) par done-condition. Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
