# PB19b - Seeds, démo et documentation (2/2) : CLAUDE.md aux contrats exacts, Swagger, variables et procédures

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche détaillée, aucune décision laissée ouverte)
Audience: dev (documentation, Swagger, variables d'environnement)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Seconde et dernière sous-fiche de PB19 (D668), après PB19a (validée et commitée). Dernière tâche du back de la tranche. Autonome, gate verte, commitée seule (le dépôt racine reçoit un commit séparé du chef pour `.env.example` et `compose.override.yml`, précédent D635).

1. `CLAUDE.md` du back : corriger les puces devenues inexactes, réécrire la section « Mode démo » (PB19a), ajouter une puce d'exploitation qui documente les réserves de PB16 à PB18 non traitées par du code (D679, D680).
2. Swagger des 57 routes `/pharmacie` : descriptions exactes, prouvées par un test (D678).
3. Variables : `TEST_DATABASE_URL` dans `.env.example` et `compose.override.yml` de la racine ; `DESKTOP_ORIGINS` déjà présente dans l'arbre racine, vérifiée et laissée telle quelle (D677).

**Aucun changement de code applicatif hors décorateurs Swagger ; aucune migration.**

Décisions applicables : D609, D635, D664, D667, D668 à D680.

### Contexte vérifié (ne pas re-découvrir)

- Découverte des routes : `controleursDuModule` et `routesDesControleurs` (`test/etancheite-couts/decouverte-routes.ts`), `RouteDecouverte { cle, methode, chemin, controleur, handler, permissions, gardes }` ; inventaire `ROUTES_PHARMACIE` (`test/etancheite-couts/routes-pharmacie.ts`, 57 routes).
- Tous les contrôleurs de `src/pharmacie/` portent `@ApiTags` et un `@ApiOperation` par route ; `@ApiResponse` n'existe que sur `sessions-caisse`, `vente` et `points-de-vente` ; `@ApiBearerAuth` : au niveau de la classe partout sauf `pharmacie.controller.ts` (13 routes gardées sur 17, au niveau de la méthode).
- Métadonnées Swagger : `DECORATORS.API_OPERATION` et `DECORATORS.API_SECURITY` de `@nestjs/swagger/dist/constants`, posées sur la méthode (`controleur.prototype[handler]`) ou sur la classe.
- Racine du monorepo (dépôt git distinct) : `.env.example` contient déjà `DESKTOP_ORIGINS` (ajout non commité, à conserver) ; `compose.yml` (service `backend`, image `prod`, `NODE_ENV: production`) contient déjà `DESKTOP_ORIGINS: ${DESKTOP_ORIGINS:-}` ; `compose.override.yml` (dev, `target: dev`, sources montées) n'a que `NODE_ENV` dans `environment` ; le harnais lit `TEST_DATABASE_URL || DATABASE_URL` (`test/db/harnais.ts`).
- `EvenementSynchro { evenementId, posteId, sequence, type, utilisateurId, horodatageLocal, recuLe, statut, empreinte, corps, resultat }` : un événement mis de côté est `statut = 'REJETE'` avec `resultat` portant le code `EVENEMENT_INAPPLICABLE` (clé exacte à lire dans `synchro.service.ts`) ; trigger d'immuabilité, `@@unique([posteId, sequence])`, une session rejouée doit appartenir au poste (`SESSION_INCONNUE` sinon) : aucun rejeu manuel sûr n'existe en T1.

### 1. `CLAUDE.md` du back : corrections

Relire chaque puce de la section « Conventions importantes » qui touche la pharmacie (B13/B14 et PB05 à PB18) contre le code ; corriger au minimum les points suivants, et toute autre inexactitude trouvée (la lister dans le rapport) :

1. Puce « Ventes en pharmacie (B13, lot 7 ; B14, lot 8) » : garder la phrase d'en-tête (module, quatre routes, gardes, `AccesPharmacieService`, enveloppe `{ data, message, success }`) ; remplacer les sous-puces « Création », « Forme renvoyée », « Liste », « Annulation », « Erreurs sans code », « Erreurs avec code » et « Règles » par une seule sous-puce qui renvoie aux puces PB11 (création), PB12 (annulation et liste), PB17c (journée clôturée) et PB18 (rejeu) et ne garde que ce qui reste vrai : forme de base de la réponse (`id`, `numero`, `statut`, `createdAt`, `total`, `ordonnanceVerifiee`, `clientNom`, `clientTelephone`, `vendeur`, `annuleeLe`, `annuleeParId`, `motifAnnulation`, `lignes`, `pharmacie` avec `logoUrl`), `data.rejeu: true` seulement sur un rejeu, noms et prix des lignes figés, validation de `clientNom` (100), `clientTelephone` (30), 1 à 50 lignes, `details` assainis par `AllExceptionsFilter` (`CODES_AVEC_DETAILS`, 50 éléments), 404 « Cette pharmacie est introuvable. » et « Cette vente est introuvable. », vente jamais supprimée. Retirer explicitement : idempotence « dans les 24 h », numérotation `V-AAAA-NNNNNN` et `CompteurVente` pour les nouvelles ventes, annulation « du jour de sa création » et remise en stock par incrément, `ANNULATION_HORS_DELAI`, `STOCK_INSUFFISANT` et `MEDICAMENT_EXPIRE` comme refus actuels, ordre des refus de B13, retraits par décrément conditionnel, `disponible` passé à faux, alerte au franchissement de 10.
2. Sous-puce « Prix du stock désormais entier » : garder prix entiers et arrondi de l'import, permissions des rôles par défaut (vérifier le nombre de `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` dans `src/common/rbac/`) ; retirer la phrase sur `updateStockQuantite` et `SELECT ... FOR UPDATE` (remplacée par PB08).
3. Puce PB07 : « Contournement de purge ... réservé à `purgerStockPharmacies` (purge démo) et au harnais » devient « réservé à `purgerPiecesPharmacies` et `purgerStockPharmacies` (purge démo) et au harnais ».
4. Puce PB08 : supprimer « L'import Excel du stock écrit encore le compteur gelé jusqu'à PB14 et PB15. ».
5. Puce PB11 : « `annulation` (nul jusqu'à PB12) » devient « `annulation` (voir PB12) ».
6. Puce PB15a, file d'anomalies : ajouter « chaque anomalie porte `details.message` (texte lisible à afficher tel quel ; D675 pour `STOCK_NEGATIF`, `FOND_NON_COMPTE`, `ECART_CAISSE`, `ECART_INVENTAIRE`) ».
7. Section « Variables d'environnement » : ajouter `TEST_DATABASE_URL` (optionnelle, dev seulement : serveur PostgreSQL du harnais `npm run test:db`, bases jetables `mc_test_*` ; vide = serveur de `DATABASE_URL` ; jamais lue par l'application).
8. Section « Dette/risques » : « Tests : 148 tests ... » devient « Tests : tests unitaires (`npm test`, pre-push) et tests en base (`npm run test:db`, hors pre-push, D444) ; pas de tests e2e. ».

### 2. `CLAUDE.md` : section « Mode démo » réécrite (PB19a, D670 à D674)

Garder tout ce qui reste vrai (activation stricte, avertissement, comptes en `@demo.medconnecte.gn`, mots de passe aléatoires, aucun email ni SMS réel, routes `/auth/demo/*`, vitrine, ne jamais activer avec de vraies données de santé) et décrire exactement :

- deux phases : phase 1 en une transaction (structures, comptes, carnets, messagerie, SOS, notifications, points de vente, `debutCaisse` et `debutFiabiliteMarge` reculés de 30 jours, 16 fiches qualifiées à deux prix sauf Spasfon au Niger) ; phase 2 jouée par les services de la pharmacie (`ScenarioDemoPharmacieService`, `src/pharmacie/demo/`), seulement juste après une création ou une remise à zéro, une transaction par opération ; échec journalisé `demo.scenario_pharmacie_echoue`, remède `DEMO_RESET=true` ;
- contenu du scénario en une phrase par pharmacie (Kaloum : réceptions avec lots, péremptions à 7, 30 et 90 jours, un lot sans coût, inventaire avec écart et lot périmé trouvé, poste desktop « Comptoir principal » avec plage, journée J-2 clôturée et exportable, journée J-1 clôturée de force avec vente remontée en régularisation, caisses web ouvertes du jour, boîte entamée, vente sans stock, annulation, anomalies ; Niger : réception, fiche Spasfon reprise à qualifier, ruptures et stock bas) ;
- purge : comptes et leurs audits, puis `purgerPiecesPharmacies`, `purgerStockPharmacies`, `supprimerConfigurationPharmacies`, structures ; prouvée sur les 28 tables de la tranche par `test/db/demo.db-spec.ts` ; le catalogue partagé n'est jamais supprimé ;
- `npm run seed:medicaments` : ajoute au catalogue global les médicaments manquants, sans jamais créer de stock ni modifier l'existant.

Retirer « (5 structures, 20 comptes, ... stocks ...) » s'il devient inexact et toute mention d'un stock démo en lot technique.

### 3. `CLAUDE.md` : puce « Exploitation de la tranche pharmacie 1 (PB19) » (D679, D680)

Nouvelle puce après la puce PB18, en français, pour un développeur ou un exploitant :

1. **Contrôle du stock** : après une restauration, une intervention en base ou un incident, lancer `stock:verifier` (dev `docker compose exec -T backend npm run stock:verifier`, production `node dist/scripts/stock-verifier.js` par `docker compose run --rm --entrypoint ""`) ; agrégats ou conditionnements faux : `stock:reconstruire` ; lots négatifs, plages superposées ou allocations incohérentes : analyse requise, jamais de correction SQL des tables immuables.
2. **Événement mis de côté** (`REJETE` `EVENEMENT_INAPPLICABLE`, D664) : (a) le repérer par l'anomalie `EVENEMENT_REJETE` du titulaire (`details.evenementId`) ; (b) lire son corps en lecture seule : `docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '<requête>'` avec une requête `SELECT "evenementId", "sequence", "type", "horodatageLocal", "corps", "resultat" FROM "EvenementSynchro" WHERE "statut" = 'REJETE' AND <code EVENEMENT_INAPPLICABLE dans resultat> ORDER BY "recuLe"` (écrire la condition exacte d'après la clé lue dans `synchro.service.ts`, guillemets du shell adaptés) ; (c) corriger la cause côté serveur et déployer ; (d) aucun rejeu n'existe en T1 : ne jamais modifier, supprimer ni réinsérer la ligne (immuabilité, séquence du poste déjà avancée) ; reporter l'effet à la main : une `VENTE` est ressaisie par le titulaire sur sa caisse web (mêmes médicaments, prix et paiements) quand l'argent du tiroir du poste lui est remis, puis l'anomalie est traitée en citant le numéro du ticket d'origine ; tout autre type : traiter l'anomalie avec un commentaire qui décrit la correction faite. Un outil de rejeu reste à décider (porteur).
3. **Argent d'une régularisation hors clôture** (D659, D667) : une vente remontée après une clôture forcée reste sur la caisse d'origine, jamais incluse : son argent n'entre dans aucun `TotalClotureMode`. Le titulaire le voit par `REMONTEE_APRES_CLOTURE` (raison `JOURNEE_CLOTUREE` au vendeur, raison `CAISSE_FERMEE_APRES_CLOTURE` à lui-même avec `montantEncaisse`), par l'export du jour de rattachement (« Non » dans « Caisse incluse dans la clôture ») et par le bilan de la caisse d'origine. Procédure : recompter le tiroir, traiter l'anomalie avec le montant constaté ; ne saisir ni apport ni vente de plus (la vente est déjà enregistrée). Un rapprochement explicite reste à concevoir (porteur).
4. **Paiement arrivé après la fermeture d'une caisse du jour** (raison `CAISSE_FERMEE`, `jourMetier` égal à `jourMetierOrigine`) : la caisse est incluse dans la clôture du jour mais son bilan figé (`ResultatSessionMode`) ne compte pas ce paiement ; les totaux de clôture le sous-estiment d'autant. Le titulaire l'ajoute à la main d'après l'anomalie ; le front (PF05, PF06) affiche l'anomalie à côté de la clôture. Changement du calcul : décision du porteur.

