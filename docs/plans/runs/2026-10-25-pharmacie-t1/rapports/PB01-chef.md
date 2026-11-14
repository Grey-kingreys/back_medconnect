# PB01 - Rapport du chef (Opus)

Statut : validé (verdict du vérificateur renversé après arbitrage).

## Ce qui a été fait

- Harnais `test/db/` (base jetable `mc_test_<12 hex>`, migrations appliquées dans l'ordre de Prisma, retours arrière, jeu « format actuel », `PrismaService` sur la base), script `npm run test:db` hors `npm test`, `prisma/retours-arriere/README.md`.
- Diff relu en entier : 10 fichiers créés de la liste fermée et 1 ligne dans `package.json`. Aucun fichier sous `src/`, `prisma/schema.prisma`, `prisma/migrations/`, `jest.config.js`, lock.

## Preuves (relancées par le chef)

- `tsc --noEmit` : aucune erreur.
- `eslint` sur les 4 fichiers `.ts` : aucune erreur ni avertissement.
- `npm test` : 62 suites, 715 réussis, 3 ignorés (inchangé, aucun fichier `test/db`).
- `npm run test:db` : 1 suite, 11 tests verts (avant et après la retouche du commentaire).
- Bases `mc_test_` restantes : 0.
- Contre-épreuve du point bloquant : migration fautive SANS `BEGIN`/`COMMIT` déployée par `prisma migrate deploy` sur une base jetable (dossier temporaire, supprimé après) : statut 1, table `HarnaisTemoinFautif` restante avec 1 ligne. Le constat du codeur est exact.

## Décisions prises

- D456 : Prisma n'enveloppe pas un fichier de migration dans une transaction. Repli prévu par D432 et D451 appliqué au lieu d'un BLOCKED (le fond était tranché d'avance par le plan) : toutes les migrations de la tranche (PB03, PB05, PB06, PB07, PB09) commencent par `BEGIN;` et finissent par `COMMIT;`. La migration fautive du harnais porte `BEGIN`/`COMMIT`, le test 7 prouve que Prisma n'en laisse rien.
- D457 : `ROLLBACK` après échec dans `appliquerSql` entériné (connexion réutilisable après un fichier avec `BEGIN`). Piège signalé : `ALTER TYPE ... ADD VALUE` entre `BEGIN` et `COMMIT` ne peut pas servir dans le même fichier.
- Retouche du chef : commentaire de `appliquerSql` corrigé (il affirmait à tort « transaction implicite, comme le moteur de Prisma »).

## Réserves (à reporter dans les fiches suivantes)

- Le harnais applique un fichier en transaction implicite (D448) : il ne détecte PAS l'oubli de `BEGIN`/`COMMIT`. Chaque fiche de migration (PB03, PB05, PB06, PB07, PB09) doit exiger un test statique : le fichier commence par `BEGIN;` et finit par `COMMIT;` (commentaires exclus), en plus du test « une migration qui échoue ne laisse rien ».
- Test 7 renommé par le codeur et précédé d'une garde (statut 0 : échec avec sortie masquée et tronquée) : sans risque de fuite, accepté.
- `prettier` signale `package.json` pour des fins de ligne, écart déjà présent sur HEAD, hors sujet.
