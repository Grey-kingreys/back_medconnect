# PB17c : contrôle du chef d'orchestration

Verdict : validé, commité (un seul commit, sans amend, hooks actifs). PB17 est validé en entier (PB17a, PB17b, PB17c).

## Fait

- Relecture du diff complet dans le code, avec un regard de concurrence :
  - Verrou partagé en première instruction : `enregistrerVente` (étape 0, avant la lecture des fiches), `annulerVente` (avant la lecture de l'origine), `ouvrirDansTransaction` (avant le verrou du poste), `saisirComptage`, `enregistrerMouvement`, `fermer` (avant `verrouillerSession`). Réception : après la lecture du point de vente, seulement si `recueLe` tombe avant aujourd'hui (exception admise par D613).
  - Aucun chemin d'écriture de caisse n'y échappe : recherche des `create`, `createMany`, `update`, `updateMany`, `upsert`, `delete` et du SQL brut sur `Vente`, `Paiement`, `LigneVente`, `SessionCaisse`, `ComptageCaisse`, `MouvementCaisse`, `ResultatSessionMode`, `CompteurTicket` dans `src/`. Tous passent par ces six transactions ; `enregistrerComptage` n'est appelé que sous elles. Hors périmètre : la clôture (verrou exclusif), `purge-pieces.ts` et `point-de-vente.ts` (purge démo, configuration). Le statut d'une vente annulée est dérivé de la pièce liée, jamais écrit.
  - Ordre D613 : journées, poste (`FOR UPDATE OF p`), session, compteur ou vente d'origine, fiches. Le poste web par défaut (`assurerPoste`) prend le point de vente en `FOR NO KEY UPDATE` après le verrou de journée ; la clôture n'y prend qu'un `KEY SHARE` (clé étrangère de `ClotureJournaliere`), compatible : pas de cycle. La clôture appelle `assurerPointDeVente` dans une transaction séparée, avant son verrou exclusif : pas d'interblocage avec une réception antidatée qui créerait le point de vente.
  - Isolation : toutes les transactions sont en lecture validée (aucun `isolationLevel`), donc une écriture qui a attendu la clôture relit la `ClotureJournaliere` validée (test 10). En lecture répétable, la photo prise au premier ordre la cacherait : à garder en tête si l'isolation change un jour.
  - Réentrance : la vente et l'annulation reprennent le verrou dans `ouvrirDansTransaction`, sans attente (verrou consultatif réentrant dans la transaction).
  - Réception antidatée (D614) : comparaison de chaînes `AAAA-MM-JJ`, jour même permis même clôturé, import de livraison à `new Date()` jamais concerné.
  - Rattachement (D615) : `jourDeRattachement` dans la transaction, sous le verrou ; `jourMetierOrigine` = jour réel seulement si différent ; `rattacheeAuJourSuivant` faux pour une caisse existante ; message `messageOuvertureJourSuivant`.
  - Refus D624 : au début du bloc `if (existante)`, après `POSTE_INCONNU`, `SESSION_FERMEE`, `IDENTIFIANT_DEJA_UTILISE`, `SESSION_AUTRE_UTILISATEUR` et avant tout comptage ; dans comptage, mouvement et fermeture après le contrôle de statut, et pour le mouvement avant le rejeu par identifiant.
- Contre-épreuves (voir Preuves) : le code est juste, mais la fiche ne prouvait pas « première instruction » pour la vente. Sans le verrou en tête de `enregistrerVente`, les dix tests restaient verts : `ouvrirDansTransaction` reprend le verrou plus loin, donc les tests 9 et 10 attendent quand même. La vente aurait alors lu les fiches et pris point de vente et poste avant d'attendre la clôture, contraire à l'ordre global.
- Correction : test db 11 ajouté (D629), « chaque écrivain de caisse attend la clôture avant toute lecture ». La clôture est tenue en exclusif ; six écrivains sont lancés, chacun échouerait ou rejouerait sur sa toute première lecture (vente d'une fiche inexistante, annulation d'une vente inexistante, ouverture sur un poste inexistant, comptage, mouvement et fermeture de la caisse `SV` fermée) ; six attentes consultatives simultanées sont exigées dans `pg_locks`, puis chacun rend son résultat habituel (404 `STOCK_INTROUVABLE`, 404, 409 `POSTE_INCONNU`, 409 `SESSION_FERMEE` deux fois, bilan rejoué). Aucune ligne de code de production modifiée.
- Fiche (section 4, Done when, Historique, Validation), D629, puce CLAUDE.md (consigne d'ajout au test 11), ACTIVE.md (PB17 validé, cinq dernières décisions D613, D615, D624, D625, D629).

## Tests

- Unitaire : 1034 inchangé (95 suites).
- test:db : 326 + 11 = 337 (29 suites) : `journee-cloturee.db-spec.ts` 11 (10 de la fiche, 1 du chef). Tous les autres db-specs inchangés et verts.

## Preuves (depuis la racine, `docker compose exec -T backend`)

- `npx tsc --noEmit` : 0 erreur.
- `npx eslint` des 4 fichiers `.ts` de la fiche : 0 erreur, 0 avertissement.
- `npm test` : 95 suites, 1034 réussis, 3 ignorés (préexistants), 0 échec.
- `npm run test:db` : 29 suites, 337 réussis, 0 échec.
- `journee-cloturee.db-spec.ts` seul : vert à chaque passage sans mutation : 2 passages à 11 tests chez le chef (dont la gate), après les 3 passages à 10 tests du vérificateur ; dans les passages de contre-épreuve, les tests non visés restent verts.
- Contre-épreuve 1, verrou partagé retiré de `enregistrerVente` (ligne mise en commentaire par Edit) : avant le test 11, 10 sur 10 verts (preuve du trou) ; avec le test 11, 10 verts et le test 11 en échec « Attente non observée. » après 4 s.
- Contre-épreuve 2, verrou partagé retiré de `fermer` : test 11 en échec, même message.
- Contre-épreuve 3, `exigerJourOuvert` retiré de `saisirComptage` : test 3 (CA20) en échec.
- Chaque fois restauré par Edit ; ensuite `git diff --stat src` identique à l'état d'avant (84, 17 et 7 lignes), aucune occurrence du marqueur dans `src/` ni `test/`.
- `git diff --stat -- prisma test/db/instantanes src/pharmacie/caisse/journee.ts src/pharmacie/caisse/clotures.service.ts` : vide. Aucun tiret cadratin ni demi-cadratin ajouté. `docker-entrypoint.sh` exclu du commit.

## Jugement

- Le titulaire clôture le soir pendant qu'un vendeur encaisse : la clôture attend la vente en cours, puis toute nouvelle vente compte pour le lendemain ; aucune vente n'est refusée parce qu'on a clôturé tôt.
- Une vente d'un jour clôturé se corrige par une annulation sur la journée en cours, qui pointe l'origine ; le jour clôturé, ses totaux et son export ne bougent plus (CA20).
- Une livraison du jour se reçoit même après la clôture ; une livraison antidatée sur un jour clôturé est refusée avec un message qui dit quoi faire.
- Seule une caisse restée ouverte sur un jour clôturé (desktop après clôture forcée) refuse tout, avec un message qui invite à changer de poste.

## Décisions

- D629 (ajoutée) : « première instruction » prouvée par le test db 11 ; tout nouvel écrivain de caisse s'y ajoute.
- D612 à D615, D618, D624, D626 appliquées telles quelles ; D625 reste à PB18.

## Réserves

- Message de la vente : une vente qui ouvre automatiquement une caisse rattachée au lendemain ne le dit pas dans son message (« Vente enregistrée (...) ») ; seul `data.jourMetier` le porte. Le front doit l'afficher (voir PF05).
- Le message D624 parle de « ce poste aura envoyé ses ventes » : juste pour un poste desktop. Une caisse web ne peut pas rester ouverte après une clôture (D617), donc le cas ne se présente pas aujourd'hui.
- `jour(n)` dépend de l'horloge du test (comme PB16 et PB17a) : un passage de minuit UTC pendant la suite pourrait fausser un appel daté.
- Le test 11 compte toutes les attentes consultatives de la base : il suppose `--runInBand` (déjà la règle de `test:db`).

## Ce que PB18 doit reprendre

- D625 en entier : (1) chaque événement rejoué prend `verrouillerJourneesPartage` en première instruction de sa transaction, et le rejeu s'ajoute au test 11 (D629) avec un événement qui échouerait sur sa première lecture ; (2) une ouverture hors ligne d'un jour clôturé entre-temps prend le jour de `jourDeRattachement` et `jourMetierOrigine` = jour local ; (3) une `VENTE` sur une caisse d'un jour clôturé devient une `REGULARISATION` sur une caisse du jour de rattachement, `Vente.jourMetierOrigine` = jour d'origine, anomalie `REMONTEE_APRES_CLOTURE` au vendeur, clôture retrouvée par `postesManquants[].sessionId` ou par le jour ; (4) la fermeture rejouée d'une caisse restée ouverte est acceptée (OUVERTE vers FERMEE, jamais INCLUSE), son argent signalé au titulaire ; (5) comptage et mouvement rejoués sur une telle caisse : appliqués ou régularisés, jamais refusés ; (6) `Poste.dernierContactLe` et `dernierEtat` écrits à chaque synchro.
- Le rejeu ne doit pas réutiliser tel quel `ouvrirDansTransaction` ni les méthodes de comptage, mouvement et fermeture du service : elles refusent désormais une caisse d'un jour clôturé (409 `JOURNEE_CLOTUREE`), alors que le rejeu ne refuse jamais un événement passé (D434). Prévoir un chemin de rejeu (ou un paramètre explicite) qui garde le verrou partagé et l'ordre des verrous, mais remplace le refus par la régularisation.
- Garder l'ordre : verrou de journée avant tout, y compris avant la création du poste par défaut et avant `assurerPointDeVente` ; rien ne doit verrouiller une ligne puis attendre le verrou de journée.
- Rester en lecture validée : un écrivain qui attend la clôture doit relire la clôture validée après l'attente.
- Le jour de rattachement se calcule sous le verrou partagé (lecture de `ClotureJournaliere` dans la transaction), jamais avant.

## Conséquences pour le front (PF05)

- Ouverture de caisse après la clôture du jour : le message de la réponse (« Caisse ouverte. La journée d'aujourd'hui est déjà clôturée : cette caisse compte pour le JJ/MM/AAAA. ») est à afficher tel quel ; `data.jourMetier` vaut le lendemain.
- Vente avec ouverture automatique : afficher le jour de la caisse quand `data.jourMetier` diffère d'aujourd'hui (aucun message dédié côté serveur), par exemple dans l'en-tête de caisse et sur le ticket.
- 409 `JOURNEE_CLOTUREE` : afficher le message du serveur ; sur une caisse, proposer d'encaisser sur un autre poste, ne pas réessayer en boucle ; sur une réception, remettre la date d'aujourd'hui.
- Après une clôture, la liste des ventes d'un jour clôturé montre la vente d'origine en `ANNULEE` ; la pièce d'annulation apparaît dans la journée en cours (total négatif).
