# PB19b : contrôle du chef d'orchestration

Verdict : validé, commité (un seul commit, sans amend, hooks actifs). PB19 est validé, et avec lui tout le back de la tranche pharmacie 1 (PB01 à PB19). Prochaine étape : le front web PF01 à PF06.

## Relecture du diff

- `src/pharmacie/` : 11 contrôleurs modifiés, uniquement des chaînes de `@ApiOperation` (permission, statut de succès, codes d'erreur) ; aucune importation, garde, route, DTO ni ligne de code changés ; aucune `@ApiResponse` ajoutée (celle de `sessions-caisse` visible dans le diff est l'existante).
- `src/pharmacie/swagger-pharmacie.spec.ts` (nouveau, 5 tests) : lit les métadonnées réelles (`DECORATORS.API_OPERATION`, `API_SECURITY`, `API_TAGS`) sur les 57 routes découvertes, comparées à `ROUTES_PHARMACIE` ; il prouve ce que dit D678.
- `CLAUDE.md` : puce B13/B14 réduite à ce qui reste vrai, corrections PB07, PB08, PB11, PB15a, variable `TEST_DATABASE_URL`, ligne « Tests », section « Mode démo » réécrite (deux phases, purge, procédure), nouvelle puce « Exploitation de la tranche pharmacie 1 (PB19) » (contrôle du stock, événement mis de côté avec requête `SELECT` seule, argent d'une régularisation hors clôture, paiement après fermeture). Contrôlé contre le code par le vérificateur (27 affirmations) et par sondage du chef.
- Racine (non commitée ici, laissée à l'orchestrateur principal) : `.env.example` gagne le commentaire et `TEST_DATABASE_URL=` vide, `compose.override.yml` la seule ligne `TEST_DATABASE_URL: ${TEST_DATABASE_URL:-}` ; `compose.yml` inchangé par PB19b (`DESKTOP_ORIGINS` déjà présent).
- `docker-entrypoint.sh` : diff vide (fin de ligne), hors du commit.

## Corrections du chef

1. **Défaut trouvé à la relecture** : en supprimant la phrase « L'import Excel du stock écrit encore le compteur gelé ... » de la puce PB08, le codeur avait aussi supprimé le saut de ligne ; la puce PB10 (« Sessions de caisse ») était recollée à la fin de la puce PB08 et disparaissait du rendu en liste. Saut de ligne rétabli.
2. Puce PB10 : `GET courante` documentée comme voulue (D528) : caisse ouverte du poste quel qu'en soit le titulaire, nom, fond et comptage d'ouverture compris, sans bilan ni montant d'activité ; durcissement renvoyé au porteur.
3. Description Swagger de `GET :structureId/caisse/sessions/courante` (`sessions-caisse.controller.ts`) : même précision (volontairement sans contrôle du vendeur, D528). Comportement inchangé.
4. Puce PB14c (ex-ligne 89) : « seul le mode `livraison` existe, avec `reception:write` » contredisait la fin de la puce (mode `inventaire` par défaut) ; devient « le mode `livraison` exige `reception:write` (403 sinon) ».
5. `ACTIVE.md` : PB19 validé, back de la tranche validé, prochaine étape PF01 à PF06 ; deux questions parquées ajoutées (durcissement de `GET courante`, validation des décisions D601 à D682).

## Preuves (depuis la racine, `docker compose exec -T backend`)

- `docker compose restart backend` : « Données de démonstration déjà présentes : aucune création. » puis « Nest application successfully started » (le `npm error ... SIGTERM` est l'arrêt du `nest start --watch`).
- `npx tsc --noEmit` : 0 erreur.
- `npx eslint` des 12 fichiers `.ts` touchés : 0 erreur, 7 avertissements `no-unsafe-argument` anciens (hors décorateurs).
- `npm test` : 101 suites, 1112 réussis, 3 ignorés (1107 avant PB19b, plus les 5 du test Swagger).
- `npm run test:db` (lancé seul) : 35 suites, 409 réussis.
- `grep "nul jusqu'à PB12\|écrit encore le compteur gelé\|148 tests" CLAUDE.md` : aucune occurrence ; aucun tiret cadratin ni demi-cadratin ajouté.
- Ni migration, ni `prisma/`, ni `test/db/instantanes/`, ni `DEMO_RESET`, ni lecture du `.env`.

## Bilan du back de la tranche

### Commits de cette reprise (branche orch/pharmacie-t1-back)

| Tâche | Commit | Message |
|---|---|---|
| PB16a | a6ed30e | feat(pharmacie): alertes de péremption par lot et rapport de marge |
| PB16b | 24d6665 | test(pharmacie): étanchéité des coûts sur toutes les routes exposées |
| PB17a | e3ec64b | feat(pharmacie): clôture journalière, préparation et clôture forcée |
| PB17b | 42590ec | feat(pharmacie): export CSV d'une journée clôturée |
| PB17c | e34aa7d | feat(pharmacie): journée clôturée respectée par les écrivains de caisse |
| PB18a | a3377ae | feat(pharmacie): plages de tickets, catalogue de synchro et origines desktop |
| PB18b | ab4b45f | feat(pharmacie): moteur de rejeu et événements de caisse hors ligne |
| PB18c | 14fd6d4 | feat(pharmacie): rejeu des ventes hors ligne avec réallocation serveur |
| PB18d | c563eae | feat(pharmacie): régularisation des ventes remontées après la clôture |
| PB19a | f754351 | feat(pharmacie): jeu démo de la tranche pharmacie, seed et purge |
| PB19b | commit de cette tâche | docs(pharmacie): contrats exacts, Swagger et variables de la tranche |

Tests à la fin du back : 1112 unitaires (101 suites), 409 en base (35 suites).

### Décisions à faire valider par le porteur (D601 à D682, decisions.md)

Toutes prises par défaut pendant la reprise (A6), révisables.

- Alertes et marge (PB16) : D601 à D605 (péremption par lot aux horizons des paramètres, valorisation sans jamais compter un coût inconnu pour 0, marge réelle par allocations sur 92 jours au plus) ; étanchéité des coûts : D606 à D611.
- Clôture (PB17) : D612 à D629 (verrou de journée partagé, jour de rattachement au lendemain d'un jour clôturé, postes attendus nommés, clôture forcée réservée aux postes desktop avec motif, totaux « non rapproché », export CSV, refus `JOURNEE_CLOTUREE`).
- Synchro desktop (PB18) : D630 à D667 (plages, photographie et ETag, `DESKTOP_ORIGINS`, enveloppe et empreinte, une transaction par événement, statuts, trous de séquence, attribution, rejeu des ventes au prix du ticket avec réallocation serveur, régularisation après clôture, journée clôturée jamais modifiée).
- Démo et documentation (PB19) : D668 à D682.

Décisions qui révisent une décision antérieure (à regarder en premier) :

- D610 révise D483 : `debutFiabiliteMarge` retiré de la réponse des paramètres (7 champs).
- D616 précise D435 : postes attendus pour clôturer, une entrée par poste avec raison.
- D644 révise D436 : un événement rejoué est attribué à un membre ou administrateur de la pharmacie, `caisse:utiliser` n'est exigée que de l'envoyeur.
- D659 révise D625 (point 3) : régularisation sur la caisse d'origine, au jour de rattachement.
- D662 révise D633 : la photographie du catalogue ne porte plus `jour`.
- D663 révise D636 : 2 Mo et gzip pour la seule route des événements, 100 Ko partout ailleurs.
- D670 révise D504 : plus aucun lot technique de démonstration à Kaloum, scénario joué par les services.
- D671 révise D609 : liste blanche du balayage des coûts adaptée au scénario démo dans `src/pharmacie/demo/`.
- Compléments sans renversement : D611 (précise D606), D664 (complète D640), D666 (complète D653), D667 (précise D659), D681 (complète D671), D682 (complète D670).

### Réserves et dette restantes

- Exploitation sans outil (documentée dans `CLAUDE.md`, puce PB19, questions parquées) : aucun rejeu d'un événement mis de côté ; argent d'une régularisation hors clôture absent de tout `TotalClotureMode` ; paiement arrivé après la fermeture d'une caisse du jour non compté par le bilan figé.
- `GET courante` expose fond et comptage d'ouverture à tout vendeur de la pharmacie (voulu, D528) : question au porteur.
- Le rôle par défaut « Pharmacien » n'a pas `inventaire:write` : avec les rôles par défaut, seul le titulaire compte un inventaire (PB15a).
- Sortie « Perdu ou volé » d'un lot entier par un vendeur sans anomalie, tracée par l'audit seulement (PB15a).
- Lot trouvé à l'inventaire : coût inconnu, ventes non valorisables ; lot reçu sans numéro puis compté par numéro : risque de stock doublé (PB15b).
- Réception issue d'un import sans fournisseur ni référence, indiscernable d'une saisie (PB14c) ; mises à jour de prix et notes par l'import non auditées.
- L'ETag du catalogue change à chaque mouvement : le 304 ne joue guère qu'hors activité (PB18a).
- Imbrication pathologique d'un corps de 2 Mo : récursion non bornée (500 avant traitement) (PB18b) ; course sur un même numéro de ticket entre deux postes : `A_RENVOYER` (PB18c).
- Corps d'une vente rejetée stocké avec nom et téléphone du client dans `EvenementSynchro` (D641), jamais recopié ailleurs.
- Phase 2 de la démo non atomique (D670) ; la base de dev garde l'ancien jeu démo tant qu'aucune remise à zéro n'est faite (procédure dans `CLAUDE.md`, « Mode démo »).
- Tests datés : `jour(n)` dépend de l'horloge du test, un passage de minuit UTC pendant `test:db` peut fausser un test (sans effet en production).
- Hors PF01 à PF06 : aucun écran de réception, de fournisseurs, d'inventaire ni de sortie de stock n'est prévu au front de la tranche ; seules les routes existent (et l'import Excel déjà présent).
- Correspondance des écrans : la section « Ce que les écrans du front trouveront » de PB19a-chef.md numérote les écrans autrement que PLAN.md ; la référence est PLAN.md (PF01 vente, PF02 fiche produit, PF03 Ma caisse, PF04 annulation et ventes du jour, PF05 clôture, PF06 anomalies, alertes et marge).

### Consignes pour le front (PF01 à PF06), tirées des rapports chef de PB14 à PB19

Générales :
- Enveloppe `{ data, message, success }` ; afficher tel quel le `message` du serveur et, pour les codes à lignes, `details[].message` ; erreurs `VALIDATION` avec `champs`.
- Toute clé dont le nom contient `cout` ou `marge` est réservée à `marge:read` : tester la présence de la clé, jamais sa valeur ; une valeur nulle signifie « inconnu », jamais 0 GNF (PB16a, PB16b).
- `GET .../referentiels` et `.../parametres` renvoient 7 champs, sans `debutFiabiliteMarge` (D610).
- Générer un `id` client neuf par saisie (réception, inventaire, sortie, session, comptage, mouvement) : un rejeu par `id` renvoie l'objet d'origine sans comparer le contenu (PB14a).
- 409 `JOURNEE_CLOTUREE` : afficher le message, ne pas réessayer en boucle ; sur une caisse proposer un autre poste, sur une réception remettre la date du jour (PB17c).

PF01 (vente) :
- Afficher le jour de la caisse quand `data.jourMetier` diffère d'aujourd'hui (vente qui ouvre une caisse rattachée au lendemain, aucun message dédié) ; message d'ouverture de caisse après clôture à afficher tel quel (PB17c).
- Codes nouveaux : `VENTE_UNITE_INTERDITE`, `PRIX_UNITE_MANQUANT`, `SORTIE_MANUELLE_REQUISE` (lots dans `details[].lots`, choix d'un lot et d'un motif), `PAIEMENTS_INCOHERENTS`, `MODE_PAIEMENT_INCONNU`, `POSTE_INCONNU`, `SESSION_AUTRE_UTILISATEUR`, `FICHE_MODIFIEE` ; `STOCK_INSUFFISANT` et `MEDICAMENT_EXPIRE` ne sont plus renvoyés.

PF02 (fiche produit) :
- Proposer les lots existants de la fiche (par `lotId`) plutôt qu'un numéro libre à l'inventaire (risque de stock doublé, PB15b) ; sur une fiche à lot unique, ne pas exiger de date (D600).
- Import : mode par défaut `inventaire` (`inventaire:write`), `livraison` exige `reception:write` ; afficher le 403 ; modèles par `GET .../import/modele?mode=` ; colonnes du rapport (`quantiteComptee`, `quantiteTheorique` parfois négative, `ecart`, `sousTolerance`, `nouveauLot`, `unitesRecues`, `coutAchatBoite` absent sans `marge:read`) ; réponse `inventaireId` ou `receptionId` (PB14c, PB15c).

PF03 (Ma caisse) :
- `GET courante` renvoie la caisse ouverte du poste quel qu'en soit le titulaire (nom compris, D528) : l'utiliser pour dire qui occupe un poste, ne jamais y afficher de bilan.
- Un compté `null` signifie « non rapproché » (relevé Mobile Money manquant), jamais 0 ; pas d'écart affiché dans ce cas (PB17a).

PF04 (annulation et ventes du jour) :
- Après une clôture, la vente d'origine reste `ANNULEE` dans son jour clôturé ; la pièce d'annulation apparaît dans la journée en cours, total négatif (PB17c).
- Codes : `VENTE_DEJA_ANNULEE`, `PIECE_NON_ANNULABLE` ; `ANNULATION_HORS_DELAI` n'existe plus.

PF05 (clôture) :
- `GET .../caisse/clotures/:jour/preparation` donne tout (sessions, caisses ouvertes, `postesAttendus` avec `message`, `totaux` avec `sessionsNonRapprochees`, `peutCloturer`, `peutForcer`) : ne rien recalculer côté client.
- 409 `CLOTURE_INCOMPLETE` et `CAISSES_A_FERMER` : `details[].message` poste par poste, message global en titre ; « Forcer » seulement si `peutForcer`, motif de 3 à 500 caractères ; 409 `JOURNEE_DEJA_CLOTUREE` : recharger la préparation ; liste mensuelle `GET .../caisse/clotures?mois=AAAA-MM` ; `cloture:gerer` seulement.
- Export : bouton seulement sur une journée clôturée ; télécharger par `fetch` avec le jeton, lire en `Blob`, nom tiré de `Content-Disposition` ; ne jamais réécrire le fichier (BOM, apostrophes) ; erreurs `VALIDATION` (`jourFutur`, `dateValide`), `JOUR_AVANT_DEBUT_CAISSE`, `JOURNEE_NON_CLOTUREE` (PB17b).
- Afficher à côté de la clôture les anomalies `REMONTEE_APRES_CLOTURE` (argent hors clôture) et les paiements arrivés après fermeture (raison `CAISSE_FERMEE`), non comptés par les totaux (puce Exploitation, D679).

PF06 (anomalies, alertes, marge) :
- File : `GET .../anomalies?statut=&type=&page=` ; badge sur `ouvertes` (indépendant du filtre) ; afficher `details.message` (présent sur tous les types depuis D675) et `rattachement` ; une `STOCK_NEGATIF` reste ouverte après rattachement (D577) : montrer qu'elle est résolue côté stock pour éviter un double traitement.
- Alertes : `GET .../stock/alertes-peremption` (`stock:read`) ; afficher `nombreLotsSansPrix` et `nombreLotsCoutInconnu` à côté des totaux ; lots sans date seulement comptés, lien vers le stock pour les dater.
- Marge : `GET .../rapports/marge?du=&au=` (`marge:read`, menu masqué sinon) ; défaut du 1er du mois à aujourd'hui, 92 jours au plus ; messages `VALIDATION` (`jourInvalide`, `periodeInversee`, `periodeMaximale`) ; afficher `nonValorisable`, `provisoire` et `debutFiabilite` ; taux calculés côté front.

Données de démo pour tester les écrans : PB19a-chef.md, section « Ce que les écrans du front trouveront » (après une remise à zéro de la démo sur la base de dev).
