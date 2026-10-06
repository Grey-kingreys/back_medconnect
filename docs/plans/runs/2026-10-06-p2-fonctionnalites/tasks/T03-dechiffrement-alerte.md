# T03 - Déchiffrement : alerte structurée et valeurs non chiffrées signalées (point 19)

Tier: spécifié (agent implementeur-specifie)
Audience: dev (logs uniquement)
Visuel: n/a
Background-safe: oui

## Spec

Contexte : `src/common/services/encryption.service.ts`, méthode `decrypt` (format stocké `ivHex:authTagHex:texteHex`, IV de 12 octets donc 24 caractères hexadécimaux, tag GCM de 16 octets donc 32 caractères). Décision D09 dans `docs/plans/runs/2026-10-06-p2-fonctionnalites/decisions.md` : la valeur de repli renvoyée en cas d'échec reste exactement `' [Donnée illisible] '`.

1. Ne pas changer `encrypt` ni le format.
2. Dans `decrypt` : si la valeur est vide, la renvoyer telle quelle (comme aujourd'hui). Si elle ne correspond pas au format chiffré (regex stricte `^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$`, insensible à la casse), journaliser `this.logger.warn` un événement structuré `encryption.valeur_non_chiffree` avec uniquement `{ longueur }` (jamais le contenu, jamais un extrait), puis renvoyer la valeur telle quelle (comportement identique à aujourd'hui pour une valeur sans « : » ; pour une valeur en clair contenant « : », elle est désormais renvoyée telle quelle au lieu de « [Donnée illisible] »).
3. En cas d'échec de déchiffrement (format valide mais clé ou données invalides) : `this.logger.warn` (ou `error`, garder `error`) d'un événement structuré `encryption.dechiffrement_echoue` avec `{ raison: error.name ou un code court, longueur }`, sans le message brut s'il pouvait contenir des données, sans le contenu. Corriger au passage le texte mixte anglais de la ligne actuelle (et son tiret cadratin) : texte du log en français.
4. Tests : nouveau fichier `src/common/services/encryption.service.spec.ts` (ConfigService simulé renvoyant une clé hex de 64 caractères générée dans le test) : aller-retour chiffrer/déchiffrer ; valeur en clair renvoyée telle quelle + `warn` appelé une fois sans le contenu dans les arguments ; valeur chiffrée altérée renvoie `' [Donnée illisible] '` et journalise `encryption.dechiffrement_echoue` sans le contenu ; chaîne vide renvoyée telle quelle sans log. Espionner le logger via `jest.spyOn((service as any).logger, 'warn')` ou équivalent.

## Contraintes

Faire uniquement ce qui est demandé. Règles typographiques et de langue : docs/ORCHESTRATOR.md (sections 4, 5). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Aucun tiret cadratin ou demi-cadratin dans les lignes ajoutées ou modifiées. Aucun commit.

## Done when

- `npx --no-install tsc --noEmit` sans erreur ; `npm test` vert avec le nouveau spec ; eslint des fichiers touchés sans erreur introduite.

## Return

Fichiers modifiés et créés + preuves (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

## Validation
