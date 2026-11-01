# PB18d : contrôle du chef d'orchestration

Verdict : validé, commité (un seul commit, sans amend, hooks actifs). PB18 validé en entier : PB18a, PB18b, PB18c et PB18d.

## Relecture du diff

- `appliquerVente` (`src/pharmacie/synchro/synchro.service.ts`) : la caisse vient de `corps.sessionId`, doit être du poste et est verrouillée (`sessionDuPoste`) ; `regularisation = statut !== 'OUVERTE' || jour de la caisse clôturé`. Dans ce cas seulement, `jourDeRattachement` est lu sous le verrou de journée partagé pris en tête de transaction par `appliquer` (D613, D639) : une clôture ne peut pas s'intercaler entre le calcul du jour et l'écriture. La pièce garde `sessionId: s.id` (caisse d'origine, FERMEE ou INCLUSE comprise), paiements dans cette caisse, `typePiece` `REGULARISATION`, `jourMetier` = jour de rattachement, `jourMetierOrigine` = jour de la caisse, `venteOrigineId` nul, numéro du ticket (D655). Les anomalies d'application et `STOCK_NEGATIF` prennent le jour de la pièce.
- Journée clôturée jamais modifiée : aucune écriture ne porte le `jourMetier` d'un jour clôturé (la pièce est au jour de rattachement, qui n'est par construction pas clôturé) ; aucune session n'est passée INCLUSE ; `ClotureJournaliere` et `TotalClotureMode` ne sont que lus (`findUnique` de la clôture pour l'anomalie). La seule écriture sur un objet de la veille est la ligne `Paiement` rattachée à la caisse S (non incluse, `clotureJournaliereId` nul) et, plus tard, la fermeture de S par `SESSION_FERMEE` (D649) ; l'export de la veille ne lit que les pièces de son `jourMetier` : il reste identique au caractère près (test 3).
- Anomalie `REMONTEE_APRES_CLOTURE` : une par pièce, pièce `VENTE`, attribuée à `s.utilisateurId ?? adminId` (vendeur de la caisse) par le nouveau paramètre optionnel de `creerAnomalie` (défaut inchangé pour tous les autres appels) ; raison `JOURNEE_CLOTUREE` prioritaire sur `CAISSE_FERMEE` ; clôture retrouvée par `pointDeVenteId_jourMetier` du jour de la caisse ; `posteManquantDeLaCloture` par `postesManquants[].sessionId === s.id`, tolérant un tableau absent ; `details` sans donnée du client (nom et téléphone du client restent dans la pièce seule) ; messages conformes à la fiche.
- Plus aucun `A_RENVOYER` `REGULARISATION_INDISPONIBLE` : le code n'est plus levé nulle part dans `src/` ; il reste déclaré dans `CodeARenvoyer` et `MESSAGES_REJET` (`rejeu-regles.ts`), code stable (précédent D542). `aRenvoyer` est typé par `CodeARenvoyer`.
- Ordre des verrous : journées (partagé, en tête), poste (`FOR UPDATE`), session (`verrouillerSession`), fiches ; `jourDeRattachement` et la lecture de la clôture ne prennent aucun verrou. Conforme à PB17c et à la vente web.
- Annulation : une `REGULARISATION` répond 409 `PIECE_NON_ANNULABLE` (existant, test 4).

## Corrections du chef

1. Écart (a) du test 3, fiche mise en cohérence (D667) : la section 3 exigeait `etatJour(hier)` « strictement égal », ce que D649 contredit (la caisse du poste manquant passe OUVERTE vers FERMEE par le rejeu, jamais incluse). La fiche dit désormais : égalité de tout sauf le statut de S.
2. `etatJour` (`test/db/synchro-remontee.db-spec.ts`) compare le contenu utile des pièces et non plus leurs seuls identifiants : `typePiece`, `total`, `jourMetier`, `sessionCaisseId` et les paiements (caisse, mode, montant, référence, triés par id) (remarque 1 du vérificateur).
3. `sansStatut` ne neutralise plus que le statut de S ; toute autre caisse de la veille est comparée en entier (remarque 2 du vérificateur).

## Tests

