# B12 - Import Excel du stock : mode « livraison », date d'expiration vide conservée, quantités avant et après

Tier: spécifié (agent implementeur-specifie)
Audience: mixte (API dev ; textes de la feuille « Mode d'emploi » et raison de rejet lus par des pharmaciens, non-dev, fournis mot pour mot ci-dessous)
Visuel: n/a
Background-safe: oui (outils Read, Edit, Write, Bash ; docker compose exec)

Dépôt : `D:\souleymane\perso-archive-20260923\perso\medconnecte\back_medconnect`, branche `orch/lot6-back` (arbre principal ; ne pas créer de branche ; NE PAS COMMITER : l'orchestrateur commite après validation). Rien à modifier dans le dépôt racine, ni dans `front_medconnect` ou `mobile_medconnect`.
Décisions de référence : `docs/plans/runs/2026-10-21-lot6/decisions.md`, D97 à D106.

## Audit (état avant correction, établi par le chef d'équipe, à ne pas refaire)

1. `src/pharmacie/pharmacie.service.ts`, `importerStock` (l. 541 à 609) : transaction en lot (`$transaction([...upserts])`) ; `donnees.dateExpiration` vaut `null` quand la cellule est vide, donc l'`update` EFFACE la date enregistrée ; le prix (`undefined`) et les notes (`undefined`) sont déjà conservés par Prisma. La quantité du fichier remplace toujours celle en stock. L'alerte groupée compte les lignes acceptées dont `quantite < SEUIL_STOCK_BAS`.
2. `apercuImportStock` (l. 525 à 538) et `importerStock` appellent `analyserImportStock(fichier)` (l. 612 à 734), qui ne lit jamais le stock existant. Borne de quantité écrite en dur `2147483647` (l. 671).
3. `getModeleImportStock` (l. 481 à 522) : feuille « Mode d'emploi », 5 lignes, la 3e dit que la quantité remplace le stock.
4. `src/pharmacie/pharmacie.controller.ts` l. 337 à 387 : routes `POST stock/:structureId/import/apercu` et `POST stock/:structureId/import`, `FileInterceptor('fichier')`, aucun `@Body()`. Constante Swagger `CORPS_IMPORT_STOCK` (l. 47 à 53) partagée avec les routes du catalogue (l. 157 à 194).
5. `src/pharmacie/dto/pharmacie.dto.ts` l. 127 à 170 : `FichierImport`, `LigneImportStock`, `RapportImport<L>` (partagé avec le catalogue), `RapportImportStock`, `ResultatImportStock`.
6. `ValidationPipe` global (`src/main.ts` l. 44 à 51) : `whitelist`, `forbidNonWhitelisted`, `transform`, `exceptionFactory: fabriquerErreurValidation` (400 `{ code: 'VALIDATION', champs: [{ champ, contraintes }] }`). Un `@Body()` typé par une classe DTO sur une route multipart est validé par ce pipe (multer remplit `req.body` avec les champs texte). Le front (`front_medconnect/src/lib/api_pharmacie.ts` l. 170 à 183) n'envoie aujourd'hui que `fichier` : un DTO avec le seul champ `mode` ne casse rien.
7. Tests existants : `src/pharmacie/pharmacie.import.spec.ts` (8 tests). Le dernier (« n'écrit que les lignes acceptées, en une seule transaction... ») suppose une transaction en lot et devra être réécrit (voir Spec 5).

## Spec

### 1. `src/pharmacie/dto/pharmacie.dto.ts`

- Ajouter `IsIn` à l'import de `class-validator`.
- Après l'interface `FichierImport`, ajouter :

```ts
/** Façon de compter les quantités du fichier : remplacer le stock ou s'y ajouter. */
export const MODES_IMPORT_STOCK = ['inventaire', 'livraison'] as const;
export type ModeImportStock = (typeof MODES_IMPORT_STOCK)[number];

/** Champs texte du formulaire d'import du stock (en plus du fichier). */
export class OptionsImportStockDto {
  @ApiPropertyOptional({
    enum: MODES_IMPORT_STOCK,
    default: 'inventaire',
    description:
      'inventaire : la quantité du fichier remplace la quantité en stock. livraison : elle s\'y ajoute.',
  })
  @IsOptional()
  @IsIn(MODES_IMPORT_STOCK)
  mode?: ModeImportStock;
}
```

  (Si prettier préfère des guillemets doubles pour la description, suivre prettier.)
- `LigneImportStock` : ajouter après `notes?: string;`

```ts
  /** Quantité en stock avant l'import (0 si le médicament n'y est pas), lignes acceptées seulement. */
  quantiteAvant?: number;
  /** Quantité en stock après l'import, selon le mode choisi, lignes acceptées seulement. */
  quantiteApres?: number;
```

- Ne pas modifier `RapportImport<L>` (partagé avec le catalogue). Ne rien changer d'autre.

### 2. `src/pharmacie/pharmacie.service.ts`

Imports : ajouter `ModeImportStock` à l'import depuis `./dto/pharmacie.dto`.

Constantes, après `SEUIL_STOCK_BAS` :

```ts
/** Plus grande quantité enregistrable (colonne Int de PostgreSQL). */
const QUANTITE_MAX = 2147483647;
/** Transaction interactive de l'import : jusqu'à 1000 écritures successives. */
const OPTIONS_TRANSACTION_IMPORT = { maxWait: 10_000, timeout: 60_000 };
```

et remplacer le littéral `2147483647` de `analyserImportStock` par `QUANTITE_MAX` (seule modification dans `analyserImportStock`).

#### 2a. `getModeleImportStock`

Remplacer le tableau de textes de la feuille « Mode d'emploi » par, dans cet ordre (mot pour mot, apostrophes droites comme dans le code actuel) :

1. `Remplissez la feuille « Stock » : une ligne par médicament, à partir de la ligne 2. Ne modifiez pas les titres de la ligne 1.` (inchangé)
2. `Écrivez le nom du médicament tel qu'il apparaît dans le catalogue MedConnecte (les majuscules et les accents ne comptent pas).` (inchangé)
3. `La quantité est un nombre entier, 0 ou plus.`
4. `Au moment d'envoyer le fichier, choisissez « Inventaire » ou « Livraison ».`
5. `Inventaire : vous avez compté les boîtes présentes dans la pharmacie. La quantité du fichier remplace la quantité en stock. Exemple : 20 en stock et 50 dans le fichier, il y aura 50.`
6. `Livraison : vous venez de recevoir des médicaments. La quantité du fichier s'ajoute à la quantité en stock. Exemple : 20 en stock et 50 dans le fichier, il y aura 70. Un médicament qui n'est pas encore dans votre stock y est ajouté avec la quantité du fichier.`
7. `Avant d'enregistrer, l'aperçu affiche pour chaque médicament la quantité avant et après.`
8. `Le prix unitaire (en GNF), la date d'expiration (au format AAAA-MM-JJ, par exemple 2027-12-31) et les notes sont facultatifs. Une case laissée vide ne change pas ce qui est déjà enregistré.`
9. `Un même fichier peut contenir jusqu'à 1000 médicaments. Remplacez la ligne d'exemple par vos propres médicaments.` (inchangé)

Rien d'autre ne change dans cette méthode (la feuille « Stock » reste identique).

#### 2b. Nouvelle méthode privée `calculerQuantitesImport`

À placer juste après `analyserImportStock`. Fonction pure (aucun accès Prisma) :

```ts
  /**
   * Calcule quantiteAvant et quantiteApres de chaque ligne acceptée selon le mode.
   * En livraison, une ligne dont le total dépasserait QUANTITE_MAX devient rejetée.
   * Renvoie un nouveau rapport (compteurs recalculés), sans modifier celui reçu.
   */
  private calculerQuantitesImport(
    rapport: RapportImportStock,
    enStock: Map<string, number>,
    mode: ModeImportStock,
  ): RapportImportStock
```

Pour chaque ligne :
- ligne rejetée : recopiée telle quelle ;
- ligne acceptée : `avant = enStock.get(l.medicamentId as string) ?? 0`, `quantite = l.quantite ?? 0`, `apres = mode === 'livraison' ? avant + quantite : quantite` ;
- si `apres > QUANTITE_MAX` (ne peut arriver qu'en livraison) : renvoyer `{ ligne, nom, statut: 'rejetee', raison: 'Avec cette livraison, la quantité en stock deviendrait trop grande. Vérifiez la quantité.' }` (mêmes `ligne` et `nom`, aucun autre champ) ;
- sinon : `{ ...l, quantiteAvant: avant, quantiteApres: apres }`.

Puis renvoyer `{ totalLignes: lignes.length, acceptees, rejetees: lignes.length - acceptees, lignes }`.

#### 2c. Nouvelle méthode privée `lireQuantitesEnStock`

```ts
  /** Quantités en stock de la pharmacie pour les médicaments des lignes acceptées. */
  private async lireQuantitesEnStock(
    client: Pick<PrismaService, 'stockMedicament'>,
    structureId: string,
    rapport: RapportImportStock,
  ): Promise<Map<string, number>>
```

- `ids` = `medicamentId` des lignes acceptées ; si vide, renvoyer `new Map()` sans requête.
- Sinon `client.stockMedicament.findMany({ where: { structureId, medicamentId: { in: ids } }, select: { medicamentId: true, quantite: true } })` et renvoyer la `Map` `medicamentId -> quantite`.
- `client` est soit `this.prisma`, soit le `tx` de la transaction. Si `Pick<PrismaService, 'stockMedicament'>` ne compile pas avec le `tx` de `$transaction(async (tx) => ...)`, utiliser `Prisma.TransactionClient` importé de `generated/prisma/client` (et passer `this.prisma` qui en est compatible) ; ne pas utiliser `any`.

#### 2d. `apercuImportStock`

Nouvelle signature : `(structureId: string, adminUserId: string, fichier?: FichierImport, mode: ModeImportStock = 'inventaire')`.

```ts
    await this.checkPharmacieAccess(structureId, adminUserId);
    const analyse = await this.analyserImportStock(fichier);
    const enStock = await this.lireQuantitesEnStock(this.prisma, structureId, analyse);
    const rapport = this.calculerQuantitesImport(analyse, enStock, mode);

    return {
      data: { ...rapport, mode },
      message: this.messageImportStock(rapport, false),
      success: true,
    };
```

#### 2e. `importerStock`

Nouvelle signature, même ajout `mode: ModeImportStock = 'inventaire'` en 4e paramètre. Mettre à jour la JSDoc : « Refait l'analyse puis, dans une transaction, relit le stock, calcule les quantités et écrit les lignes acceptées. »

Déroulé :

```ts
    await this.checkPharmacieAccess(structureId, adminUserId);
    const analyse = await this.analyserImportStock(fichier);

    // Lecture du stock, calcul et écriture dans la même transaction
    const rapport = await this.prisma.$transaction(async (tx) => {
      const enStock = await this.lireQuantitesEnStock(tx, structureId, analyse);
      const calcule = this.calculerQuantitesImport(analyse, enStock, mode);
      const lignes: LigneImportStock[] = [];
      for (const l of calcule.lignes) {
        if (l.statut !== 'acceptee') {
          lignes.push(l);
          continue;
        }
        const ecrit = await tx.stockMedicament.upsert(/* voir ci-dessous */);
        lignes.push(
          mode === 'livraison'
            ? { ...l, quantiteAvant: ecrit.quantite - (l.quantite ?? 0), quantiteApres: ecrit.quantite }
            : l,
        );
      }
      return { ...calcule, lignes };
    }, OPTIONS_TRANSACTION_IMPORT);
    const aEcrire = rapport.lignes.filter((l) => l.statut === 'acceptee');
```

Ajouter dans la boucle, au-dessus de la ligne `mode === 'livraison'`, le commentaire : « En livraison, avant et après viennent de la ligne écrite : un import simultané déjà ajouté est compté, jamais écrasé. »

Paramètres de l'`upsert` (où `quantite = l.quantite ?? 0`, `date = l.dateExpiration ? new Date(l.dateExpiration) : undefined`, `notes = l.notes?.trim()`) :

- `where` : `{ medicamentId_structureId: { medicamentId: l.medicamentId as string, structureId } }` (inchangé) ;
- `create` (identique dans les deux modes) : `{ medicamentId, structureId, quantite, prixUnitaire: l.prixUnitaire, disponible: quantite > 0, dateExpiration: date ?? null, notes }` ;
- `update` en mode `inventaire` : `{ quantite, prixUnitaire: l.prixUnitaire, disponible: quantite > 0, dateExpiration: date, notes }` ;
- `update` en mode `livraison` : `{ quantite: { increment: quantite }, prixUnitaire: l.prixUnitaire, dateExpiration: date, notes, ...(quantite > 0 ? { disponible: true } : {}) }`.

`date` vaut `undefined` quand la cellule est vide : Prisma ne touche alors pas la colonne, la date enregistrée est conservée (comme le prix et les notes). Ajouter le commentaire d'une ligne : « Case vide = undefined : Prisma garde la valeur enregistrée (date, prix, notes). » Supprimer le commentaire « Même sémantique que upsertStock : la quantité remplace celle en stock ».

Après la transaction (inchangé dans sa forme) :
- l'alerte groupée compte `aEcrire.filter((l) => (l.quantiteApres ?? 0) < SEUIL_STOCK_BAS).length` (au lieu de `l.quantite`) ; textes des notifications inchangés ;
- retour : `{ data: { ...rapport, mode, importees: aEcrire.length }, message: this.messageImportStock(rapport, true), success: true }`.

Ne rien modifier d'autre dans ce fichier (`upsertStock`, `updateStockQuantite`, `messageImportStock`, `lireNombre`, `lireDate` inchangés). Le `eslint-disable` global de tête reste tel quel.

### 3. `src/pharmacie/pharmacie.controller.ts`

- Ajouter `OptionsImportStockDto` à l'import depuis `./dto/pharmacie.dto`.
- Après `CORPS_IMPORT_STOCK` (qui reste utilisé par le catalogue, ne pas le modifier), ajouter :

```ts
// Formulaire d'import du stock : le classeur et la façon de compter (facultative)
const CORPS_IMPORT_STOCK_MODE = {
  schema: {
    type: 'object',
    required: ['fichier'],
    properties: {
      fichier: { type: 'string', format: 'binary' },
      mode: {
        type: 'string',
        enum: ['inventaire', 'livraison'],
        default: 'inventaire',
      },
    },
  },
};
```

- Routes `stock/:structureId/import/apercu` et `stock/:structureId/import` seulement :
  - `@ApiBody(CORPS_IMPORT_STOCK_MODE)` à la place de `@ApiBody(CORPS_IMPORT_STOCK)` ;
  - nouveau paramètre `@Body() options: OptionsImportStockDto`, déclaré AVANT `@UploadedFile() fichier?: FichierImport` (un paramètre optionnel doit rester en dernier) ;
  - appel du service : 4e argument `options.mode ?? 'inventaire'` ;
  - descriptions Swagger :
    - aperçu : `'Analyse le classeur (champ multipart `fichier`, .xlsx, 2 Mo et 1000 lignes max) sans rien écrire. Champ multipart facultatif `mode` : `inventaire` (défaut, la quantité du fichier remplace le stock) ou `livraison` (elle s\'y ajoute) ; toute autre valeur : 400 VALIDATION sur le champ `mode`. Renvoie { totalLignes, acceptees, rejetees, mode, lignes[] }, chaque ligne acceptée portant quantiteAvant et quantiteApres.'`
    - import : `"Refait l'analyse de l'aperçu puis, dans une transaction, relit le stock et écrit les lignes acceptées : en mode inventaire la quantité remplace celle en stock, en mode livraison elle s'y ajoute (incrément atomique). Une case vide (prix, date d'expiration, notes) conserve la valeur enregistrée. Renvoie le rapport + mode + importees."`
  - (Adapter les guillemets à prettier, sans changer le texte.)
- Rien d'autre (route du modèle, catalogue, autres routes inchangées).

### 4. Pas d'autre fichier de production

Ne pas toucher `import-excel.ts`, `catalogue-import.service.ts`, `erreur-validation.ts` (pas d'entrée `mode` dans `MESSAGES_REGLES`, D104), `codes-erreur.ts`, `main.ts`, le schéma Prisma (aucune migration).

### 5. Tests

#### 5a. `src/pharmacie/pharmacie.import.spec.ts` (mettre à jour)

Harnais :
- `stockMedicament` simulé : `{ findMany, upsert }` où `findMany = jest.fn().mockResolvedValue([])` par défaut et `upsert = jest.fn((args) => Promise.resolve({ quantite: <calcul> }))` : le mock renvoie une ligne dont `quantite` vaut `args.create.quantite` si le médicament n'est pas dans une `Map` d'état du test (`stockSimule`), sinon `args.update.quantite` si c'est un nombre, sinon `stockSimule.get(id) + args.update.quantite.increment` ; il met `stockSimule` à jour. `stockSimule` est remis à zéro dans `beforeEach` et rempli par les tests qui en ont besoin (avec `findMany` renvoyant le même contenu).
- `$transaction = jest.fn((fn, options) => fn(tx))` avec `tx = { stockMedicament }` (le même objet que `prisma.stockMedicament`).
- Adapter le type `OperationUpsert` et le typage des mocks en conséquence (pas de `any`).

Tests existants : garder les 7 premiers tels quels (ils doivent passer sans modification de leurs assertions). Réécrire le 8e (« n'écrit que les lignes acceptées... ») : même fichier d'entrée, assertions : `$transaction` appelé 1 fois avec une fonction et `{ maxWait: 10_000, timeout: 60_000 }` ; `upsert` appelé 2 fois, pour `med-para` puis `med-amox` ; le 2e appel a `create` `{ medicamentId: 'med-amox', structureId, quantite: 0, prixUnitaire: 2000, disponible: false, dateExpiration: null }` et `update` `{ quantite: 0, disponible: false }` sans clé `dateExpiration` définie (`update.dateExpiration` vaut `undefined`) ; `data.mode === 'inventaire'`, `importees` 2, `acceptees` 2, `rejetees` 3, même message, même alerte groupée (« 2 médicaments »).

Nouveaux tests (un `it` chacun, titres en français) :
1. **Date vide conservée** : stock simulé `med-para` = 30 ; fichier `[['Paracétamol 500 mg', 40]]` (prix, date, notes vides), import sans mode : l'`update` passé à `upsert` a `quantite: 40` et `dateExpiration`, `prixUnitaire`, `notes` valant `undefined` ; ligne acceptée `quantiteAvant: 30`, `quantiteApres: 40`.
2. **Aperçu inventaire par défaut** : stock `med-para` = 30 ; fichier `[['Paracétamol 500 mg', 40], ['Amoxicilline 500 mg', 5]]` ; `apercuImportStock(STRUCTURE_ID, USER_ID, fichier)` : `data.mode === 'inventaire'`, ligne 2 `{ quantiteAvant: 30, quantiteApres: 40 }`, ligne 3 `{ quantiteAvant: 0, quantiteApres: 5 }` ; `findMany` appelé avec `where: { structureId: STRUCTURE_ID, medicamentId: { in: ['med-para', 'med-amox'] } }` ; `$transaction` et `upsert` jamais appelés.
3. **Aperçu livraison** : même stock et fichier, mode `'livraison'` : ligne 2 `{ quantiteAvant: 30, quantiteApres: 70 }`, ligne 3 `{ quantiteAvant: 0, quantiteApres: 5 }`, `data.mode === 'livraison'`.
4. **Import livraison** : stock `med-para` = 30 ; fichier `[['Paracétamol 500 mg', 40], ['Amoxicilline 500 mg', 5]]` ; `importerStock(..., 'livraison')` : 1er `upsert` avec `update.quantite` égal à `{ increment: 40 }` et `update.disponible === true` ; 2e `upsert` avec `create.quantite === 5` (médicament absent créé) ; lignes `{ quantiteAvant: 30, quantiteApres: 70 }` et `{ quantiteAvant: 0, quantiteApres: 5 }` ; une seule alerte groupée envoyée, avec « 1 médicament » (5 est sous le seuil de 10, 70 ne l'est pas).
5. **Livraison de 0** : stock `med-para` = 30 ; `[['Paracétamol 500 mg', 0]]` en livraison : `update` a `quantite: { increment: 0 }` et aucune clé `disponible` ; ligne `{ quantiteAvant: 30, quantiteApres: 30 }`.
6. **Concurrence par incrément** : `findMany` renvoie `med-para` = 30 (lecture), mais `stockSimule` vaut 50 au moment de l'`upsert` (un autre import a déjà ajouté 20) ; livraison de 40 : `update.quantite` vaut `{ increment: 40 }` (jamais un nombre calculé) ; la ligne renvoyée a `quantiteAvant: 50` et `quantiteApres: 90` (valeurs issues de la ligne écrite, pas de la lecture).
7. **Borne entière en livraison** : stock `med-para` = 2147483600 ; livraison de 100 : aperçu et import rejettent la ligne avec la raison exacte `Avec cette livraison, la quantité en stock deviendrait trop grande. Vérifiez la quantité.` ; à l'import, `upsert` n'est pas appelé et `importees === 0`. En inventaire, la même quantité 100 est acceptée (`quantiteApres: 100`).
8. **Alerte calculée sur quantiteApres** : stock `med-para` = 5 ; livraison de 10 : `quantiteApres` 15, aucune notification ; le même fichier en inventaire (quantité 10, pas d'alerte non plus) ; puis stock `med-amox` = 2, livraison de 3 : 1 notification « 1 médicament ».
9. **Modèle téléchargeable** : `getModeleImportStock(STRUCTURE_ID, USER_ID)` (ajouter `medicament.findFirst` au mock si nécessaire) ; relire le buffer avec `new Workbook().xlsx.load(...)` ; la feuille « Mode d'emploi » a 9 lignes, une ligne commence par `Inventaire :`, une par `Livraison :`, et la dernière phrase de la ligne 8 est `Une case laissée vide ne change pas ce qui est déjà enregistré.`

#### 5b. Nouveau fichier `src/pharmacie/pharmacie-import-mode.http.spec.ts`

Test HTTP au plus près du réel (modèle : `src/common/rbac/permissions-type-structure.spec.ts`, l. 216 à 250) :
- `Test.createTestingModule({ controllers: [PharmacieController], providers: [{ provide: PharmacieService, useValue: { apercuImportStock, importerStock } }, { provide: CatalogueImportService, useValue: {} }] })`, `.overrideGuard(AuthGuard)` qui pose `req.user = { userId: 'pharmacien-1', role: 'PHARMACIEN', structureId: 'structure-1' }` et `.overrideGuard(PermissionsGuard).useValue({ canActivate: () => true })` ;
- même pipe que `main.ts` : `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: fabriquerErreurValidation }))` et `app.useGlobalFilters(new AllExceptionsFilter())` ;
- `apercuImportStock` et `importerStock` : `jest.fn().mockResolvedValue({ data: {}, message: 'ok', success: true })`.

Cas (supertest, `.attach('fichier', Buffer.from('x'), 'stock.xlsx')`) :
1. aperçu sans champ `mode` : 200, service appelé avec `('structure-1', 'pharmacien-1', expect.anything(), 'inventaire')` ;
2. aperçu avec `.field('mode', 'livraison')` : 200, 4e argument `'livraison'` ;
3. import avec `.field('mode', 'livraison')` : 200, `importerStock` reçoit `'livraison'` ;
4. aperçu et import avec `.field('mode', 'retour')` : 400, `body.code === 'VALIDATION'`, `body.champs` contient une entrée `champ: 'mode'` ; service non appelé.

### 6. Hors périmètre

Front (envoi de `mode`, affichage avant et après) : non. Swagger hors des deux routes : non. Pas de nouveau code d'erreur. Pas de modification de `upsertStock` ni de `updateStockQuantite`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (textes et commentaires en français, jamais de tiret cadratin ni demi-cadratin). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Pas de `any` ajouté.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (conteneur `backend` démarré) :

1. `docker compose exec -T backend npx tsc --noEmit` : code de sortie 0.
2. `docker compose exec -T backend npx eslint src/pharmacie/pharmacie.service.ts src/pharmacie/pharmacie.controller.ts src/pharmacie/dto/pharmacie.dto.ts src/pharmacie/pharmacie.import.spec.ts src/pharmacie/pharmacie-import-mode.http.spec.ts` : 0 erreur (si `pharmacie.dto.ts` porte une dette prettier préexistante hors des lignes touchées, la signaler dans le retour sans la corriger ; les lignes ajoutées doivent être propres).
3. `docker compose exec -T backend npx jest src/pharmacie` : tous verts, dont les 9 nouveaux tests de 5a et les 4 cas de 5b.
4. `docker compose exec -T backend npx jest` : tous verts (aucune régression).
5. `git -C back_medconnect status --porcelain -- src` ne liste que les 3 fichiers de production, le spec modifié et le nouveau spec `src/pharmacie/pharmacie-import-mode.http.spec.ts`.
6. `git -C back_medconnect diff -U0 | LC_ALL=C.UTF-8 grep -P "^\+.*[\x{2013}\x{2014}]"` : aucune sortie.

## Return

Chemin des fichiers modifiés + preuve (commandes 1 à 4 lancées, résultat en une ligne chacune). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
