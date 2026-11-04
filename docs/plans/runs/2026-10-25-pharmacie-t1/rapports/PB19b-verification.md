# PB19b - Vérification indépendante

Verdict : PASS (aucun défaut bloquant ; trois remarques mineures, une recommandation de sécurité facultative).

## Commandes lancées (depuis la racine du monorepo)

| Commande | Résultat |
|---|---|
| `docker compose exec -T backend npx tsc --noEmit` | aucune erreur |
| `docker compose exec -T backend npx eslint` sur `swagger-pharmacie.spec.ts` et tous les `*.controller.ts` de `src/pharmacie/` | 0 erreur, 7 avertissements `no-unsafe-argument` (anciens, hors décorateurs) |
| `docker compose exec -T backend npm test` | 101 suites, 1112 passés, 3 ignorés (attendu 1112) |
| `docker compose exec -T backend npm run test:db` (seul à le lancer) | 35 suites, 409 passés (attendu 409) |
| Journal du backend de dev (`docker compose logs backend`) | « Nest application successfully started », « Données de démonstration déjà présentes : aucune création », Swagger servi ; aucune erreur |
| `git diff -U0 -- src/pharmacie` hors lignes `@Api*` | uniquement des chaînes de texte à l'intérieur de `@ApiOperation` ; aucune importation, aucune garde, aucun DTO, aucune ligne de code modifiés |
| U+2014 et U+2013 dans les lignes ajoutées (CLAUDE.md, contrôleurs) et dans `swagger-pharmacie.spec.ts` | 0 |
| `grep "nul jusqu'à PB12\|écrit encore le compteur gelé\|148 tests" CLAUDE.md` | aucune occurrence |

DEMO_RESET, prisma migrate, reset et db push n'ont pas été lancés ; aucune valeur de `.env` lue ni affichée.

## 1. Gate et démarrage

Conforme à la fiche, nombres identiques à l'annonce du codeur. Le `swagger-pharmacie.spec` (5 tests) et `etancheite-couts.spec` passent. Le test Swagger lit les métadonnées réelles (57 routes découvertes comparées à `ROUTES_PHARMACIE`, résumé et description, chaque permission exigée citée, Bearer sur toute route gardée, tag par contrôleur) : il prouve ce que dit la fiche.

## 2. Diff `src/pharmacie`

12 contrôleurs modifiés, 194 insertions, 82 suppressions, toutes dans des décorateurs Swagger (`@ApiOperation` ajoutés ou réécrits, quelques `@ApiResponse` déjà présents). `git diff` ne signale rien d'autre. Seul écart à la lettre de la fiche (« Aucune `@ApiResponse` ajoutée ») : aucun ajout détecté, le seul `@ApiResponse` visible dans le diff de `sessions-caisse.controller.ts` est un décorateur existant déplacé dans la même opération. Sans conséquence. `docker-entrypoint.sh` figure dans `git status` mais son diff est vide (fin de ligne seulement), hors du travail du codeur.

## 3. CLAUDE.md contre le code (27 affirmations contrôlées)