### 4. Swagger (D678)

**Test** `src/pharmacie/swagger-pharmacie.spec.ts` (nouveau), routes de `controleursDuModule(PharmacieModule)` filtrées sur `/pharmacie`, un par un :
1. « 57 routes /pharmacie découvertes, celles de l'inventaire » : même ensemble de clés que `ROUTES_PHARMACIE`.
2. « chaque route a un résumé et une description » : `API_OPERATION` avec `summary` et `description` non vides.
3. « la description cite chaque permission exigée » : pour chaque élément de `route.permissions`, la chaîne littérale (`caisse:utiliser`, `marge:read`...) figure dans `description`.
4. « toute route gardée déclare l'authentification Bearer » : route dont `gardes` contient `AuthGuard` : `API_SECURITY` présent sur la méthode ou sur la classe ; route publique : aucune exigence.
5. « chaque contrôleur a un tag » : `ApiTags` non vide sur chaque contrôleur concerné.

**Descriptions** : corriger celles que le test refuse ; relire en plus, contre les puces PB14 à PB18 du `CLAUDE.md`, les descriptions des routes de réceptions, inventaires, sorties, anomalies, rapports (alertes, marge), clôtures (préparation, clôture, liste, export), plages, catalogue de synchro et événements : chacune cite le statut de succès, la permission et les codes d'erreur métier de la route (par exemple, événements : 200, `caisse:utiliser`, JSON jusqu'à 2 Mo, gzip accepté, 0 à 200 événements, statuts `APPLIQUE`, `DEJA_APPLIQUE`, `EN_ATTENTE`, `REJETE`, `A_RENVOYER`, 409 `POSTE_INCONNU`, 413). Texte seulement : aucun changement de route, de garde, de DTO ni de comportement. Aucune `@ApiResponse` ajoutée.

