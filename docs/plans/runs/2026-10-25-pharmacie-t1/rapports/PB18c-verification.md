# PB18c - Vérification indépendante

Verdict : PASS (aucun défaut bloquant ; trois remarques mineures).

## Commandes lancées (depuis la racine du monorepo)

| Commande | Résultat |
|---|---|
| `docker compose exec -T backend npx tsc --noEmit` | aucune erreur |
| `npx eslint` sur les 8 fichiers `.ts` autorisés | aucune erreur |
| `npm test` | 99 suites, 1092 passés, 3 ignorés (attendu 1092) |
| `npm run test:db` | 33 suites, 392 passés (attendu 392) |
| `jest --config test/db/jest-db.json synchro-ventes` x2 | 15/15 les deux fois (stable) |
| Démarrage du backend de dev | « Nest application successfully started », API et Swagger démarrés, aucune erreur dans les logs |
| `git status --porcelain` | uniquement les fichiers autorisés plus `docker-entrypoint.sh` (hors périmètre PB18c, déjà modifié avant) |
| `git diff --stat -- prisma test/db/instantanes vente.db-spec annulation.db-spec` | vide |
| grep `clientNom\|clientTelephone` dans `src/pharmacie/synchro/` | `synchro.service.ts:1025-1026` (passage à `ecrirePieceVente`) et le spec de `resumeEvenement` (exclusion) ; le DTO est dans `dto/` |
| U+2014 / U+2013 dans les lignes ajoutées et les fichiers nouveaux | 0 |

## Extraction `ecrirePieceVente` (D657)

Comparaison ligne à ligne de l'ancien code (étapes 13 à 16) et de `src/pharmacie/ecriture-vente.ts` : identique pour la vente web.

- Même ordre : `vente.create` (lignes, allocations DEFINITIVE puis PROVISOIRE), `paiement.createMany`, mouvements (allocations puis reste provisoire, `apresParFiche`), anomalies `STOCK_NEGATIF`.
- Mêmes champs, mêmes `auteurId` (vendeur), même `details` de base ; `jourMetier` de l'anomalie reste `dateVersJour(jourMetier)`.
- Les options de rejeu sont absentes pour la vente web : `id` non passé, `evenementId` absent donc UUID serveur (`m.evenementId ?? randomUUID()`), `horodatageLocal`, `sequencePoste` et `jourMetierOrigine` à null comme avant (défauts de colonne).
- Aucun verrou n'est pris dans le module (ils restent en amont dans `enregistrerVente`), donc l'ordre des verrous de la vente web est inchangé.
- Le diff de `vente.service.ts` ne contient que l'import, l'appel et le remplacement de `vente.id` par `venteId` (étapes 17 et 19). `vente`, `annulation`, `non-regression-lectures` et les instantanés restent verts sans modification.

## Rejeu d'une vente (`appliquerVente`), conformité à la fiche

- Verrous : verrou de journée partagé puis poste (déjà pris par `appliquer`), puis caisse (`sessionDuPoste`), puis fiches (`verrouillerFiches`), fiches relues après les verrous (D560). Cohérent avec la vente web.
- Caisse non ouverte ou jour clôturé : `ARenvoyerSynchro('REGULARISATION_INDISPONIBLE')`, rien d'écrit (test 14 de `synchro-ventes` et test 14 de `synchro-caisse`).
- `IDENTIFIANT_DEJA_UTILISE`, cohérence (`total`, numéros), paiements via `preparerPaiements` avec tous les modes, `STOCK_INTROUVABLE` : conformes.
- Réallocation au jour local (`jourConakry(borne)`), prix du ticket gardé, coefficient lu sur la fiche du serveur, sortie manuelle ignorée si le lot n'est plus candidat, reste toujours provisoire, jamais de périmé pris automatiquement (`allouerLignes`).
- D652 : `STOCK_NEGATIF` aussi sans reste provisoire quand `quantiteProvisoireLocale > 0`, avec `origine`, `quantiteProvisoireLocale`, `perimesDisponibles`, `evenementId` dans les `details`.
- D654 : `CONDITIONNEMENT_CONCURRENT` calculé avant l'allocation, dédoublonné par fiche, ignore les lots périmés.
- D655 : plage trouvée et numéro libre donne `T<ordre>-n` ; sinon `N<ordre>-<poste>-<séquence>` avec `numeroTicket` nul ; secours `S...`, repli hors plage si déjà pris ; `PLAGE_EPUISEE` de secours créée une seule fois tant qu'une est OUVERTE (pièce `Poste`), hors plage toujours (pièce `VENTE`).
- D656 : `Vente.id = venteId`, `cleIdempotence` nulle, `evenementId` des mouvements `synchro:<evt>:<ligne>:<lot|provisoire>`.
- D653 : une anomalie par type et par vente, attribuée au titulaire, `details` sans donnée client ; aucune notification de stock bas.
- Audit `origine: 'synchro'` conforme.
- Données client : `clientNom || null` et `clientTelephone || null` comme la vente web (DTO rogne le texte) ; jamais dans une anomalie ni un journal (test 9 balaie tous les `details` des anomalies, test 13 vérifie `EVENEMENT_REJETE`).

