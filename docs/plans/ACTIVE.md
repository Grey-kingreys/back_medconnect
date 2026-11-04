# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-25-pharmacie-t1 | Branche: orch/pharmacie-t1-back | Parallélisme: 1 (tâches séquentielles, arbre principal) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-25-pharmacie-t1/ (tranche pharmacie 1 côté back : lots, journal de stock, caisse, clôture, synchro desktop). Références par priorité : CORRECTIONS-PORTEUR.md (prime), PLAN.md, decisions.md (D401 et suivantes), DEMANDE.md, rapports/inventaire-consolide.md. Exécution (arbitrage A2) : chaque tâche codée par un Sonnet, vérifiée par un second Sonnet ; la colonne Tier indique le niveau de détail de la fiche. Jalons : J1 = PB01 à PB06, J2 = PB07 à PB13 (indissociables), J3 = PB14 à PB19 ; aucune fusion vers dev avant la fin.
Run parqué, non exécuté : docs/plans/runs/2026-10-22-lot8/ (B14, admin de pharmacie stock et démo de Kaloum), reste « à faire » hors de ce run (O14, D447).

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| PB01 | Harnais de base de test, `npm run test:db` (tasks/PB01-harnais-base-de-test.md) | dur | validé (D456, D457) | 1 |
| PB02 | Non-régression des alertes et des lectures, instantanés avant recâblage (tasks/PB02-non-regression-lectures.md) | spécifié | validé (commit 2004c97) | 1 |
| PB03 | Permissions T1, contrôle d'accès unifié, `masquerCouts`, migration M1 (tasks/PB03-permissions-acces-unifie.md) | spécifié | validé (D464 à D468, rapports/PB03-chef.md) | 1 |
| PB04 | Règles pures du domaine et vecteurs de test (tasks/PB04-regles-domaine-vecteurs.md) | dur | validé (D469 à D477, rapports/PB04-chef.md) | 1 |
| PB05 | Points de vente, postes et référentiels, migration M2 (tasks/PB05-points-de-vente-referentiels.md) | spécifié | validé (D478 à D484, rapports/PB05-chef.md) | 1 |
| PB06 | Fiche produit étendue, migration M3 (tasks/PB06-fiche-produit-etendue.md) | spécifié | validé (D485 à D492, rapports/PB06-chef.md) | 1 |
| PB07 | Lots, journal, agrégats, reprise, migration M4 (tasks/PB07-lots-journal-agregats-reprise.md, D493 à D505) | dur | validé (D493 à D505, rapports/PB07-chef.md) | 1 |
| PB08 | Service de mouvements et lectures recâblées (tasks/PB08-mouvements-lectures-recablees.md, D506 à D513) | dur | validé (D506 à D513, rapports/PB08-chef.md) | 1 |
| PB09 | Tables de caisse et pièces de vente, migrations M5 et M6 (tasks/PB09-caisse-pieces-de-vente.md, D514 à D525) | dur | validé (D514 à D525, rapports/PB09-chef.md) | 1 |
| PB10 | Postes et sessions de caisse (tasks/PB10-sessions-de-caisse.md, D526 à D533) | spécifié | validé (D526 à D533, rapports/PB10-chef.md) | 1 |
| PB11 | Vente recâblée sur lots, prix et caisse (tasks/PB11-vente-recablee.md, D534 à D543) | dur | validé (D534 à D543, rapports/PB11-chef.md) | 1 |
| PB12 | Annulation par écriture inverse et jour métier (tasks/PB12-annulation-ecriture-inverse.md, D544 à D554) | spécifié | validé (D544 à D554, rapports/PB12-chef.md) | 1 |
| PB13 | Qualification d'une fiche (tasks/PB13-qualification-fiche.md, D555 à D565) | spécifié | validé (D555 à D565, rapports/PB13-chef.md) | 1 |
| PB14 | Réceptions, fournisseurs, lots et import livraison, trois sous-fiches commitées dans l'ordre : tasks/PB14a-receptions-fournisseurs-lots.md, tasks/PB14b-resolution-provisoires.md, tasks/PB14c-import-livraison-reception.md (D566 à D582) | spécifié | validé (PB14a, PB14b, PB14c ; rapports/PB14a-chef.md, PB14b-chef.md, PB14c-chef.md) | 1 |
| PB15 | Inventaire, sorties manuelles, anomalies et import inventaire, trois sous-fiches commitées dans l'ordre : tasks/PB15a-sorties-anomalies.md, tasks/PB15b-inventaire-par-lot.md, tasks/PB15c-import-inventaire.md (D583 à D600) | spécifié | validé (PB15a, PB15b, PB15c ; rapports/PB15a-chef.md, PB15b-chef.md, PB15c-chef.md) | 1 |
| PB16 | Alertes de péremption, marge et étanchéité des coûts, deux sous-fiches commitées dans l'ordre : tasks/PB16a-alertes-peremption-marge.md, tasks/PB16b-etancheite-couts.md (D601 à D610) | spécifié | validé (PB16a, PB16b ; D601 à D611, rapports/PB16a-chef.md, PB16b-chef.md) | 1 |
| PB17 | Clôture journalière, trois sous-fiches commitées dans l'ordre : tasks/PB17a-cloture-journaliere.md, tasks/PB17b-export-cloture.md, tasks/PB17c-verrou-journee-ecrivains.md (D612 à D628) | dur | validé (PB17a, PB17b, PB17c ; D612 à D629, rapports/PB17a-chef.md, PB17b-chef.md, PB17c-chef.md) | 1 |
| PB18 | Synchronisation desktop, quatre sous-fiches commitées dans l'ordre : tasks/PB18a-plages-catalogue-cors.md, tasks/PB18b-moteur-rejeu-caisse.md, tasks/PB18c-rejeu-ventes.md, tasks/PB18d-remontee-apres-cloture.md (D630 à D661) | dur | validé (PB18a, PB18b, PB18c, PB18d ; D630 à D667, rapports/PB18a-chef.md, PB18b-chef.md, PB18c-chef.md, PB18d-chef.md) | 1 |
| PB19 | Seeds, démo et documentation, deux sous-fiches à commiter dans l'ordre : tasks/PB19a-jeu-demo-pharmacie.md, tasks/PB19b-documentation-swagger-variables.md (D668 à D682) | spécifié | validé (PB19a, PB19b ; D668 à D682, rapports/PB19a-chef.md, PB19b-chef.md) | 1 |
| PF01 | Vente : socle (types, droits, erreurs, règles, source) puis écran (unité, reliquat, vente sans stock, paiements), dépôt front, branche orch/pharmacie-t1-front : tasks/PF01a-socle-front-caisse.md, tasks/PF01b-ecran-vente-unite-paiements.md (D683 à D705) | spécifié | PF01a validé (front 3bd8abe, D705, rapports/PF01a-chef.md) ; PF01b validé (front 646edfd, D706, rapports/PF01b-chef.md) | 1 |
| PF02 | Fiche produit et page du stock : tasks/PF02a-page-stock-correction-apercu.md, tasks/PF02b-fiche-produit-deux-prix-qualification.md | spécifié | PF02a validé (front 63bb9ad, rapports/PF02a-chef.md) ; PF02b validé (front 9faa963, D707, rapports/PF02b-chef.md), avec correction du back sur cette branche : upsert du stock à quantité facultative, sans elle aucune écriture de stock | 2 |
| PF07 | Réception, inventaire et sorties de stock (ajout D683, après PF02) : tasks/PF07a-reception-livraison-fournisseurs.md, tasks/PF07b-detail-reception-sorties-stock.md, tasks/PF07c-inventaire-par-lot.md, tasks/PF07d-import-excel-livraison-inventaire.md | spécifié | PF07a validé (front 1d2197f, D708, rapports/PF07a-chef.md) ; PF07b validé (front 23a558c, D709, rapports/PF07b-chef.md) ; PF07c validé (front 896206d, D710, rapports/PF07c-chef.md) ; PF07d validé (front d16c1f2, D729, rapports/PF07d-chef.md ; import réel à jouer par le porteur) | 1 |
| Correctifs porteur 1 | Réception (champ Quantité), stock (colonne Péremption, lots en lecture seule), fiche produit (alerte de prix au détail), hors fiche | spécifié | validé (front 4f54bb3, D711, D712, rapports/correctifs-porteur-1-chef.md) ; réserve : `coefficientReception` à exposer par la tâche « plaquette » | 1 |
| PF03 | Ma caisse : tasks/PF03a-ma-caisse-ouverture-comptage.md, tasks/PF03b-ma-caisse-mouvements-fermeture.md | spécifié | PF03a contrôlé par le chef (front add367c, D730, rapports/PF03a-chef.md), test navigateur à faire ; PF03b contrôlé par le chef (front dc60497, rapports/PF03b-chef.md), test navigateur à faire | 1 |
| Correctif D731 | Fenêtre d'ajout au stock : recherche seule avant un choix, « Déjà en stock », encadré livraison ou modification, hors fiche | spécifié | contrôlé par le chef (front 2e9fdd2, D731, rapports/PF03b-chef.md), test navigateur à faire | 1 |
| PF04 | Annulation et ventes du jour : tasks/PF04-annulation-ventes-du-jour.md | spécifié | contrôlé par le chef (front de22bf0, rapports/PF04-chef.md), test navigateur à faire | 1 |
| PF05 | Clôture journalière : tasks/PF05-cloture-journaliere.md | spécifié | contrôlé par le chef (front b1f2a69, rapports/PF05-chef.md), test navigateur à faire | 1 |
| PF06 | Anomalies, alertes de péremption et marge : tasks/PF06a-file-anomalies.md, tasks/PF06b-alertes-peremption-marge.md | spécifié | PF06a contrôlé par le chef (front eca3842, rapports/PF06a-chef.md), test navigateur et build à faire ; PF06b contrôlé par le chef (front 0bdcbde, rapports/PF06b-chef.md), test navigateur et build à faire ; bilan du front : rapports/front-t1-chef.md | 1 |
| PB20 | Vente en ligne refusée au-delà du stock, quantité jamais négative en sortie d'API, démo par le rejeu : tasks/PB20-vente-refusee-stock-jamais-negatif.md (D713 à D722, D727, D728) | dur | validé (rapports/PB20-chef.md) | 1 |
| PF08 | Écran de vente sans attente de livraison, « 0 » et « N à régulariser » : tasks/PF08-vente-refusee-a-regulariser.md (dépend de PB20) | spécifié | validé (test navigateur OK, front 1cb3fee, rapports/PF08-chef.md) | 1 |
| PB21 | Unité PLAQUETTE, coefficient de réception dans les lots : tasks/PB21-unite-plaquette.md (D723, D724, dépend de PB20) | spécifié | validé (rapports/PB21-chef.md) | 2 |
| PF09 | Unité plaquette à l'écran, libellés accordés : tasks/PF09-unite-plaquette.md (D723 à D725, dépend de PB21 et PF08) | spécifié | contrôlé par le chef (front 8a2a159, rapports/PF09-chef.md), test navigateur à faire | validé (test navigateur OK, 8a2a159, rapports/PF09-chef.md du run) |

