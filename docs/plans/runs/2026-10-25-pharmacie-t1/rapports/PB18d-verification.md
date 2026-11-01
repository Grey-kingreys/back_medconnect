# PB18d - Vérification indépendante

Verdict : PASS (aucun défaut bloquant ; deux remarques mineures).

## Commandes lancées (depuis la racine du monorepo)

| Commande | Résultat |
|---|---|
| `docker compose exec -T backend npx tsc --noEmit` | aucune erreur |
| `npx eslint` sur les 4 fichiers `.ts` autorisés | aucune erreur |
| `npm test` | 99 suites, 1093 passés, 3 ignorés (attendu 1093) |
| `npm run test:db` | 34 suites, 399 passés (attendu 399) |
| `jest --config test/db/jest-db.json synchro-remontee` x2 | 7/7 les deux fois (stable) |
| Démarrage du backend de dev | « Nest application successfully started », API et Swagger démarrés ; les seules erreurs des logs sont d'anciens `SIGTERM` de redémarrage de `nest start --watch` |
| `git status --porcelain` | CLAUDE.md, synchro.service.ts, les deux specs de test 14, le nouveau synchro-remontee.db-spec.ts, plus `docker-entrypoint.sh` (hors périmètre, déjà modifié) |
| `git diff --stat -- prisma test/db/instantanes src/pharmacie/caisse` | vide |
| grep `REGULARISATION_INDISPONIBLE` dans synchro.service.ts | aucune occurrence |
| U+2014 / U+2013 (octets UTF-8) dans les lignes ajoutées et le fichier nouveau | 0 |
| Fins de ligne, `.bak` | index `i/lf`, arbre `w/lf` pour les fichiers touchés, aucun CR, aucun `.bak`, diff sans bruit (110 insertions, 45 suppressions, uniquement du fond) |

## Conformité à la fiche

- `appliquerVente` (`src/pharmacie/synchro/synchro.service.ts` autour des lignes 868-886) : `regularisation = statut !== 'OUVERTE' || clos`, `jourDeRattachement` sous le verrou de journée partagé, `jourMetier` = jour de rattachement, `jourMetierOrigine` = jour de la caisse, `sessionId: s.id` (caisse d'origine, paiements compris), `typePiece` `REGULARISATION`, `venteOrigineId` non renseigné, numéro de ticket inchangé (D655). Les anomalies d'application prennent le `jourMetier` de la pièce. Conforme.
- Anomalie `REMONTEE_APRES_CLOTURE` (lignes ~1193-1240) : raison `JOURNEE_CLOTUREE` ou `CAISSE_FERMEE`, clôture retrouvée par `pointDeVenteId_jourMetier` du jour de la caisse, `posteManquantDeLaCloture` calculé sur `postesManquants[].sessionId === s.id` (faux sans clôture, tableau absent toléré), `attribueeAId = s.utilisateurId ?? adminId`, `details` complets, messages français identiques à la fiche. Conforme.
- `creerAnomalie` : paramètre `attribueeAId` optionnel avec défaut `ctx.structure.adminId` : les autres appels sont inchangés.
- `aRenvoyer` prend `CodeARenvoyer` ; le code reste défini mais n'est plus levé. Audit : `metadata.typePiece` ajouté ; résultat `piece.type` correct.
- Tests existants : synchro-ventes test 14 et synchro-caisse test 14 conformes à la fiche (seuls changements de ces fichiers). CLAUDE.md : puce PB18 complétée, ancienne phrase `A_RENVOYER` retirée.

## Invariant « le jour clôturé n'est jamais modifié »

Le test 3 de `test/db/synchro-remontee.db-spec.ts` prend `avant = etatJour(hier)` juste après la clôture forcée, rejoue deux ventes, un comptage et la fermeture, puis compare `etatJour(hier)`. L'aide couvre : identifiants des pièces du jour, sessions (id, statut, clôture), ligne `ClotureJournaliere` (`forcee`, `postesManquants`), `TotalClotureMode` (théorique, compté, écart par mode), export CSV complet en texte. La comparaison `toEqual` est réelle sur l'ensemble, avec l'unique exception déclarée du statut de sessions. Les assertions de contenu (pièces `REGULARISATION` du jour courant, caisse S, paiements dans S, stock -4) prouvent que quelque chose a bien été écrit ailleurs. Le test est probant.

Remarques mineures sur la portée de la preuve :
1. `etatJour` compare les pièces par identifiant seulement ; une modification de contenu d'une pièce (total) serait vue par l'export, pas par les ids. Couvert indirectement par l'export au caractère près.
2. `sansStatut` retire le statut de toutes les sessions du jour, pas seulement de S ; seule S est vérifiée FERMEE. Une autre caisse de la veille qui changerait de statut passerait inaperçue (aucune autre caisse n'existe dans le scénario). Non bloquant ; resserrer en ne neutralisant que S serait plus strict (`test/db/synchro-remontee.db-spec.ts`, fonction `sansStatut` du test 3).

## Écarts déclarés

(a) Test 3, S OUVERTE vers FERMEE : acceptable et cohérent. D618/D649 : la clôture forcée laisse la caisse desktop ouverte, hors totaux (`clotureJournaliereId` nul) ; le rejeu de `SESSION_FERMEE` la ferme sans jamais l'inclure. Le test assert S FERMEE avec `clotureJournaliereId` nul, et tout le reste (pièces, clôture, totaux, export) strictement égal : l'invariant est tenu au niveau où il compte (ce qui est verrouillé et figé). La fiche elle-même écrivait « égalité stricte » alors que D649 impose cette transition ; l'écart est une correction de la fiche, pas un affaiblissement.
(b) Test 4, `totalJour` comparé à la somme SQL des pièces VALIDEE du jour par structure : acceptable (les fixtures laissent d'autres pièces le même jour), et l'assertion distincte somme des régularisations = 4000 garde la valeur propre. L'égalité à une requête indépendante est même plus forte qu'un littéral.
(c) Test 14 de synchro-caisse, mouvement rendu valide : nécessaire, sinon il serait rejeté `EVENEMENT_INVALIDE` avant d'atteindre `SESSION_FERMEE` ; l'assertion attendue par la fiche (`SESSION_FERMEE`) est ainsi réellement exercée.

## Jugement métier

Le scénario de terrain est tenu : un poste desktop hors ligne pendant la clôture forcée remonte le lendemain ; la journée close reste intacte (export identique), les ventes sont comptées sur la journée en cours (liste et total du jour, clôture du jour sans forcer, export avec « Régularisation » et caisse non incluse), l'argent est resté sur la caisse d'origine (paiements dans S, anomalie de fermeture avec `montantEncaisse` 6 000 au titulaire), le vendeur de la caisse est destinataire de l'anomalie `REMONTEE_APRES_CLOTURE` avec le numéro du ticket, le jour d'origine et le message en français clair (« La journée clôturée n'a pas changé »). Une régularisation n'est pas annulable (409 `PIECE_NON_ANNULABLE`). Le cas caisse ouverte hors ligne sur journée déjà clôturée (test 6) reste une vente ordinaire sans anomalie : cohérent avec la fiche.

## Problèmes

Aucun bloquant. Remarques mineures ci-dessus (resserrer `sansStatut` à la seule caisse S, `test/db/synchro-remontee.db-spec.ts`).
