# PB13 - Qualification d'une fiche

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages d'erreur et de succès lus par les pharmaciens, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Dernier pas du jalon J2 (PB07 à PB13, indissociables, D445). Toutes les fiches reprises ont un coefficient 1 et un lot technique dont les unités sont en réalité des boîtes. Passer le coefficient de 1 à N sans conversion ferait de 12 boîtes 12 comprimés (plan 1.7, D412). Cette tâche ajoute `conversionStock: "MULTIPLIER" | "CONSERVER"` à `PATCH /pharmacie/:structureId/stock/:stockId/fiche` :

- `MULTIPLIER` : par lot technique en stock, mouvement `CORRECTION` de `solde x (N - 1)`, pièce `QUALIFICATION`, et mise à jour du lot technique (`coefficientReception` = N, coût par unité divisé par N) ;
- `CONSERVER` : aucun mouvement, les quantités sont déclarées déjà comptées en unités ;
- toute conversion appliquée qualifie la fiche ; une fiche qualifiée ne se convertit plus ;
- le refus `CONVERSION_REQUISE` lit enfin le stock calculé (journal), plus la colonne `quantite` gelée ;
- deux corrections de concurrence découvertes en préparant la tâche : verrou de la fiche en `FOR NO KEY UPDATE` (interblocage avec une vente), et relecture du coefficient par la vente sous verrou (409 `FICHE_MODIFIEE`) ;
- une vente faite avant une multiplication ne peut plus être annulée (elle rendrait 2 unités pour 2 boîtes).

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate`.** Ne pas toucher aux migrations, aux retours arrière, aux instantanés `test/db/instantanes/`, à `test/db/non-regression-lectures.db-spec.ts`, `test/db/vente.db-spec.ts`, `test/db/annulation.db-spec.ts` (ils doivent rester verts tels quels). Jamais `prisma migrate dev`, `migrate reset` ni `db push`.

Décisions applicables (lire dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D405, D412, D466, D485 à D492, D496, D500, D507, D527, D535, D545, D546, D554, et celles de cette tâche, D555 à D564.

### Contexte vérifié (ne pas re-découvrir)

- `LotStock` : trigger `lot_stock_proteger` (M4) ; toutes les colonnes sont figées sauf `dateExpiration`, et `coefficientReception` et `coutUnitaire` qui ne se modifient que si `lotTechnique` est vrai. Un `tx.lotStock.update({ where: { id }, data: { coefficientReception, coutUnitaire } })` sur un lot technique passe.
- `MouvementStock` : `evenementId` unique global ; `horodatageServeur DateTime @default(now())` (modifiable à l'insertion par Prisma) ; `TypePiece.QUALIFICATION` et `TypeMouvementStock.CORRECTION` existent ; clé étrangère vers `StockMedicament` (son contrôle prend `FOR KEY SHARE` sur la fiche). Agrégats `AgregatStockLot` (solde par lot, jamais négatif) et `AgregatStockProduit` (par fiche et point de vente, peut être négatif) tenus par trigger : ne jamais les écrire.
- `MouvementsStockService.ecrire(tx, m)` (`src/pharmacie/stock/mouvements-stock.service.ts`) : valide, reprend le verrou consultatif de la fiche (réentrant), insère, lit le lot (`coefficientReception`) et maintient `ConditionnementOuvert` (reliquat = solde mod coefficient). `QUALIFICATION` n'est ni dans `PIECES_SANS_LOT` ni dans `PIECES_AVEC_MOTIF` (un mouvement de qualification a toujours un lot ; son motif est fourni quand même).
- `FicheProduitService.modifierFiche` (`src/pharmacie/fiche-produit.service.ts`, PB06) : verrou de ligne `FOR UPDATE` de la fiche, lecture `existante`, fusion `voulus`, refus `PRIX_UNITE_SANS_DECONDITIONNEMENT`, refus `CONVERSION_REQUISE` sur `existante.quantite` (colonne gelée, fausse depuis PB07), paramètres, champs changés, `stockMedicament.update`, audit `{ avant, apres }`, réponse `data` + `avertissements`.
- `PharmacieService.updateStockQuantite` (`src/pharmacie/pharmacie.service.ts`, vers la ligne 686) : `SELECT "id", "coefficientBoite" FROM "StockMedicament" ... FOR UPDATE` puis `verrouillerFiches`.
- `VenteService.enregistrerVente` (`src/pharmacie/vente.service.ts`) : étape 1 lit les fiches (`fiches`, `parId`) sans verrou, étape 2 calcule les lignes avec `fiche.coefficientBoite`, étape « 10. Verrous et lots » appelle `this.mouvementsStock.verrouillerFiches(tx, ids)`. `annulerVente` : étape « 4. Verrous des fiches » appelle `verrouillerFiches` sur les fiches des lignes d'origine ; `origine` (lu par `tx.vente.findFirst` avec `lignes: { include: { allocations: true } }`) porte `createdAt` ; `nonAnnulable(message)` construit le 409 `PIECE_NON_ANNULABLE`.
- `arrondiGnf` et `exigerEntier` sont dans `src/pharmacie/domaine/quantites.ts`.
- Filtre d'erreurs : `CODES_AVEC_DETAILS` dans `src/common/filters/all-exceptions.filter.ts` ; `assainirDetails` recopie déjà `stockId` et `nom`.
- Jeu « format actuel » : `str-pharma-1`, `usr-admin-p1` (administrateur), `usr-pharm-p1` (vendeur), point de vente d'ordre 1. Les fiches `stk-01` à `stk-20` ont les quantités 0, 1, 9, 10, 11, 240 en boucle ; après M4, une fiche à quantité positive a un lot technique de ce solde.
- `test/db/fiche-produit.db-spec.ts` (test « refus : coefficient changé ... ») reste vrai tel quel avec la nouvelle règle (stk-05 a un lot technique de 11) : seule sa ligne de construction du service change.

### 1. `src/pharmacie/domaine/qualification.ts` (nouveau, règles pures, D557)

Sans Nest ni Prisma. Contenu exact des signatures :

```ts
import { arrondiGnf, exigerEntier } from './quantites';