- Unitaire : 1093 (99 suites), inchangé.
- test:db : 399 (34 suites) ; nouveau fichier `synchro-remontee` 7 tests ; `synchro-ventes` et `synchro-caisse` test 14 réécrits (régularisation, plus d'A_RENVOYER).

## Preuves (depuis la racine, `docker compose exec -T backend`)

- `docker compose restart backend` : « Nest application successfully started ».
- `npx tsc --noEmit` : 0 erreur.
- `npx eslint` des 4 fichiers `.ts` touchés : 0 erreur.
- `npm test` : 99 suites, 1093 réussis, 3 ignorés, 0 échec.
- `npm run test:db` (lancé seul) : 34 suites, 399 réussis, 0 échec.
- `prisma/`, `test/db/instantanes/`, `src/pharmacie/caisse/` inchangés ; `docker-entrypoint.sh` hors du commit ; aucun tiret cadratin ni demi-cadratin ajouté.

## Décisions

- D667 ajoutée (précise D659 et CA21 : périmètre de « journée clôturée jamais modifiée », seule transition admise celle de D649).
- D657, D658 (cas désormais traité), D659 et D660 appliquées sans écart.

## Réserves

- L'argent d'une régularisation reste dans la caisse d'origine, jamais incluse dans une clôture (D618, D649) : il n'apparaît dans aucun `TotalClotureMode`. Le titulaire le voit par les anomalies (`REMONTEE_APRES_CLOTURE` au vendeur, `CAISSE_FERMEE_APRES_CLOTURE` avec `montantEncaisse` à lui-même) et par l'export du jour de rattachement (colonne « Non »). Un rapprochement explicite de ces caisses hors clôture reste à concevoir (PB19 ou tranche suivante).
- Cas `CAISSE_FERMEE` sur une caisse du jour (test 5) : la pièce est une régularisation du même jour (`jourMetier` = `jourMetierOrigine`) ; la caisse fermée sera incluse dans la clôture du jour, mais son bilan figé (`ResultatSessionMode`) ne compte pas ce paiement arrivé après la fermeture. L'anomalie demande de vérifier l'argent ; à surveiller en PB19 (affichage).
- `REGULARISATION_INDISPONIBLE` reste dans le catalogue des codes ; un desktop qui le recevrait d'un serveur antérieur doit continuer à renvoyer l'événement.

## Synthèse de PB18 pour PB19 et pour le desktop (PD02, PD03)

Trois routes, toutes `caisse:utiliser`, réponses `{ data, message, success }`, poste DESKTOP actif de la pharmacie (sinon 409 `POSTE_INCONNU` ; un poste désactivé peut encore envoyer ses événements, plus recevoir plages ni catalogue, D645).

1. Plages : `POST /pharmacie/:structureId/postes/:posteId/plages` `{ id }` (UUID généré par le poste, rejouable). Réserve `taillePlageTickets` numéros ; deux plages non épuisées au plus (409 `PLAGES_SUFFISANTES`). Le poste recharge quand il franchit `seuilRechargementPlagePct` de sa plage, et dès la connexion revenue après un numéro de secours.
2. Catalogue : `GET /pharmacie/:structureId/synchro/catalogue?posteId=` avec `If-None-Match` (ETag faible) et `Accept-Encoding: br, gzip`. 304 : garder la photographie locale. 200 : la remplacer en entier (fiches, lots à solde positif périmés compris, paramètres, modes, coupures, pharmacie, plages, `sequenceAppliquee`, `sequenceMaxRecue`), aucun coût. Le poste lit l'heure du serveur dans l'en-tête `Date` pour détecter une horloge locale fausse (D662).
3. Événements : `POST /pharmacie/:structureId/synchro/evenements`, JSON jusqu'à 2 Mo, gzip permis : `{ posteId, etat: { fileVide, sessionOuverte, versionApp }, evenements: [...] }`, 0 à 200 événements dans l'ordre de `sequence` (lot vide = battement de cœur, à envoyer régulièrement : il tient `dernierContactLe` et `fileVide`, lus par la clôture, D616, D646). Chaque événement : `evenementId` (UUID unique, jamais réutilisé), `sequence` (entier croissant sans trou par poste, à partir de 1, jamais réattribué), `type`, `horodatageLocal` (heure réelle sur le poste, ISO), `utilisateurId` (vendeur connecté sur le poste, membre ou administrateur de la pharmacie), `corps`. Un événement renvoyé doit être identique au premier envoi (même empreinte), sinon `EVENEMENT_MODIFIE`.
   - `SESSION_OUVERTE` `{ sessionId }` (UUID de la caisse, généré sur le poste) ; `COMPTAGE_SAISI` `{ comptageId, sessionId, moment: OUVERTURE | FERMETURE, coupures, releves? }` ; `MOUVEMENT_CAISSE` `{ mouvementId, sessionId, type: PRELEVEMENT | APPORT | REMBOURSEMENT, montant, motif, mode? }` ; `SESSION_FERMEE` `{ sessionId, comptageFermeture?, commentaire? }` (jamais refusée) ; `VENTE` `{ venteId, sessionId, numeroTicket ou numeroSecours, lignes, paiements, total, clientNom?, clientTelephone?, ordonnanceVerifiee }` (détail des champs dans rapports/PB18c-chef.md). Tout champ non déclaré est refusé (`champInconnu`).
   - Réponse `{ resultats, sequenceAppliquee, enAttente }` ; un résultat par événement reçu et par événement en attente traité pendant l'appel (`differe: true`).
   - Que faire de chaque statut : `APPLIQUE` et `DEJA_APPLIQUE` : retirer de la file ; pour une vente, lire `piece { type, id, numero }` (le numéro enregistré peut être `N...` au lieu du numéro imprimé, `type` peut être `REGULARISATION`) et `anomalies` (informatives, rien à corriger sur le poste). `EN_ATTENTE` : reçu et gardé par le serveur (trou de séquence), ne pas renvoyer, envoyer la séquence manquante ; au-delà de 24 h le serveur saute le trou (`SEQUENCE_MANQUANTE`). `REJETE` (`EVENEMENT_INVALIDE`, `EVENEMENT_MODIFIE`, `SEQUENCE_DEJA_UTILISEE`, `UTILISATEUR_NON_AUTORISE`, `SESSION_INCONNUE`, `SESSION_FERMEE`, `COMPTAGE_DEJA_SAISI`, `IDENTIFIANT_DEJA_UTILISE`, `STOCK_INTROUVABLE`, `EVENEMENT_INAPPLICABLE`) : retirer de la file, afficher `message` tel quel (le titulaire a une anomalie `EVENEMENT_REJETE`), ne jamais renvoyer. `A_RENVOYER` (`SERVICE_INDISPONIBLE`) : rien n'est écrit, le traitement du lot s'arrête ; garder cet événement et les suivants et les renvoyer inchangés plus tard (après trois échecs imprévus du même événement, le serveur le met de côté `EVENEMENT_INAPPLICABLE`). Une erreur HTTP (400 `VALIDATION` de l'enveloppe, 409 `POSTE_INCONNU`, 413, 5xx, coupure) : rien n'est acquis, tout renvoyer tel quel.
   - Vente remontée après une clôture forcée sans le poste, ou sur une caisse fermée entre-temps (PB18d) : `APPLIQUE` avec `piece.type` `REGULARISATION` ; la vente est comptée sur la journée en cours, l'argent reste sur la caisse d'origine, le vendeur de la caisse reçoit `REMONTEE_APRES_CLOTURE`. Le poste n'a rien à faire de plus : plus jamais d'`A_RENVOYER` pour ce motif. Une caisse ouverte hors ligne sur une journée déjà clôturée compte pour la journée en cours (vente ordinaire).
   - Clôture : un poste à file non vide ou qui a vendu sans synchro complète depuis le début du jour bloque la clôture (`CLOTURE_INCOMPLETE`) sauf clôture forcée ; le poste doit donc vider sa file et déclarer `fileVide` vrai dès que possible.
- PB19 (seeds, démo, documentation) : un poste desktop de démonstration avec une plage, quelques événements rejoués (dont une régularisation après clôture forcée) et la documentation de ce contrat ; ajouter un `message` aux `details` de `STOCK_NEGATIF` si le front ou le desktop l'affichent (réserve de PB18c).
