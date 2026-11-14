# PB04 - Rapport du chef (Opus)

Branche orch/pharmacie-t1-back. Verdict : validé.

## Ce qui a été fait

Cinq fichiers de règles pures sous `src/pharmacie/domaine/` (`quantites`, `prix`, `selection-lots`, `caisse`, `marge`), leurs cinq specs, et `test/vecteurs/selection-lots.json` (24 cas, version 1). Aucun fichier existant modifié, aucune migration, aucun service branché (jalon J1 sans changement visible).

## Preuves (relancées par le chef)

- `docker compose exec -T backend npx tsc --noEmit` : code 0.
- `npx eslint` sur les 10 fichiers .ts : code 0, aucun avertissement.
- `npm test` : 69 suites, 825 réussis (740 + 85), 3 ignorés.
- `npm run test:db` : 3 suites, 26 tests verts (inchangé).
- Pureté : aucun import hors dossier (sauf `fs`/`path` en spec), aucun `new Date(` ni `Date.now(` dans le code.
- Aucun tiret cadratin ou demi-cadratin, aucun `eslint-disable`, `any`, `console.*`, `it.only`, `it.skip`.
- JSON des vecteurs : identique après parse au bloc de la fiche, V01 à V24, fin par saut de ligne.

## Relecture

Diff relu en entier contre la fiche : signatures, messages, ordre des refus (D471), arrondi GNF moitié éloignée de zéro sans -0 (D470), seuil de stock bas en boîtes sans division (D476, A4), sélection reliquat puis FEFO et variante BOITE (D473, déroulé à la main sur V21 et V17), théorique de caisse par mode (D474), marge par allocations avec provisoires par ligne et non valorisable par vente (D475). Aucune mutation des entrées (filtre avant tri). Les coûts (`coutUnitaire`, `coutAlloue`, `marge`) suivent la règle de nommage D466 : le masquage par `masquerCouts` restera assuré par les services qui exposeront ces résultats.

## Décisions

Aucune nouvelle décision : D469 à D477 (consignées par l'orchestrateur avant dispatch) sont confirmées par l'implémentation.

## Réserves pour les tâches suivantes

- `estPerime` et la validation des lots ne contrôlent que le format AAAA-MM-JJ, pas l'existence de la date (`2026-02-31` passe) : le service doit fournir des dates issues de la base (PB08, PB11).
- Vente par BOITE : la première passe prend `solde - reliquat` du lot, calculé avec le coefficient de réception ; si la fiche change de coefficient de boîte après réception, une « boîte » peut se composer d'unités de plusieurs lots. Comportement conforme à D473, à garder en tête pour PB11 et le front (PF01).
- `AllocationCalculee` et `ResultatMarge` portent des coûts : toute sortie API qui les inclut doit passer par `masquerCouts` (PB08, PB11, PB16).
