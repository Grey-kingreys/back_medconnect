# PB18a - Vérification indépendante

Verdict : **PASS**

## Commandes (depuis la racine du monorepo)

- `docker compose exec -T backend npx tsc --noEmit` : 0 erreur.
- `npx eslint` sur les 21 fichiers `.ts` autorisés plus `chat.gateway.ts` : 0 erreur. Un seul avertissement, `src/main.ts:91` (`bootstrap()` non attendu), antérieur à la fiche.
- `npm test` : 97 suites, 1060 passés, 3 skipped (1034 + 26, conforme à l'annoncé).
- `npm run test:db` (lancé seul) : 31 suites, 354 passés (337 + 10 plages + 7 synchro-http). `etancheite-couts` vert avec les deux nouvelles routes.
- Backend de dev : le conteneur tournait sur l'ancien code (démarré à 00:29, fichiers modifiés à partir de 00:40, pas de rechargement automatique). Après `docker compose restart backend` : démarrage propre, `POST /pharmacie/:structureId/postes/:posteId/plages` et `GET /pharmacie/:structureId/synchro/catalogue` mappées, aucune erreur dans les journaux. `DESKTOP_ORIGINS` absente du conteneur : cas optionnel couvert.

## Conformité à la fiche

- Fichiers modifiés : seulement les fichiers autorisés, plus `docker-entrypoint.sh` toléré. `prisma/` et `test/db/instantanes` inchangés. Racine : seuls `.env.example` (2 lignes) et `compose.yml` (1 ligne, `DESKTOP_ORIGINS: ${DESKTOP_ORIGINS:-}`) pour cette fiche, aucune valeur réelle.
- `grep -n cout catalogue-synchro.service.ts` : aucune occurrence. Aucun `select` de coût.
- Aucun U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux (les 6 occurrences de `.env.example` sont déjà dans HEAD).
- **CORS** : `origines-cors.ts` conforme (motif boucle locale, port 1024 à 65535, 10 au plus, message sans valeur, première erreur retenue, origines valides conservées même en erreur pour la passerelle socket.io). `originesCors` : front d'abord (défaut `http://localhost:3000`), puis desktop, sans doublon : aucune origine web perdue. Même fonction dans `main.ts` (plus `exposedHeaders: ['ETag']`) et `chat.gateway.ts`. Règle `DESKTOP_ORIGINS` après `SWAGGER_ENABLED`, optionnelle : la validation refuse le démarrage (test avec message sans la valeur).
- **Plages** : SQL de `lirePlagesNonEpuisees` identique à la fiche. `attribuerPlage` : poste `FOR UPDATE OF p` d'abord, puis contrôle d'idempotence par id (même poste : rejeu `cree: false` ; autre poste : 409 `IDENTIFIANT_DEJA_UTILISE`), refus à 2 plages non épuisées (`PLAGES_SUFFISANTES`), taille des paramètres (défaut 1000), prise sur `CompteurTicket` par l'upsert de la vente web, audit, réponse avec les plages en cours. P2002 sur `PlageTicket` converti en 409. Ordre des verrous poste puis compteur, aucun verrou de journée ni de caisse. Poste web, technique, inactif, inconnu ou d'une autre pharmacie : 409 `POSTE_INCONNU` (message dédié pour le web). Code `PLAGES_SUFFISANTES` ajouté au catalogue.
- **Photographie** : contenu conforme à D633 (fiches non archivées, lots à solde positif périmés compris, paramètres 7 clés, modes, coupures, pharmacie, plages, `sequenceAppliquee` et `sequenceMaxRecue` = max de l'appliquée et de la plus haute séquence reçue). Lecture en `RepeatableRead` dans une seule transaction. Tris fiches (`localeCompare` fr puis id) et lots (péremption nulle d'abord, réception, id). Poste web, technique, inactif ou inconnu : 409 (D645). Le vendeur et le titulaire reçoivent le même contenu, sans coût (CA22 étendu vérifié par `cheminsCout` pour les deux profils).
- **ETag, 304, compression** : ETag faible sha256 du JSON non compressé (donc valable pour tout encodage), `Vary: Accept-Encoding`, `Cache-Control: private, no-cache`, 304 avec liste et comparaison faible, brotli qualité 5 puis gzip niveau 6, `q=0` exclu, `*` accepté. Erreurs levées avant toute écriture sur `res`. Aucun middleware de compression global dans `main.ts` : pas de double compression.
- **CA22** : deux routes à l'inventaire (classe J, sans coût) et deux appels dans `APPELS`, avec enregistrement idempotent du poste desktop par profil. Seul `randomUUID` et l'aide ajoutés dans le fichier.
- **CLAUDE.md** : puce PB18 conforme au texte de la fiche, placée après PB17c ; `DESKTOP_ORIGINS` ajoutée à la section des variables.
- **Tests** : `origines-cors.spec.ts` (6 refus en `it.each`, 11 origines, doublon, `originesCors`), `reponse-compressee.spec.ts` (16 assertions, aller-retour brotli et gzip), cas HTTP 400 `VALIDATION` champ `id` avec service non appelé, `env.validation.spec.ts` (3 cas), `plages-tickets` (10 cas conformes à la fiche, rejeu, concurrence réelle de deux postes, taille 100 rétablie en `finally`), `synchro-http` (7 cas conformes : lot périmé, archivée, épuisée, 304 avec liste, ETag changé après PATCH de prix, br et identity, postes refusés, plage et séquence 5). Aucun test à vide.

## Écart de procédure (heredoc Bash)

- `src/pharmacie/dto/synchro.dto.ts` : conforme à la fiche (`IsString`, `IsNotEmpty`, `MaxLength(64)`, `ApiProperty`), UTF-8 sans BOM, 10 lignes toutes en CRLF.
- `AttribuerPlageDto` dans `points-de-vente.dto.ts` : `@IsUUID('all')` + `ApiProperty`, import `IsUUID` ajouté dans l'ordre alphabétique. Fichier entier en CRLF (125 lignes sur 125), sans BOM, sans tiret interdit.
- CRLF constaté sur tous les fichiers du dépôt (autocrlf), donc cohérent avec le reste. Validation complète : le test HTTP 8 prouve le refus d'un id non UUID. Écart sans conséquence sur le contenu, déjà déclaré.

## Jugement métier

- Connexion lente et chère : `ETag` calculé sur le texte non compressé, `If-None-Match` donne un 304 sans corps ; sinon brotli (typiquement bien plus petit que gzip sur du JSON répétitif). La photographie n'embarque ni description, ni historique, ni coût : champs minimaux par fiche. Réserve (non bloquante) : le 304 économise la bande passante mais pas le calcul serveur, et `jour` dans la charge change l'ETag à minuit (un téléchargement complet par jour et par poste, à confirmer acceptable).
- Poste hors ligne longtemps : deux plages de 1000 numéros en réserve, la réponse liste toujours les plages en cours (une réponse perdue ne perd aucun numéro, rejeu par id), une plage s'épuise sur dernier numéro ou plage plus récente entamée. Taille réglable de 100 à 10 000.
- Coûts : aucun coût vers un poste de caisse, même pour le titulaire (test sur les deux profils, aucun `select` de coût, grep vide).

## Problèmes

Aucun bloquant.

- Mineur : le backend de dev ne recharge pas à chaud les fichiers modifiés depuis l'hôte Windows (constaté : ancien code actif jusqu'au redémarrage manuel). Redémarrer le conteneur après modification avant toute vérification manuelle.
- Mineur : `src/main.ts:91` avertissement `no-floating-promises` préexistant.
