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
| PB15 | Inventaire, sorties manuelles, anomalies et import inventaire | spécifié | à faire | 0 |
| PB16 | Alertes de péremption, marge et étanchéité des coûts | spécifié | à faire | 0 |
| PB17 | Clôture journalière | dur | à faire | 0 |
| PB18 | Synchronisation desktop | dur | à faire | 0 |
| PB19 | Seeds, démo et documentation | spécifié | à faire | 0 |

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|

## Questions parquées

- Porteur : Q01, Q02, Q05 à Q14, Q16, Q17 de PLAN.md section 7, défauts du plan appliqués (A6), à remonter au rapport final.
- Reprises du run parqué 2026-10-22-lot8 : voir son decisions.md et l'historique git de ce fichier (questions TB3, B2, B4, U1, B8, B10, B11, B12, B14 toujours ouvertes).

## Dernières décisions (5 max, historique complet dans decisions.md)

- D570 Réception : lignes des fiches en `FOR NO KEY UPDATE` triées, puis verrous consultatifs ; ni poste ni caisse (révisable)
- D576 Résolution : ventes les plus anciennes d'abord, lots non périmés en FEFO, partielle permise, jamais une vente annulée (révisable)
- D578 L'annulation relit les allocations sous les verrous des fiches (concurrence avec la résolution) (révisable)
- D579 Import : livraison vers réception en PB14c, inventaire refusé 409 `IMPORT_INVENTAIRE_INDISPONIBLE` jusqu'à PB15 ; plus aucune écriture du compteur gelé (révisable)
- D582 Mode d'import absent = inventaire, refusé jusqu'à PB15 ; le front doit envoyer `livraison` (correction PF) (révisable)
