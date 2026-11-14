# PB18b : vérification indépendante

Verdict : PASS (aucun défaut bloquant ; trois remarques non bloquantes, dont une recommandation sur la limite de corps).

Base : branche orch/pharmacie-t1-back, commit a3377ae (PB18a), modifications non commitées de PB18b.

## Commandes lancées

| Commande (depuis la racine, via docker compose exec -T backend) | Résultat |
|---|---|
| npx tsc --noEmit | 0 erreur |
| npx eslint (15 fichiers .ts modifiés ou nouveaux) | 0 erreur, 1 avertissement (main.ts:95 no-floating-promises, ligne préexistante non touchée) |
| npm test | 99 suites, 1072 passés, 3 ignorés (référence 1060, annoncé 1072) |
| npm run test:db (seul lancé par moi) | 32 suites, 374 tests verts (référence 354 en 31 suites, annoncé 374 en 32) |
| jest test/db/synchro-caisse + journee-cloturee, deux fois | 28 passés les deux fois, stable |
| git diff --stat -- prisma test/db/instantanes sessions-caisse.db-spec clotures.db-spec | vide |
| grep verrouillerJourneesPartage synchro.service.ts | lignes 385 (traitement), 477 (rejet), 1022 (saut) : première instruction de chaque transaction |
| Recherche U+2013 et U+2014 (fichiers nouveaux et lignes ajoutées) | aucun |
| Journaux du backend de dev | démarré sans erreur, route POST /pharmacie/:structureId/synchro/evenements mappée, Nest application successfully started (le SIGTERM visible plus haut est le redémarrage par le watch) |

git status : uniquement les fichiers autorisés ; docker-entrypoint.sh figure comme modifié mais son diff est vide (simple avertissement de fin de ligne), donc rien à reprocher.

## Conformité à la fiche

- Empreinte (D638) : sha256 du JSON canonique { sequence, type, horodatageLocal, utilisateurId, corps }, undefined remplacé par null (rejeu-regles.ts). Rejeu identique : DEJA_APPLIQUE avec le résultat stocké ; contenu différent ou autre poste : EVENEMENT_MODIFIE sans écriture hormis une anomalie dédupliquée par evenementId ; autre evenementId sur la même séquence : SEQUENCE_DEJA_UTILISEE de même (synchro.service.ts:392 à 414, 518 à 550).
- Ordre (D642, D643) : tri par séquence puis position, EN_ATTENTE au-delà de derniere + 1, drainage après chaque avancée (`differe`), saut après 24 h sur le plus ancien EN_ATTENTE avec SEQUENCE_MANQUANTE (premiere, derniere, nombre), événement manquant ensuite appliqué avec `horsOrdre` sans toucher la séquence.
- Transactions (D639, D640, D641) : une par événement ; verrou de journée partagé puis `SELECT ... FOR UPDATE` du poste, puis session ; erreur imprévue : rien d'écrit, A_RENVOYER, et les suivants du lot sont renvoyés sans traitement ; refus métier : transaction annulée puis seconde transaction (mêmes verrous) qui stocke la ligne REJETE avec son corps, avance la séquence et crée EVENEMENT_REJETE. Les details sont en liste blanche, `resume` sans clientNom ni clientTelephone, jamais le corps. Les journaux ne portent que posteId, séquence, evenementId et le nom de la classe d'erreur.
- Événements de caisse (D647 à D649) : ouverture au jour local ou, si ce jour est clôturé, au jour de rattachement avec `jourMetierOrigine` ; fermeture automatique d'une caisse restée ouverte avec SEQUENCE_MANQUANTE ; comptage et mouvement acceptés sur caisse ouverte d'un jour clôturé (aucun appel à exigerJourOuvert) ; SESSION_FERMEE jamais refusée (déjà fermée : SESSION_DEJA_FERMEE sans écriture) ; ECART_CAISSE (comptage absent) et REMONTEE_APRES_CLOTURE créées, caisse jamais INCLUSE.
- dernierContactLe et dernierEtat (D646) écrits en fin d'appel, fileVide = déclaré et rien en attente et pas de A_RENVOYER. Poste inactif accepté (D645). Attribution (D644) : utilisateur de la pharmacie ou son administrateur.
- Extraction D650 : le diff (comparé sans les espaces) ne fait que déplacer le corps de `fermer` dans `fermerSessionVerrouillee`, avec exigerComptage et exigerCommentaire vrais côté web, `fermeeLeLocal`, `evenementFermetureId` et `horodatageLocal` paramétrés, anomalies renvoyées. Messages, codes, ordre des contrôles et identifiant `fermeture:<sessionId>` inchangés ; le `let s` devient `const` côté web, `s` est réassigné dans la nouvelle méthode. sessions-caisse, clotures, journee-cloturee (tests 1 à 10) et sessions-caisse.http inchangés et verts.
- Test 11 de journee-cloturee : septième écrivain (rejeu) ajouté, `attendreAttentes(7)`, assertion REJETE SESSION_INCONNUE ; aucune autre ligne modifiée.
- CA22 : route inventoriée et appelée dans etancheite-couts, verte.

## Limite de corps de 2 Mo (D636)