## Tests

Tous probants, assertions concrètes sur la base (pièces, lignes, allocations, paiements, mouvements, soldes, anomalies), aucun à vide.

- CA25 : doublon séquentiel (compteurs Vente/Ligne/Allocation/Paiement/Mouvement/Audit inchangés) et deux envois simultanés (un `APPLIQUE` et un `DEJA_APPLIQUE` par événement, un seul mouvement par vente).
- CA24 (test 5) : allocation DEFINITIVE 1 plus PROVISOIRE 2, agrégat -2, `STOCK_NEGATIF`, puis réception qui remplace la provisoire et donne `RATTACHEE`.
- CA23 (test 8) : deux postes plus une vente web en `Promise.all` ; numéros distincts et dans la plage du poste, numéro web hors plage, quantités 14, agrégat -4, provisoires 4, `verifierStock` sans anomalie.
- Ordre inversé (test 4), résolution à la synchro (test 6), périmé seul et sortie manuelle (test 7), coefficient serveur (10), boîtes entamées (11), secours et hors plage (12), mises de côté (13), caisse fermée (14), pas d'interblocage 3 fois (15).
- `synchro-caisse` test 14 réécrit comme prévu (seul changement du fichier).

## Entorse `sed -i` sur `vente.service.ts`

- `git ls-files --eol` : index `i/lf`, arbre `w/lf`. L'index est en LF pour tous les fichiers du dépôt (108 en `w/lf`, 4 en `w/crlf`) : le dépôt est donc majoritairement LF dans l'arbre, `core.autocrlf=true` normalise de toute façon en LF à l'ajout. Aucun problème ; le diff n'est pas gonflé (154 lignes, uniquement les changements voulus, aucun bruit de fins de ligne).
- Aucun résidu `.bak` dans le dépôt (find).
- Remarque : l'énoncé indiquait des fichiers en CRLF dans l'arbre ; ce n'est vrai que pour 4 fichiers sous `src/pharmacie/`, sans lien avec PB18c.

## Écarts déclarés, jugement

1. Dédoublonnage `PRIX_DIVERGENT` par fiche (`rejeu-regles.ts`, ensemble `vus.prix` sur `fiche.id`) : conforme à la fiche (« une entrée par fiche et par cause »). Limite connue : une fiche vendue à la boîte puis à l'unité à des prix tous deux divergents n'en signale qu'une. Acceptable.
2. `PRIX_DIVERGENT` sur une vente à l'unité d'une fiche non déconditionnable : la fiche le prescrit littéralement (prix de l'unité nul ou différent) ; le test 9 vend F à l'unité et n'affirme que `VENTE_UNITE_INTERDITE`. En pratique cela produit deux anomalies pour une cause (`prixFiche: null`). Remarque mineure : seule l'anomalie d'unité serait plus lisible pour le titulaire ; à trancher avec le porteur, non bloquant.
3. `STOCK_NEGATIF` du rejeu sans `message` : identique à la vente web (aucun `message` dans les `details` de base) ; les nouvelles clés rejeu s'ajoutent sans le remplacer. Conforme à D657 (comportement identique), pas de défaut.

## Problèmes

Aucun bloquant. Remarques mineures : points 1 et 2 ci-dessus (`src/pharmacie/synchro/rejeu-regles.ts`, fonction `anomaliesApplication`).