/** Plus grand entier enregistrable (colonne Int de PostgreSQL). */
const ENTIER_MAX = 2147483647;

export interface SoldeProduitPv {
  pointDeVenteId: string;
  quantite: number; // agrégat produit, peut être négatif
}
export interface LotAConvertir {
  lotId: string;
  pointDeVenteId: string;
  lotTechnique: boolean;
  coefficientReception: number;
  coutUnitaire: number;
  solde: number; // agrégat du lot, >= 0
}
export interface LotConverti {
  lotId: string;
  pointDeVenteId: string;
  quantiteAvant: number;
  quantiteApres: number;
  correction: number; // quantiteApres - quantiteAvant
  coutUnitaireApres: number;
}
export type PlanMultiplication =
  | { ok: true; quantiteAvant: number; quantiteApres: number; lots: LotConverti[] }
  | { ok: false; code: 'STOCK_NON_CONVERTIBLE' | 'QUANTITE_TROP_GRANDE' };

/** Vrai si un point de vente a un agrégat produit non nul ou si un lot a un solde positif (D556). */
export function aDuStock(produits: readonly SoldeProduitPv[], lots: readonly LotAConvertir[]): boolean;

/** Plan de la multiplication par le nouveau coefficient (D557). */
export function planifierMultiplication(
  coefficient: number,
  produits: readonly SoldeProduitPv[],
  lots: readonly LotAConvertir[],
): PlanMultiplication;
```

Règles de `planifierMultiplication`, dans cet ordre :

1. `exigerEntier(coefficient, 'coefficient', 1)` (RangeError sinon).
2. Ne considérer que les lots de `solde > 0` (les autres sont ignorés, même non techniques).
3. Un lot considéré non technique, ou technique avec `coefficientReception !== 1` : `{ ok: false, code: 'STOCK_NON_CONVERTIBLE' }`.
4. Pour chaque point de vente présent dans `produits` ou dans les lots considérés : si l'agrégat produit (0 s'il manque) diffère de la somme des soldes de ses lots considérés : `STOCK_NON_CONVERTIBLE` (part provisoire, stock négatif compris).
5. Par lot considéré, trié par `lotId` croissant (comparaison de chaînes `<`) : `quantiteApres = solde * coefficient`, `correction = quantiteApres - solde`, `coutUnitaireApres = coutUnitaire === 0 ? 0 : arrondiGnf(coutUnitaire / coefficient)`.
6. Si un `quantiteApres` ou la somme des `quantiteApres` dépasse `ENTIER_MAX` : `{ ok: false, code: 'QUANTITE_TROP_GRANDE' }`.
7. `quantiteAvant` = somme des `quantite` de `produits` ; `quantiteApres` = somme des `quantiteApres` des lots (égale à `quantiteAvant` quand `coefficient` vaut 1).

`aDuStock` : `produits.some((p) => p.quantite !== 0) || lots.some((l) => l.solde > 0)`.

### 2. `src/pharmacie/domaine/qualification.spec.ts` (nouveau)

`describe('aDuStock')` puis `describe('planifierMultiplication')`, tests exacts :

- `aDuStock : aucun produit ni lot` : `aDuStock([], [])` faux.
- `aDuStock : produit nul et lot vide` : produit `{ pv1, 0 }`, lot technique solde 0 : faux.
- `aDuStock : stock négatif` : produit `{ pv1, -2 }`, aucun lot : vrai.
- `aDuStock : lot positif` : produit `{ pv1, 0 }`, lot solde 3 : vrai.
- `12 boîtes de coefficient 1 qualifiées à 20 donnent 240 unités et un reliquat nul` : produit `{ pv1, 12 }`, lot `{ lotId: 'l1', pv1, technique, coef 1, cout 0, solde 12 }`, coefficient 20 : `toEqual({ ok: true, quantiteAvant: 12, quantiteApres: 240, lots: [{ lotId: 'l1', pointDeVenteId: 'pv1', quantiteAvant: 12, quantiteApres: 240, correction: 228, coutUnitaireApres: 0 }] })` et `reliquatLot(240, 20)` vaut 0.
- `coefficient 1 : corrections nulles` : même entrée, coefficient 1 : `ok`, correction 0, `quantiteApres` 12.
- `lot non technique en stock : refus` : lot non technique solde 5 (produit 5) : `{ ok: false, code: 'STOCK_NON_CONVERTIBLE' }`.
- `lot non technique vide : ignoré` : lot technique 12, lot non technique solde 0, produit 12 : `ok`, un seul lot dans le plan.
- `lot technique déjà converti : refus` : lot technique coef 20 solde 240 : `STOCK_NON_CONVERTIBLE`.
- `part provisoire : refus` : produit 10, lot technique 12 : `STOCK_NON_CONVERTIBLE` ; produit -1 sans lot : `STOCK_NON_CONVERTIBLE`.
- `quantité trop grande` : lot technique 300000, coefficient 10000 : `QUANTITE_TROP_GRANDE` ; deux lots techniques de 150000 sur deux points de vente (produits 150000 chacun), coefficient 10000 : `QUANTITE_TROP_GRANDE` (somme).
- `coût divisé par le coefficient` : cout 1000, coefficient 3 : 333 ; cout 1001, coefficient 2 : 501 ; cout 0 : 0.
- `ordre des lots par identifiant` : lots `'l2'` puis `'l1'` (deux points de vente) : plan dans l'ordre `l1`, `l2`.
- `coefficient invalide` : 0 et 1.5 lèvent `RangeError`.

### 3. `src/pharmacie/stock/mouvements-stock.service.ts`

3.1. `MouvementAEcrire` gagne, après `sequencePoste?` :

```ts
  /** Horodatage serveur explicite (qualification, D561) ; défaut de la base sinon. */
  horodatageServeur?: Date | null;
