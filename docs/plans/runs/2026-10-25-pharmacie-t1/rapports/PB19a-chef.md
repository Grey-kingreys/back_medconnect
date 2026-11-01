# PB19a : contrôle du chef d'orchestration

Verdict : validé, commité (un seul commit, sans amend, hooks actifs). PB19b (documentation, Swagger, variables) reste à faire.

## Relecture du diff

- Mode démo inactif par défaut : la sortie anticipée de `onApplicationBootstrap` est inchangée (`DEMO_MODE` absent ou différent de `true` : rien n'est créé, rien n'est joué) ; `compose.yml` garde `DEMO_MODE` et `DEMO_RESET` à `false` par défaut.
- `prisma/seed_medicaments.ts` : catalogue global seulement (12 médicaments, `findFirst` par nom puis `create`), aucune écriture de `StockMedicament`, de lot, de mouvement ni de structure, aucune mise à jour ni suppression, aucune URL affichée, `process.exitCode = 1` en cas d'erreur. Seule ligne changée de `package.json` : le script `seed:medicaments`.
- Phase 1 (`DemoSeeder.inserer`) : fiches qualifiées à quantité nulle (champs de D673), bloc « Stock initial » supprimé ; `src/demo/` ne nomme plus aucun lot, mouvement ni coût (balayage d'étanchéité à liste vide).
- Phase 2 (`ScenarioDemoPharmacieService.jouer`) : uniquement des méthodes publiques des services, une transaction par opération ; seule écriture directe, le lot technique du Spasfon par `MouvementsStockService.creerLot` (jamais de pièce `MIGRATION`). Toute réponse de synchro autre que `APPLIQUE` lève une erreur explicite. Identifiants clients tirés à chaque exécution, dates relatives au jour de l'exécution (tout horodatage est passé, jamais futur).
- Aucune vraie donnée : fournisseurs, téléphones `+224`, bordereaux et références Mobile Money inventés ; aucun nom ni téléphone de client ; aucune donnée de santé.
- Messages d'anomalies (D675) : `STOCK_NEGATIF` construit dans le seul cœur partagé `ecrirePieceVente` (web et rejeu : texte identique par construction), `FOND_NON_COMPTE` et `ECART_CAISSE` dans le cœur de fermeture partagé avec le rejeu (D650), `ECART_INVENTAIRE` dans l'unique `anomalie.create` de ce type ; clé `message` toujours en dernier, aucune autre clé changée.
- Purge (D676) : `purger` publique, ordre inchangé ; le test 9 de `test/db/demo.db-spec.ts` calcule le point fixe `Restrict` depuis `schema.prisma`, exige les 28 tables peuplées puis vides après purge, puis la transaction annulée ne laisse rien ; le test 10 purge, recrée et rejoue aux mêmes comptes. Aucune table manquante.

## Corrections du chef

1. Écart (a) accepté : trois conditionnements ouverts (Doliprane `DL23K052`, Flagyl `FG24E118`, Glucophage `GL24D300`), conséquence arithmétique de l'inventaire à 355 unités (11 boîtes de 30 et 25 unités). Fiche (sections 4 et 6) et D672 corrigées.
2. Écart (b) accepté : `reculerDebutsCaisseDemo` reste dans `src/pharmacie/demo/scenario-demo-pharmacie.service.ts` ; consigné par D681 (complète D671), fiche section 3 annotée.
3. `test/db/synchro-ventes.db-spec.ts` (test 6) : les deux `toContain` remplacés par un `toBe` sur le texte complet (nom, poste, numéro de la pièce lu dans `resultat.piece`, vendeur).
4. `src/demo/demo.seeder.ts` : si `rattacherRoles` échoue après une création réussie, un avertissement `demo.scenario_pharmacie_saute` (« Scénario pharmacie de démonstration non joué : les rôles des comptes démo n'ont pas pu être rattachés. Relancez avec DEMO_RESET=true. », sans donnée sensible) suit `demo.seed_echoue` (D682) ; test unitaire 7 ajouté dans `demo.seeder.spec.ts`.

## Tests

- Unitaire : 1107 (100 suites), soit 1106 du codeur plus le test du saut journalisé.
- test:db : 409 (35 suites), dont `demo` 10 tests.

## Preuves (depuis la racine, `docker compose exec -T backend`)

- `docker compose restart backend` : « Données de démonstration déjà présentes : aucune création. » puis « Nest application successfully started » (le seul `npm error ... SIGTERM` est l'arrêt du `nest start --watch` par le redémarrage).
- `npx tsc --noEmit` : 0 erreur.
- `npx eslint` des 18 fichiers `.ts` touchés : 0 erreur.
- `npm test` : 100 suites, 1107 réussis, 3 ignorés, 0 échec.
- `npm run test:db` (lancé seul) : 35 suites, 409 réussis, 0 échec.
- `git diff --stat -- prisma/schema.prisma prisma/migrations test/db/instantanes` : vide ; `grep` lots, mouvements et coûts dans `src/demo` hors spec : vide ; aucun tiret cadratin ni demi-cadratin ajouté ; `docker-entrypoint.sh` hors du commit.
- Jamais de `DEMO_RESET` ni de seed sur la base de dev : les tests passent par une base jetable.

## Décisions

- D681 (complète D671) et D682 (complète D670) ajoutées ; D672 corrigée (trois conditionnements ouverts).
- D668 à D676 appliquées ; D677 à D680 relèvent de PB19b.

## Obtenir le nouveau jeu démo sur la base de dev (porteur)

La base de dev garde l'ancien jeu (lots techniques de D504) tant qu'aucune remise à zéro n'est faite : le seeder ne recrée rien si des données démo existent.

1. Dans le `.env` de la racine : `DEMO_MODE=true` et `DEMO_RESET=true`.
2. Recréer le conteneur pour qu'il relise l'environnement : `docker compose up -d backend` (un simple `restart` ne relit pas le `.env`).
3. Vérifier les journaux (`docker compose logs --tail 50 backend`) : « Données de démonstration supprimées puis recréées ... » puis « Scénario pharmacie de démonstration joué : 3 réceptions, 16 opérations du poste, 2 clôtures, 3 ventes web. ». En cas de `demo.scenario_pharmacie_echoue` ou `demo.scenario_pharmacie_saute`, relancer l'étape 2.
4. Remettre `DEMO_RESET=false` puis `docker compose up -d backend`, sinon chaque démarrage recrée le jeu (nouveaux identifiants, sessions démo invalidées).
5. Facultatif : `docker compose exec -T backend npm run seed:medicaments` n'ajoute que les médicaments du catalogue qui manquent, sans aucun stock.

Les dates du scénario sont relatives au jour de la remise à zéro (J) : refaire une remise à zéro un autre jour décale tout le jeu.

## Ce que les écrans du front trouveront (connexion démo, Pharmacie de Kaloum)

- PF01 (fiches et stock) : 10 fiches qualifiées à deux prix (boîte et unité pour les déconditionnables) ; boîtes entamées Doliprane (6 comprimés restants sur `DL23K052`), Flagyl et Glucophage ; stock bas Amlor ; rupture Ventoline à -1 (vente sans stock) avec sa note « Livraison attendue la semaine prochaine ». Pharmacie du Niger : Spasfon non qualifié (lot technique de 60, coefficient 1) à qualifier, Gaviscon en rupture, Coartem en stock bas.
- PF02 (réceptions, fournisseurs, lots) : deux fournisseurs, réceptions `BL-MAT-0412` (J-20, 11 lignes dont un lot d'Ibuprofène sans coût) et `BL-BON-0087` (J-3) ; Niger `BL-KAN-0153` (J-15).
- PF03 (caisse et vente) : caisse web du vendeur Ousmane Keita ouverte aujourd'hui avec W1 (Doliprane à l'unité), W2 (Ventoline, provisoire, Orange Money) et W3 (Amoxicilline) ; caisse web du titulaire ouverte avec l'annulation `A-<numero>` de W3 ; poste desktop D1 « Comptoir principal » avec une plage de 1 000 numéros et 16 événements appliqués.
- PF04 (clôture et export) : J-2 clôturée normalement (espèces théorique 213 000, compté 211 000, écart -2 000 sous le seuil ; Orange Money 87 000 ; MTN MoMo 47 000), export CSV avec 6 pièces, 7 paiements et le prélèvement de 100 000 ; J-1 clôturée de force, poste D1 manquant, avec le motif ; la vente T9 remontée apparaît en régularisation dans la journée en cours (export du jour, caisse non incluse) ; aujourd'hui reste à clôturer (caisses web ouvertes).
- PF05 (péremption et marge) : alertes `CT23H990` à 7 jours, `DL23K052` à 30, `FG24E118` à 90, lot `AG23C777` périmé (trouvé à l'inventaire, coût inconnu) ; marge de J-2 à J avec la vente T5 (Ibuprofène sans coût) non valorisable et W2 comptée à part comme provisoire.
- PF06 (anomalies) : file ouverte avec `STOCK_NEGATIF` (W2), deux `ECART_INVENTAIRE` (Glucophage -5, Augmentin +16), `REMONTEE_APRES_CLOTURE` `JOURNEE_CLOTUREE` (au vendeur), chacune avec `details.message` lisible ; la `REMONTEE_APRES_CLOTURE` `CAISSE_FERMEE_APRES_CLOTURE` est traitée avec son commentaire (filtre « traitées »).

## Réserves

- Le scénario n'est pas atomique (D670) : un échec à mi-parcours laisse un jeu partiel, signalé par `demo.scenario_pharmacie_echoue` ; remède `DEMO_RESET=true`.
- Le saut de la phase 2 n'est journalisé que pour un échec de `rattacherRoles` après création ; un échec de la création elle-même annule la transaction (rien n'est créé, rien à jouer).
- Une remise à zéro faite peu après minuit (heure de Conakry) reste correcte (tout horodatage du scénario est sur J-1 ou avant, sauf les ventes web, au présent), mais les testeurs verront une journée du jour presque vide en dehors des ventes web.
- La documentation de la procédure ci-dessus dans `CLAUDE.md` relève de PB19b (D680).
