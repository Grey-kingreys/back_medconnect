# PB14c - Import livraison vers réception, import inventaire refusé jusqu'à PB15

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: mixte (API dev ; raisons de rejet, messages et texte du modèle Excel lus par les pharmaciens, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Dernière des trois sous-fiches de PB14 (D566). Prérequis : PB14a et PB14b validés et commités.

L'import Excel du stock (`PharmacieService.apercuImportStock` et `importerStock`) écrit encore le compteur gelé (`tx.stockMedicament.upsert` avec `quantite`, `quantite: { increment }` et `disponible`, vers les lignes 963 à 995) : sur une base migrée, le trigger `stock_medicament_geler_compteur` le fait échouer (erreur serveur). Partage arrêté (D579) :

- **mode `livraison` (PB14, cette fiche)** : réécrit sur la réception de PB14a. Une `Reception` par import, un lot par ligne acceptée (quantité du fichier en boîtes), colonnes facultatives « Lot » et « Coût d'achat » (par boîte), date de péremption obligatoire sauf « sans péremption » (A3), ventes en attente de stock résolues (PB14b) ;
- **mode `inventaire` (PB15)** : aperçu et import refusés proprement par 409 `IMPORT_INVENTAIRE_INDISPONIBLE` avec un message qui dit quoi faire, avant toute lecture du fichier ; le code d'écriture de l'inventaire par le compteur est supprimé. PB15 le réécrira vers un `Inventaire`.

À la fin de cette fiche, plus aucun chemin de `src/pharmacie/` n'écrit `quantite`, `disponible` ni `dateExpiration` de `StockMedicament`.

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate`.** Ne pas toucher aux migrations, aux instantanés, aux tests `test/db/` existants sauf la ligne de construction de `PharmacieService` (section 9). Jamais `prisma migrate dev`, `migrate reset` ni `db push`.

Décisions applicables : D466, D476, D493, D505, D509, D512, D534, D566 à D577, et celles de cette fiche, D579 à D581.

### Contexte vérifié (ne pas re-découvrir)

- `PharmacieService` (`src/pharmacie/pharmacie.service.ts`, `eslint-disable` global préexistant) : constructeur `(prisma, notificationsService, accesPharmacie, mouvementsStock, permissions)` ; `COLONNES_IMPORT_STOCK` (type `ColonneImport = 'nom' | 'quantite' | 'prix' | 'date' | 'notes'`), `getModeleImportStock`, `apercuImportStock`, `importerStock`, `analyserImportStock(fichier)`, `calculerQuantitesImport(rapport, enStock, mode)`, `lireQuantitesEnStock` (lit `quantite` gelée), `messageImportStock`, `lireNombre`, `lireDate` (ISO, `undefined` si vide, `false` si invalide), `peutVoirMarge(userId)`, `alerterStock(structureId, message)` (destinataires et titre « Stock critique » existants), constantes `QUANTITE_MAX`, `PRIX_MAX`, `NOTES_MAX_IMPORT`, `SEUIL_STOCK_BAS`, `OPTIONS_TRANSACTION_IMPORT`.
- `normaliserTitre` est exporté par `src/pharmacie/import-excel.ts` (« sans péremption » devient `sansperemption`).
- `ReceptionsService.enregistrerDansTransaction(tx, acces, entree, ip)` (PB14a, PB14b) : verrous de ligne des fiches triés puis consultatifs, désarchivage audité, une `Reception` et un lot par ligne, résolution des provisoires ; renvoie `{ receptionId, cree, lignes: [{ stockId, lotId, quantiteUm, soldeProduitApres }], avertissements, resolutions }`. `receptions.service.ts` n'importe pas `pharmacie.service.ts` : la dépendance `PharmacieService` vers `ReceptionsService` n'est pas circulaire.
- Contrôleur : `apercuImportStock` et `importerStock` reçoivent `options.mode ?? 'inventaire'` ; `src/pharmacie/pharmacie-import-mode.http.spec.ts` reste vrai tel quel (le contrôleur ne change pas de comportement).
- `etatStock(quantite, coefficientBoite, seuilBoites)` (`src/pharmacie/domaine/quantites.ts`) ; `dateVersJour` (`src/pharmacie/stock/lecture-stock.ts`) ; `jourConakry` (`src/pharmacie/jour-metier.ts`).

### 1. `src/common/filters/codes-erreur.ts`

Ajouter à la fin de `CODES_ERREUR` :

```ts
  // Import Excel d'un inventaire indisponible tant que l'inventaire par lot n'existe pas (409).
  'IMPORT_INVENTAIRE_INDISPONIBLE',
```

### 2. `src/pharmacie/dto/pharmacie.dto.ts`

- `OptionsImportStockDto.mode` : description Swagger remplacée par `"livraison : la quantité du fichier (en boîtes) s'ajoute au stock par une réception, un lot par ligne. inventaire : refusé pour l'instant (409 IMPORT_INVENTAIRE_INDISPONIBLE)."` ; validateurs inchangés.
- `LigneImportStock` gagne, après `notes?` :

```ts
  /** Numéro de lot inscrit sur la boîte (colonne « Lot »). */
  numeroLot?: string;
  /** Coût d'achat d'une boîte en GNF (colonne « Coût d'achat »), retiré sans marge:read. */
  coutAchatBoite?: number;
  /** Vrai si la date de péremption est « sans péremption ». */
  sansPeremption?: boolean;
  /** Unités minimales reçues (boîtes x unités par boîte de la fiche), lignes acceptées seulement. */
  unitesRecues?: number;
  /** Lot créé par l'import, lignes acceptées seulement. */
  lotId?: string;
```

  et les commentaires de `quantiteAvant` et `quantiteApres` deviennent « Stock calculé en unités avant l'import (0 si le médicament n'y est pas), lignes acceptées seulement. » et « Stock calculé en unités après l'import, lignes acceptées seulement. ».
- `ResultatImportStock` gagne `receptionId: string | null;`.

### 3. `src/pharmacie/receptions/receptions.service.ts`

`LigneReceptionAEnregistrer` gagne :

```ts
  /** Mise à jour de la fiche demandée par l'import (prix de la boîte, notes) ; jamais par la route. */
  majFiche?: { prixUnitaire?: number; notes?: string };
```

Dans `enregistrerDansTransaction`, juste après le désarchivage (étape 7) et avant les verrous consultatifs (étape 8) : pour chaque ligne dont `majFiche` porte `prixUnitaire !== undefined` ou `notes` non vide, `tx.stockMedicament.update({ where: { id: stockId }, data: { ...(prixUnitaire !== undefined ? { prixUnitaire } : {}), ...(notes ? { notes } : {}) } })` (ligne déjà verrouillée à l'étape 5 ; jamais `quantite`, `disponible` ni `dateExpiration`). Aucun audit (comportement de l'import actuel). Rien d'autre dans ce fichier.

### 4. `src/pharmacie/pharmacie.service.ts`

4.1. Constructeur : `ReceptionsService` ajouté en DERNIER paramètre (`private readonly receptions: ReceptionsService`, import depuis `./receptions/receptions.service`). Imports ajoutés : `ForbiddenException`, `normaliserTitre`, `etatStock` (déjà importé), `dateVersJour` (déjà importé).

4.2. Constantes exportées ajoutées (texte exact) :

```ts
export const MESSAGE_IMPORT_INVENTAIRE_INDISPONIBLE =
  "L'import d'un inventaire depuis un fichier Excel n'est pas encore disponible avec le suivi des lots. Pour enregistrer des médicaments reçus, choisissez « Livraison » ; pour corriger une quantité, ouvrez la fiche du médicament.";
export const MESSAGE_IMPORT_LIVRAISON_INTERDIT =
  "Vous n'avez pas le droit d'enregistrer une livraison dans cette pharmacie. Demandez au titulaire de vous donner ce droit.";
export function messageAlerteImportLivraison(nombre: number): string {
  return nombre === 1
    ? "Après l'import de la livraison, 1 médicament a encore un stock bas ou épuisé. Pensez à le réapprovisionner."
    : `Après l'import de la livraison, ${nombre} médicaments ont encore un stock bas ou épuisé. Pensez à les réapprovisionner.`;
}
```

4.3. Colonnes (D580) : `ColonneImport` devient `'nom' | 'quantite' | 'prix' | 'date' | 'lot' | 'cout' | 'notes'` ; `toutes: ['nom', 'quantite', 'prix', 'date', 'lot', 'cout', 'notes']` ; dans `reconnaitre`, juste après le bloc `quantite` et AVANT le bloc `prix` (« Prix d'achat » est un coût, pas le prix de vente) :

```ts
    if (
      titre.startsWith('cout') ||
      titre.startsWith('prixdachat') ||
      titre.startsWith('prixachat')
    ) {
      return 'cout';
    }
    if (
      [
        'lot',
        'nlot',
        'nolot',
        'numlot',
        'numerolot',
        'numerodelot',
        'ndelot',
        'nodelot',
        'lotn',
        'lotno',
        'batch',
      ].includes(titre)
    ) {
      return 'lot';
    }
```

`libelles` gagne `lot: 'Lot'` et `cout: "Coût d'achat"` ; `obligatoires` inchangé.

4.4. Raisons de rejet (texte exact), dans l'ordre nom, quantité, prix, date, lot, coût, jointes par une espace comme aujourd'hui :

- quantité absente : `'Indiquez la quantité reçue (un nombre entier de boîtes, 1 ou plus).'` ;
- quantité non entière, inférieure à 1 ou supérieure à `QUANTITE_MAX` : `'La quantité reçue doit être un nombre entier de boîtes, 1 ou plus (exemple : 25).'` ;
- prix : messages existants inchangés ;
- date absente (cellule vide) : `"Indiquez la date de péremption (AAAA-MM-JJ), ou écrivez « sans péremption » si ce médicament n'en a pas."` ;
- date invalide : message existant inchangé ;
- date valide avant le jour de Conakry (`dateVersJour(new Date(iso)) < jour`) : `'Cette date de péremption est déjà passée : vérifiez-la. Un médicament périmé ne doit pas entrer en stock.'` (le jour même est accepté) ;
- lot : cellule texte ou nombre convertie en texte (`String(valeur).trim()`, une date est convertie en AAAA-MM-JJ comme les notes), vide : absent ; plus de 64 caractères : `'Le numéro de lot est trop long (64 caractères au plus).'` ;
- coût : `lireNombre` ; non fini ou négatif : `"Le coût d'achat doit être un nombre, 0 ou plus, sans texte (exemple : 25000)."` ; sinon `Math.round` puis, au-delà de `PRIX_MAX` : `"Le coût d'achat est trop grand. Vérifiez le montant (exemple : 25000)."`.

« Sans péremption » : cellule texte dont `normaliserTitre(valeur) === 'sansperemption'` (majuscules, accents et espaces indifférents) ; la ligne acceptée porte alors `sansPeremption: true` et pas de `dateExpiration`. Toute ligne acceptée porte `sansPeremption` (vrai ou faux), `numeroLot` et `coutAchatBoite` s'ils sont fournis.

4.5. `private async analyserImportStock(fichier: FichierImport | undefined, jour: string)` : la règle de date et de quantité ci-dessus remplace l'ancienne ; le reste (catalogue, doublons, notes, colonnes) est inchangé.

4.6. `private async lireQuantitesEnStock(client: Pick<Prisma.TransactionClient, 'stockMedicament'>, structureId, rapport): Promise<Map<string, { quantite: number; coefficientBoite: number }>>` : `client.stockMedicament.findMany({ where: { structureId, medicamentId: { in: ids } }, select: { medicamentId: true, coefficientBoite: true, agregatsProduit: { select: { quantite: true } } } })`, `quantite` = somme des `agregatsProduit[].quantite` (0 sans agrégat). Plus aucune lecture de la colonne `quantite`.

4.7. `private calculerQuantitesImport(rapport, enStock)` (paramètre `mode` retiré) : par ligne acceptée, `avant = enStock.get(medicamentId)?.quantite ?? 0`, `coefficient = enStock.get(medicamentId)?.coefficientBoite ?? 1`, `unites = quantite * coefficient`, `apres = avant + unites` ; `unites > QUANTITE_MAX` ou `apres > QUANTITE_MAX` : ligne rejetée avec la raison existante « Avec cette livraison, la quantité en stock deviendrait trop grande. Vérifiez la quantité. » ; sinon `{ ...l, unitesRecues: unites, quantiteAvant: avant, quantiteApres: apres }`.

4.8. `private async verifierModeImport(userId: string, mode: ModeImportStock): Promise<void>` : `mode === 'inventaire'` : `ConflictException({ message: MESSAGE_IMPORT_INVENTAIRE_INDISPONIBLE, code: 'IMPORT_INVENTAIRE_INDISPONIBLE' })` ; sinon, sans `PERMISSIONS.RECEPTION_WRITE` dans `this.permissions.getUserPermissions(userId)` : `ForbiddenException(MESSAGE_IMPORT_LIVRAISON_INTERDIT)`.

4.9. `apercuImportStock(structureId, adminUserId, fichier?, mode = 'inventaire')` : `accesPharmacie.verifier` ; `verifierModeImport` (avant toute lecture du fichier) ; `jour = jourConakry(new Date())` ; analyse ; `enStock` (lu sur `this.prisma`) ; calcul ; réponse `{ data: masquerCouts({ ...rapport, mode }, peutVoirMarge), message: this.messageImportStock(rapport, false), success: true }`. Aucune écriture.

4.10. `importerStock(structureId, adminUserId, fichier?, mode = 'inventaire')` :

1. `acces = verifier(...)` ; `verifierModeImport` ; `jour` ; analyse.
2. Transaction (`OPTIONS_TRANSACTION_IMPORT`) :
   a. `enStock = lireQuantitesEnStock(tx, ...)` ; `calcule = calculerQuantitesImport(analyse, enStock)` ; `acceptees` = lignes `acceptee` dans l'ordre du fichier ; aucune : renvoyer `{ rapport: calcule, receptionId: null }`.
   b. Fiches absentes (médicaments acceptés absents de `enStock`) : `tx.stockMedicament.createMany({ data: absents.map((medicamentId) => ({ medicamentId, structureId })), skipDuplicates: true })` (quantité 0 par défaut, permis par le gel D493) ; puis `tx.stockMedicament.findMany({ where: { structureId, medicamentId: { in: <tous les acceptés> } }, select: { id: true, medicamentId: true } })`.
   c. `ecrite = await this.receptions.enregistrerDansTransaction(tx, acces, { fournisseurId: null, reference: null, recueLe: new Date(), lignes: acceptees.map((l) => ({ stockId, numeroLot: l.numeroLot ?? null, dateExpiration: l.dateExpiration ? dateVersJour(new Date(l.dateExpiration)) : null, sansPeremption: l.sansPeremption === true, nombreBoites: l.quantite as number, quantiteUnites: null, coutAchatBoite: l.coutAchatBoite ?? null, majFiche: { prixUnitaire: l.prixUnitaire, notes: l.notes?.trim() } })) })`.
   d. Lignes du rapport : la k-ième ligne acceptée devient `{ ...l, lotId: ecrite.lignes[k].lotId, unitesRecues: ecrite.lignes[k].quantiteUm, quantiteAvant: ecrite.lignes[k].soldeProduitApres - ecrite.lignes[k].quantiteUm, quantiteApres: ecrite.lignes[k].soldeProduitApres }` (le stock relu sous verrou fait foi, un import simultané est compté) ; les rejetées sont inchangées.
   e. Renvoyer `{ rapport: { ...calcule, lignes }, receptionId: ecrite.receptionId }`.
3. Alerte groupée (A4, D476) : `seuil` = `parametresPharmacie.seuilStockBas` de la pharmacie, sinon `SEUIL_STOCK_BAS` ; coefficient d'une ligne = `enStock` lu en 2a, sinon 1 (fiche créée) ; `n` = lignes acceptées dont `etatStock(quantiteApres, coefficient, seuil) !== 'NORMAL'` ; `n > 0` : `await this.alerterStock(structureId, messageAlerteImportLivraison(n))`.
4. Réponse `{ data: masquerCouts({ ...rapport, mode, importees: <acceptées>, receptionId }, peutVoirMarge), message: this.messageImportStock(rapport, true), success: true }`.

L'ancien code d'écriture (`tx.stockMedicament.upsert` avec `quantite`, `increment`, `disponible`, `dateExpiration`) est supprimé, ainsi que la branche `mode === 'inventaire'` de `calculerQuantitesImport`.

4.11. `getModeleImportStock` : colonnes exactes

```ts
    feuille.columns = [
      { header: 'Médicament', key: 'nom', width: 40 },
      { header: 'Quantité (boîtes)', key: 'quantite', width: 16 },
      { header: 'Prix de la boîte (GNF)', key: 'prix', width: 22 },
      { header: "Date d'expiration (AAAA-MM-JJ)", key: 'date', width: 32 },
      { header: 'Lot', key: 'lot', width: 16 },
      { header: "Coût d'achat de la boîte (GNF)", key: 'cout', width: 30 },
      { header: 'Notes', key: 'notes', width: 40 },
    ];
```

ligne d'exemple `{ nom, quantite: 50, prix: 35000, date: new Date(Date.UTC(2027, 11, 31)), lot: 'A2417', cout: 25000, notes: 'Livraison du mois' }` ; feuille « Mode d'emploi », exactement ces 8 lignes :

1. `'Remplissez la feuille « Stock » : une ligne par médicament reçu, à partir de la ligne 2. Ne modifiez pas les titres de la ligne 1.'`
2. `"Écrivez le nom du médicament tel qu'il apparaît dans le catalogue MedConnecte (les majuscules et les accents ne comptent pas)."`
3. `'La quantité est le nombre de boîtes reçues : un nombre entier, 1 ou plus.'`
4. `"Au moment d'envoyer le fichier, choisissez « Livraison » : la quantité du fichier s'ajoute à votre stock. Exemple : 20 en stock et 50 dans le fichier, il y aura 70. Un médicament qui n'est pas encore dans votre stock y est ajouté."`
5. `"La date d'expiration est obligatoire, au format AAAA-MM-JJ (par exemple 2027-12-31). Pour un produit qui n'en a pas, écrivez « sans péremption »."`
6. `"Le lot (numéro inscrit sur la boîte) et le coût d'achat d'une boîte (en GNF) sont facultatifs. Sans coût d'achat, la marge de ces boîtes ne pourra pas être calculée."`
7. `"Le prix de la boîte (en GNF) et les notes sont facultatifs. Une case laissée vide ne change pas ce qui est déjà enregistré. Avant d'enregistrer, l'aperçu affiche pour chaque médicament la quantité avant et après."`
8. `"Un même fichier peut contenir jusqu'à 1000 médicaments. Remplacez la ligne d'exemple par vos propres médicaments."`

### 5. `src/pharmacie/pharmacie.controller.ts`

Descriptions `@ApiOperation` remplacées (texte exact) :

- modèle : `"Classeur .xlsx : feuille « Stock » (Médicament, Quantité (boîtes), Prix de la boîte (GNF), Date d'expiration (AAAA-MM-JJ), Lot, Coût d'achat de la boîte (GNF), Notes) avec une ligne d'exemple, et feuille « Mode d'emploi »."` ;
- aperçu : `"Analyse le classeur (champ multipart fichier, .xlsx, 2 Mo et 1000 lignes max) sans rien écrire. Champ multipart mode : livraison seulement (reception:write) ; inventaire (défaut) : 409 IMPORT_INVENTAIRE_INDISPONIBLE ; autre valeur : 400 VALIDATION sur mode. Date de péremption obligatoire sauf « sans péremption », jamais passée ; colonnes facultatives Lot et Coût d'achat (par boîte). Chaque ligne acceptée porte quantiteAvant, quantiteApres et unitesRecues (unités, stock calculé). Coûts retirés sans marge:read."` ;
- import : `"Refait l'analyse de l'aperçu puis, dans une transaction, enregistre une réception (un lot par ligne acceptée, coût par unité figé) et rattache les ventes faites sans stock. Un médicament absent du stock y est ajouté ; prix de la boîte et notes mis à jour si la case est remplie. Mode inventaire : 409 IMPORT_INVENTAIRE_INDISPONIBLE. Renvoie le rapport, mode, importees et receptionId."`.

Rien d'autre (permissions de route inchangées : `stock:read` et `stock:write` ; `reception:write` est vérifié par le service).

### 6. `src/pharmacie/pharmacie.import.spec.ts` (réécrit)

Mêmes outils (`construireFichier`, en-têtes par défaut `['Médicament', 'Quantité', 'Prix unitaire (GNF)', "Date d'expiration (AAAA-MM-JJ)", 'Notes']`, Prisma simulé) ; doublure : `user.findUnique`, `structure.findUnique`, `medicament.findFirst` et `findMany` (catalogue actuel du fichier : `med-para`, `med-amox`, `med-coartem`), `stockMedicament.findMany` qui renvoie `[...stockLu].map(([medicamentId, { quantite, coefficientBoite }]) => ({ medicamentId, coefficientBoite, agregatsProduit: [{ quantite }] }))`, `$transaction` (jest.fn) ; permissions `getUserPermissions` configurable par test (défaut `['reception:write']`) ; `ReceptionsService` = `{ enregistrerDansTransaction: jest.fn() } as unknown as ReceptionsService` en dernier paramètre du constructeur. `DATE = '2027-12-31'`. Tous les aperçus passent `'livraison'` sauf mention. Tests exacts :

1. `accepte une ligne valide et retrouve le médicament sans tenir compte des accents ni de la casse` : lignes `['  PARACETAMOL   500 MG ', 40, 1500, DATE, 'Lot A']` et `['artemether/lumefantrine', 12, null, DATE]` : 2 acceptées, première `toMatchObject({ ligne: 2, statut: 'acceptee', medicamentId: 'med-para', medicamentNom: 'Paracétamol 500 mg', quantite: 40, prixUnitaire: 1500, dateExpiration: '2027-12-31T00:00:00.000Z', notes: 'Lot A', sansPeremption: false, unitesRecues: 40, quantiteAvant: 0, quantiteApres: 40 })`, message `'2 lignes prêtes à être importées, aucune ligne à corriger.'`, `$transaction` non appelé.
2. `reconnaît les titres courants des pharmacies, le lot et le coût d'achat` : en-têtes `['Désignation', 'Fournisseur', 'Qté', 'P.U. (GNF)', 'Péremption', 'N° lot', "Prix d'achat"]`, ligne `['Paracétamol 500 mg', 'Sopharma', 30, 1200, '2027-06-30', 'B-77', 900]` : ligne `toMatchObject({ statut: 'acceptee', quantite: 30, prixUnitaire: 1200, numeroLot: 'B-77', coutAchatBoite: 900 })` ; `colonnes` `toEqual({ ligneTitres: 1, reconnues: [{ titre: 'Désignation', colonne: 'Médicament' }, { titre: 'Qté', colonne: 'Quantité' }, { titre: 'P.U. (GNF)', colonne: 'Prix' }, { titre: 'Péremption', colonne: "Date d'expiration" }, { titre: 'N° lot', colonne: 'Lot' }, { titre: "Prix d'achat", colonne: "Coût d'achat" }], ignorees: ['Fournisseur'] })`.
3. `trouve les titres sous un en-tête (nom de la pharmacie, ligne vide)` : comme l'ancien test avec les titres `['Produit', 'Quantité en stock', 'Date de péremption']` et la ligne `['Amoxicilline 500 mg', 15, DATE]` : `ligneTitres` 3, ligne 4 acceptée.
4. `ne prend pas un seuil d'alerte pour la quantité en stock` : titres `['Médicament', 'Quantité minimale', 'Stock', 'Date']`, ligne `['Paracétamol 500 mg', 5, 40, DATE]` : `quantite` 40, `ignorees` `['Quantité minimale']`.
5. `rejette un médicament absent du catalogue` : raison contient `'Médicament absent du catalogue'`.
6. `rejette une quantité négative, nulle ou non numérique` : `-5`, `0`, `'beaucoup'`, `2.5` (avec `DATE`) : 4 rejetées, chaque raison contient `'La quantité reçue doit être un nombre entier de boîtes'` ; message `'Aucune ligne prête à être importée, 4 lignes à corriger.'`.
7. `rejette la deuxième occurrence d'un même médicament` : comme l'ancien test (avec `DATE`).
8. `refuse un fichier sans colonne Quantité en nommant la colonne manquante`, 9. `refuse un fichier qui n'est pas un classeur .xlsx`, 10. `refuse l'envoi sans fichier` : comme les anciens tests, avec `'livraison'`.
11. `date obligatoire sauf « sans péremption », date passée refusée` : lignes `['Paracétamol 500 mg', 1]` (date vide), `['Amoxicilline 500 mg', 1, null, 'Sans Péremption']`, `['Coartem 20mg/120mg', 1, null, '2020-01-01']` : première rejetée, raison exacte de date absente ; deuxième acceptée `sansPeremption: true`, sans `dateExpiration` ; troisième rejetée, raison exacte de date passée. Puis ligne `['Paracétamol 500 mg', 1, null, jourConakry(new Date())]` : acceptée.
12. `lot et coût d'achat : lecture, arrondi et rejets` : en-têtes par défaut plus `'Lot'` et `"Coût d'achat"` ; lignes `['Paracétamol 500 mg', 1, null, DATE, null, '  A123 ', 25000.4]`, `['Amoxicilline 500 mg', 1, null, DATE, null, 4521, -3]`, `['Coartem 20mg/120mg', 1, null, DATE, null, 'x'.repeat(65), 3000000000]` : première `numeroLot` `'A123'`, `coutAchatBoite` 25000 ; deuxième rejetée, raison exacte du coût invalide ; troisième rejetée, raison qui contient la raison exacte du lot trop long et celle du coût trop grand. Ligne `['Amoxicilline 500 mg', 1, null, DATE, null, 4521]` : `numeroLot` `'4521'`.
13. `quantités en unités depuis le stock calculé` : `stockLu` `med-para` `{ quantite: 30, coefficientBoite: 10 }` ; lignes `['Paracétamol 500 mg', 4, null, DATE]`, `['Amoxicilline 500 mg', 5, null, DATE]` : première `{ unitesRecues: 40, quantiteAvant: 30, quantiteApres: 70 }`, seconde `{ unitesRecues: 5, quantiteAvant: 0, quantiteApres: 5 }` ; `stockMedicament.findMany` appelé avec `{ where: { structureId: STRUCTURE_ID, medicamentId: { in: ['med-para', 'med-amox'] } }, select: { medicamentId: true, coefficientBoite: true, agregatsProduit: { select: { quantite: true } } } }`.
14. `refuse une ligne dont le total dépasserait la borne entière` : `stockLu` `med-para` `{ quantite: 2147483600, coefficientBoite: 1 }`, quantité 100 : rejetée, raison existante exacte.
15. `arrondit un prix décimal à l'entier et rejette un prix trop grand` : comme l'ancien test (avec `DATE`).
16. `inventaire refusé avant toute lecture du fichier` : `apercuImportStock(..., 'inventaire')`, `apercuImportStock(...)` (mode par défaut) et `importerStock(..., 'inventaire')` : `ConflictException`, `getResponse()` `toMatchObject({ code: 'IMPORT_INVENTAIRE_INDISPONIBLE', message: MESSAGE_IMPORT_INVENTAIRE_INDISPONIBLE })` ; `medicament.findMany` et `$transaction` non appelés.
17. `livraison sans reception:write refusée` : permissions `[]` : aperçu et import en `'livraison'` : `ForbiddenException` de message `MESSAGE_IMPORT_LIVRAISON_INTERDIT` ; `medicament.findMany` non appelé.
18. `coût d'achat retiré sans marge:read` : permissions `['reception:write']` : `cheminsCout(data)` vide ; `['reception:write', 'marge:read']` : `data.lignes[0].coutAchatBoite` vaut 25000.
19. `le modèle téléchargeable décrit la livraison et ses colonnes` : ligne 1 de la feuille « Stock » = les 7 titres exacts de 4.11 ; « Mode d'emploi » : 8 lignes, identiques au texte de 4.11.

### 7. `test/db/import-livraison.db-spec.ts` (nouveau)

Préparation copiée de `test/db/resolution.db-spec.ts` (doublures, `VenteService`, `ReceptionsService`, aides `sql`, `compter`, `soldeProduit`, `soldeLot`, `allocations`) et aide `refus` copiée de `test/db/receptions.db-spec.ts` (elle n'existe pas dans `resolution.db-spec.ts`), plus `pharmacie = new PharmacieService(prisma, notifications, acces, mouvements, permissions, receptions)` et `construireFichier(lignes, entetes)` (copié de `pharmacie.import.spec.ts`, en-têtes par défaut : les 7 titres du modèle). Aides : `nouveauMedicament()` (`med-import-<n>`, nom `Produit import <n>`, sans fiche) et `nouvelleFiche({ coef?, qualifie? })` (crée médicament et fiche, ids `stk-import-<n>`). `importer(fichier, user = RESPONSABLE, mode = 'livraison')` = `pharmacie.importerStock(PHARMACIE, user, fichier, mode)`. `describe('Import livraison vers réception, sur base de test (PB14c)')`. Tests exacts :

1. `une réception, un lot par ligne, coût par unité, fiche absente créée` : fiche A coef 10 qualifiée sans stock, médicament B sans fiche ; lignes `[nomA, 2, 15000, jour(200), 'L-1', 20000, 'Note A']` et `[nomB, 3, null, 'sans péremption', null, null, null]` : `data.importees` 2, `data.receptionId` non nul ; une `Reception` de ce `id` avec 2 lots ; lot A `{ quantiteRecue: 20, coefficientReception: 10, coutUnitaire: 2000, coutAchatBoite: 20000, numeroLot: 'L-1' }` ; fiche A `prixUnitaire` 15000, `notes` `'Note A'` ; fiche B créée (`coefficientBoite` 1, `qualifie` faux), lot B `{ quantiteRecue: 3, dateExpiration: null, coutUnitaire: 0, coutAchatBoite: null }` ; `data.lignes[0]` `toMatchObject({ statut: 'acceptee', unitesRecues: 20, quantiteAvant: 0, quantiteApres: 20, lotId: <lot A> })` ; mouvements `RECEPTION` de pièce `RECEPTION` et `pieceOrigineId` = `receptionId` : 2.
2. `résout une vente faite sans stock` : fiche C coef 1 qualifiée sans stock, vente de 2 (provisoire) ; import de 5 : allocations de la vente `REMPLACEE` 2 puis `DEFINITIVE` 2 ; `soldeProduit` 3 ; `data.lignes[0]` `{ quantiteAvant: -2, quantiteApres: 3 }`.
3. `fiche archivée désarchivée, compteur gelé jamais écrit` : fiche D archivée ; import de 4 : `archiveLe` nul ; pour les fiches A à D, colonne `quantite` 0 et `disponible` inchangée (lues par `sql` avant et après).
4. `aucune ligne acceptée : aucune réception` : une seule ligne sans date : `importees` 0, `receptionId` null, nombre de `Reception` inchangé.
5. `inventaire refusé sans rien écrire` : `importer(fichier, RESPONSABLE, 'inventaire')` et `pharmacie.apercuImportStock(PHARMACIE, RESPONSABLE, fichier, 'inventaire')` : 409 `IMPORT_INVENTAIRE_INDISPONIBLE`, `MESSAGE_IMPORT_INVENTAIRE_INDISPONIBLE` ; nombres de `Reception`, `LotStock` et `MouvementStock` inchangés.
6. `livraison sans reception:write refusée` : `importer(fichier, VENDEUR)` : 403, `MESSAGE_IMPORT_LIVRAISON_INTERDIT`.
7. `alerte groupée sur l'état après l'import` : `alertes.mockClear()` ; fiche E coef 1 sans stock ; import de 3 : `alertes` appelé une fois, message `messageAlerteImportLivraison(1)` ; `mockClear` ; import de 50 sur E : non appelé.
8. `aperçu : quantités avant et après depuis le stock calculé, rien n'est écrit` : fiche F coef 1 avec une réception de 30 (par `receptions.enregistrer`) ; aperçu de 40 : `{ quantiteAvant: 30, quantiteApres: 70, unitesRecues: 40 }` ; nombres de `Reception` et `LotStock` inchangés.
9. `invariants` : `verifierStock(base.client).totalAnomalies` vaut 0.

### 8. `src/pharmacie/pharmacie-import-mode.http.spec.ts`

Aucun changement.

### 9. Lignes de construction (D581)

Dans `test/db/fiche-produit.db-spec.ts`, `test/db/mouvements-stock.db-spec.ts`, `test/db/non-regression-lectures.db-spec.ts`, `test/db/qualification.db-spec.ts` : seule modification permise, l'appel `new PharmacieService(...)` gagne en dernier argument `new ReceptionsService(prisma, <instance AccesPharmacieService déjà passée>, <instance MouvementsStockService déjà passée, sinon new MouvementsStockService()>, <doublure de permissions déjà passée>)`, plus la ligne d'import `import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';`. Appels, assertions et instantanés intouchés.

### 10. `CLAUDE.md` du dépôt back

Ajouter après la puce PB14a une puce « **Import Excel du stock (tranche pharmacie 1, PB14c)** » qui dit, en une phrase par point : mode `livraison` seulement, avec `reception:write` (403 sinon), enregistré comme une réception (un lot par ligne, quantité du fichier en boîtes, colonnes facultatives « Lot » et « Coût d'achat » par boîte, « Prix d'achat » reconnu comme coût) ; date de péremption obligatoire sauf « sans péremption », jamais passée ; médicament absent du stock ajouté, prix de la boîte et notes mis à jour si la case est remplie ; ventes faites sans stock rattachées ; `quantiteAvant`, `quantiteApres`, `unitesRecues` en unités depuis le stock calculé, `receptionId` dans la réponse ; mode `inventaire` refusé (409 `IMPORT_INVENTAIRE_INDISPONIBLE`) jusqu'à PB15 ; plus aucun import n'écrit le compteur gelé.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (messages en français, actionnables, aucun tiret cadratin ni demi-cadratin nulle part). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Aucune migration, aucun `prisma generate`, jamais `prisma migrate dev`, `migrate reset` ni `db push` sur la base de dev. Ne jamais afficher ni écrire d'URL de base, de mot de passe ni de valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh`. Ne pas commiter (le chef commite). Si une étape se révèle impossible telle qu'écrite, s'arrêter en BLOCKED avec la commande et l'erreur, sans contournement.

Fichiers touchés attendus (et seulement eux) : `src/common/filters/codes-erreur.ts`, `src/pharmacie/dto/pharmacie.dto.ts`, `src/pharmacie/receptions/receptions.service.ts`, `src/pharmacie/pharmacie.service.ts`, `src/pharmacie/pharmacie.controller.ts`, `src/pharmacie/pharmacie.import.spec.ts`, `test/db/import-livraison.db-spec.ts` (nouveau), `test/db/fiche-produit.db-spec.ts`, `test/db/mouvements-stock.db-spec.ts`, `test/db/non-regression-lectures.db-spec.ts`, `test/db/qualification.db-spec.ts`, `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/common/filters/codes-erreur.ts src/pharmacie/dto/pharmacie.dto.ts src/pharmacie/receptions/receptions.service.ts src/pharmacie/pharmacie.import.spec.ts test/db/import-livraison.db-spec.ts test/db/fiche-produit.db-spec.ts test/db/mouvements-stock.db-spec.ts test/db/non-regression-lectures.db-spec.ts test/db/qualification.db-spec.ts` : aucune erreur ; `npx eslint src/pharmacie/pharmacie.service.ts src/pharmacie/pharmacie.controller.ts` (`eslint-disable` globaux préexistants) : aucune erreur nouvelle par rapport à avant la tâche.
3. `docker compose exec -T backend npm test` : tout vert, dont `pharmacie.import.spec.ts` (19 tests) et `pharmacie-import-mode.http.spec.ts` inchangé.
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/import-livraison.db-spec.ts` (9 tests), et `non-regression-lectures.db-spec.ts` vert avec ses instantanés intouchés.
5. `git status --porcelain` (depuis `back_medconnect`) ne liste que les fichiers de « Fichiers touchés attendus » (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes` est vide ; `git diff -- test/db/fiche-produit.db-spec.ts test/db/mouvements-stock.db-spec.ts test/db/non-regression-lectures.db-spec.ts test/db/qualification.db-spec.ts` ne change que l'import et l'appel de construction.
6. Plus aucune écriture du compteur gelé : `grep -nE "increment|disponible:|quantite: (l\.|quantite)" src/pharmacie/pharmacie.service.ts` : aucune ligne d'écriture de `StockMedicament` (les seules lignes restantes, s'il y en a, sont des lectures de réponse à justifier dans le Return) ; `grep -rn "stockMedicament.upsert" src/pharmacie` : la seule ligne est celle de `upsertStock` (création à quantité nulle, D493) ; `grep -n "select: { medicamentId: true, quantite: true }" src/pharmacie/pharmacie.service.ts` : aucune ligne.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées (`git diff -U0 | grep -P "[\x{2013}\x{2014}]"` vide, et de même sur le fichier nouveau).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-27 | spécifié (Sonnet) | PASS | vérificateur Sonnet PASS avec deux lacunes de couverture, comblées par deux tests DB ajoutés (import mixte, cases vides)

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
tsc, eslint, npm test, npm run test:db (docker compose exec -T backend) | 0 erreur ; 946 unitaires et 238 test:db verts | voir rapports/PB14c-chef.md et le commit PB14c
