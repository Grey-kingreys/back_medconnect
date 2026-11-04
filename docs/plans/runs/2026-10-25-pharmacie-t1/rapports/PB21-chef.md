# PB21 : contrôle du chef d'orchestration

Verdict : validé. Back `orch/pharmacie-t1-back`, commit `feat(pharmacie): unité PLAQUETTE et coefficient de réception dans les lots (PB21)`.

## Condition de `fiche-produit.service.ts`, relue cas par cas (fiche avec du stock)

| Fiche | Changement | Résultat |
|---|---|---|
| Qualifiée, toute unité | Unité seule, ou unité et coefficient | 409 `UNITE_CHANGEMENT_AVEC_STOCK` |
| Non qualifiée, `UNITE`, coefficient 1 | Unité seule | Accepté (décision de l'orchestrateur principal, D724), quantités inchangées, sans conversion |
| Non qualifiée, `UNITE`, coefficient 1 | Unité et coefficient, sans `conversionStock` | 400 `CONVERSION_REQUISE` |
| Non qualifiée, `UNITE`, coefficient 1 | Unité et coefficient, `MULTIPLIER` ou `CONSERVER` | Accepté |
| Non qualifiée, autre unité | Unité seule | 409 |
| Non qualifiée, autre unité | Unité et coefficient | 400 sans conversion, 409 avec |
| Non qualifiée, `UNITE`, coefficient différent de 1 | Unité seule | 409 |
| Non qualifiée, `UNITE`, coefficient différent de 1 | Unité et coefficient | 400 sans conversion, 409 avec, y compris `CONSERVER` |

Sans stock, tout passe. Une fiche à -1 ou à régulariser compte comme ayant du stock (`aDuStock`). Lectures faites sous les verrous de la fiche. `lireStockFiche` reprend à l'identique la lecture extraite de la qualification, sans changement de comportement.

La dernière ligne va un peu plus loin que la formule « coefficient différent de 1 sans conversion » : `CONSERVER` y reste aussi refusé. C'est conforme à D724, à la fiche et à `CLAUDE.md`, et `MULTIPLIER` y était déjà impossible.

## Correction du chef

- `test/db/plaquette.db-spec.ts` : seul `MULTIPLIER` prouvait le changement d'unité par conversion. Test ajouté pour `CONSERVER` (fiche `UNITE` à coefficient 1, passage en plaquettes par 10, lot inchangé à 3).
- `docs/plans/ACTIVE.md` : la ligne PF08 du back avait une colonne de trop, remise en forme.

## Autres contrôles

- `test/db/fiche-produit.db-spec.ts` : aucun changement par rapport au dépôt.
- `plaquette.db-spec.ts` : parcours du porteur, photographie et cas de D724 ci-dessus. Le cas « coefficient différent de 1, unité et coefficient changés » n'a pas de test dédié, lu dans le code.
- Migration additive entre `BEGIN` et `COMMIT`, valeur placée après `AMPOULE`, schéma dans le même ordre. Retour arrière refusé tant qu'une fiche utilise `PLAQUETTE`, enum recréé et défaut remis ; README à jour.
- `coefficientReception` dans `LotExpose`, sans donnée de coût.

## Point à garder pour PF09

Une reprise qualifiée en plaquettes à coefficient 1 compte ses 3 « boîtes » comme 3 plaquettes à 1 par boîte, et ne peut plus être multipliée ensuite : la fiche est qualifiée. Pour une vraie boîte de 10, le titulaire doit changer unité et coefficient ensemble, avec le choix de conversion. L'écran doit le rendre évident.

## Preuves

- Par le chef, après ses corrections : `npm run test:db -- --testPathPatterns plaquette`, 2 suites, 14 verts ; crochet pre-commit (`tsc`, `eslint`) passé.
- Relancées par l'orchestrateur principal sur le code commité, test ajouté compris : `tsc` propre, 1151 unitaires, 432 `test:db`.
- Migration déjà appliquée à la base de dev (redémarrage du PC), `migrate status` à jour, d'après l'orchestrateur principal.
- `docker-entrypoint.sh` laissé hors du commit.

## Reste à présenter au porteur

D724, avec son exception de reprise.