| PD01 | Squelette Electron et embarquement standalone, dépôt front, branche orch/pharmacie-t1-desktop : tasks/PD01-squelette-electron-standalone.md (D733 à D736, D749 à D751) | dur | validé (rapports/PD01-chef.md) | 2 |
| PD02a | Règles portées, stockage local, catalogue et stock dérivé : tasks/PD02a-regles-stockage-catalogue.md | dur | validé (rapports/PD02a-chef.md) | 2 |
| PD02b | Cœur hors ligne : vente, caisse, journal, plages : tasks/PD02b-coeur-vente-caisse.md (D752, D753 ; `annulation` du back enrichie, à déployer avant ou avec le desktop) | dur | validé (rapports/PD02b-chef.md) | 2 |
| PD03 | Client de synchronisation : tasks/PD03-client-synchro.md | spécifié | à faire | 0 |
| PD04a | Pont IPC, source desktop, synchro branchée : tasks/PD04a-pont-ipc-source-desktop.md | dur | à faire | 0 |
| PD04b | Rester connecté hors ligne : tasks/PD04b-connexion-hors-ligne.md | dur | à faire | 0 |
| PD04c | Écrans en mode desktop : tasks/PD04c-ecrans-mode-desktop.md | dur | à faire | 0 |
| PD05 | Impression directe : tasks/PD05-impression-directe.md | spécifié | à faire | 0 |
| PD06 | Installation et mise à jour, mesure sur 4 Go : tasks/PD06-installation-mise-a-jour.md | spécifié | à faire | 0 |

