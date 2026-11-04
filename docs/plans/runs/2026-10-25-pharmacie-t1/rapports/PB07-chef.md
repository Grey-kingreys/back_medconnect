# PB07 - Rapport du chef (Opus)

Branche orch/pharmacie-t1-back. Verdict : validé, commité (message « feat(pharmacie): lots, journal de stock, agrégats, reprise et migration M4 (PB07) », hash dans git log, non poussé).

## Ce qui a été fait

- Schéma : `LotStock`, `MouvementStock`, `AgregatStockLot`, `AgregatStockProduit`, `ConditionnementOuvert`, enums `TypeMouvementStock` et `TypePiece`, relations inverses sur `StockMedicament`, `PointDeVente`, `Poste`, `Fournisseur`.
- Migration M4 `20261026120000_pharmacie_t1_lots_mouvements` et son retour arrière : arrêts (quantité négative, fiche sans point de vente), CHECK nommés, triggers d'immuabilité, de protection du lot, d'agrégat et de gel du compteur, reprise rejouable, contrôle final stock calculé = compteur.
- `src/pharmacie/stock/commandes-stock.ts` (pg seul) et quatre scripts : `stock:verifier`, `stock:reconstruire`, `stock:comparer-compteur`, `pharmacie:pre-migration`.
- `purgerStockPharmacies` et jeu démo adapté (fiches à quantité nulle, lot technique et mouvement RECEPTION par fiche non vide, purge du journal avant la configuration de caisse).
- Tests : 2 (purge), 1 nouveau et 2 adaptés (seeder), 18 (M4 en base), 12 (commandes en base). Puce CLAUDE.md.

## Preuves (relancées par le chef)

- SQL de M4 et du retour arrière : identiques au texte de la fiche (diff exact, hors CRLF).
- `prisma generate` puis `prisma validate` : schéma valide.
- `tsc --noEmit` : code 0.
- `eslint` sur les 11 fichiers de la fiche : code 0, aucun avertissement.
- `npm test` : 74 suites, 852 réussis, 3 ignorés.
- `npm run test:db` : 10 suites, 94 tests verts (m4 : 18, commandes-stock : 12).
- `git status --short test/db/instantanes` : vide ; bases `mc_test_` restantes : 0 ; aucun tiret cadratin, demi-cadratin ni points de suspension dans les lignes ajoutées.
- Base de dev : `pharmacie:pre-migration` « migration possible » (57 fiches, 0 bloquant), `prisma migrate deploy` applique M4, `stock:comparer-compteur` « reprise et agrégats cohérents », `stock:verifier` « aucune anomalie », `prisma migrate diff --exit-code` : 0.

## Relecture

- Justesse métier : quantités entières en unités minimales, coût figé par lot (0 = non valorisable pour la reprise), lot jamais négatif (UPDATE puis INSERT, D499), produit négatif autorisé sans lot (O11), inventaire à écart nul accepté, reliquat de conditionnement dérivé du journal.
- Concurrence : reconstruction sous `SHARE ROW EXCLUSIVE` sur journal et conditionnements, ordre d'écriture fixé par D500 pour PB08 et suivants.
- Réversibilité : retour arrière testé après activité (écrêtage signalé, dates depuis les lots en stock), puis haut de nouveau ; arrêts de M4 testés sans trace partielle.
- Sécurité : aucune route ni lecture modifiée, aucun coût exposé ; cohérence lot, mouvement et point de vente imposée en base (D498) ; contournement de purge local à la transaction, suppressions seulement, retiré en fin de purge (testé).
- Scripts : n'affichent jamais `DATABASE_URL` ; `commandes-stock.ts` n'importe que le type `pg` (résolution en production).

## Décisions prises

Aucune nouvelle décision : D493 à D505 (ajoutées par l'orchestrateur à la spécification) appliquées telles quelles. `ACTIVE.md` : PB07 passé à validé ; le remplacement de D478, D479, D487, D490 par D493, D499, D500, D503 dans « Dernières décisions » est voulu (5 au plus, historique complet dans decisions.md).

## Réserves (non bloquantes, attendues)

- M4 est appliquée sur la base de dev : jusqu'à PB08 et PB11, les chemins qui écrivent encore `quantite` (upsert et import de stock, PATCH quantité, vente, annulation, `seed_medicaments.ts`) échouent (D505), et les lectures affichent le compteur gelé.
- Jeu démo recréé (`DEMO_RESET`) pendant J2 : les fiches démo lisent une quantité 0 jusqu'au recâblage des lectures en PB08 (D504).
- La suppression d'une pharmacie qui a des lots par le super administrateur échoue sur la clé étrangère jusqu'au 409 de PB09 (D503).
