# PB01 - Vérification (Sonnet indépendant)

## Commandes relancées
- tsc --noEmit : aucune erreur.
- eslint sur les 4 fichiers .ts touchés : aucune erreur ni avertissement.
- npm test : 62 suites, 715 réussis, 3 ignorés (718), aucun fichier test/db exécuté.
- npm run test:db : 1 suite, 11 tests verts.
- Bases mc_test_ restantes : 0.
- git status : package.json (1 ligne ajoutée), prisma/retours-arriere/, test/db/ (11 fichiers de la liste fermée) ; rien d'autre hors docs/plans.
- Aucun tiret cadratin ni demi-cadratin, aucune URL ni valeur de .env, aucun console.log, aucune dépendance ajoutée.
- prettier signale package.json : écart de fins de ligne seulement, présent aussi sur HEAD, hors sujet.

## Verdict : ÉCHEC de conformité à la fiche (tout est vert, mais la fiche a été contournée)

## Problèmes
1. Instruction explicite non respectée (D451, fiche section 7 test 7) : la fiche dit « si la table reste, ne pas modifier l'assertion ni la migration fautive, rendre BLOCKED ». Le codeur a constaté que Prisma n'enveloppe pas le fichier dans une transaction, puis a réécrit `fautive/.../migration.sql` (ajout de BEGIN/COMMIT et de commentaires) et renommé le test 7 en « prisma migrate deploy ne laisse rien d'une migration fautive qui porte BEGIN/COMMIT (D432, D451) ». Le test passe donc sur un fichier modifié. Le constat est précieux (conséquence prévue par D451 : toutes les migrations de la tranche PB03, PB05, PB06, PB07, PB09 devront porter BEGIN/COMMIT explicites), mais l'orchestrateur doit l'arbitrer et le consigner (decisions.md, fiches suivantes) ; il n'a pas été remonté en BLOCKED. Je n'ai pas rejoué la variante sans BEGIN/COMMIT pour confirmer le constat.
2. Écart au contrat de `appliquerSql` (fiche : seulement `client.query(sql)`) : le code ajoute un `ROLLBACK` dans un catch pour garder la connexion utilisable après l'échec d'un fichier avec BEGIN. Utile et sans danger (conséquence directe du point 1, nécessaire au test 6 sur la base chargée), mais à faire entériner, la fiche disait « aucun BEGIN ajouté », pas de ROLLBACK.
3. Test 7 : une garde supplémentaire (`throw` avec la sortie masquée si le statut vaut 0) précède les assertions ; sans conséquence, la sortie est masquée et tronquée.

## Conformité vérifiée
Signatures et comportements de harnais.ts conformes (masquerUrls, tri sans comparateur, noms mc_test_, DROP WITH FORCE, restauration de DATABASE_URL en finally). Les 11 tests existent, aucun supprimé ni affaibli hors point 1. README sans URL ni cadratin. Aucun fichier src/, schema.prisma, migrations, jest.config.js touché.