Web fusionné vers dev (back #36, front #43) ; le suivi du run reste sur cette branche. Desktop dans l'ordre du tableau, une fiche à la fois, un commit par fiche sur orch/pharmacie-t1-desktop du front.

Back de la tranche (PB01 à PB19) validé ; bilan, décisions à faire valider par le porteur et consignes pour le front : rapports/PB19b-chef.md. Front : 14 sous-fiches dans l'ordre PF01a, PF01b, PF02a, PF02b, PF07a, PF07b, PF07c, PF07d, PF03a, PF03b, PF04, PF05, PF06a, PF06b (D685), une à la fois sur l'arbre principal du dépôt front_medconnect, en attente de validation des fiches par l'orchestrateur principal.

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|

## Questions parquées

- Porteur : Q01, Q02, Q05 à Q14, Q16, Q17 de PLAN.md section 7, défauts du plan appliqués (A6), à remonter au rapport final.
- Porteur, après PB19 (D679) : outil de rejeu d'un événement mis de côté, rapprochement de l'argent des régularisations hors clôture, paiement arrivé après la fermeture d'une caisse du jour non compté par le bilan figé.
- Porteur, après PB19b : `GET .../caisse/sessions/courante` montre à tout vendeur (`caisse:utiliser`) la caisse ouverte du poste, fond et comptage d'ouverture compris (voulu, D528). Durcir en masquant `fondCaisse`, `fondCompte` et `comptageOuverture` à un appelant qui n'est ni le titulaire de la caisse ni `caisse:superviser` (nom du titulaire gardé, utile à PF03) ?
- Porteur, après PB19b : décisions D601 à D682 de cette reprise à valider (liste et révisions de décisions antérieures dans rapports/PB19b-chef.md).
- Porteur, après PF03b : attendu et écart sont visibles en direct pendant le comptage de fermeture, donc ajustables avant la confirmation (DEMANDE.md ligne 77 : « sa propre activité [...] et ensuite l'écart »). Recommandation de l'orchestrateur principal : les masquer jusqu'à la confirmation. Comportement inchangé en attendant.
- Porteur, après PF04 : le reçu d'une vente en plaquettes dit « 6 unités de X » faute de libellé d'unité sur la ligne de vente, et les alertes de péremption (PF06b) disent aussi « unités ». Ajouter ce libellé aux réponses du back ?
- Porteur, desktop (D748) : signature de code, hébergement des mises à jour, cible Windows, parc réel des officines, adresse de l'API déployée avec `DESKTOP_ORIGINS` ; à valider : D737 et D743.
- Reprises du run parqué 2026-10-22-lot8 : voir son decisions.md et l'historique git de ce fichier (questions TB3, B2, B4, U1, B8, B10, B11, B12, B14 toujours ouvertes).

## Dernières décisions (5 max, historique complet dans decisions.md)

- D731 Fenêtre d'ajout au stock : recherche seule avant un choix, encadré pour un médicament déjà en stock (porteur)
- D730 Ma caisse : bandeau si le jour métier de sa caisse est passé, date de la ligne d'ouverture selon le jour d'ouverture (révisable)
- D729 Import d'un inventaire : ni attendu ni écart à l'aperçu (révisable)
- D724 Changer l'unité d'une fiche qui a du stock est refusé (`UNITE_CHANGEMENT_AVEC_STOCK`) (à valider par le porteur)
- D723 Unité PLAQUETTE par migration additive, sur le modèle existant (porteur)
