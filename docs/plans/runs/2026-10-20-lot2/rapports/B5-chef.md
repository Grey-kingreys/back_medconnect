# B5 : avis du chef d'équipe back (TB17, un numéro de téléphone par compte)

Date : 2026-10-21
Branche : `orch/lot2-back`
Verdict : validé (le FAIL du vérificateur porte sur des points hors B5 ou non bloquants, détaillés plus bas)

## Ce qui a été fait

- Relecture complète du diff (14 fichiers modifiés, 10 nouveaux) contre la spec `tasks/B5-telephone-unique.md`.
- Commandes clés relancées depuis la racine du monorepo.
- Aucune modification du code livré par le codeur : une tentative d'aligner la migration sur les séquences ` ` / ` ` a été annulée (voir décisions), le fichier est revenu à l'octet près à la version appliquée en base (sha256 `e89c522d...` identique au `checksum` de `_prisma_migrations`).

## Preuves (une ligne chacune)

- `docker compose exec -T backend npx tsc --noEmit` : sortie vide, code 0.
- `docker compose exec -T backend npx eslint <17 fichiers de la tâche>` : code 0, aucune erreur.
- `docker compose exec -T backend npx jest` : 43 suites sur 43, 509 tests passés, 3 ignorés (préexistants).
- `npx jest src/common/telephone src/demo/demo.telephones` après retour à l'état d'origine : 4 suites, 42 tests passés.
- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` : seule dérive = `AuditLog` (FK `AuditLog_userId_fkey` et 3 index), rien sur `User` ni `telephoneNormalise`.
- Origine de la dérive `AuditLog` : les index et la FK viennent de `20260704_add_soft_delete_audit_trail/migration.sql`, le modèle `AuditLog` de `schema.prisma` à HEAD ne les déclare pas : préexistant, hors B5.
- Base de dev : `server_encoding` = UTF8 ; `telephone_e164(E'+224 622 98 87 76')` = `+224622988776` ; regex PostgreSQL avec ` ` dans la classe fonctionne aussi.
- Migration sans réécriture : `SELECT count(*) FROM "User" WHERE telephone ~ ' '` = 20 et `telephone <> "telephoneNormalise"` = 20 sur 20 numéros : les valeurs saisies espacées sont intactes (remplace l'empreinte d'avant migration manquante).
- Couverture des écritures (grep `telephone` dans `src/`) : les 8 écritures de `User.telephone` passent par `exigerTelephone` / `verifierTelephoneLibre` / `avecTelephoneUnique` ou `normaliserTelephone` (démo) ; restent seulement `Structure.telephone` (`createStructure`, `structureTelephone`, `updateStructure`, seeder démo des structures).

## Décisions prises

1. Dérive `AuditLog` dans `migrate diff` (Done when 5) : acceptée pour B5, préexistante. À traiter dans une tâche séparée de réalignement de `schema.prisma` (déclarer `@@index([createdAt])`, `@@index([entityType, entityId])`, `@@index([userId])` et l'`onUpdate` de la relation), sans nouvelle migration si le diff devient vide.
2. Empreinte d'avant migration absente (Done when 4) : écart accepté. Preuve de substitution : lecture de la migration (aucun `UPDATE` de `telephone`) et 20 numéros sur 20 encore au format saisi espacé, différents de leur forme normalisée.
3. Caractères insécables bruts (U+00A0, U+202F) dans `migration.sql` et dans un cas de `telephone.spec.ts`, au lieu des séquences ` ` / ` ` de la spec : écart accepté. Comportement identique vérifié en base UTF8. Cause : l'outillage d'écriture des agents décode `\uXXXX` en caractère brut (reproduit par le chef). Corriger maintenant changerait la somme de contrôle d'une migration déjà appliquée en dev ; à reprendre seulement par un script qui écrit l'octet `\` (par exemple `String.fromCharCode(92)`) ET mise à jour du `checksum` dans `_prisma_migrations` de dev, avant tout déploiement.
4. Fichiers `docs/plans/ACTIVE.md` et `decisions.md` : écrits par l'orchestrateur (ligne B5, D40 à D51), commités avec la tâche comme prévu.
5. Message de validation du DTO : un numéro de 5 à 7 caractères est refusé par `@Length(8, 20)` avec le message générique, pas `MESSAGE_TELEPHONE_INVALIDE`. Conforme à D44 (DTO inchangés) ; code `VALIDATION` et champ `telephone` présents dans les deux cas.

## Qualité (revue du chef)

- Sécurité : aucune écriture applicative de `telephoneNormalise` ; course entre deux écritures traduite en 409 par `avecTelephoneUnique` (P2002 filtré sur la colonne, les autres P2002 remontent intacts) ; aucune donnée sensible dans les messages ; script en `BEGIN READ ONLY` puis `ROLLBACK`.
- Cohérence : codes au catalogue `codes-erreur.ts`, contrat `{ message, code, champs }` passé par `AllExceptionsFilter` (testé), imports relatifs dans le script exécuté sans `tsconfig-paths`.
- Textes visibles en français, sans tiret cadratin ni demi-cadratin.
- Web et mobile : les DTO ne changent pas ; un numéro stocké passe de la forme saisie à `+224XXXXXXXXX` pour les nouvelles écritures (affichage côté front inchangé dans sa logique). `requestOtp` retrouve aussi les anciennes saisies (`OR` sur `telephoneNormalise` et les variantes). Pas de régression vue.
- `super-admin.service.ts` : reformatage prettier demandé par la spec (dette des 14 erreurs) plus un `eslint-disable-next-line` justifié ; aucune autre modification de `createStructure`.

## Réserves

- Mode démo : si un vrai compte porte déjà un numéro du jeu démo, le seed (une transaction) échoue sur l'index unique. Risque faible (mode démo réservé aux instances sans vraies données) ; à garder en tête pour `DEMO_RESET`.
- Production : lancer `telephones:doublons` avant de déployer ; tout doublon bloque la migration (décision porteur, D48).
- Jest signale un worker non arrêté proprement (préexistant, sans effet sur le résultat).
