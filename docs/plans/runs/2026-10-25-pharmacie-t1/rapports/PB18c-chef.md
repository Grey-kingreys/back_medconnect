# PB18c : contrôle du chef d'orchestration

Verdict : validé, commité (un seul commit, sans amend, hooks actifs). PB18 en cours : PB18a, PB18b et PB18c validés ; PB18d à faire.

## Relecture du diff

- Entorse `sed -i` du codeur sur `src/pharmacie/vente.service.ts` : diff relu en entier. Il ne contient que l'import de `ecrirePieceVente`, le remplacement des étapes 13 à 16 par l'appel et `vente.id` devenu `venteId` aux étapes 17 et 19 ; aucun bruit de fin de ligne, aucun autre changement, aucun fichier `.bak`.
- Extraction D657 (`src/pharmacie/ecriture-vente.ts`), comparée à l'ancien code : même ordre (pièce avec lignes et allocations DEFINITIVE puis PROVISOIRE, paiements, mouvements des allocations puis du reste provisoire, `STOCK_NEGATIF`), mêmes champs, même `auteurId`, mêmes `details` de base. Les seuls ajouts côté web sont des `null` explicites (`jourMetierOrigine`, `horodatageLocal`, `sequencePoste` sur la pièce et les mouvements) : colonnes sans défaut ni trigger qui les remplit (vérifié dans `schema.prisma` et les migrations), et `MouvementsStockService.ecrire` traite `undefined` et `null` pareil (`?? null`), `evenementId` reste un UUID serveur. Aucun verrou pris dans le module : l'ordre des verrous de la vente web est inchangé. Vente web strictement identique ; `vente`, `annulation`, `non-regression-lectures` et les instantanés verts sans modification.
- Verrous : `appliquer` prend le verrou de journée partagé en tête puis le poste (PB18b, test 11 de `journee-cloturee`) ; `appliquerVente` verrouille ensuite la caisse (`sessionDuPoste`), puis les fiches (`verrouillerFiches`), relues après les verrous (D560). Ordre journées, poste, session, fiches : conforme à la vente web (le rejeu ne prend pas le compteur de tickets, il n'en consomme pas).
- Caisse visée et A_RENVOYER (D658) : la caisse vient de `corps.sessionId` et doit être du poste ; fermée ou d'un jour clôturé : `ARenvoyerSynchro('REGULARISATION_INDISPONIBLE')`, rien d'écrit, jamais compté comme échec imprévu (classe distincte dans le moteur).
- Réallocation D652 : jour local (`jourConakry(borne)`), coefficient de la fiche du serveur pour une boîte, prix du ticket gardé, sortie manuelle gardée seulement si le lot est encore candidat, reste provisoire avec `STOCK_NEGATIF` (aussi sans reste quand `quantiteProvisoireLocale > 0`, `details` enrichis de `origine`, `quantiteProvisoireLocale`, `perimesDisponibles`, `evenementId`).
- Anomalies D653 : une par type et par vente, au titulaire, pièce `VENTE`, messages de la fiche. Conditionnement D654 : calculé avant l'allocation, lots périmés exclus, dédoublonné. Numéros D655 : plage et numéro libre `T<ordre>-n`, sinon `N<ordre>-<poste>-<séquence>` avec `PLAGE_EPUISEE` `NUMERO_HORS_PLAGE` ; secours `S<ordre>-<poste>-<n>`, une seule `PLAGE_EPUISEE` OUVERTE par poste. Identifiants D656 : `Vente.id` = `venteId`, `cleIdempotence` nulle, mouvements `synchro:<evenementId>:<ligne>:<lot ou provisoire>`.
- Données du client : `clientNom` et `clientTelephone` vont seulement dans la pièce (comme la vente web). Aucune anomalie (application, `STOCK_NEGATIF`, `PLAGE_EPUISEE`, `EVENEMENT_REJETE`), aucun audit, aucun résumé ne les contient ; le test 9 balaie tous les `details` des anomalies, le test 13 celui d'`EVENEMENT_REJETE`.

## Corrections du chef

1. D666 (décision de l'orchestrateur principal, remarque 2 du vérificateur) : `anomaliesApplication` ne signale plus de prix divergent pour une ligne vendue à l'unité sur une fiche non déconditionnable ; seule `VENTE_UNITE_INTERDITE` est produite. Le prix d'une autre ligne de la même fiche vendue à la boîte reste contrôlé (le dédoublonnage du prix n'est marqué que par une ligne effectivement contrôlée). Tests : unitaire « unité interdite, ordonnance et archive » complété (`prixDivergents` vide) et nouveau test « unité interdite : le prix est contrôlé sur une autre ligne à la boîte » ; test db 9 complété (aucune `PRIX_DIVERGENT` pour la vente à l'unité). Fiche PB18c (sections 3 et 6) et puce PB18 du `CLAUDE.md` mises en cohérence.
2. Formatage prettier de la condition réécrite (seule erreur eslint).

## Tests

- Unitaire : 1092 + 1 = 1093 (99 suites).
- test:db : 392 (33 suites), dont `synchro-ventes` 15 et `synchro-caisse` 19 (test 14 réécrit).

## Preuves (depuis la racine, `docker compose exec -T backend`)

- `npx tsc --noEmit` : 0 erreur.
- `npx eslint` des 8 fichiers `.ts` touchés : 0 erreur.
- `npm test` : 99 suites, 1093 réussis, 3 ignorés, 0 échec.
- `npm run test:db` (lancé seul) : 33 suites, 392 réussis, 0 échec.
- `docker compose restart backend` : « Found 0 errors », « Nest application successfully started » ; seules les lignes `SIGTERM` de l'arrêt de l'ancien processus.
- `prisma/`, `test/db/instantanes/`, `vente.db-spec.ts`, `annulation.db-spec.ts` inchangés ; `docker-entrypoint.sh` hors du commit. Aucun tiret cadratin ni demi-cadratin ajouté.

## Décisions

- D666 ajoutée (complète D653, révisable).
- D651 à D658 et D660 appliquées sans écart.

## Réserves

- Course sur un même numéro de ticket : si un poste envoie un numéro de la plage d'un autre poste et que les deux pièces s'écrivent en même temps, la contrainte d'unicité (`pointDeVenteId`, `numeroTicket`) fait échouer l'une (échec imprévu, `A_RENVOYER`) ; au renvoi, le numéro est vu pris et la vente passe en numéro hors plage. Pas de perte ; au pire un essai de plus (bien en dessous du seuil de trois).
- Dédoublonnage par fiche de `PRIX_DIVERGENT` : une fiche vendue à la boîte puis à l'unité (déconditionnable) avec deux prix divergents n'en signale qu'une ligne (remarque 1 du vérificateur, conforme à la fiche).
- `STOCK_NEGATIF` sans `message` dans ses `details`, comme la vente web (D657 impose l'identité) ; à ajouter avec PB19 si le desktop ou le front l'affichent.
- Le corps d'une vente REJETE est stocké avec le nom et le téléphone du client dans `EvenementSynchro` (D641, consultable pour rejouer) ; jamais recopié dans une anomalie ni un résumé.

## Conséquences pour PD02 et PD03 (desktop)

Champs à envoyer dans le corps d'un événement `VENTE` (tout autre champ est refusé, `champInconnu`) :

- `venteId` : UUID généré sur le poste à la création de la vente, jamais réutilisé (il devient l'identifiant de la pièce ; une pièce existante donne `IDENTIFIANT_DEJA_UTILISE`).
- `sessionId` : UUID de la caisse du poste où la vente a été faite (celle de `SESSION_OUVERTE`).
- Exactement un de `numeroTicket` (entier de la plage réservée, imprimé `T<ordre>-NNNNNNN`) ou `numeroSecours` (compteur local quand aucune plage ne reste, imprimé `S<ordre>-<code du poste>-<n>`) ; les deux ou aucun : `EVENEMENT_INVALIDE`. Le numéro enregistré peut différer (`N...`) : le poste lit `piece.numero` dans le résultat.
- `lignes` (1 à 50) : `stockId`, `unite` (`BOITE` ou `UNITE`), `nombre` (1 à 10 000), `prixUnitaire` (prix du ticket pour une boîte ou une unité, entier GNF), `quantiteProvisoireLocale` (unités non couvertes par un lot sur le poste, si la vente a mis le poste en négatif), `ouvertureConditionnement` (vrai si le poste a entamé une boîte pour cette ligne), `sortieManuelle { lotId, motif de 3 à 300 caractères }` (lot périmé choisi par le vendeur).
- `paiements` (1 à 5) : `mode` (code du référentiel), `montant` (au moins 1), `reference?`, `montantRecu?` ; somme égale au total.
- `total` = somme de `nombre x prixUnitaire` (sinon `EVENEMENT_INVALIDE` champ `total`).
- `clientNom?` (100 caractères), `clientTelephone?` (30), `ordonnanceVerifiee` (booléen obligatoire).
- `horodatageLocal` de l'événement : heure réelle de la vente sur le poste (elle fixe le jour de réallocation des lots, bornée par le serveur).
- Résultats à traiter : `APPLIQUE` avec `piece { type, id, numero }` et `anomalies` (informatives, rien à corriger sur le poste) ; `A_RENVOYER` `REGULARISATION_INDISPONIBLE` (caisse fermée ou jour clôturé, jusqu'à PB18d) : garder l'événement et le renvoyer inchangé ; `REJETE` (`STOCK_INTROUVABLE`, `EVENEMENT_INVALIDE`, `SESSION_INCONNUE`, `IDENTIFIANT_DEJA_UTILISE`) : retirer de la file et afficher `message`.
- Après un numéro de secours, recharger les plages (`POST .../postes/:posteId/plages`) dès la connexion revenue.
