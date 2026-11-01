# PF07d - Import Excel : livraison par défaut, modes selon les droits, rapport par lot

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (titulaire qui charge le fichier Excel de son grossiste ou son propre fichier de stock)
Visuel: oui (fenêtre `ImportStockModal` existante, textes et colonnes)
Background-safe: oui
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-front`

## Spec

### Objectif

Huitième sous-fiche (D685), dernière de PF07. L'import Excel du stock suit PB14c et PB15c : « Livraison » devient le mode par défaut (D696, demande de l'orchestrateur principal ; le serveur garde `inventaire` par défaut quand le mode manque, D582, mais le front envoie toujours un mode), chaque mode n'est proposé qu'à qui en a le droit (`reception:write`, `inventaire:write`), le modèle se télécharge par mode, les consignes disent que les quantités sont en boîtes et que la péremption est obligatoire, l'aperçu montre les nouvelles colonnes (lot, coût seulement s'il est transmis, unités reçues, écarts d'inventaire) et le résultat mène à la réception créée.

Décisions applicables : D684, D686, D687, D695, D696, D698, D704.

### Contexte vérifié dans le code front (ne pas re-découvrir)

- `src/components/modals/ImportStockModal.tsx` (703 lignes) : composant générique `ImportExcel` piloté par `ConfigImportExcel<L, M>` (`modes?: OptionModeImport<M>[]`, la **première option est celle par défaut**, `textes`, `telechargerModele`, `apercu`, `importer`, colonnes du tableau d'aperçu) ; `configImportStock(structureId)` (lignes 567 à 610) met « Inventaire : remplacer les quantités » en premier ; `configImportCatalogue` (catalogue, inchangé) ; colonne « avant → après » par `quantiteAvant` / `quantiteApres` (lignes 33 à 41).
- `src/lib/api_pharmacie.ts` : `ModeImportStock`, `LigneImportStock` (sans les champs de PB14c et PB15c), `telechargerModeleImportStock(structureId)` sans mode, `apercuImportStock` et `importerStock` avec `mode = "inventaire"` par défaut, `RapportImport<L>` sans `receptionId` ni `inventaireId`.
- `src/app/dashboard/stock/page.tsx` : bouton « Importer depuis Excel » toujours visible ; ouverture par `?importer=1`. `src/lib/navigation_tableau_de_bord.ts` : raccourci `importer-stock` (`acces: perm(["stock:read", "stock:write"])`).
- `src/hooks/useAuth.tsx` + `src/lib/acces.ts` : `lireContexteAcces(user, profile).permissions` (ensemble des permissions effectives) ; modèle d'usage : `src/app/dashboard/ventes/page.tsx` ligne 51 (`peutAnnuler`).
- Contrats (back `CLAUDE.md`, puces PB14c et PB15c ; `pharmacie.dto.ts` lignes 185 à 251 ; `pharmacie.service.ts` lignes 1341 à 1480) : `POST /pharmacie/stock/:structureId/import` et `/import/apercu` (multipart `fichier`, `mode`) : `livraison` exige `reception:write`, `inventaire` exige `inventaire:write` (403 sinon) ; `GET .../import/modele?mode=livraison|inventaire` ; lignes du rapport : `ligne`, `nom`, `statut`, `raison?`, `medicamentId?`, `medicamentNom?`, `quantite?` (boîtes), `prixUnitaire?`, `dateExpiration?`, `notes?`, `numeroLot?`, `coutAchatBoite?` (absent sans `marge:read`), `sansPeremption?`, `unitesRecues?`, `lotId?`, `quantiteAvant?` (unités, peut être négative), `quantiteApres?`, `unitesEnPlus?`, `quantiteComptee?`, `quantiteTheorique?` (peut être négative), `ecart?`, `sousTolerance?`, `nouveauLot?` ; réponse de l'import `data { ...rapport, mode, importees, receptionId, inventaireId }` (l'un des deux non nul) ; message du serveur (nombre d'écarts signalés pour l'inventaire).
- Jeu démo : aucun fichier Excel fourni ; le modèle téléchargé sert de fichier de test.

### 1. `src/lib/api_pharmacie.ts`

- `LigneImportStock` gagne les champs ci-dessus (tous facultatifs ; `coutAchatBoite?: number | null`, commentaire D698) ; `RapportImportStock` = `RapportImport<LigneImportStock> & { mode?: ModeImportStock; receptionId?: string | null; inventaireId?: string | null }`.
- `telechargerModeleImportStock(structureId, mode: ModeImportStock)` appelle `.../import/modele?mode=<mode>` ; nom par défaut `modele-livraison-stock.xlsx` ou `modele-inventaire-stock.xlsx`.
- `apercuImportStock` et `importerStock` : paramètre `mode` **obligatoire** (plus de défaut).

### 2. `ImportStockModal.tsx`

- `configImportStock(structureId, modesPermis: ModeImportStock[])` : options dans l'ordre « Livraison » puis « Inventaire », filtrées par `modesPermis` ; un seul mode permis : pas de choix affiché, ce mode est utilisé et nommé dans l'introduction.
  - Livraison : libellé « Livraison : ajouter les boîtes reçues », explication « Chaque ligne du fichier crée un lot. Quantités en boîtes ; date de péremption obligatoire (ou « sans péremption ») ; numéro de lot et coût d'achat facultatifs. ».
  - Inventaire : libellé « Inventaire : remplacer par les quantités comptées », explication « Une ligne par lot compté, quantités en boîtes (et unités en plus d'une boîte entamée). Les quantités du fichier remplacent celles enregistrées. ».
- Consignes de l'étape 1 (remplacent le texte actuel) : « 1. Téléchargez le modèle du mode choisi. 2. Remplissez une ligne par produit et par lot : les quantités sont en boîtes. 3. Pour une livraison, indiquez la date de péremption de chaque ligne (par exemple 30/06/2028), ou écrivez « sans péremption ». 4. Envoyez le fichier : rien n'est enregistré avant votre confirmation. ».
- Le bouton du modèle télécharge le modèle **du mode sélectionné**.
- Tableau d'aperçu, colonnes selon le mode :
  - Livraison : « Ligne », « Médicament », « Boîtes » (`quantite`), « Unités reçues » (`unitesRecues`), « Péremption » (`dateExpiration` affichée `afficherDatePeremption`, ou « Sans péremption »), « Lot » (`numeroLot` ou vide), « Coût d'une boîte » **seulement si au moins une ligne porte la clé `coutAchatBoite`** (`formaterGNF`, « Inconnu » si `null`), « Stock avant → après » (existant, en unités, valeur négative affichée telle quelle), « Statut ».
  - Inventaire : « Ligne », « Médicament », « Lot » (`numeroLot` ou date, « nouveau lot » si `nouveauLot`), « Attendu » (`quantiteTheorique`), « Compté » (`quantiteComptee`), « Écart » (`ecart`, signé, « dans la tolérance » si `sousTolerance`), « Statut ».
  - Lignes rejetées : `raison` du serveur telle quelle.
- Confirmation : livraison « Ajouter <n> lots au stock ? », inventaire « Remplacer le stock de <n> lots par les quantités comptées ? ».
- Résultat : message du serveur ; livraison avec `receptionId` : lien « Voir la réception » vers `/dashboard/receptions/<receptionId>` (affiché seulement si `reception:write`, ce qui est le cas en livraison) ; inventaire : « Les écarts au-delà de la tolérance sont signalés au titulaire. ».
- 403 (aperçu ou import) : message du serveur dans le bloc d'erreur existant, rien d'autre ; 409 et 400 : message du serveur.

### 3. Page du stock et raccourci (D695)

- `src/app/dashboard/stock/page.tsx` : `modesPermis` calculé depuis `lireContexteAcces(user, profile).permissions` (`reception:write` donne `livraison`, `inventaire:write` donne `inventaire`) ; le bouton « Importer depuis Excel » et l'ouverture par `?importer=1` n'existent que si `modesPermis` n'est pas vide ; `ImportStockModal` reçoit `modesPermis` et le passe à `configImportStock`.
- `src/lib/navigation_tableau_de_bord.ts` : raccourci `importer-stock` : `acces: perm(["reception:write", "inventaire:write"], { typesStructure: P })`, description « Ajoutez une livraison ou un inventaire depuis un fichier Excel ».

### 4. Tests

`src/components/modals/ImportStockModal.test.tsx` (adapter les tests existants qui supposent « Inventaire » par défaut ; ajouter 7) :
1. avec les deux droits, « Livraison » est sélectionnée par défaut et l'aperçu est demandé avec `"livraison"` ;
2. avec `inventaire:write` seul : aucun choix affiché, mode `"inventaire"` utilisé ;
3. le modèle téléchargé suit le mode sélectionné (`telechargerModeleImportStock(s1, "inventaire")` après bascule) ;
4. aperçu livraison : colonne « Coût d'une boîte » absente quand aucune ligne n'a la clé ; présente avec « Inconnu » pour `null` ;
5. aperçu inventaire : écart « -5 » et `quantiteTheorique` négative affichée telle quelle ;
6. résultat livraison avec `receptionId: "r1"` : lien « Voir la réception » vers `/dashboard/receptions/r1` ;
7. 403 de l'aperçu : message du serveur affiché.

`src/app/dashboard/stock/page.test.tsx` (1 ajouté, adapter le test existant `?importer=1` en donnant `reception:write` au profil simulé) : sans `reception:write` ni `inventaire:write`, ni bouton « Importer depuis Excel » ni ouverture par l'adresse.

`src/lib/navigation_tableau_de_bord.pharmacie.test.ts` (1 ajouté) : le raccourci « Importer le stock » est absent pour le rôle « Pharmacien » par défaut.

## Contraintes

Faire uniquement ce qui est demandé ; `configImportCatalogue` et le composant générique ne changent pas de comportement. Audience non-dev : termes interdits absents. Visuel : classes existantes de la fenêtre, clair et sombre, AA. Écrire uniquement avec Write et Edit. Ne jamais afficher une valeur de `.env`. Ne pas toucher à `docs/plans/`. Ne pas commiter. Aucun tiret cadratin ni demi-cadratin.

Fichiers autorisés : `src/lib/api_pharmacie.ts`, `src/components/modals/ImportStockModal.tsx`, `src/components/modals/ImportStockModal.test.tsx`, `src/app/dashboard/stock/page.tsx`, `src/app/dashboard/stock/page.test.tsx`, `src/lib/navigation_tableau_de_bord.ts`, `src/lib/navigation_tableau_de_bord.pharmacie.test.ts`.

## Test à la main

Démo remise à zéro, **Djénabou Baldé** (titulaire, Kaloum) : « Importer depuis Excel », « Livraison » présélectionnée, modèle de livraison téléchargé, rempli de deux lignes (une avec péremption, une sans date ni « sans péremption » pour voir le rejet), import, lien « Voir la réception ». Puis modèle d'inventaire. **Ousmane Keita** (vendeur) : aucun bouton d'import. Captures clair et sombre.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte\front_medconnect` :

1. `npx tsc --noEmit` : aucune erreur.
2. `npx eslint` sur les fichiers autorisés : aucune erreur nouvelle.
3. `npm test` : tout vert, dont `ImportStockModal.test.tsx` (7 ajoutés), page du stock (1 ajouté), navigation (1 ajouté).
4. `npm run build` (local) : réussi.
5. `git status --porcelain` ne liste que des fichiers autorisés ; `grep -n 'mode: ModeImportStock = "inventaire"' src/lib/api_pharmacie.ts` : aucune ligne.
6. Termes interdits absents ; aucun U+2014 ni U+2013 ajouté ; captures clair et sombre (vérificateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