`app.useBodyParser('json', { limit })` remplace l'analyseur JSON par défaut pour toute l'application : TOUTES les routes passent de 100 ko à 2 Mo, y compris les routes publiques (/auth/login, /auth/register, /auth/forgot-password, /auth/demo/connexion). Le gzip est accepté partout, mais la limite s'applique à la taille décompressée (pas de bombe de décompression au-delà de 2 Mo).

Risque : l'analyse du corps (middleware) précède les gardes, donc le limiteur de débit ; un client anonyme peut faire analyser 2 Mo par requête avant d'être compté. Avec 60 requêtes par minute et par IP, l'impact reste modeste pour une IP unique, mais il est multiplié par 20 par rapport à aujourd'hui et s'ajoute à la mémoire et au processeur de JSON.parse sur des attaques distribuées. Risque jugé faible à moyen, non bloquant, et conforme à la fiche.

Recommandation (suite, hors PB18b) : limiter 2 Mo à la seule route de synchro. Dans main.ts, avant l'init, enregistrer `app.use('/pharmacie/:structureId/synchro/evenements', json({ limit: '2mb' }))` (le premier analyseur qui lit le corps prime) et garder l'analyseur par défaut à 100 ko pour le reste, ou déclarer `bodyParser: false` à la création et monter les deux analyseurs explicitement. À décider avec le porteur, car cela s'écarte de la lettre de la fiche et de D636.

## Écarts déclarés

- `@IsDefined` sur `etat` (synchro.dto.ts:100) : justifié, `@ValidateNested` seul laisse passer `undefined` et le test 10 de synchro-http attend un 400. Accepté.
- Test 6 de synchro-caisse : D reste attendu par la clôture pour SESSION_OUVERTE (caisse S2 toujours ouverte) mais plus pour FILE_NON_VIDE. Le comportement est correct (D616) et le test vérifie bien la disparition de la raison de file non vide. Accepté.
- `.serialize` dans le test gzip (synchro-http:481) : nécessaire pour envoyer un tampon binaire avec supertest. Accepté.
- Hypothèses sur le contenu des anomalies : conformes à la liste blanche de la fiche, aucune donnée du client. Accepté.
- `mouvementsStock` injecté mais non lu (synchro.service.ts:143) : voulu par la fiche (constructeur définitif pour PB18c), commenté. Accepté.

## Remarques métier

1. Poste hors ligne une journée entière : les lots de 200 arrivent triés, s'appliquent dans l'ordre, les trous sont attendus puis sautés après 24 h avec une anomalie en français clair (numéros manquants, poste nommé). Un événement manquant qui arrive après le saut est appliqué hors ordre sans casser la séquence. Bon.
2. Coupure au milieu d'un envoi : chaque événement est sa propre transaction et idempotent ; un renvoi donne DEJA_APPLIQUE, un envoi simultané ne double rien (test 16). Bon.
3. Vendeur jamais bloqué : un événement illisible, d'un vendeur inconnu ou d'une caisse inconnue est stocké REJETE et la séquence avance. Seule une erreur imprévue persistante (ou VENTE tant que PB18c n'existe pas) arrête l'avancée, avec A_RENVOYER explicite et rien d'écrit. Voir la remarque A ci-dessous.
4. Titulaire informé : anomalies EVENEMENT_REJETE, SEQUENCE_MANQUANTE, ECART_CAISSE et REMONTEE_APRES_CLOTURE attribuées à l'administrateur, avec un message français actionnable (qui, quel poste, quelle caisse, quoi vérifier).

## Problèmes et remarques non bloquantes

A. synchro.service.ts:313 à 339 et 342 à 347 : une erreur imprévue déterministe (par exemple un caractère NUL dans une chaîne du corps ou du type, que PostgreSQL refuse dans jsonb et text) lève une erreur générique et donne A_RENVOYER indéfiniment, sans jamais être mise de côté : tous les événements suivants du poste restent bloqués et `dernierEtat.fileVide` reste faux, donc la clôture attend ce poste. C'est le choix D640 (rien d'écrit sur imprévu) mais sans issue pour un événement « empoisonné ». Suggestion : un événement qui revient en A_RENVOYER depuis plus de N jours, ou une validation préalable refusant les NUL dans type, utilisateurId et corps (rejet EVENEMENT_INVALIDE). Risque faible.

B. synchro.service.ts:412 à 414 et 518 à 550 : un nouvel evenementId à une séquence déjà prise n'est pas stocké (seule une anomalie avec `resume`). Si un poste est réinstallé et repart de la séquence 1 sous le même posteId, toute sa production est écartée sans conservation du corps, seule la trace `resume` reste. Conforme à D641 et à la fiche ; à surveiller côté desktop (le poste ne doit jamais réutiliser une séquence).

C. valider-corps.ts:7 à 12 : les chemins d'erreur reprennent les noms de propriétés fournis par le poste (clés inconnues refusées par forbidNonWhitelisted) ; elles sont copiées dans `champs` de l'anomalie et du résultat stockés. Jamais de valeur, donc pas de donnée client, mais une clé très longue est stockée telle quelle (plafonnée seulement par les 2 Mo du corps). Cosmétique.

Aucun problème bloquant.
