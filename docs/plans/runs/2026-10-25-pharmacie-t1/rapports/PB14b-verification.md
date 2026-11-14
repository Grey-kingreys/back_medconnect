# PB14b - Vérification (Sonnet, indépendant)

Verdict : PASS

## Commandes relancées

- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `docker compose exec -T backend npx eslint <7 fichiers>` : aucune erreur.
- `docker compose exec -T backend npm test` : 83 suites passées, 948 tests passés, 3 ignorés (préexistants).
- `docker compose exec -T backend npm run test:db` : 20 suites, 227 tests passés (resolution, receptions, vente, annulation, qualification, non-regression-lectures, commandes-stock, schema-derive verts).
- `jest --config ./test/db/jest-db.json --runInBand test/db/resolution.db-spec.ts` x3 : 9 tests verts à chaque fois.
- `git status --porcelain` : 9 entrées, uniquement les fichiers attendus plus `docker-entrypoint.sh` (hors sujet) ; `git diff --stat -- prisma test/db/instantanes vente/annulation/receptions.db-spec.ts` : vide.
- Tirets cadratins/demi-cadratins (U+2014, U+2013) dans les lignes ajoutées et les 4 fichiers nouveaux : 0.

## Revue du diff

- Planification pure (`resolution.ts`) conforme à la fiche : contrôles RangeError, lots non périmés triés FEFO, soldes décrémentés en mémoire, ventes les plus anciennes d'abord puis identifiant, arrêt dès qu'aucune prise n'est possible, résolution partielle avec `reste`.
- `resoudreProvisoires` : fiches triées, verrou réentrant, filtre `VENTE`/`REGULARISATION` + `pieceLiee: null` + `quantite > 0` (jamais une vente annulée ni une pièce d'annulation), mouvement VENTE par lot puis contrepartie sans lot (pièce RESOLUTION, `evenementId` déterministe `resolution:<alloc>:<lot>` / `:contrepartie`), `updateMany` PROVISOIRE vers REMPLACEE avec contrôle `count === 1`, création des DEFINITIVE au coût du lot et de la PROVISOIRE du reste. Anomalies STOCK_NEGATIF non touchées.
- Réception : appel entre étapes 11 et 12 ; `resolutions` dans les trois retours (rejeux à `[]`), message additionnel, relecture en base dans `presenterReception` (triée), Swagger complété.
- Audit : `nombreResolutions` n'est ajouté que si supérieur à 0 (écart par rapport à la fiche, qui le met toujours ; jugé acceptable et conforme à la consigne du chef, les audits sans résolution gardent leur forme antérieure).
- `vente.service.ts` : seul `annulerVente` est touché (bloc 4a de relecture sous verrous, deux remplacements `origine.lignes` vers `lignesOrigine`), ordre des verrous inchangé. Correctif D578 en place, test 8 (concurrence) vert.
- Test 2 : réception de 3 puis de 10 sur une vente de 5 donne REMPLACEE 5, DEFINITIVE 3, REMPLACEE 2, DEFINITIVE 2. Cohérent avec la fiche et le PLAN : la provisoire d'origine (5) est remplacée, 3 prises définitives et 2 restantes en provisoire ; la seconde réception remplace cette provisoire de 2 et la définit. Conservation : définitives 3+2 = 5 vendues, provisoires restantes 0 ; stock calculé -2 puis 8 = somme des lots 8 (10 reçus - 2 résolus).
- Compteur gelé, journal immuable, coûts masqués (test 6 : `cheminsCout` vide pour le vendeur) : respectés.
- Tests demandés présents (10 unitaires, 9 base de test), aucun test supprimé ni affaibli, rien hors sujet, CLAUDE.md complété comme demandé.

## Problèmes

Aucun bloquant.

Remarques mineures (non bloquantes) :
- La fiche demandait `nombreResolutions` dans l'audit sans condition ; le codeur l'omet quand il vaut 0. Écart assumé, à conserver.
- Avertissement CRLF de git sur `receptions.controller.ts` (fins de ligne), sans effet fonctionnel.
