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
| PB18 | Synchronisation desktop, quatre sous-fiches commitées dans l'ordre : tasks/PB18a-plages-catalogue-cors.md, tasks/PB18b-moteur-rejeu-caisse.md, tasks/PB18c-rejeu-ventes.md, tasks/PB18d-remontee-apres-cloture.md (D630 à D661) | dur | en cours : PB18a validé (D662, rapports/PB18a-chef.md) ; PB18b validé (D663 à D665, rapports/PB18b-chef.md) ; PB18c validé (D666, rapports/PB18c-chef.md) ; PB18d à faire | 1 |
| PB19 | Seeds, démo et documentation | spécifié | à faire | 0 |

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|

## Questions parquées

- Porteur : Q01, Q02, Q05 à Q14, Q16, Q17 de PLAN.md section 7, défauts du plan appliqués (A6), à remonter au rapport final.
- Reprises du run parqué 2026-10-22-lot8 : voir son decisions.md et l'historique git de ce fichier (questions TB3, B2, B4, U1, B8, B10, B11, B12, B14 toujours ouvertes).

## Dernières décisions (5 max, historique complet dans decisions.md)

- D666 Vente à l'unité sur fiche non déconditionnable : seule `VENTE_UNITE_INTERDITE`, pas de `PRIX_DIVERGENT` en plus (révisable)
- D663 Révise D636 : 2 Mo et gzip pour la seule route de synchro, 100 Ko et 415 sur un corps compressé ailleurs (révisable)
- D664 Événement empoisonné : NUL rejeté `EVENEMENT_INVALIDE`, 3e échec imprévu (hors panne passagère) mis de côté `EVENEMENT_INAPPLICABLE`, compteur dans `dernierEtat` (révisable)
- D662 Photographie du catalogue sans `jour` : rien qui dépende de l'heure dans l'ETag ; heure du serveur dans l'en-tête `Date`, exposé par le CORS (révisable)
