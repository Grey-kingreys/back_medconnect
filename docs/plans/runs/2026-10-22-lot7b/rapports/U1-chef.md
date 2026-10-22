# Chef d'équipe back : U1 structure de rattachement (lot7b)

Date : 2026-10-22. Dépôt `D:\tmp\wt-back-lot7b`, branche `orch/lot7b-back`. Gate locale, aucun `docker compose`.

## Ce qui a été fait (par le codeur, revu ici)

- `UserStructureDto` + `UserResponseDto.structure` exposée (`@Expose`, `@Type`) : cause D201 corrigée, `GET /users` et `GET /users/:userId` renvoient `structure { id, nom, type }`.
- `user.service.ts` : `avecStructureResolue` (structureId, sinon structure administrée, sinon null), `administeredStructure` ajouté aux deux `select`, `structureId` brut conservé, aucune autre méthode touchée.
- Script lecture seule `scripts/structures-rattachements.ts` + logique pure `src/user/rattachements-structure.ts` (requête paramétrée, `BEGIN READ ONLY` / `ROLLBACK`, libellés conformes), entrée `npm run structures:rattachements`, puce CLAUDE.md après TB17.
- Tests : 5a (5 cas service), 5b (contrôleur, non-régression D201), 5c (règles d'analyse).

## Preuves

- `npx --no-install tsc --noEmit` : code 0.
- `npx --no-install eslint <7 fichiers touchés>` : sortie vide, code 0.
- `npx --no-install jest` : 58 suites, 648 tests verts, 3 ignorés (préexistants).
- `env -u DATABASE_URL npm run structures:rattachements` : « DATABASE_URL n'est pas définie. », code 1.
- `git diff --quiet -- package-lock.json prisma src/pharmacie src/common/rbac src/user/user.controller.ts` : code 0.
- Tirets U+2013/U+2014 dans les lignes ajoutées et fichiers nouveaux : 0 (recherche sur octets).
- Contrat front : `src/app/dashboard/utilisateurs/page.tsx` lit `u.structure ? u.structure.nom`, cohérent avec `structure { id, nom, type } | null`.

## Décisions

- D-U1-a : verdict défavorable du vérificateur écarté. Le seul grief est le reformatage de `src/user/dto/user.dto.ts` (4 vers 2 espaces, deux `message` reflowés, une ligne vide en double retirée). Le fichier de HEAD échoue déjà à `eslint` (121 erreurs `prettier/prettier`, vérifié via `git show HEAD:... | eslint --stdin`) : la spec était contradictoire (conserver 4 espaces ET eslint vide), et le hook pre-commit lint les fichiers indexés. Le formatage Prettier du projet est donc requis ; `git diff -w` ne montre que les ajouts de la spec plus le reflow Prettier, aucun changement de comportement.

## Réserves

- Chemin 5 (`createByAdmin`, POST /users sans établissement) reste parqué pour le porteur (D206) : les comptes créés ainsi s'afficheront toujours sans structure ; le script les liste.
- Le script n'a pas été lancé contre une base réelle (gate locale sans base) ; requête relue, couverte par les tests de la logique pure.
- Diff de `user.dto.ts` volumineux à la relecture (reformatage) : lire avec `git diff -w`.
