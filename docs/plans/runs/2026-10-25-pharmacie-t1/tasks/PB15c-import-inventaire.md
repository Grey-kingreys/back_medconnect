# PB15c - Import Excel d'un inventaire vers un inventaire par lot

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: mixte (API dev ; raisons de rejet, messages et texte du modèle Excel lus par les pharmaciens, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Dernière des trois sous-fiches de PB15 (D583). Prérequis : PB15a et PB15b validés et commités (`InventairesService.enregistrerDansTransaction(tx, acces, entree, ip, { rejeterLignes })`, `InventairesService.simuler(client, structureId, lignes, jour)`, types `LigneInventaireAEnregistrer`, `RefusLigneInventaire`, `LigneEvaluee`).

PB14c a suspendu le mode `inventaire` de l'import Excel du stock (409 `IMPORT_INVENTAIRE_INDISPONIBLE`, D579, D582 : mode absent = inventaire). PB15c le rétablit vers un `Inventaire` de PB15b (D596, D597) : comptage absolu, écart en mouvement `INVENTAIRE`, tolérance et anomalies identiques à la saisie, ventes faites sans stock rattachées. Le mode absent reste `inventaire` (D582 : un comptage remplace, ce qui est le sens attendu). `IMPORT_INVENTAIRE_INDISPONIBLE` reste au catalogue sans plus être renvoyé (précédent D542).

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate`.** Ne pas toucher aux migrations, aux instantanés, aux tests `test/db/` existants sauf les lignes de construction de `PharmacieService` (section 8) et le test 5 de `test/db/import-livraison.db-spec.ts` (section 7). Jamais `prisma migrate dev`, `migrate reset` ni `db push`.

Décisions applicables : D466, D493, D509, D579 à D582, D589 à D595, et celles de cette fiche, D596 et D597.

### Contexte vérifié (ne pas re-découvrir)

- `PharmacieService` (`src/pharmacie/pharmacie.service.ts`, `eslint-disable` global préexistant) : constructeur `(prisma, notificationsService, accesPharmacie, mouvementsStock, permissions, receptions)` ; `COLONNES_IMPORT_STOCK` (`ColonneImport = 'nom' | 'quantite' | 'prix' | 'date' | 'lot' | 'cout' | 'notes'`) ; `getModeleImportStock(structureId, userId)` ; `apercuImportStock` et `importerStock(structureId, userId, fichier?, mode = 'inventaire')` ; `verifierModeImport(userId, mode)` (inventaire : 409 `IMPORT_INVENTAIRE_INDISPONIBLE` ; livraison sans `reception:write` : 403) ; `analyserImportStock(fichier, jour)` (règles de livraison : quantité de boîtes 1 ou plus, date obligatoire jamais passée, lot, coût, prix, notes, doublon par médicament « Médicament déjà présent à la ligne N. ») ; `calculerQuantitesImport`, `lireQuantitesEnStock`, `messageImportStock(rapport, importe)`, `lireNombre`, `lireDate`, constantes `QUANTITE_MAX`, `NUMERO_LOT_MAX`, `MESSAGE_IMPORT_INVENTAIRE_INDISPONIBLE`, `MESSAGE_IMPORT_LIVRAISON_INTERDIT`, `OPTIONS_TRANSACTION_IMPORT`.
- `src/pharmacie/pharmacie.controller.ts` : modèle `GET stock/:structureId/import/modele` (nom de fichier fixe `modele-import-stock.xlsx`), aperçu et import passent `options.mode ?? 'inventaire'` ; `CORPS_IMPORT_STOCK_MODE` (enum `inventaire`, `livraison`, défaut `inventaire`).
- `src/pharmacie/dto/pharmacie.dto.ts` : `OptionsImportStockDto`, `LigneImportStock`, `RapportImportStock`, `ResultatImportStock` (`importees`, `receptionId`).
- `normaliserTitre` retire accents, majuscules et tout caractère non alphanumérique (`src/pharmacie/import-excel.ts`).
- `normaliserNumeroLot` (`src/pharmacie/domaine/inventaire.ts`, PB15b).
- `src/pharmacie/pharmacie-import-mode.http.spec.ts` : vérifie seulement que le contrôleur transmet le mode (défaut `inventaire`) ; reste vrai tel quel.

### 1. `src/pharmacie/dto/pharmacie.dto.ts`

- `OptionsImportStockDto.mode` : description remplacée par `"inventaire (défaut, inventaire:write) : la quantité comptée remplace le stock du lot, écart enregistré, anomalie au-delà de la tolérance. livraison (reception:write) : la quantité du fichier (en boîtes) s'ajoute au stock par une réception, un lot par ligne."`.
- Nouveau `export class ModeleImportStockDto { mode?: ModeImportStock }` (`@IsOptional() @IsIn(MODES_IMPORT_STOCK)`, Swagger défaut `livraison`, description « Modèle de livraison (défaut) ou d'inventaire »).
- `LigneImportStock` gagne, après `quantiteApres?` :

```ts
  /** Inventaire : unités d'une boîte entamée (colonne « Unités en plus »). */
  unitesEnPlus?: number;
  /** Inventaire : unités comptées (boîtes x unités par boîte du lot + unités en plus). */
  quantiteComptee?: number;
  /** Inventaire : stock attendu du lot (stock moins les ventes faites sans stock rattachées). */
  quantiteTheorique?: number;
  /** Inventaire : quantité comptée moins quantité théorique. */
  ecart?: number;
  /** Inventaire : écart de la fiche dans la tolérance du médicament. */
  sousTolerance?: boolean;
  /** Inventaire : boîtes d'un lot qui n'était pas enregistré (lot créé). */
  nouveauLot?: boolean;
```

  et les commentaires de `quantiteAvant` et `quantiteApres` deviennent « Livraison : stock calculé en unités avant l'import ; inventaire : stock du lot avant le comptage (0 pour un nouveau lot). Lignes acceptées seulement. » et « Livraison : stock calculé après l'import ; inventaire : quantité comptée. Lignes acceptées seulement. ».
- `ResultatImportStock` gagne `inventaireId: string | null;`.

### 2. `src/pharmacie/pharmacie.service.ts`

2.1. Constructeur : `InventairesService` ajouté en DERNIER paramètre (`private readonly inventaires: InventairesService`, import depuis `./inventaires/inventaires.service`). Imports ajoutés : `normaliserNumeroLot` (`./domaine/inventaire`), types `LigneInventaireAEnregistrer`, `RefusLigneInventaire`.

2.2. Constantes exportées (texte exact) :

```ts
export const MESSAGE_IMPORT_INVENTAIRE_INTERDIT =
  "Vous n'avez pas le droit d'enregistrer un inventaire dans cette pharmacie. Demandez au titulaire de vous donner ce droit.";
export function messageAnomaliesImportInventaire(nombre: number): string {
  return nombre === 1
    ? "1 écart dépasse la tolérance : il est signalé dans les anomalies."
    : `${nombre} écarts dépassent la tolérance : ils sont signalés dans les anomalies.`;
}
```

`MESSAGE_IMPORT_INVENTAIRE_INDISPONIBLE` reste exporté (plus utilisé par le service, gardé pour le catalogue et les tests).

2.3. Colonnes : `ColonneImport` gagne `'unites'` ; `toutes` : `['nom', 'quantite', 'unites', 'prix', 'date', 'lot', 'cout', 'notes']` ; dans `reconnaitre`, juste après le bloc `quantite` :

```ts
    if (titre.startsWith('unite') || ['vrac', 'detail'].includes(titre)) {
      return 'unites';
    }
```

`libelles` gagne `unites: 'Unités en plus'`. En mode livraison la colonne est lue mais ignorée (aucune raison de rejet).

2.4. `verifierModeImport(userId, mode)` : lit les permissions une fois ; `inventaire` sans `PERMISSIONS.INVENTAIRE_WRITE` : `ForbiddenException(MESSAGE_IMPORT_INVENTAIRE_INTERDIT)` ; `livraison` sans `RECEPTION_WRITE` : inchangé. Plus aucun 409.

2.5. `analyserImportStock(fichier, jour, mode: ModeImportStock)` : livraison exactement comme aujourd'hui. Inventaire (raisons en texte exact, jointes par une espace, dans l'ordre nom, quantité, unités, date, lot) :

- nom, catalogue, homonymes : inchangés ;
- doublon : clé `${med.id}|${cle}` où `cle` = `normaliserNumeroLot(numeroLot)` s'il est donné, sinon le jour `AAAA-MM-JJ` de la date valide, sinon `sansperemption` si « sans péremption », sinon chaîne vide ; clé déjà vue : clé vide `Médicament déjà présent à la ligne ${n}.`, sinon `Ce lot de ce médicament est déjà compté à la ligne ${n}.` (le contrôle se fait après la lecture de la date et du lot) ;
- quantité (`lireNombre`) : absente : `'Indiquez le nombre de boîtes comptées (un nombre entier, 0 ou plus).'` ; non entière, négative ou au-delà de 1 000 000 : `'Le nombre de boîtes comptées doit être un nombre entier, 0 ou plus (exemple : 12).'` ;
- unités en plus (`lireNombre`) : vide : 0 ; non entier, négatif ou au-delà de 1 000 000 000 : `"Les unités en plus doivent être un nombre entier, 0 ou plus (exemple : 7 comprimés d'une boîte entamée)."` ;
- date : « sans péremption » reconnu comme en livraison ; vide : aucune date (permis) ; invalide : message existant ; une date passée est acceptée ;
- lot : lecture et longueur comme en livraison ;
- prix, coût et notes : ni lus ni validés (ignorés en inventaire).

Ligne acceptée : `{ ligne, nom, statut: 'acceptee', medicamentId, medicamentNom, quantite (boîtes), unitesEnPlus, sansPeremption, dateExpiration?, numeroLot? }`.

2.6. Lignes du cœur : `private lignesInventaire(acceptees, ficheDe: Map<medicamentId, stockId>)` : pour chaque ligne acceptée dont la fiche existe, `{ stockId, lotId: null, numeroLot: l.numeroLot ?? null, dateExpiration: l.dateExpiration ? dateVersJour(new Date(l.dateExpiration)) : null, sansPeremption: l.sansPeremption === true, quantiteComptee: null, nombreBoites: l.quantite, unitesEnPlus: l.unitesEnPlus ?? 0 }`.

2.7. Raisons des refus du cœur (texte exact), `private raisonRefusInventaire(r: RefusLigneInventaire): string` :

- `LOT_REQUIS` : `` `Ce médicament a plusieurs lots en stock (${liste}) : indiquez le lot ou la date de péremption, une ligne par lot.` `` où `liste` joint par `', '` les 5 premiers lots de `r.lots`, chacun `<numeroLot ou « sans numéro »> (péremption <AAAA-MM-JJ>)` ou `<...> (sans péremption)`, suivis de `', ...'` s'il y en a plus de 5 ;
- `DATE_PEREMPTION_REQUISE` : `"Ces boîtes ne correspondent à aucun lot en stock : indiquez leur date de péremption (AAAA-MM-JJ) ou « sans péremption »."` ;
- `LOT_INCONNU_VIDE` : `"Ce lot n'est pas dans votre stock et la quantité comptée est 0 : rien à enregistrer. Retirez la ligne ou vérifiez le numéro de lot."` ;
- `LOT_EN_DOUBLE` : `'Ce lot est déjà compté sur une autre ligne du fichier.'` ;
- `QUANTITE_TROP_GRANDE` : `'La quantité comptée est trop grande. Vérifiez la quantité.'` ;
- `STOCK_INTROUVABLE` et `LOT_INTROUVABLE` (impossibles par l'import, défense) : `"Ce médicament est introuvable dans votre stock."`.

2.8. Médicaments absents du stock (fiche inexistante), règle pure `private evaluerAbsent(l)` : `X = l.quantite + (l.unitesEnPlus ?? 0)` (coefficient 1 d'une fiche créée) ; `X === 0` : rejet `"Ce médicament n'est pas dans votre stock et la quantité comptée est 0 : rien à enregistrer. Retirez la ligne."` ; ni date ni « sans péremption » : rejet de `DATE_PEREMPTION_REQUISE` (2.7) ; sinon acceptée `{ nouveauLot: true, quantiteAvant: 0, quantiteApres: X, quantiteComptee: X, quantiteTheorique: 0, ecart: X, sousTolerance: false }` (tolérance nulle d'une fiche créée : un stock trouvé hors du système est signalé).

2.9. `getModeleImportStock(structureId, userId, mode: ModeImportStock = 'livraison')` : livraison inchangée. Inventaire : feuille « Stock », colonnes exactes

```ts
    feuille.columns = [
      { header: 'Médicament', key: 'nom', width: 40 },
      { header: 'Quantité comptée (boîtes)', key: 'quantite', width: 26 },
      { header: 'Unités en plus (boîte entamée)', key: 'unites', width: 30 },
      { header: 'Lot', key: 'lot', width: 16 },
      { header: "Date d'expiration (AAAA-MM-JJ)", key: 'date', width: 32 },
    ];
```

ligne d'exemple `{ nom, quantite: 12, unites: 7, lot: 'A2417', date: new Date(Date.UTC(2027, 11, 31)) }` (format de date `yyyy-mm-dd`) ; feuille « Mode d'emploi », exactement ces 8 lignes :

1. `'Remplissez la feuille « Stock » : une ligne par lot compté, à partir de la ligne 2. Ne modifiez pas les titres de la ligne 1.'`
2. `"Écrivez le nom du médicament tel qu'il apparaît dans le catalogue MedConnecte (les majuscules et les accents ne comptent pas)."`
3. `"Quantité comptée : le nombre de boîtes entières trouvées en rayon (0 si aucune). Unités en plus : les comprimés, sachets ou ampoules d'une boîte entamée (case vide : 0)."`
4. `"Au moment d'envoyer le fichier, choisissez « Inventaire » : la quantité comptée remplace le stock enregistré du lot. L'écart est enregistré ; au-delà de la tolérance du médicament, il est signalé au titulaire."`
5. `'Si un médicament a plusieurs lots en stock, faites une ligne par lot et indiquez le numéro de lot ou la date de péremption inscrite sur la boîte.'`
6. `"Des boîtes d'un lot qui n'est pas encore enregistré sont ajoutées au stock : indiquez alors leur date de péremption (AAAA-MM-JJ), ou « sans péremption »."`
7. `'Saisissez le comptage sans vendre entre-temps les médicaments comptés : une vente faite après le comptage apparaîtrait comme un écart.'`
8. `"Un même fichier peut contenir jusqu'à 1000 lignes. Remplacez la ligne d'exemple par vos propres comptages."`

2.10. `apercuImportStock(structureId, userId, fichier?, mode = 'inventaire')` : livraison inchangée (l'analyse reçoit `'livraison'`). Inventaire : `verifier` ; `verifierModeImport` (avant toute lecture du fichier) ; `jour` ; `analyse = analyserImportStock(fichier, jour, 'inventaire')` ; fiches `stockMedicament.findMany({ where: { structureId, medicamentId: { in } }, select: { id, medicamentId } })` ; `simule = inventaires.simuler(this.prisma, structureId, lignesInventaire(...), jour)` ; rapport : chaque ligne acceptée d'une fiche existante devient, par son index dans les lignes du cœur, soit rejetée (`raisonRefusInventaire`), soit `{ ...l, lotId: e.lotId ?? undefined, nouveauLot: e.nouveauLot, quantiteAvant: e.soldeAvant, quantiteApres: e.quantiteComptee, quantiteComptee, quantiteTheorique, ecart, sousTolerance }` ; lignes de médicaments absents : 2.8 ; compteurs `acceptees`/`rejetees` recalculés ; réponse `{ data: { ...rapport, mode }, message: this.messageImportStock(rapport, false), success: true }` (aucune clé de coût en inventaire). Aucune écriture.

2.11. `importerStock(structureId, userId, fichier?, mode = 'inventaire')` : livraison inchangée (renvoie en plus `inventaireId: null`). Inventaire :

1. `acces` ; `verifierModeImport` ; `jour` ; analyse.
2. Transaction (`OPTIONS_TRANSACTION_IMPORT`) :
   a. Absents évalués par 2.8 ; fiches créées seulement pour les absents acceptés : `createMany({ data, skipDuplicates: true })` (quantité 0, D493) ; puis relecture des fiches de tous les médicaments acceptés.
   b. `ecrit = inventaires.enregistrerDansTransaction(tx, acces, { commentaire: 'Import Excel', lignes }, null, { rejeterLignes: true })` où `lignes` = toutes les lignes acceptées (absents compris, désormais avec fiche), dans l'ordre du fichier.
   c. Rapport : la k-ième ligne acceptée correspond à l'index k du cœur ; refusée : rejetée (`raisonRefusInventaire`) ; écrite : `{ ...l, lotId, nouveauLot, quantiteAvant: soldeAvant, quantiteApres: quantiteComptee, quantiteComptee, quantiteTheorique, ecart, sousTolerance }` (valeurs du cœur sous verrou, qui font foi) ; lignes rejetées par l'analyse inchangées.
   d. Renvoyer `{ rapport, inventaireId: ecrit.inventaireId, nombreAnomalies: ecrit.anomalies.length }`.
3. Aucune alerte de stock bas (D596).
4. Réponse `{ data: { ...rapport, mode, importees: <acceptées>, receptionId: null, inventaireId }, message: this.messageImportStock(rapport, true) + (nombreAnomalies > 0 ? \` ${messageAnomaliesImportInventaire(nombreAnomalies)}\` : ''), success: true }`.

La branche qui levait `IMPORT_INVENTAIRE_INDISPONIBLE` est supprimée.

### 3. `src/pharmacie/pharmacie.controller.ts`

- `getModeleImportStock` reçoit `@Query() options: ModeleImportStockDto` ; appelle le service avec `options.mode ?? 'livraison'` ; nom de fichier `modele-inventaire-stock.xlsx` pour l'inventaire, `modele-import-stock.xlsx` sinon ; description : `"Classeur .xlsx. mode=livraison (défaut) : feuille « Stock » (Médicament, Quantité (boîtes), Prix de la boîte (GNF), Date d'expiration (AAAA-MM-JJ), Lot, Coût d'achat de la boîte (GNF), Notes). mode=inventaire : feuille « Stock » (Médicament, Quantité comptée (boîtes), Unités en plus (boîte entamée), Lot, Date d'expiration (AAAA-MM-JJ)). Une ligne d'exemple et une feuille « Mode d'emploi »."`.
- Aperçu : description `"Analyse le classeur (champ multipart fichier, .xlsx, 2 Mo et 1000 lignes max) sans rien écrire. Champ multipart mode : inventaire (défaut, inventaire:write) ou livraison (reception:write) ; autre valeur : 400 VALIDATION. Livraison : date obligatoire sauf « sans péremption », jamais passée, quantiteAvant, quantiteApres et unitesRecues en unités, coûts retirés sans marge:read. Inventaire : une ligne par lot (numéro ou date de péremption), quantiteComptee, quantiteTheorique, ecart, sousTolerance, nouveauLot ; plusieurs lots sans précision : ligne rejetée avec la liste des lots."`.
- Import : description `"Refait l'analyse puis écrit dans une transaction. Livraison : une réception (un lot par ligne acceptée), ventes faites sans stock rattachées, receptionId. Inventaire : un inventaire (commentaire « Import Excel »), un mouvement INVENTAIRE par lot compté, anomalie ECART_INVENTAIRE au-delà de la tolérance, ventes faites sans stock rattachées aux lots comptés, inventaireId. Les lignes refusées sont rejetées une par une, les autres écrites."`.
- `CORPS_IMPORT_STOCK_MODE` inchangé.

### 4. `src/pharmacie/pharmacie.module.ts`

Aucun changement (`InventairesService` est déjà fourni par PB15b).

### 5. `src/pharmacie/pharmacie.import.spec.ts`

Construction : `InventairesService` simulé `{ simuler: jest.fn(), enregistrerDansTransaction: jest.fn() } as unknown as InventairesService` en dernier paramètre ; permissions par défaut `['reception:write', 'inventaire:write']`. Tests existants gardés tels quels, sauf :

- test 16 `inventaire refusé avant toute lecture du fichier` remplacé par `inventaire sans inventaire:write refusé avant toute lecture du fichier` : permissions `['reception:write']` : `apercuImportStock(..., 'inventaire')`, `apercuImportStock(...)` (défaut) et `importerStock(..., 'inventaire')` : `ForbiddenException` de message `MESSAGE_IMPORT_INVENTAIRE_INTERDIT` ; `medicament.findMany` et `$transaction` non appelés.

Tests ajoutés :

20. `inventaire : boîtes comptées 0 permises, unités en plus, date passée acceptée` : en-têtes `['Médicament', 'Quantité comptée (boîtes)', 'Unités en plus (boîte entamée)', 'Lot', "Date d'expiration (AAAA-MM-JJ)"]` ; `simuler` renvoie une évaluation acceptée par ligne ; lignes `['Paracétamol 500 mg', 0, null, 'A1', '2020-01-01']`, `['Amoxicilline 500 mg', 3, 7, null, null]` (fiches existantes dans `stockLu`) : deux acceptées, première `toMatchObject({ quantite: 0, unitesEnPlus: 0, numeroLot: 'A1', dateExpiration: '2020-01-01T00:00:00.000Z' })`, seconde `unitesEnPlus` 7 ; `simuler` appelé avec deux lignes `{ nombreBoites: 0, unitesEnPlus: 0, numeroLot: 'A1', dateExpiration: '2020-01-01', ... }` et `{ nombreBoites: 3, unitesEnPlus: 7, numeroLot: null, dateExpiration: null, ... }` ; `colonnes.reconnues` contient `{ titre: 'Unités en plus (boîte entamée)', colonne: 'Unités en plus' }`.
21. `inventaire : rejets de saisie` : `-1` boîtes, `2.5` boîtes, unités `-3` : raisons exactes de 2.5.
22. `inventaire : doublons par lot` : deux lignes Paracétamol lot `A1` puis `a 1` : seconde rejetée `Ce lot de ce médicament est déjà compté à la ligne 2.` ; deux lignes Paracétamol sans lot ni date : `Médicament déjà présent à la ligne 2.` ; lots `A1` et `B2` : deux acceptées.
23. `inventaire : refus du cœur traduits en raisons` : `simuler` renvoie `refusees` `[{ index: 0, code: 'LOT_REQUIS', lots: [{ lotId: 'l1', numeroLot: 'A1', dateExpiration: '2027-01-31', quantite: 5 }, { lotId: 'l2', numeroLot: null, dateExpiration: null, quantite: 2 }] }]` : raison exacte `Ce médicament a plusieurs lots en stock (A1 (péremption 2027-01-31), sans numéro (sans péremption)) : indiquez le lot ou la date de péremption, une ligne par lot.`.
24. `inventaire : médicament absent du stock` : compté 0 : raison exacte de 2.8 ; compté 2 sans date : raison `DATE_PEREMPTION_REQUISE` de 2.7 ; compté 2 avec date : acceptée `{ nouveauLot: true, quantiteComptee: 2, ecart: 2, sousTolerance: false }`.
25. `le modèle d'inventaire` : `getModeleImportStock(..., 'inventaire')` : ligne 1 de « Stock » = les 5 titres exacts de 2.9 ; « Mode d'emploi » : 8 lignes identiques au texte de 2.9 ; `getModeleImportStock(...)` sans mode : les 7 titres de livraison (test 19 inchangé).

### 6. `test/db/import-inventaire.db-spec.ts` (nouveau)

Préparation copiée de `test/db/import-livraison.db-spec.ts` (doublures, `VenteService`, `ReceptionsService`, `PharmacieService`, `construireFichier`, aides), plus `inventaires = new InventairesService(prisma, acces, mouvements)` passé en dernier argument de `PharmacieService` ; en-têtes par défaut : les 5 titres du modèle d'inventaire ; permissions doublées : `RESPONSABLE` avec `inventaire:write`, `reception:write`, `marge:read`, `stock:write` ; `VENDEUR` sans `inventaire:write`. `importer(fichier, user = RESPONSABLE, mode?: ModeImportStock)` (sans mode : défaut du service). `describe('Import Excel d\'un inventaire, sur base de test (PB15c)')`. Tests exacts :

1. `mode absent : inventaire, comptage absolu par lot` : fiche coef 10 tolérance 5 avec une réception de 3 boîtes (lot `L-1`) ; ligne `[nom, 2, 7, null, null]` sans mode : `data.mode` `'inventaire'`, `data.inventaireId` non nul, `Inventaire` de ce `id` au `commentaire` `'Import Excel'` ; ligne `toMatchObject({ statut: 'acceptee', quantiteComptee: 27, quantiteTheorique: 30, ecart: -3, sousTolerance: true, quantiteAvant: 30, quantiteApres: 27 })` ; `soldeLot` 27 ; un mouvement `INVENTAIRE` -3 de pièce `INVENTAIRE`.
2. `au-delà de la tolérance : anomalie attribuée à l'auteur, message complété` : nouvelle fiche coef 10 tolérance 0 avec une réception de 3 boîtes ; ligne `[nom, 2, null, null, null]` : écart -10, `sousTolerance` faux ; une anomalie `ECART_INVENTAIRE` `attribueeAId` `RESPONSABLE`, `pieceId` = `data.inventaireId` ; `message` se termine par `messageAnomaliesImportInventaire(1)`.
3. `fiche à plusieurs lots : ligne sans lot rejetée avec la liste, ligne par lot acceptée` : deux réceptions (lots `A1` daté d1 et `B2` daté d2) ; lignes `[nom, 1, null, null, null]` (rejetée, raison qui commence par `'Ce médicament a plusieurs lots en stock (A1 (péremption '`), `[nom, 4, null, 'A1', null]` et `[nom, 2, null, null, d2]` (acceptées) : lots 4 et 2 ; une seule `Inventaire` avec 2 lignes.
4. `médicament absent du stock : fiche créée et nouveau lot, ou rejet` : médicament sans fiche compté 3 avec date `jour(200)` : fiche créée (`coefficientBoite` 1), lot de 3 (mouvement `INVENTAIRE`), anomalie (tolérance nulle) ; autre médicament sans fiche compté 0 : rejeté, aucune fiche créée.
5. `ventes faites sans stock rattachées par l'import` : fiche coef 1, réception 2, vente 2, vente 1 (provisoire) ; import compté 4 sur le lot : `soldeLot` 4, `soldeProduit` 4, allocation de la seconde vente `REMPLACEE` et `DEFINITIVE` 1.
6. `aperçu : rien n'est écrit, mêmes valeurs que l'import` : aperçu de la ligne du test 1 sur une nouvelle fiche identique : `{ quantiteTheorique: 30, ecart: -3 }` ; nombres d'`Inventaire`, `MouvementStock`, `LotStock` inchangés ; import du même fichier : mêmes valeurs.
7. `sans inventaire:write : 403 avant toute lecture` : `importer(fichier, VENDEUR)` et l'aperçu : 403, `MESSAGE_IMPORT_INVENTAIRE_INTERDIT` ; rien écrit.
8. `toutes les lignes rejetées : aucun inventaire` : `data.inventaireId` null, nombre d'`Inventaire` inchangé.
9. `livraison inchangée` : import `'livraison'` d'une ligne de 5 boîtes avec date : `data.receptionId` non nul, `data.inventaireId` null.
10. `compteur gelé jamais écrit` : colonnes `quantite` et `disponible` des fiches des tests 1 à 5 inchangées (lues par `sql` avant et après).
11. `invariants` : `verifierStock(base.client).totalAnomalies` vaut 0.

### 7. `test/db/import-livraison.db-spec.ts`

Seules modifications permises : la construction de `PharmacieService` (section 8) et le test 5 `inventaire refusé sans rien écrire`, remplacé par `inventaire sans inventaire:write refusé sans rien écrire` : la doublure de permissions de ce fichier ne donne pas `inventaire:write` : `importer(fichier, RESPONSABLE, 'inventaire')` et l'aperçu en `'inventaire'` : 403, `MESSAGE_IMPORT_INVENTAIRE_INTERDIT` ; nombres de `Reception`, `LotStock`, `MouvementStock` inchangés. Les autres tests sont intouchés.

### 8. Lignes de construction

Dans `test/db/fiche-produit.db-spec.ts`, `test/db/mouvements-stock.db-spec.ts`, `test/db/non-regression-lectures.db-spec.ts`, `test/db/qualification.db-spec.ts`, `test/db/import-livraison.db-spec.ts` : seule modification permise, l'appel `new PharmacieService(...)` gagne en dernier argument `new InventairesService(prisma, <instance AccesPharmacieService déjà passée>, <instance MouvementsStockService déjà passée>)`, plus la ligne `import { InventairesService } from 'src/pharmacie/inventaires/inventaires.service';`. Appels, assertions et instantanés intouchés.

### 9. `CLAUDE.md` du dépôt back

Puce PB14c : remplacer la phrase « Le mode `inventaire` est refusé (409 `IMPORT_INVENTAIRE_INDISPONIBLE`) jusqu'à PB15. » par « Le mode `inventaire` (défaut, `inventaire:write`) est décrit par la puce PB15c. ». Ajouter après la puce PB15b une puce « **Import Excel d'un inventaire (tranche pharmacie 1, PB15c)** » : mode `inventaire` (défaut, `inventaire:write`, 403 sinon) enregistré comme un inventaire par lot de PB15b (commentaire « Import Excel ») ; quantité comptée en boîtes (0 permis) et unités en plus ; une ligne par lot, lot trouvé par numéro ou par date ; plusieurs lots sans précision : ligne rejetée avec la liste des lots ; boîtes d'un lot inconnu : nouveau lot (date obligatoire, date passée acceptée) ; médicament absent : fiche créée si la quantité est positive ; prix, coût et notes ignorés ; lignes refusées rejetées une par une ; réponse `inventaireId` ; modèle `GET .../import/modele?mode=inventaire`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (messages en français, actionnables, aucun tiret cadratin ni demi-cadratin nulle part). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Aucune migration, aucun `prisma generate`, jamais `prisma migrate dev`, `migrate reset` ni `db push` sur la base de dev. Ne jamais afficher ni écrire d'URL de base, de mot de passe ni de valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh`. Ne pas commiter (le chef commite). Si une étape se révèle impossible telle qu'écrite, s'arrêter en BLOCKED avec la commande et l'erreur, sans contournement.

Fichiers touchés attendus (et seulement eux) : `src/pharmacie/dto/pharmacie.dto.ts`, `src/pharmacie/pharmacie.service.ts`, `src/pharmacie/pharmacie.controller.ts`, `src/pharmacie/pharmacie.import.spec.ts`, `test/db/import-inventaire.db-spec.ts` (nouveau), `test/db/import-livraison.db-spec.ts`, `test/db/fiche-produit.db-spec.ts`, `test/db/mouvements-stock.db-spec.ts`, `test/db/non-regression-lectures.db-spec.ts`, `test/db/qualification.db-spec.ts`, `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/pharmacie/dto/pharmacie.dto.ts src/pharmacie/pharmacie.import.spec.ts test/db/import-inventaire.db-spec.ts test/db/import-livraison.db-spec.ts test/db/fiche-produit.db-spec.ts test/db/mouvements-stock.db-spec.ts test/db/non-regression-lectures.db-spec.ts test/db/qualification.db-spec.ts` : aucune erreur ; `npx eslint src/pharmacie/pharmacie.service.ts src/pharmacie/pharmacie.controller.ts` : aucune erreur nouvelle par rapport à avant la tâche.
3. `docker compose exec -T backend npm test` : tout vert, dont `pharmacie.import.spec.ts` (25 tests) et `pharmacie-import-mode.http.spec.ts` inchangé.
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/import-inventaire.db-spec.ts` (11 tests), `import-livraison.db-spec.ts` et `non-regression-lectures.db-spec.ts` (instantanés intouchés).
5. `git status --porcelain` ne liste que les fichiers attendus (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes` vide ; `git diff` des quatre specs de construction ne change que l'import et l'appel de construction ; celui de `import-livraison.db-spec.ts` en plus le seul test 5.
6. `grep -n "IMPORT_INVENTAIRE_INDISPONIBLE" src/pharmacie/pharmacie.service.ts` : seulement la constante de message (aucun `code: 'IMPORT_INVENTAIRE_INDISPONIBLE'`) ; `grep -rn "stockMedicament.upsert" src/pharmacie` : seulement `upsertStock`.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées ni dans le fichier nouveau.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
