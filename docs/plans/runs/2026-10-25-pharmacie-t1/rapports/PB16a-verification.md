# PB16a - Vérification (Sonnet, indépendant)

Verdict : PASS (aucun problème bloquant, 2 remarques non bloquantes)

## Commandes relancées

- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `npx eslint` des 8 fichiers de la fiche : 0 erreur, 0 avertissement (sortie vide).
- `npm test` : 90 suites, 996 passés, 3 ignorés (préexistants), 0 échec. Avant PB16a : 88 suites, 982 ; écart de +2 suites et +14 tests : 7 (`peremption.spec.ts`) + 5 (`rapports.http.spec.ts`) = 12, les 2 tests restants viennent de suites préexistantes (à confirmer par l'orchestrateur).
- `npm run test:db` : 25 suites, 305 passés, 0 échec. `rapports-pharmacie.db-spec.ts` compte 14 `it` (comptés dans le fichier, noms conformes à la fiche). Le total passe de 290 à 305 (+15) : un test de plus que les 14 attendus, venant d'ailleurs que de ce fichier (voir remarque 2).
- `git status --porcelain` : fichiers autorisés (`CLAUDE.md`, `pharmacie.module.ts`, les 7 nouveaux fichiers), plus `docker-entrypoint.sh`, plus `docs/plans/` (ACTIVE.md, decisions.md, fiches PB16a et PB16b) qui relèvent de l'orchestrateur. `git diff --stat -- prisma test/db/instantanes src/pharmacie/domaine/marge.ts` : vide.
- Lecture seule : `grep "\.create\|\.update\|\.delete\|\$executeRaw"` sur `rapports/` et `peremption.ts` : seule ligne, `Test.createTestingModule` du spec HTTP (faux positif, aucune écriture).
- Domaine pur : `grep "new Date(\|Date.now\|@nestjs\|generated/prisma"` sur `peremption.ts` : aucune ligne. Imports : `./quantites`, `./reception`, `./selection-lots` seulement.
- Tirets cadratins et demi-cadratins : aucun dans les fichiers nouveaux ni dans les lignes ajoutées de `CLAUDE.md` et `pharmacie.module.ts`.

## Conformité fiche

- `peremption.ts` : règles 1 à 8 conformes (`joursEntre` par `Date.UTC`, validations dans l'ordre demandé, lots à solde <= 0 ignorés, horizons décroissants, classement exclusif par le plus petit horizon avec `perimes` via `estPerime`, valorisation `umVersBoites` / `arrondiGnf`, `coutConnu = coutUnitaire > 0 && !lotTechnique`, totaux `null` si aucun lot connu et 0 pour un groupe vide, tri date, nom `fr`, lotId).
- Service : alertes en lecture seule (aucun `assurerPointDeVente`), repli sur `{90,30,7}`, une seule requête `lotStock.findMany` avec exactement le `where` et le `select` de la fiche, lots de fiche archivée gardés, `masquerCouts` appliqué, `valeurVente` conservée sans `marge:read` (clé sans « cout » ni « marge »). Marge : contrôles et ordre des 400 conformes (`du` invalide, `au` invalide, inversée sur `du`, 92 jours sur `au`, `joursEntre + 1 > 92`), requête `vente.findMany` avec `statut: 'VALIDEE'`, `calculerMarge` réutilisé tel quel, `chiffreAffairesTotal` sommé sur toutes les lignes, pas de `masquerCouts` (la garde exige `marge:read`).
- Contrôleur : gardes, permissions (`STOCK_READ`, `MARGE_READ`) et textes Swagger conformes. DTO conforme. Module : contrôleur et service ajoutés après les `Anomalies*`, rien d'autre.
- Tests : 7 unitaires, 5 HTTP et 14 db présents avec les assertions de la fiche (valeurs 20 000, 12 500, 5 000, 24 000 / 17 000 / 7 000, 4 000 / 2 400 / 1 600, `toEqual` avec `masquerCouts(..., false)`, `finally` qui restaure `{90,30,7}`). Aucun test affaibli, aucune assertion absente. Le test 1 utilise `annulees > 0`, comme demandé.
- CLAUDE.md : puce ajoutée après PB15c, texte de la fiche.

## Écarts déclarés

- (a) RangeError via `jourValide` dans `classerAlertesPeremption` : justifié. `estPerime` (via `exigerJour`) ne contrôle que le format ; le test 7 (`'2026-13-01'`) l'exige. Peu coûteux, dans l'esprit de la règle 2. Accepté.
- (b) Tests db 1 et 2 par `to_char` : accepté, plus fiable que `dateVersJour` pour lire des dates SQL sans effet de fuseau, et la comparaison reste exacte.
- (c) Fabrique de lot à J+3 : accepté. Le groupe `7` est celui que les tests lisent (`horizons[2]`) ; les cas qui dépendent de la date la fixent explicitement.
- (d) `prettier --write` et `sed -i` : seul le dernier est une entorse à la règle Write/Edit, sans effet visible. `git diff --stat` ne montre aucune réécriture hors fichiers autorisés. Tous les fichiers touchés sont en CRLF cohérent (nombre de `\r` = nombre de lignes), sans BOM (premier octet `i` / `import`). Aucun autre fichier reformaté.

## Jugement métier

- GNF entiers : `arrondiGnf`, `exigerEntier` sur quantité, coût et prix.
- Un coût inconnu n'est jamais compté pour 0 : `valeurCout` nul, `coutConnu` faux, totaux de groupe nuls quand rien n'est connu, `nombreLotsCoutInconnu` visible du titulaire.
- Vendeur sans `marge:read` : `cheminsCout` vide (testé), route marge en 403, `valeurVente` seule visible. Rien ne fuit par `debutFiabilite` (route marge seulement).
- Lecture seule : aucune écriture ; la marge ne compte jamais une vente à coût 0 à 100 %.

## Problèmes

Aucun bloquant.

1. Non bloquant : `rapports.service.ts` lit `horizonsPeremptionJours` sans valider les valeurs en base ; une valeur hors 1 à 365 ferait lever un `RangeError` (500). Les paramètres sont déjà validés à l'écriture (PB05), donc risque théorique seulement.
2. Non bloquant : `test:db` passe de 290 à 305 (+15) pour 14 tests ajoutés par PB16a ; le test supplémentaire vient d'un autre fichier déjà présent (je n'ai pas relevé lequel, aucune suite existante n'est modifiée par `git status`). À confirmer par l'orchestrateur en comparant au dernier décompte validé.
3. Ordre de grandeur : le message « N lot(s) à surveiller. » ne compte pas les lots sans date ; conforme à la fiche.