Exactes (code lu) :
1. Les six routes de session sont en 200 (`@HttpCode(OK)`), `GET ?jour=` exige `caisse:superviser`, les autres `caisse:utiliser`.
2. `GET courante` ne contrôle pas le vendeur (`sessions-caisse.service.ts:256-286`).
3. Rôle Pharmacien : liste exacte (9 permissions, sans `vente:annuler` ni `catalogue:manage`) (`permissions.constants.ts:340-355`).
4. Rôle administrateur : les 12 de `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` (tableau de 12 lignes) plus `structure:read`, `structure:write`, `membre:read`, `membre:manage`, `role:manage`.
5. Paramètres : 1 à 5 horizons distincts de 1 à 365, `seuilEcartCaisse` 0 à 10 000 000, avertissement de prix 1 à 100, stock bas 0 à 10 000, plage 100 à 10 000, rechargement 5 à 50 (`points-de-vente.dto.ts:75-115`).
6. `POST postes` en 200 ; `PATCH` poste `structure:write`.
7. Vente : 201, `vente:write` et `caisse:utiliser`, 1 à 50 lignes, `clientNom` 100, `clientTelephone` 30, 5 paiements au plus.
8. Numéros `T<ordre>-NNNNNNN` (`vente-regles.ts:23`) et `A-<numero>` (`vente-regles.ts:240`).
9. Annulation en 200, `vente:annuler` et `caisse:utiliser`.
10. Codes `SORTIE_MANUELLE_REQUISE`, `FICHE_MODIFIEE`, `STOCK_ALERTE`, `CONVERSION_IMPOSSIBLE`, `FICHE_NON_QUALIFIEE` existent dans le code.
11. Codes de clôture `CLOTURE_INCOMPLETE`, `CAISSES_A_FERMER`, `JOUR_AVANT_DEBUT_CAISSE` existent dans `clotures.service.ts`.
12. Synchro : `EVENEMENT_INAPPLICABLE` (`synchro.service.ts:417`), `EVENEMENT_INVALIDE`, `UTILISATEUR_NON_AUTORISE`, `SEQUENCE_MANQUANTE`, saut après 24 h (`DELAI_SAUT_MS`), compteur `echecImprevu`, `EVENEMENT_REJETE`, `CAISSE_FERMEE_APRES_CLOTURE`, `REMONTEE_APRES_CLOTURE`.
13. `resultat` est un JSON et le rejet y met la clé `code` : la requête de l'exploitation (`"resultat"->>'code' = 'EVENEMENT_INAPPLICABLE'`) est cohérente avec `detailsBase` ; colonnes `evenementId`, `sequence`, `type`, `horodatageLocal`, `corps`, `resultat`, `recuLe` présentes dans `EvenementSynchro`.
14. Réception : 409 `JOURNEE_CLOTUREE` pour un jour antérieur clôturé (`receptions.service.ts:303`) ; 400 `VALIDATION` pour les lignes en cause (`quantité`, date) et `recueLe` futur.
15. Mode démo : 16 fiches (10 Kaloum et 6 Niger), toutes qualifiées sauf Spasfon du Niger (`demo.donnees.ts` ~807), prix à l'unité seulement sur les déconditionnables.
16. Puces corrigées présentes : `purgerPiecesPharmacies` et `purgerStockPharmacies`, `details.message` (D675), `TEST_DATABASE_URL`, ligne « Tests » reformulée.
17. Procédure de démo : ordre des étapes, `docker compose up -d backend` pour relire le `.env`, message de succès, retour de `DEMO_RESET=false`, avertissement sur le décalage des dates.

Les sept différences relevées par le codeur sont toutes confirmées et correctement traitées : (1) Swagger de la synchro réécrit d'après le comportement réel (VENTE rejouée, 3e échec, gzip, 413, 400) ; (2) permissions du Pharmacien et de l'administrateur alignées sur le code ; (3) `GET courante` sans contrôle de vendeur (voir 4) ; (4) `JOURNEE_CLOTUREE` ajouté aux routes de caisse, vente, annulation et réception ; (5) 16 fiches ; (6) contraintes `VALIDATION` de la réception ; (7) ajouts aux descriptions (permission, succès, 404) dans tous les contrôleurs.

