# PB19a - Vérification indépendante

Verdict : PASS (aucun défaut bloquant ; trois remarques mineures).

## Commandes lancées (depuis la racine du monorepo)

| Commande | Résultat |
|---|---|
| `docker compose exec -T backend npx tsc --noEmit` | aucune erreur |
| `docker compose exec -T backend npx eslint` sur les 18 fichiers `.ts` modifiés ou créés | aucune erreur |
| `npm test` | 100 suites, 1106 passés, 3 ignorés (attendu 1106) |
| `npm run test:db` (seul à le lancer) | 35 suites, 409 passés (attendu 409) |
| `jest --config test/db/jest-db.json demo.db-spec` x2 | 10/10 les deux fois (stable) |
| Démarrage du backend de dev | « Nest application successfully started », « Données de démonstration déjà présentes : aucune création » ; aucune création, aucun scénario joué ; les seules erreurs des logs sont d'anciens `SIGTERM` de `nest start --watch` |
| `git diff --stat -- prisma/schema.prisma prisma/migrations test/db/instantanes` | vide |
| `grep -rnE "lotStock\|mouvementStock\|coutUnitaire\|LotStock" src/demo` (hors spec) | aucune occurrence |
| Octets U+2014 et U+2013 dans les lignes ajoutées et les fichiers nouveaux | 0 |
| CR dans les fichiers nouveaux, fichiers `.bak` ou `.orig` | 0 |
| `git status --porcelain` | uniquement les fichiers autorisés, plus `docker-entrypoint.sh` (hors périmètre), plus `ACTIVE.md`, `decisions.md` et les deux fiches PB19 sous `docs/plans/` (travail du chef, pas du codeur) |

DEMO_RESET et le seed n'ont jamais été lancés sur la base de dev ; les tests passent par une base jetable (`creerBaseVide`).

## Conformité à la fiche

- D669 : `prisma/seed_medicaments.ts` ne contient que le catalogue global (12 médicaments, `findFirst` par nom puis `create`, jamais de mise à jour ni de suppression), aucune écriture de `StockMedicament`, de lot, de structure ni de pharmacie ; journal en français sans émoji ; `process.exitCode = 1` ; aucune URL affichée ; script npm `seed:medicaments` seule ligne changée de `package.json`. Conforme.
- D670 : `onApplicationBootstrap` retient `cree` (création ou bilan de remise à zéro non nul), le premier `try` garde `demo.seed_echoue` et sort par `return` en cas d'échec (le scénario n'est donc pas joué sur une base à moitié créée : bon), la phase 2 est dans un second `try`, succès journalisé au format de la fiche, échec journalisé `demo.scenario_pharmacie_echoue` avec le remède `DEMO_RESET=true`, jamais relancé. Données déjà présentes ou mode inactif : rien n'est joué. Couvert par les six tests unitaires ajoutés. Conforme.
- Phase 1 : `debutCaisse` et `debutFiabiliteMarge` reculés de 30 jours (minuit UTC de `jourConakry` moins 30), fiches créées à quantité nulle avec tous les champs de D673 (valeurs relues une à une contre D673 : coefficients, prix boîte et unité, tolérances, `qualifie`, `notes` de Ventoline), bloc « Stock initial » supprimé, `demo.seeder.ts` sans lot, mouvement, allocation ni coût. Conforme.
- D672 : `jouer` suit les onze étapes de la fiche par les méthodes publiques des services ; seule écriture directe : le lot repris du Spasfon via `MouvementsStockService.creerLot` (lot technique, jamais de pièce `MIGRATION`). Bilan attendu égal à celui de la fiche (testé en base). État final du stock égal aux valeurs de la fiche pour les 16 fiches (testé), `verifierStock` sans anomalie.
- D673 et D674 : noms de fournisseurs, bordereaux, références Mobile Money, téléphones `+224` inventés ; aucun nom ni téléphone de client (aucun champ client dans les données) ; prix GNF entiers (15 000, 85 000, 45 000, 3 000, 1 200...) ; aucune donnée de santé réelle. Conforme.
- D675 : clé `message` ajoutée en dernier dans `details` des quatre anomalies (`ecriture-vente.ts` ~200-224, `sessions-caisse.service.ts`, `inventaires.service.ts`). Le texte `STOCK_NEGATIF` est construit dans le seul cœur partagé `ecrirePieceVente` (web et rejeu) : identique par construction. `quantiteProvisoireLocale` absente ou non numérique donne 0. L'écart signé `+N` est géré pour `ECART_CAISSE` et `ECART_INVENTAIRE`. Textes conformes à la fiche.
- D676 : `purger` publique, ordre inchangé. Le test 9 calcule le point fixe `Restrict` depuis `prisma/schema.prisma` (regex sur les relations `fields:` avec `onDelete: Restrict`), le compare à la liste en dur de 28 modèles (égalité exacte, donc une table ajoutée plus tard sans purge casse le test), exige au moins une ligne par modèle avant, zéro après la purge dans une transaction annulée par sentinelle, puis vérifie que la transaction n'a rien laissé. Le test 10 couvre purge, recréation et mêmes comptes. Aucune table manquante n'a été révélée : aucune modification des fonctions de purge.
- Mode démo inactif par défaut : la sortie anticipée de `onApplicationBootstrap` est inchangée, couverte par « mode inactif : rien n'est créé ni joué ».
- `etancheite-couts.spec.ts` : seul changement, l'attendu devient `[]`.

