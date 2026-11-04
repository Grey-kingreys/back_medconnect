# PB15b : vérification indépendante

Verdict : PASS

## Commandes (relancées par le vérificateur)
- `docker compose exec -T backend npx tsc --noEmit` : 0 erreur.
- `docker compose exec -T backend npx eslint <14 fichiers touchés>` : 0 erreur.
- `docker compose exec -T backend npm test` : 88 suites, 976 réussis, 3 ignorés (déjà présents), 0 échec.
- `docker compose exec -T backend npm run test:db` : 23 suites, 278 réussis, 0 échec.
- Comptes : inventaire.spec.ts 10, inventaires.http.spec.ts 6, inventaire.db-spec.ts 23, test ajouté à all-exceptions.filter.spec.ts : conformes à la fiche.
- `grep mouvementStock.create|lotStock.create|lotStock.update` dans src/pharmacie/inventaires : aucune ligne.
- `git diff -- prisma test/db/instantanes` : vide. Aucun test db existant modifié.
- U+2014 / U+2013 dans les lignes ajoutées et les 4 fichiers nouveaux : 0.

## Contrôles spéciaux
- (a) Périmètre : fichiers modifiés = ceux de la fiche + docker-entrypoint.sh. docs/plans : aucun changement dans git status, aucune modification postérieure à bbd7ef6. docker-entrypoint.sh : aucun écart de contenu (stat vide, seulement l'avertissement LF/CRLF), hors sujet, à ne pas inclure dans le commit.
- (b) Encodage : aucun BOM, aucun mojibake (Ã, â€) dans les 15 fichiers ; accents corrects.
- (c) Fins de ligne : les blobs HEAD sont en CRLF, les fichiers de travail aussi (CRLF cohérent) ; `git diff --stat` (595 insertions, 172 suppressions) identique avec et sans --ignore-cr-at-eol, donc aucune réécriture totale.
- (d) Aucun script Python dans le dépôt.

## Relecture contre fiche et PLAN
- D589 : `ciblerLot` pur, ordre id, numéro (date pour départager), date, lot unique ; plusieurs possibles donne LOT_REQUIS avec la liste FEFO, aucune répartition automatique (test 8 le couvre).
- D590 : quantiteComptee ou nombreBoites x coefficient du lot visé (fiche pour un nouveau lot) + unitesEnPlus ; exclusivité et unités sans boîtes contrôlées avec messages clairs.
- D591 : tolérance = |somme des écarts par fiche| contre toleranceInventaire (nul = 0) ; anomalie ECART_INVENTAIRE attribuée à l'auteur (`attribueeAId`), détails en liste blanche sans coût ; un mouvement INVENTAIRE par lot compté, écart nul compris (test 3).
- D592 : plan pur, capacité du lot compté = comptage + provisoires, théorique = solde moins rattaché, mouvement = écart, puis résolution ; le lot finit exactement au comptage (démontré par le calcul et le test 12 ; lot périmé et vente annulée exclus).
- D593 : extraction fidèle (comparée ligne à ligne, diff de receptions.service.ts limité à l'import et à l'appel de lireResolutionsDePiece) ; `typeMouvement?` par défaut RECEPTION.
- D594 : verrous ligne FOR NO KEY UPDATE triés, désarchivage, puis verrous consultatifs, comme la réception ; théorique lu sous verrou. Test 22 : la fiche attendait attendreAttentes ; le codeur a ajouté `attendreVerrouLigne` (pg_locks transactionid non accordé), car l'inventaire se bloque sur le verrou de ligne tenu par la réception, pas sur le verrou consultatif. Le comportement testé est le même (deux pièces simultanées sur une fiche tenue, libération, les deux aboutissent sans interblocage) ; l'attente est un peu moins spécifique (compte tout verrou transactionid en attente) mais correcte.
- D595 : routes et permission inventaire:write, id client rejouable, désarchivage seulement si une quantité est comptée, avertissement FICHE_NON_QUALIFIEE, refus groupés par code, LOT_REQUIS dans CODES_AVEC_DETAILS, date de lot nulle acceptée. permissions.constants.ts non modifié : le rôle Pharmacien ne reçoit pas inventaire:write (conforme à la décision de l'orchestrateur).
- Coûts : aucun champ de coût dans les réponses ni dans les détails d'anomalie ; contrôle de structure par AccesPharmacieService, fiches filtrées par structureId, détail filtré par structure (404 sinon).
- Tests : seules des additions (le seul retrait est la boucle beforeEach de l'http spec, étendue au nouveau mock). Rien hors sujet.

## Problèmes
Aucun bloquant. Remarques mineures, non bloquantes :
1. En mode rejeterLignes, une fiche archivée est désarchivée dès qu'une de ses lignes est non nulle, même si cette ligne est ensuite refusée au ciblage (étape 4 avant l'évaluation). Effet limité à l'import (PB15c) ; à garder en tête ou à corriger là.
2. docker-entrypoint.sh figure comme modifié sans écart de contenu : l'exclure du commit.