Remarques mineures :
- `CLAUDE.md` puce PB14c (ligne 89) : « seul le mode `livraison` existe » est contredit par la fin de la même puce (« Le mode `inventaire` (défaut ... ») ; reformuler en « le mode `livraison` exige `reception:write` ».
- Puce PB10 (ligne 80) : « `GET courante` ne contrôle pas le vendeur » ne dit pas que c'est voulu ; ajouter « (D528, voulu : un vendeur doit savoir qui occupe un poste) ».
- `GET .../caisse/sessions/courante` : la description Swagger ne mentionne pas non plus ce comportement ; une phrase aiderait les testeurs du front.

## 4. Point de sécurité : `GET sessions/courante`

Code : `courante()` vérifie l'accès à la pharmacie (`accesPharmacie.verifier`), que le poste existe, n'est pas technique et appartient au point de vente de la pharmacie, puis renvoie la session `OUVERTE` du poste sans condition sur `utilisateurId`. Le vendeur (qui a `caisse:utiliser`) voit donc de la caisse d'un autre vendeur :
- identité : `utilisateurId` et `utilisateurNom` ; poste (id, code, libellé, type) ; `ouverteLe`, `jourMetier` ;
- fond : `fondCaisse`, `fondCompte` et `comptageOuverture` complet (coupures, nombre de billets, relevés Orange Money et MTN MoMo saisis à l'ouverture, `auteurId`).
Il ne voit PAS : théorique, ventes, encaissements, apports, prélèvements, écart (le bilan reste réservé au titulaire ou à `caisse:superviser`) ; `comptageFermeture` et `commentaireEcart` sont vides tant que la caisse est ouverte.

Conformité aux décisions : conforme à D528 (`decisions.md:136`), qui dit explicitement « `GET /caisse/sessions/courante` montre la session ouverte du poste quel qu'en soit le titulaire (nom compris) », motif « un vendeur doit savoir qui occupe un poste ». `PLAN.md:336` la liste en `caisse:utiliser`. Ce n'est donc pas un trou involontaire.

Recommandation : ne rien corriger dans PB19b (décision actée, accès limité à la pharmacie et au poste, aucun montant d'activité exposé, aucun coût). Si le porteur veut durcir sans casser le front (PF03 a besoin du nom du titulaire), le correctif minimal et peu risqué est, pour un appelant qui n'est ni le titulaire ni `caisse:superviser`, de renvoyer la session sans `comptageOuverture`, `fondCaisse` ni `fondCompte` (garder `id`, `poste`, `utilisateurId`, `utilisateurNom`, `statut`, `jourMetier`, `ouverteLe`). À proposer comme question au porteur, pas comme défaut. Documenter D528 dans CLAUDE.md (voir remarque).

## 5. Racine

`git diff -- .env.example compose.override.yml compose.yml` : `.env.example` gagne le bloc `DESKTOP_ORIGINS` (ajout non commité antérieur, conservé : trois origines `http://127.0.0.1:<port>`, boucle locale, aucune valeur secrète) et le commentaire plus `TEST_DATABASE_URL=` (valeur vide) ; `compose.override.yml` gagne une seule ligne, `TEST_DATABASE_URL: ${TEST_DATABASE_URL:-}` après `NODE_ENV` ; `compose.yml` : seule ligne ajoutée `DESKTOP_ORIGINS: ${DESKTOP_ORIGINS:-}` (déjà annoncée comme existante, ajout non commité antérieur). Aucune valeur réelle. Les tirets cadratins présents dans ces fichiers sont antérieurs et absents des lignes ajoutées.

## 6. Procédures d'exploitation

- Contrôle du stock : `stock:verifier` est en lecture seule ; `stock:reconstruire` est signalé comme recalcul (sous verrou) et réservé aux agrégats et conditionnements ; la puce interdit la correction SQL des tables immuables. Exact et sans risque non signalé.
- Événement mis de côté : la requête est un `SELECT` seul, la commande `psql` lit sur l'entrée standard (le texte précise « sur l'entrée standard »), la puce interdit modification, suppression et réinsertion. Exacte avec le schéma réel. Aucune commande destructive.
- Régularisation hors clôture et paiement après fermeture : procédures manuelles cohérentes avec les raisons réelles `JOURNEE_CLOTUREE` et `CAISSE_FERMEE_APRES_CLOTURE`.
- Démo : procédure en quatre étapes sans risque caché, mais `DEMO_RESET=true` supprime physiquement les données démo (signalé : « Purge physique volontaire ») et l'avertissement final interdit l'activation sur de vraies données de santé. À noter : le backend de dev tourne déjà en `DEMO_MODE` actif.

## Problèmes

Aucun bloquant. Trois retouches facultatives de documentation (CLAUDE.md:89 et CLAUDE.md:80, description Swagger de `courante` dans `src/pharmacie/caisse/sessions-caisse.controller.ts:68-75`) et une question de durcissement à poser au porteur (point 4).
