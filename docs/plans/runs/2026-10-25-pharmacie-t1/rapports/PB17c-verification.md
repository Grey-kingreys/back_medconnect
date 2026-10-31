# PB17c - Vérification indépendante

Verdict : **PASS**

## Commandes (depuis la racine du monorepo)

- `docker compose exec -T backend npx tsc --noEmit` : 0 erreur.
- `npx eslint` sur les 4 fichiers de la fiche : 0 erreur.
- `npm test` : 95 suites, 1034 passés, 3 skipped. Conforme à l'attendu (aucun test unitaire demandé par la fiche, 1034 inchangé).
- `npm run test:db` : 29 suites, 336 passés (326 + 10).
- `journee-cloturee.db-spec.ts` seul, 3 fois : 10/10, 10/10, 10/10 (stable).
- Aucun jest en cours au moment de la reprise ; test:db relancé en entier après la coupure.

## Conformité au diff

- Fichiers modifiés : seulement sessions-caisse.service.ts, vente.service.ts, receptions.service.ts, CLAUDE.md, le nouveau db-spec (plus docker-entrypoint.sh, toléré). `git diff --stat` sur prisma, instantanes, journee.ts, clotures.service.ts : vide. Aucun test existant modifié (aucun `M` sous test/ ni dans les specs src).
- Aucun U+2014 ni U+2013 dans les lignes ajoutées ni dans le nouveau fichier.
- Verrou partagé : 8 appels hors import (7 de la fiche plus la définition exclue). En première instruction : `enregistrerVente` (vente.service.ts:424), `annulerVente` (:1128), `ouvrirDansTransaction` (sessions-caisse.service.ts:592), `saisirComptage` (:298), `enregistrerMouvement` (:336), `fermer` (:429). Réception : receptions.service.ts:302, exception de place admise par D613.
- Chemins d'écriture de caisse (recherche sur src/ de create/update/delete de Vente, Paiement, SessionCaisse, ComptageCaisse, MouvementCaisse, ResultatSessionMode) : tous passés par ces six transactions. `enregistrerComptage` est appelé depuis comptage, fermeture et ouverture, tous sous verrou. Hors périmètre légitime : `clotures.service.ts` (clôture, verrou exclusif), `purge-pieces.ts` et `point-de-vente.ts` (purge de la démo/point de vente, pas des écrivains métier). Aucun écrivain sans verrou.
- Réentrance : la vente et l'annulation prennent le verrou, puis `ouvrirDansTransaction` le reprend dans la même transaction : verrou consultatif réentrant, aucune attente.
- Ordre D613 : journées, poste (`FOR UPDATE OF p`), session, compteur ou vente d'origine, fiches. Aucune écriture ne prend un verrou de rang inférieur après un verrou supérieur ; la clôture prend l'exclusif en tête, donc pas de cycle. Les tests 8 (3 courses réelles) et 9 (attente puis aboutissement) le confirment.
- Réception : refus seulement si `jourRecu < aujourd'hui` et clôturé ; jour même permis (D614). Testé (test 6, trois cas).
- Rattachement D615 : `jourDeRattachement`, `jourMetierOrigine` = jour réel si différent, message `messageOuvertureJourSuivant`, `rattacheeAuJourSuivant` faux pour une session existante. Conforme.
- Ordre des refus D624 : `exigerJourOuvert` est placé au début du bloc `if (existante)`, donc après `POSTE_INCONNU`, `SESSION_FERMEE`, `IDENTIFIANT_DEJA_UTILISE`, `SESSION_AUTRE_UTILISATEUR` (qui précèdent le bloc) et avant tout comptage : **conforme** à D624 et à la fiche. Pour comptage, mouvement, fermeture : après le contrôle de statut (SESSION_FERMEE ou bilan rejoué conservé), et pour le mouvement avant le rejeu par identifiant : conforme.
- Tests : l'attente est mesurée par `pg_locks` (`locktype='advisory' AND NOT granted`) avec échec si non observée sous 4 s ; le test 7 vérifie aussi que la promesse n'est pas résolue pendant l'attente ; le test 10 vérifie 409 sans écriture et compteur inchangé. Aucun test à vide repéré.

## Comportement hors journée clôturée

Inchangé : les branches nouvelles ne s'activent que si `estJourCloture` ; sans clôture, `jourDeRattachement` renvoie aujourd'hui et `jourMetierOrigine` nul ; tous les autres db-specs existants sont verts.

## Jugement métier

- Titulaire qui clôture le soir pendant qu'un vendeur encaisse : la clôture attend les écritures en cours (test 7), puis toute nouvelle vente ouvre ou réutilise une caisse rattachée au lendemain ; aucune vente refusée pour cause de clôture (tests 4 et 8). Seule une caisse desktop restée ouverte d'un jour clôturé refuse (D624), avec un message qui dit d'encaisser sur un autre poste, acceptable.
- Livraison tardive : réception du jour reçue même si le jour est clôturé ; une livraison antidatée sur un jour antérieur clôturé est refusée, message lisible.
- Correction d'une vente d'un jour clôturé : annulation rattachée à la journée en cours, pointe l'origine, jour clôturé intact (CA20, test 5).

## Problèmes

Aucun bloquant. Remarque mineure : un vendeur dont la caisse web (jour J) est restée OUVERTE au moment d'une clôture forcée est lui aussi refusé sur cette caisse, comme le prévoit D624 ; seul le poste desktop est cité dans le texte, mais le message est identique et invite à changer de poste.