### 5. Variables (racine du monorepo, D677)

- `.env.example` : après le bloc `DESKTOP_ORIGINS`, ajouter un commentaire « Harnais de test en base (dev, `npm run test:db`) : serveur PostgreSQL où créer les bases jetables mc_test_*. Vide : celui de DATABASE_URL. Jamais lu par l'application. » et `TEST_DATABASE_URL=` (valeur vide). Ne rien changer d'autre, garder `DESKTOP_ORIGINS` tel quel.
- `compose.override.yml`, service `backend`, `environment` : ajouter `TEST_DATABASE_URL: ${TEST_DATABASE_URL:-}` après `NODE_ENV: development`.
- `compose.yml` : inchangé (vérifier seulement que `DESKTOP_ORIGINS: ${DESKTOP_ORIGINS:-}` y figure).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell ni par script. Ne jamais afficher ni écrire une URL de base, un mot de passe ou une valeur de `.env` (ne pas lire `.env`). Ne pas toucher à `docker-entrypoint.sh`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés (et seulement eux) : `CLAUDE.md` (back), `src/pharmacie/swagger-pharmacie.spec.ts`, les contrôleurs de `src/pharmacie/` (`*.controller.ts`, décorateurs Swagger seulement), et à la racine du monorepo `.env.example` et `compose.override.yml`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/pharmacie/swagger-pharmacie.spec.ts` et sur chaque contrôleur modifié : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, dont `swagger-pharmacie.spec` (5) et `etancheite-couts.spec`.
4. `docker compose exec -T backend npm run test:db` : tout vert (aucun changement attendu).
5. `git -C back_medconnect status --porcelain` ne liste que les fichiers autorisés (plus `docker-entrypoint.sh`) ; `git -C back_medconnect diff -- src/pharmacie` ne touche que des décorateurs `@Api*` et leurs imports.
6. `git diff -- .env.example compose.override.yml` (racine) : seulement les ajouts de la section 5 ; `compose.yml` sans nouveau changement.
7. `grep -n "nul jusqu'à PB12\|écrit encore le compteur gelé\|148 tests" back_medconnect/CLAUDE.md` : aucune occurrence.
8. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans les fichiers nouveaux.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne) + liste des inexactitudes corrigées hors de la section 1. Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