## Écarts déclarés à juger

(a) Trois conditionnements ouverts au lieu de deux : justifié. Glucophage lot `GL24D300` : 12 boîtes de 30 = 360 unités ; l'inventaire compte 11 boîtes et 25 unités = 355 (écart -5, valeur que la fiche elle-même impose dans l'état final). 355 n'est pas multiple de 30, donc une boîte est forcément entamée (25 restantes). La fiche se contredisait (« exactement deux » mais 355 comme état final) ; le service est correct et l'attendu du test corrigé avec un commentaire explicite (`test/db/demo.db-spec.ts` ~378). Ce n'est pas un affaiblissement : la liste exacte des trois noms est toujours testée par `toEqual`. Doliprane `DL23K052` (32 - 16 - 6 - 4 = 6) et Flagyl (280 - 10 = 270) vérifiés de même. Atout pour les testeurs : une boîte entamée de plus à l'écran.

(b) `reculerDebutsCaisseDemo` déplacé dans `src/pharmacie/demo/scenario-demo-pharmacie.service.ts` : rangement légitime, pas un contournement. Le motif du balayage (`etancheite-couts.spec.ts`) interdit hors `src/pharmacie/` la lecture de `lotStock`, `allocationLot`, `coutUnitaire`, `coutAchatBoite` et `debutFiabiliteMarge`, parce que cette dernière conditionne la fiabilité d'une marge calculée sur des coûts ; la fiche (écrire `debutFiabiliteMarge` dans le seeder) contredisait donc D609 et D671 (« le code qui touche aux coûts reste dans `src/pharmacie/` »). La fonction écrit la date sans jamais l'exposer ni la lire ; le balayage n'est pas affaibli (motif et liste vide intacts) et la règle reste respectée dans son esprit. Recommandation : accepter tel quel. Deux ajustements facultatifs : (1) consigner l'écart dans `decisions.md` (D671 mentionne le service mais pas cette fonction exportée) ; (2) la fonction vit dans le fichier du service sans être dans les `exports` du module : le seeder l'importe par chemin, ce qui est cohérent avec les autres imports `src/pharmacie/...` du seeder.

(c) Le dev garde l'ancien format tant que `DEMO_RESET` n'est pas activé : conforme au comportement voulu (« données déjà présentes : rien n'est joué »). Vérifié au démarrage : message « déjà présentes : aucune création », stock de dev intact. Les testeurs du front doivent faire un `DEMO_RESET=true` volontaire une fois pour voir le scénario ; à rappeler dans la documentation PB19b.

## Assertions `message` ajoutées dans les quatre db-specs existants

Aucun affaiblissement : les assertions précédentes sont conservées, seules des vérifications sont ajoutées.
- `vente.db-spec.ts` : `toBe` sur le texte complet de `STOCK_NEGATIF` (`nom`, numéro de vente, poste, vendeur, solde -2). Strict.
- `sessions-caisse.db-spec.ts` : `toBe` complets pour `FOND_NON_COMPTE` et `ECART_CAISSE`. L'ancienne assertion `posteCode` est réécrite en deux lignes équivalentes (`details.posteCode` toujours testé).
- `inventaire.db-spec.ts` : `toBe` complet pour `ECART_INVENTAIRE`.
- `synchro-ventes.db-spec.ts` : deux `toContain` (fin du texte et début « le poste D1 a vendu 2 unité(s) sans stock (vente »). Plus lâche que les autres car le numéro de ticket et le nom varient, mais le texte du cas « sans reste provisoire » est bien distingué du cas web.

## Problèmes

Aucun bloquant. Remarques mineures :
1. `test/db/synchro-ventes.db-spec.ts` : `toContain` au lieu d'un `toBe` complet ; resserrable en reconstruisant le numéro de ticket et le nom comme dans `vente.db-spec.ts`.
2. `decisions.md` : D671 ne mentionne pas le déplacement de `reculerDebutsCaisseDemo` (écart (b)) ni la correction du nombre de conditionnements ouverts (écart (a), la fiche et D672 disent « deux »).
3. `src/demo/demo.seeder.ts` (bloc `onApplicationBootstrap`) : si `rattacherRoles` échoue après une création réussie, le scénario n'est pas joué et seul `demo.seed_echoue` est journalisé : choix prudent et cohérent avec D670, mais le journal ne dit pas que la phase 2 a été sautée.
