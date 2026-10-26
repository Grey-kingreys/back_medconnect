# PB11 - Contrôle du chef d'orchestration

Branche orch/pharmacie-t1-back. Reprise après interruption : l'arbre de travail du codeur a été gardé tel quel, rien n'a été jeté ni modifié dans le code.

## Ce qui a été fait

- Relecture complète du diff : `vente.service.ts` (création en 19 étapes, présentation D540, détail et annulation), `vente-regles.ts`, `jour-metier.ts`, `lecture-stock.ts` (`lireLotsCandidats`), `points-de-vente.service.ts` (`assurerPoste` extrait sans changement de comportement), filtre et catalogue d'erreurs, DTO, contrôleur, `CLAUDE.md`, tests unitaires, HTTP et base.
- Seul changement du chef : ligne PB11 de `docs/plans/ACTIVE.md` passée à « validé ».

## Preuves (relancées par le chef)

- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `docker compose exec -T backend npx eslint` (16 fichiers de la fiche) : aucune erreur.
- `docker compose exec -T backend npm test` : 79 suites, 889 tests passés, 3 ignorés (préexistants).
- `docker compose exec -T backend npm run test:db` : 16 suites, 178 tests passés (dont `vente.db-spec` 20 tests, `non-regression-lectures` avec instantanés intouchés).
- `git diff --stat -- test/db/instantanes prisma` : vide (aucune migration, schéma intact, D460 respecté).
- grep `CompteurVente|SOS_IDEMPOTENCE_HEURES|STOCK_INSUFFISANT|MEDICAMENT_EXPIRE` dans `vente.service.ts` et `vente.controller.ts` : aucune ligne.
- Tirets U+2013 et U+2014 dans les lignes ajoutées et les nouveaux fichiers : 0.

## Points vérifiés en particulier

1. Réserve 1 de PB10 (levée) : la vente prend les verrous dans l'ordre D527. `ouvrirDansTransaction` verrouille la ligne du poste (`FOR UPDATE OF p`), puis la vente verrouille la session (`FOR UPDATE OF s`, statut relu ; fermée entre-temps : une seule réouverture sous le verrou du poste), puis `CompteurTicket` (`INSERT ... ON CONFLICT DO UPDATE`), puis les verrous consultatifs des fiches, et seulement ensuite `Paiement`. `fermer` ne verrouille que la session puis calcule le bilan : une vente en cours bloque la fermeture jusqu'à son commit (le bilan, relu en READ COMMITTED, voit alors ses paiements), et une fermeture en cours fait relire FERMEE à la vente qui rouvre une session. Aucun cycle de verrous possible (fermer ne prend pas le poste).
2. Réserve de PB08 (levée) : les fiches de la vente sont lues avec `archiveLe: null` ; une fiche archivée répond 404 `STOCK_INTROUVABLE` (test 17 de `vente.db-spec`).
3. Coûts : toute réponse qui présente une vente (création, rejeu, rejeu concurrent, détail, annulation) passe par `masquerCouts` avec `marge:read` calculé hors transaction ; `details` de `SORTIE_MANUELLE_REQUISE` ne porte pas de coût (et le filtre les retirerait) ; l'anomalie `STOCK_NEGATIF` ne porte ni coût ni donnée du client.
4. Métier : prix lus de la fiche, unité refusée sur fiche non déconditionnable, périmé jamais pris automatiquement, provisoire sans refus avec anomalie attribuée à l'administrateur, ordonnance toujours exigée, espèces par défaut, somme des paiements égale au total, montants entiers GNF, numéro `T<ordre>-NNNNNNN`, clé d'idempotence permanente, seuil de stock bas en boîtes (A4) lu dans `ParametresPharmacie`.
5. Permissions : `caisse:utiliser` est déjà accordée par M1 (`20261026090000_pharmacie_t1_permissions`) ; la création exige `vente:write` et `caisse:utiliser`.

## Décisions prises

- Aucune nouvelle décision : D534 à D543 (écrites avec la fiche) couvrent tout.

## Réserves (non bloquantes)

1. Fiches lues à l'étape 1 avant leurs verrous consultatifs (étape 10, ordre imposé par D527) : un archivage concurrent exactement entre les deux pourrait laisser passer une dernière vente sur une fiche qui vient d'être archivée. Fenêtre très courte, sans perte de données (journal cohérent) ; à garder en tête pour PB12 et PB18.
2. PB12 (annulation) devra respecter le même ordre de verrous (poste, session, `CompteurTicket`, fiches) pour ne pas créer de cycle avec la vente.
3. Contrat front changé (PF03) : la création exige `caisse:utiliser`, renvoie `numero` au format `T1-0000001` et de nouveaux codes (`VENTE_UNITE_INTERDITE`, `PRIX_UNITE_MANQUANT`, `SORTIE_MANUELLE_REQUISE`, `PAIEMENTS_INCOHERENTS`) ; `STOCK_INSUFFISANT` et `MEDICAMENT_EXPIRE` ne sortent plus.
4. `annulerVente` échoue toujours en base (trigger d'immuabilité, D524) jusqu'à PB12, comme prévu.
