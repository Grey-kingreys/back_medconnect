# PB12 - Contrôle du chef d'orchestration

Branche orch/pharmacie-t1-back. Vérificateur : PASS (rapports/PB12-verification.md).

## Ce qui a été fait

- Relecture complète du diff : `vente-regles.ts` (règles pures de l'annulation), `vente.service.ts` (extraction `posteParDefaut` et `ouvrirSessionVerrouillee`, `presenterVente`, `listerVentes`, `annulerVente`), contrôleur, DTO, catalogue d'erreurs, tests purs, HTTP et base, `CLAUDE.md`.
- Écart du codeur (`FOR KEY SHARE` sur `PointDeVente` avant le `FOR UPDATE` de l'origine) remplacé par une correction à la source (D554) : `assurerPoste` prend le point de vente en `FOR NO KEY UPDATE` au lieu de `FOR UPDATE`. Deux créations du même poste restent sérialisées ; une insertion qui pointe le point de vente (contrôle de clé étrangère en `FOR KEY SHARE`) ne l'attend plus. Le `FOR KEY SHARE` de l'annulation devenu inutile est retiré.
- Test ajouté : `8b` de `test/db/annulation.db-spec.ts`. Une transaction tient une création de poste ; une vente puis une annulation du même point de vente doivent aboutir en moins de 5 s. Rouge avant la correction (« Attente du verrou du point de vente. », la vente elle-même attendait), vert après.
- `CLAUDE.md` : une phrase D554 ajoutée à la puce PB12. Fiche (Historique, Validation), `decisions.md` (D554) et `ACTIVE.md` (PB12 validé, dernières décisions) mis à jour.

## Preuves (relancées par le chef, depuis la racine medconnecte)

- `docker compose exec -T backend npx tsc --noEmit` : 0 erreur.
- `docker compose exec -T backend npx eslint` (8 fichiers de la fiche et `points-de-vente.service.ts`) : 0 erreur.
- `docker compose exec -T backend npm test` : 79 suites, 903 tests passés, 3 ignorés (préexistants).
- `docker compose exec -T backend npm run test:db` : 17 suites, 191 tests passés.
- `annulation.db-spec.ts` et `points-de-vente.db-spec.ts` relancés 3 fois après la correction : 27 tests sur 27 à chaque passe (test 4 de course stable sans le `FOR KEY SHARE`).

## Justesse métier vérifiée

1. Pièce ANNULATION unique même en course : verrou `FOR UPDATE` de l'origine puis relecture de la pièce liée ; `venteOrigineId` unique en base ; P2002 sur `Vente` traduit en 409 `VENTE_DEJA_ANNULEE` (test 4).
2. Mouvements inverses : un `CORRECTION` positif par allocation non remplacée, même lot, sans lot pour une provisoire (tests 1, 7a à 7d) ; reliquat refermé ; fiche archivée acceptée.
3. Paiements opposés, un par paiement d'origine, référence et montant reçu nuls, dans la session de l'auteur (test 6) ; somme contrôlée par `paiementsInverses`.
4. Session et jour métier de l'auteur, session ouverte automatiquement, plus de limite de jour (tests 5 et 6) ; liste par `jourMetier` avec total signé (test 5).
5. Champs dérivés : colonnes gelées jamais écrites (grep vide), statut et `annulation` dérivés de la pièce liée ; historique inchangé (instantanés PB02 intouchés et verts).

## Sécurité

- Coûts : réponse d'annulation et détail passent par `masquerCouts` (`cheminsCout` vide sans `marge:read`, tests 1).
- Accès : origine lue par `id` et `structureId` (autre pharmacie : 404) ; `posteId` d'une autre pharmacie : 409 `POSTE_INCONNU` (filtre `structureId` de `ouvrirDansTransaction`), d'un autre point de vente : 409 `POSTE_INCONNU`.
- Permissions : `vente:annuler` ET `caisse:utiliser` (test HTTP 2d : 403 sans `caisse:utiliser`).
- Audit sans motif ni client (test 6).

## Décisions prises

- D554 : `assurerPoste` en `FOR NO KEY UPDATE`, `FOR KEY SHARE` de l'annulation retiré, test `8b`.

## Réserves (non bloquantes)

1. Changements de contrat pour le front (PF04) :
   - l'annulation exige en plus `caisse:utiliser` (403 `PERMISSION_REFUSEE` sinon) ; corps `{ motif, posteId? }` ;
   - `ANNULATION_HORS_DELAI` n'est plus jamais renvoyé ; nouveau code 409 `PIECE_NON_ANNULABLE` (pièce d'annulation ou de régularisation, vente déjà régularisée, vente d'avant la caisse) ; `POSTE_INCONNU` et `SESSION_AUTRE_UTILISATEUR` possibles ;
   - réponse : vente d'origine avec `statut` ANNULEE, `annulation { id, numero, motif, le, par { id, nom } }` ; toute pièce gagne `venteOrigine` et `motif` ; message « Vente <numero> annulée (A-<numero>). ... »;
   - liste : filtrée par `jourMetier` (et non plus `createdAt`), contient les pièces d'annulation (total et `nombreArticles` négatifs, `typePiece` ANNULATION, `numeroTicket` nul, `venteOrigine`), chaque élément gagne `typePiece`, `numeroTicket`, `jourMetier`, `venteOrigine`, `annulation { id, numero }` ; `totalJour` signé ;
   - les ventes d'avant la caisse (historiques) ne sont plus annulables : le front doit masquer ou désactiver le bouton (pièce rattachée à une session technique ; aucun champ dédié n'est exposé, le refus 409 porte le message).
2. Les verrous `FOR UPDATE` sur `StockMedicament` (`fiche-produit.service.ts`, `pharmacie.service.ts`) bloquent aussi les insertions à clé étrangère vers la fiche (lignes de vente, mouvements) le temps de la modification ; pas de cycle relevé, à garder en tête pour PB14, PB15 et PB18.
3. Réserve 1 de PB11 (fiche archivée entre lecture et verrou) toujours valable pour la vente ; sans objet pour l'annulation (archivage accepté, D552).