```

Dans `ecrire`, l'objet `data` de `tx.mouvementStock.create` gagne `...(m.horodatageServeur ? { horodatageServeur: m.horodatageServeur } : {})`. Rien d'autre ne change dans `ecrire`.

3.2. Nouvelle interface exportée et nouvelle méthode publique (après `creerLot`) :

```ts
export interface QualificationLot {
  lotId: string;
  stockMedicamentId: string;
  pointDeVenteId: string;
  /** Nouveau coefficient de la fiche, au moins 2. */
  coefficient: number;
  coutUnitaire: number;
  /** solde x (coefficient - 1), au moins 1. */
  correction: number;
  auteurId: string | null;
  horodatageServeur: Date;
}

export function validerQualificationLot(q: QualificationLot): void;

/** Multiplie un lot technique à la qualification de sa fiche (D557) : lot mis à jour puis mouvement CORRECTION. */
async qualifierLotTechnique(tx: Prisma.TransactionClient, q: QualificationLot): Promise<MouvementEcrit>;
```

`validerQualificationLot` lève `RangeError` si `coefficient` n'est pas un entier >= 2, si `correction` n'est pas un entier >= 1, ou si `coutUnitaire` n'est pas un entier >= 0 (message `Qualification invalide : <champ> (reçu : <valeur>).`).

`qualifierLotTechnique`, dans cet ordre : `validerQualificationLot(q)` ; `await this.verrouillerFiches(tx, [q.stockMedicamentId])` ; `await tx.lotStock.update({ where: { id: q.lotId }, data: { coefficientReception: q.coefficient, coutUnitaire: q.coutUnitaire } })` ; puis `return this.ecrire(tx, { evenementId: \`qualification:${q.lotId}\`, pointDeVenteId, stockMedicamentId, lotId: q.lotId, type: 'CORRECTION', quantite: q.correction, pieceOrigineType: 'QUALIFICATION', pieceOrigineId: q.stockMedicamentId, motif: \`Qualification de la fiche : ${q.coefficient} unités par boîte\`, auteurId: q.auteurId, horodatageServeur: q.horodatageServeur })`. Le lot est mis à jour AVANT le mouvement : le maintien du conditionnement lit alors le nouveau coefficient (reliquat nul, aucun conditionnement ouvert).

3.3. `src/pharmacie/stock/mouvements-stock.service.spec.ts` : ajouter `describe('validerQualificationLot')` avec `refuse un coefficient inférieur à 2, une correction nulle ou un coût négatif` (trois `toThrow(RangeError)`) et `accepte une qualification valide` (coefficient 20, correction 228, coût 0 : `not.toThrow()`).

### 4. `src/pharmacie/dto/fiche-produit.dto.ts`

Après `UNITES_MINIMALES`, exporter :

```ts
/** Conversion du stock existant à la qualification (PB13, D556). */
export const CONVERSIONS_STOCK = ['MULTIPLIER', 'CONSERVER'] as const;
export type ConversionStock = (typeof CONVERSIONS_STOCK)[number];
```

Ajouter à la fin de `ModifierFicheDto` :

```ts
  @ApiPropertyOptional({
    enum: CONVERSIONS_STOCK,
    example: 'MULTIPLIER',
    description:
      "Lu seulement si le nombre d'unités par boîte change sur une fiche non qualifiée : MULTIPLIER convertit le stock repris (boîtes) en unités, CONSERVER garde les quantités telles quelles. Obligatoire si la fiche a du stock ; qualifie la fiche.",
  })
  @ValidateIf(siPresent)
  @IsIn(CONVERSIONS_STOCK)
  conversionStock?: ConversionStock;
```

Mettre à jour le commentaire de la classe : retirer « La conversion du stock (conversionStock) arrive en PB13. », écrire « conversionStock convertit le stock à la qualification (PB13, D556). ».

### 5. `src/common/filters/codes-erreur.ts` et `all-exceptions.filter.ts`

Ajouter à la fin de `CODES_ERREUR`, avec ces commentaires :

```ts
  // Fiche déjà qualifiée : le stock existant ne se convertit plus (409).
  'FICHE_DEJA_QUALIFIEE',
  // Stock qui ne peut pas être multiplié automatiquement : hors reprise, provisoire ou trop grand (409).
  'CONVERSION_IMPOSSIBLE',
  // Fiche d'un médicament du panier modifiée pendant la vente (409), lignes dans `details`.
  'FICHE_MODIFIEE',
```

Mettre à jour le commentaire de `CONVERSION_REQUISE` : `// Coefficient d'une fiche non qualifiée qui a du stock changé sans conversionStock (400).`

Dans `CODES_AVEC_DETAILS` (`src/common/filters/all-exceptions.filter.ts`), ajouter `'FICHE_MODIFIEE'` en dernier. Rien d'autre dans ce fichier.

### 6. `src/pharmacie/fiche-produit.service.ts`

6.1. Constantes exportées ajoutées (texte exact) :

```ts
export const MESSAGE_FICHE_DEJA_QUALIFIEE =
  "Ce médicament est déjà qualifié : son stock n'est plus converti. Enregistrez le nouveau nombre d'unités par boîte sans conversion : il vaudra pour les prochaines réceptions.";
export const MESSAGE_CONVERSION_IMPOSSIBLE =
  'Le stock de ce médicament ne vient pas seulement de la reprise initiale : il ne peut pas être multiplié automatiquement. Choisissez « Conserver », puis corrigez la quantité en unités par un inventaire.';
export const MESSAGE_CONVERSION_TROP_GRANDE =
  "La conversion donnerait une quantité trop grande pour être enregistrée. Vérifiez le nombre d'unités par boîte.";
export const MESSAGE_FICHE_ENREGISTREE = 'Fiche produit enregistrée.';
export const MESSAGE_AUCUNE_MODIFICATION = 'Aucune modification de la fiche produit.';
export const MESSAGE_STOCK_CONSERVE =
  'Fiche produit enregistrée. Le stock existant est gardé tel quel, compté en unités.';
export function messageStockMultiplie(quantite: number): string {
  return `Fiche produit enregistrée. Le stock existant a été converti : ${quantite} unités.`;
}
```

`MESSAGE_CONVERSION_REQUISE` est inchangé. Les deux littéraux de message existants sont remplacés par `MESSAGE_FICHE_ENREGISTREE` et `MESSAGE_AUCUNE_MODIFICATION` (mêmes textes).

6.2. Types :

```ts
export interface ConversionAppliquee {
  mode: ConversionStock;
  coefficientAvant: number;
  coefficientApres: number;
  quantiteAvant: number;
  quantiteApres: number;
  lots: { lotId: string; quantiteAvant: number; quantiteApres: number }[];
}
export type FicheReponse = FicheAvecMedicament & {
  avertissements: AvertissementPrix[];
  conversion: ConversionAppliquee | null;
};
```

6.3. Constructeur : `(prisma: PrismaService, accesPharmacie: AccesPharmacieService, mouvementsStock: MouvementsStockService)` (import depuis `./stock/mouvements-stock.service`). Aucun changement de `pharmacie.module.ts` (les deux services y sont déjà fournis).

6.4. Corps de la transaction, dans cet ordre (le reste du code existant est conservé) :

1. Verrou : remplacer `FOR UPDATE` par `FOR NO KEY UPDATE` dans la requête existante (D559). 404 inchangé.
2. Lecture `existante`, fusion `voulus` inchangées.
3. Refus `PRIX_UNITE_SANS_DECONDITIONNEMENT` inchangé.
4. `const coefficientChange = voulus.coefficientBoite !== existante.coefficientBoite;`
5. Si `coefficientChange && existante.qualifie && dto.conversionStock !== undefined` : `ConflictException({ message: MESSAGE_FICHE_DEJA_QUALIFIEE, code: 'FICHE_DEJA_QUALIFIEE' })`.
6. Si `coefficientChange && !existante.qualifie` (seul cas où le stock est lu) :
   - `await this.mouvementsStock.verrouillerFiches(tx, [stockId]);`
   - `const [{ maintenant }] = await tx.$queryRaw<{ maintenant: Date }[]>\`SELECT clock_timestamp() AS "maintenant"\`;`
   - lots : `tx.lotStock.findMany({ where: { stockMedicamentId: stockId, agregat: { is: { quantite: { gt: 0 } } } }, select: { id: true, pointDeVenteId: true, lotTechnique: true, coefficientReception: true, coutUnitaire: true, agregat: { select: { quantite: true } } } })` converti en `LotAConvertir[]` (`solde: l.agregat?.quantite ?? 0`) ;
   - produits : `tx.agregatStockProduit.findMany({ where: { stockMedicamentId: stockId }, select: { pointDeVenteId: true, quantite: true } })` ;
   - `const stock = aDuStock(produits, lots);`
   - si `stock && dto.conversionStock === undefined` : 400 `CONVERSION_REQUISE` (message inchangé) ;
   - si `dto.conversionStock !== undefined` : `voulus.qualifie = true` ; `quantiteAvant` = somme des `produits[].quantite` ;
     - `CONSERVER`, ou `MULTIPLIER` sans stock : `conversion = { mode, coefficientAvant: existante.coefficientBoite, coefficientApres: voulus.coefficientBoite, quantiteAvant, quantiteApres: quantiteAvant, lots: [] }`, aucune écriture de stock ;
     - `MULTIPLIER` avec stock : `const plan = planifierMultiplication(voulus.coefficientBoite, produits, lots);` ; `plan.ok` faux : 409 `CONVERSION_IMPOSSIBLE` avec `MESSAGE_CONVERSION_IMPOSSIBLE` (`STOCK_NON_CONVERTIBLE`) ou `MESSAGE_CONVERSION_TROP_GRANDE` (`QUANTITE_TROP_GRANDE`) ; sinon garder `plan` pour l'étape 9 et `conversion = { mode: 'MULTIPLIER', coefficientAvant, coefficientApres, quantiteAvant: plan.quantiteAvant, quantiteApres: plan.quantiteApres, lots: plan.lots.map(({ lotId, quantiteAvant, quantiteApres }) => ({ lotId, quantiteAvant, quantiteApres })) }`.
   - sans `conversionStock` (et donc sans stock) : `conversion = null`, `qualifie` inchangé (comportement de PB06).
7. Coefficient inchangé, ou fiche déjà qualifiée sans `conversionStock` : `conversionStock` ignoré, `conversion = null`.
8. Paramètres et calcul des `changes` inchangés. Aucun changement : retour inchangé avec `conversion: null` (cas du rejeu, D556).
9. Écritures, dans cet ordre : si `plan` (MULTIPLIER avec stock), pour chaque `l` de `plan.lots` avec `l.correction > 0` : `await this.mouvementsStock.qualifierLotTechnique(tx, { lotId: l.lotId, stockMedicamentId: stockId, pointDeVenteId: l.pointDeVenteId, coefficient: voulus.coefficientBoite, coutUnitaire: l.coutUnitaireApres, correction: l.correction, auteurId: user.id, horodatageServeur: maintenant })` ; puis `stockMedicament.update` existant ; puis l'audit existant dont `metadata` devient `conversion ? { avant, apres, conversion } : { avant, apres }` (même objet que la réponse, sans coût).
10. La transaction renvoie aussi `conversion`.

6.5. Réponse : `data: { ...fiche, avertissements, conversion }`. Message : aucune modification : `MESSAGE_AUCUNE_MODIFICATION` ; `conversion` non nul et `conversion.quantiteAvant !== 0` : `messageStockMultiplie(conversion.quantiteApres)` si `MULTIPLIER`, `MESSAGE_STOCK_CONSERVE` si `CONSERVER` ; sinon `MESSAGE_FICHE_ENREGISTREE`. Aucun appel à `masquerCouts` : aucune clé de la réponse ne correspond à `/cout|marge/i` (vérifié par un test).

### 7. `src/pharmacie/fiche-produit.controller.ts`

Remplacer la `description` de `@ApiOperation` par : `"Prix de la boîte et prix à l'unité indépendants, jamais recalculés l'un depuis l'autre ; avertissement ECART_PRIX non bloquant au-delà du seuil de la pharmacie. Changer le nombre d'unités par boîte d'une fiche non qualifiée qui a du stock exige conversionStock : MULTIPLIER (le stock repris compté en boîtes est converti en unités par un mouvement CORRECTION, pièce QUALIFICATION) ou CONSERVER (quantités gardées) ; la fiche est alors qualifiée. 400 PRIX_UNITE_SANS_DECONDITIONNEMENT, 400 CONVERSION_REQUISE, 409 FICHE_DEJA_QUALIFIEE, 409 CONVERSION_IMPOSSIBLE. Réponse : fiche, avertissements, conversion."`. Rien d'autre.

### 8. `src/pharmacie/pharmacie.service.ts`

Dans `updateStockQuantite`, remplacer `FOR UPDATE` par `FOR NO KEY UPDATE` dans la requête de verrou de la fiche (D559). Aucun autre changement dans ce fichier.

### 9. `src/pharmacie/vente.service.ts`

9.1. Constantes exportées ajoutées près des autres messages :

```ts
export const MESSAGE_FICHE_MODIFIEE =
  "La fiche d'un médicament du panier vient d'être modifiée (nombre d'unités par boîte). Vérifiez le panier puis validez de nouveau.";
export const MESSAGE_VENTE_AVANT_QUALIFICATION =
  "Cette vente date d'avant la conversion du stock de ce médicament en unités : elle ne peut pas être annulée. Corrigez le stock du médicament si besoin.";
```

9.2. `enregistrerVente`, étape « 10. Verrous et lots », juste après `await this.mouvementsStock.verrouillerFiches(tx, ids);` et avant la lecture `agregatsAvant` (D560) :

```ts
    const coefficients = await tx.stockMedicament.findMany({
      where: { id: { in: ids } },
      select: { id: true, coefficientBoite: true },
    });
    const modifiees = fiches.filter(
      (f) =>
        coefficients.find((c) => c.id === f.id)?.coefficientBoite !==
        f.coefficientBoite,
    );
    if (modifiees.length > 0) {
      throw new ConflictException({
        message: MESSAGE_FICHE_MODIFIEE,
        code: 'FICHE_MODIFIEE',
        details: modifiees.map((f) => ({ stockId: f.id, nom: f.medicament.nom })),
      });
    }
```

9.3. `annulerVente`, juste après l'étape « 4. Verrous des fiches » et avant « 5. Calcul des opposés » (D561) :

```ts
        // 4b. Vente antérieure à une multiplication du stock (D561)
        const lotsAlloues = [
          ...new Set(
            origine.lignes
              .flatMap((l) => l.allocations)
              .map((a) => a.lotId)
              .filter((id): id is string => id !== null),
          ),
        ];
        if (lotsAlloues.length > 0) {
          const qualification = await tx.mouvementStock.findFirst({
            where: {
              pieceOrigineType: 'QUALIFICATION',
              lotId: { in: lotsAlloues },
              horodatageServeur: { gte: origine.createdAt },
            },
            select: { id: true },
          });
          if (qualification) {
            throw nonAnnulable(MESSAGE_VENTE_AVANT_QUALIFICATION);
          }
        }
```

Aucun autre changement dans ce fichier (ordre des verrous D527 et D545 inchangé).

### 10. `src/pharmacie/fiche-produit.http.spec.ts`

- Test `5` : retirer la ligne `[{ conversionStock: 'MULTIPLIER' }, 'conversionStock', 'whitelistValidation']` et ajouter `[{ conversionStock: 'DOUBLER' }, 'conversionStock', 'isIn']` et `[{ conversionStock: null }, 'conversionStock', 'isIn']`.
- Nouveau test `6. conversionStock transmis au service` : corps `{ coefficientBoite: 20, conversionStock: 'MULTIPLIER' }` puis `{ coefficientBoite: 20, conversionStock: 'CONSERVER' }` : 200 et `modifierFiche` appelé avec `expect.objectContaining({ coefficientBoite: 20, conversionStock: <valeur> })`.

### 11. `test/db/qualification.db-spec.ts` (nouveau)

Structure et préparation copiées de `test/db/annulation.db-spec.ts` (base vide, migrations jusqu'à `DERNIERE_MIGRATION_FORMAT_ACTUEL`, `chargerFormatActuel`, migrations restantes, `creerPrismaDeTest`, mêmes doublures `notifications`, `stockage`, `permissions` (RESPONSABLE `usr-admin-p1` avec `marge:read`), `MouvementsStockService`, `SessionsCaisseService`, `VenteService`, `pv1`), plus `fiches = new FicheProduitService(prisma, acces, mouvements)` et `pharmacie = new PharmacieService(prisma, notifications, acces, mouvements, permissions)`. `describe('Qualification d une fiche, sur base de test (PB13)')`.

Aides (copiées ou écrites ici, jamais exportées) : `refus`, `sql`, `compter`, `soldeProduit(stockId)`, `soldeLot(lotId)`, `prochainNumero()`, `nombreVentes()` (identiques à `annulation.db-spec.ts`) ; `nouvelleFiche({ coef?, prixBoite?, prixUnite?, decond? })` (ids `med-qualif-<n>` et `stk-qualif-<n>`, catégorie `Test PB13`) ; `lotTechnique(stockId, quantite, cout = 0)` : `prisma.$transaction((tx) => mouvements.creerLot(tx, { ..., numeroLot: null, dateExpiration: jourVersDate(jour(200)), quantite, coutUnitaire: cout, coutAchatBoite: null, coefficientReception: 1, fournisseurId: null, receptionId: null, lotTechnique: true, auteurId: null, pieceOrigineType: 'MIGRATION', pieceOrigineId: 'test-pb13', motif: 'Reprise du stock existant' }))` qui renvoie l'identifiant du lot ; `nouveauLot` non technique comme dans `annulation.db-spec.ts` ; `modifier(stockId, dto)` = `fiches.modifierFiche(PHARMACIE, RESPONSABLE, stockId, dto, '127.0.0.1')` ; `vendre(dto)` et `annuler(venteId)` comme dans `annulation.db-spec.ts` ; `mouvementsQualification(stockId)` = `SELECT "type"::text AS "type", "quantite", "lotId", "evenementId", "pieceOrigineId", "motif", "auteurId" FROM "MouvementStock" WHERE "pieceOrigineType" = 'QUALIFICATION' AND "stockMedicamentId" = $1` ; `lot(lotId)` = `SELECT "coefficientReception", "coutUnitaire" FROM "LotStock" WHERE "id" = $1` ; `attentesConsultatives()` = `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())` ; `attendreAttentes(n)` : relit toutes les 25 ms jusqu'à au moins `n`, `Error('Attente non observée.')` après 4 s ; `tenirFiche(stockId)` : ouvre `prisma.$transaction(async (tx) => { await mouvements.verrouillerFiches(tx, [stockId]); signaler(); await libere; }, { maxWait: 5_000, timeout: 30_000 })` et renvoie `{ tenu, liberer, fin }` (même mécanique que le test `8b` de `annulation.db-spec.ts`).

Tests (noms et assertions exacts) :

1. `MULTIPLIER : 12 boîtes de coefficient 1 qualifiées à 20 donnent 240 unités et un reliquat nul` : fiche `prixBoite 1000`, lot technique 12. `modifier(stockId, { coefficientBoite: 20, uniteMinimale: 'COMPRIME', conversionStock: 'MULTIPLIER' })` : `data.coefficientBoite` 20, `data.qualifie` vrai, `data.conversion` `toEqual({ mode: 'MULTIPLIER', coefficientAvant: 1, coefficientApres: 20, quantiteAvant: 12, quantiteApres: 240, lots: [{ lotId, quantiteAvant: 12, quantiteApres: 240 }] })`, `message` = `messageStockMultiplie(240)`, `cheminsCout(r.data)` vide. En base : `soldeLot` 240, `soldeProduit` 240, lot `coefficientReception` 20 et `coutUnitaire` 0, `ConditionnementOuvert` ouvert (`"fermeLe" IS NULL`) pour la fiche : 0 ; `mouvementsQualification` : une ligne `{ type: 'CORRECTION', quantite: 228, lotId, evenementId: 'qualification:<lotId>', pieceOrigineId: stockId, motif: 'Qualification de la fiche : 20 unités par boîte', auteurId: RESPONSABLE }` ; audit `update` `StockMedicament` le plus récent de la fiche : `metadata.conversion` égal à `data.conversion`, `metadata.apres` contient `coefficientBoite: 20` et `qualifie: true`. Lecture `pharmacie.getStockPharmacie(PHARMACIE, RESPONSABLE)` : l'entrée de la fiche a `quantite` 240 et `reliquat` `[]`. Puis vente d'une boîte : ligne `quantite` 20, `coefficientApplique` 20, `soldeLot` 220.
2. `CONSERVER ne change rien au stock` : lot technique 12 ; `{ coefficientBoite: 20, conversionStock: 'CONSERVER' }` : `qualifie` vrai, `coefficientBoite` 20, `conversion` `{ mode: 'CONSERVER', coefficientAvant: 1, coefficientApres: 20, quantiteAvant: 12, quantiteApres: 12, lots: [] }`, `message` = `MESSAGE_STOCK_CONSERVE` ; `soldeLot` et `soldeProduit` 12 ; lot `coefficientReception` 1 ; `mouvementsQualification` vide ; nombre de mouvements de la fiche : 1.
3. `CONVERSION_REQUISE lit le stock calculé, pas la colonne gelée` : lot technique 12 (la colonne `quantite` de la fiche vaut 0) ; `{ coefficientBoite: 20 }` : 400 `CONVERSION_REQUISE`, `MESSAGE_CONVERSION_REQUISE` ; fiche inchangée (coefficient 1, `qualifie` faux), un seul mouvement. Fiche sans stock : `{ coefficientBoite: 10 }` : 200, `qualifie` faux, `conversion` nul, `message` `MESSAGE_FICHE_ENREGISTREE` ; autre fiche sans stock : `{ coefficientBoite: 10, conversionStock: 'MULTIPLIER' }` : `qualifie` vrai, `conversion` `{ mode: 'MULTIPLIER', coefficientAvant: 1, coefficientApres: 10, quantiteAvant: 0, quantiteApres: 0, lots: [] }`, aucun mouvement.
4. `conversion refusée après qualification` : sur une fiche qualifiée par `MULTIPLIER` (lot technique 12 à 20, 240) : `{ coefficientBoite: 10, conversionStock: 'MULTIPLIER' }` puis `{ coefficientBoite: 10, conversionStock: 'CONSERVER' }` : 409 `FICHE_DEJA_QUALIFIEE`, `MESSAGE_FICHE_DEJA_QUALIFIEE`, coefficient 20, `soldeLot` 240, un seul mouvement de qualification. Rejeu `{ coefficientBoite: 20, conversionStock: 'MULTIPLIER' }` : 200, `MESSAGE_AUCUNE_MODIFICATION`, `conversion` nul, toujours un seul mouvement de qualification. `{ coefficientBoite: 10 }` : 200, coefficient 10, `soldeLot` 240, lot `coefficientReception` 20.
5. `MULTIPLIER refusé si du stock est hors du lot technique` : (a) lot technique 12 et lot non technique 5 (`nouveauLot`) : `MULTIPLIER` à 20 : 409 `CONVERSION_IMPOSSIBLE`, `MESSAGE_CONVERSION_IMPOSSIBLE`, `soldeProduit` 17, lot technique `coefficientReception` 1, `qualifie` faux, aucun mouvement de qualification ; puis `CONSERVER` à 20 accepté (`qualifie` vrai, `soldeProduit` 17). (b) lot technique 2, vente de 3 boîtes (provisoire, `soldeProduit` -1) : `{ coefficientBoite: 20 }` : 400 `CONVERSION_REQUISE` ; `MULTIPLIER` : 409 `CONVERSION_IMPOSSIBLE`.
6. `quantité trop grande` : lot technique 300000 ; `{ coefficientBoite: 10000, conversionStock: 'MULTIPLIER' }` : 409 `CONVERSION_IMPOSSIBLE`, `MESSAGE_CONVERSION_TROP_GRANDE`, `soldeLot` 300000.
7. `coût du lot technique divisé par le coefficient, jamais exposé` : lot technique 12 de coût 1000 ; `MULTIPLIER` à 3 : lot `coutUnitaire` 333, `coefficientReception` 3, `soldeLot` 36, `cheminsCout(r.data)` vide.
8. `concurrence : vente en attente avant la qualification, aucun interblocage` : lot technique 12, `prixBoite 1000`. `tenirFiche` ; `await tenu` ; lancer `vendre({ lignes: [{ stockId, quantite: 2 }] })` sans attendre ; `attendreAttentes(1)` ; lancer `modifier(stockId, { coefficientBoite: 20, conversionStock: 'MULTIPLIER' })` ; `attendreAttentes(2)` ; `liberer()` ; `Promise.allSettled` des deux : les deux `fulfilled` (aucun 40P01). Vente : ligne `quantite` 2, `coefficientApplique` 1 ; qualification : `conversion.quantiteAvant` 10, `quantiteApres` 200 ; `soldeLot` 200.
9. `concurrence : qualification avant une vente en attente, vente refusée FICHE_MODIFIEE` : lot technique 12. `tenirFiche` ; lancer `modifier(... MULTIPLIER à 20)` ; `attendreAttentes(1)` ; mémoriser `nombreVentes()` et `prochainNumero()` (0 si aucun compteur : utiliser `SELECT COALESCE(max("prochainNumero"), 0)`) ; lancer `vendre({ lignes: [{ stockId, quantite: 2 }] })` ; `attendreAttentes(2)` ; `liberer()`. Qualification `fulfilled` (`soldeLot` 240) ; vente rejetée : `refus` donne 409, `code` `FICHE_MODIFIEE`, `message` `MESSAGE_FICHE_MODIFIEE`, `details` `[{ stockId, nom }]` ; `nombreVentes()` et le compteur inchangés.
10. `PATCH quantité pendant une vente, aucun interblocage` : lot technique 12. Même mécanique que 8 avec `pharmacie.updateStockQuantite(PHARMACIE, stockId, RESPONSABLE, { variation: 5, motif: 'Retour fournisseur' })` en second : les deux aboutissent, `soldeLot` 15.
11. `annulation : vente antérieure à la multiplication refusée, vente postérieure annulable` : lot technique 12 ; vente A de 2 boîtes ; `MULTIPLIER` à 20 (`soldeLot` 200) ; `annuler(A)` : 409 `PIECE_NON_ANNULABLE`, `MESSAGE_VENTE_AVANT_QUALIFICATION`, aucune pièce liée à A, `soldeLot` 200 ; vente B d'une boîte (20 unités, `soldeLot` 180) ; `annuler(B)` : aboutit, `soldeLot` 200. Autre fiche, lot technique 12 : vente C de 2 boîtes, `CONSERVER` à 20, `annuler(C)` aboutit, `soldeLot` 12.
12. `invariants` : `verifierStock(base.client).totalAnomalies` vaut 0.

Les tests 8 à 10 sont rouges avec le code d'avant (interblocage détecté par PostgreSQL au bout d'une seconde, ou vente servie au coefficient 1) : ne pas les affaiblir.

### 12. `test/db/fiche-produit.db-spec.ts` et `test/db/mouvements-stock.db-spec.ts`

Seule modification permise : la ligne de construction devient `new FicheProduitService(prisma, acces, new MouvementsStockService())` dans le premier (l'import existe déjà) et `new FicheProduitService(prisma, acces, <instance de MouvementsStockService déjà créée dans le fichier, sinon new MouvementsStockService()>)` dans le second.

### 13. `CLAUDE.md` du dépôt back

Ajouter, après la puce « Vente recâblée (tranche pharmacie 1, PB11) » et la puce de PB12 si elle existe, une puce « **Qualification d'une fiche (tranche pharmacie 1, PB13)** » qui dit, en une phrase par point : `PATCH .../fiche` accepte `conversionStock` (`MULTIPLIER` ou `CONSERVER`), lu seulement si le coefficient change sur une fiche non qualifiée, obligatoire si elle a du stock (stock calculé, 400 `CONVERSION_REQUISE`) ; `MULTIPLIER` convertit les seuls lots techniques (mouvement `CORRECTION` pièce `QUALIFICATION`, `evenementId` `qualification:<lotId>`, coefficient et coût par unité du lot mis à jour), 409 `CONVERSION_IMPOSSIBLE` si du stock est ailleurs ou provisoire ; toute conversion qualifie la fiche, puis 409 `FICHE_DEJA_QUALIFIEE` ; réponse `conversion` ; verrou de la fiche en `FOR NO KEY UPDATE` ; une vente dont une fiche change de coefficient pendant qu'elle attend reçoit 409 `FICHE_MODIFIEE` ; une vente antérieure à une multiplication n'est plus annulable (409 `PIECE_NON_ANNULABLE`). Corriger dans la puce PB06 la mention « aucune conversion avant PB13 » en « conversion : voir PB13 ».

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (messages en français, actionnables, aucun tiret cadratin ni demi-cadratin nulle part). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Aucune migration, aucun `prisma generate`, jamais `prisma migrate dev`, `migrate reset` ni `db push` sur la base de dev. Ne jamais afficher ni écrire d'URL de base, de mot de passe ni de valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh` (modifié par les fins de ligne seulement). Ne pas commiter (le chef commite). Si une étape se révèle impossible telle qu'écrite (contrainte de base, type Prisma, ordre des verrous), s'arrêter en BLOCKED avec la commande et l'erreur, sans contournement.

Fichiers touchés attendus (et seulement eux) : `src/pharmacie/domaine/qualification.ts` (nouveau), `src/pharmacie/domaine/qualification.spec.ts` (nouveau), `src/pharmacie/stock/mouvements-stock.service.ts`, `src/pharmacie/stock/mouvements-stock.service.spec.ts`, `src/pharmacie/dto/fiche-produit.dto.ts`, `src/pharmacie/fiche-produit.service.ts`, `src/pharmacie/fiche-produit.controller.ts`, `src/pharmacie/fiche-produit.http.spec.ts`, `src/pharmacie/pharmacie.service.ts`, `src/pharmacie/vente.service.ts`, `src/common/filters/codes-erreur.ts`, `src/common/filters/all-exceptions.filter.ts`, `test/db/qualification.db-spec.ts` (nouveau), `test/db/fiche-produit.db-spec.ts`, `test/db/mouvements-stock.db-spec.ts`, `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/pharmacie/domaine/qualification.ts src/pharmacie/domaine/qualification.spec.ts src/pharmacie/stock/mouvements-stock.service.ts src/pharmacie/stock/mouvements-stock.service.spec.ts src/pharmacie/dto/fiche-produit.dto.ts src/pharmacie/fiche-produit.service.ts src/pharmacie/fiche-produit.controller.ts src/pharmacie/fiche-produit.http.spec.ts src/pharmacie/vente.service.ts src/common/filters/codes-erreur.ts src/common/filters/all-exceptions.filter.ts test/db/qualification.db-spec.ts test/db/fiche-produit.db-spec.ts test/db/mouvements-stock.db-spec.ts` : aucune erreur (`pharmacie.service.ts` porte un `eslint-disable` global préexistant : vérifier seulement qu'aucune nouvelle erreur n'apparaît avec `npx eslint src/pharmacie/pharmacie.service.ts`, résultat identique avant et après).
3. `docker compose exec -T backend npm test` : tout vert, dont `qualification.spec.ts` (les 14 cas listés en 2), `mouvements-stock.service.spec.ts`, `fiche-produit.http.spec.ts` (6 tests).
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/qualification.db-spec.ts` (12 tests, 13 avec le test ajouté par le chef, D565), et intouchés et verts `vente.db-spec.ts`, `annulation.db-spec.ts`, `non-regression-lectures.db-spec.ts`, `fiche-produit.db-spec.ts`, `mouvements-stock.db-spec.ts`, `commandes-stock.db-spec.ts`, `schema-derive.db-spec.ts`. Relancer `npx jest --config ./test/db/jest-db.json --runInBand test/db/qualification.db-spec.ts` deux fois de plus : vert les deux fois (concurrence stable).
5. `git status --porcelain` (depuis `back_medconnect`) ne liste que les fichiers de « Fichiers touchés attendus » (plus `docker-entrypoint.sh`, préexistant) ; `git diff --stat -- prisma test/db/instantanes test/db/non-regression-lectures.db-spec.ts test/db/vente.db-spec.ts test/db/annulation.db-spec.ts` est vide ; `git diff -- test/db/fiche-produit.db-spec.ts test/db/mouvements-stock.db-spec.ts` ne change qu'une ligne de construction par fichier.
6. `grep -n "FOR UPDATE" src/pharmacie/fiche-produit.service.ts` : aucune ligne ; `grep -n "FOR NO KEY UPDATE" src/pharmacie/fiche-produit.service.ts src/pharmacie/pharmacie.service.ts` : une ligne par fichier ; `grep -n "existante.quantite" src/pharmacie/fiche-produit.service.ts` : aucune ligne.
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées (`git diff -U0 | grep -P "[\x{2013}\x{2014}]"` vide, et de même sur les trois fichiers nouveaux).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
