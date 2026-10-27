# PB14b - Résolution des allocations provisoires à la réception

Tier: spécifié (codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages de succès lus par les pharmaciens, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Deuxième des trois sous-fiches de PB14 (D566). Prérequis : PB14a validé et commité (`ReceptionsService`, `enregistrerDansTransaction`, `presenterReception`).

Une vente faite sans stock (O11) porte une allocation `PROVISOIRE` sans lot et un mouvement `VENTE` sans lot : l'agrégat produit est juste, mais aucun lot n'a été diminué. Quand une réception apporte du stock sur la fiche, la vente doit être rattachée aux lots (plan, PB14) :

- l'allocation `PROVISOIRE` passe à `REMPLACEE` (pièce de résolution = la réception) ;
- une allocation `DEFINITIVE` par lot pris (FEFO, lots non périmés), au coût du lot, et une allocation `PROVISOIRE` du reste s'il en manque encore ;
- deux mouvements par lot pris, pièce `RESOLUTION` : sortie du lot, contrepartie sans lot ; l'agrégat produit ne bouge pas, les lots descendent.

La tâche corrige aussi l'annulation : elle relit les allocations de la vente d'origine sous les verrous des fiches (sinon une annulation qui attend pendant une résolution annulerait l'allocation provisoire remplacée et laisserait le lot diminué à tort, D578).

**Aucune migration, aucun changement de `prisma/schema.prisma`, aucun `prisma generate`** : `TypePiece.RESOLUTION`, `StatutAllocation.REMPLACEE`, `AllocationLot.remplaceeParPieceId` et le trigger `allocation_lot_proteger` (seule mise à jour permise : `PROVISOIRE` vers `REMPLACEE`, avec `remplaceeParPieceId`) existent (M4, M6). Ne pas toucher aux migrations, aux instantanés, à `test/db/non-regression-lectures.db-spec.ts`, `test/db/vente.db-spec.ts`, `test/db/annulation.db-spec.ts`, `test/db/qualification.db-spec.ts`, `test/db/receptions.db-spec.ts` (ils restent verts tels quels). Jamais `prisma migrate dev`, `migrate reset` ni `db push`.

Décisions applicables : D404, D473, D500, D507, D519, D525, D545, D547, D548, D561, D566, D567, D570, et celles de cette fiche, D576 à D578.

### Contexte vérifié (ne pas re-découvrir)

- Vente provisoire (`VenteService.enregistrerVente`, étapes 13 et 15) : allocation `{ lotId: null, numeroLot: null, dateExpiration: null, quantite: reste (> 0), coutUnitaire: 0, lotTechnique: false, statut: 'PROVISOIRE' }` et mouvement `{ lotId: null, type: 'VENTE', quantite: -reste, pieceOrigineType: 'VENTE', pieceOrigineId: venteId }`. Anomalie `STOCK_NEGATIF` ouverte.
- Pièce d'annulation (PB12) : ses allocations sont opposées (quantités négatives), une provisoire annulée reste `PROVISOIRE` des deux côtés et ne se résout jamais (D548). `lignesInverses` (`src/pharmacie/vente-regles.ts`) ignore les allocations `REMPLACEE` et exige que la somme des autres égale la quantité de la ligne.
- CHECK de `AllocationLot` : `("statut" = 'DEFINITIVE') = ("lotId" IS NOT NULL)`, `("statut" = 'REMPLACEE') = ("remplaceeParPieceId" IS NOT NULL)`, `quantite <> 0`, `coutUnitaire >= 0`. L'insertion d'une allocation sur une ligne existante est permise (aucun trigger d'insertion).
- `MouvementsStockService.ecrire` accepte un mouvement sans lot pour une pièce `RESOLUTION` (`PIECES_SANS_LOT`) ; `RESOLUTION` n'exige pas de motif. `CHECK` d'agrégat lot : jamais négatif (409 `STOCK_LOT_NEGATIF`).
- `lireLotsCandidats(client, pointDeVenteId, ids)` (`src/pharmacie/stock/lecture-stock.ts`) donne les lots à solde positif en `LotCandidat` (`dateExpiration` AAAA-MM-JJ ou null, `dateReception` ISO, `solde`, `coutUnitaire`, `lotTechnique`, `numeroLot`). `comparerFefo` et `estPerime` sont exportés par `src/pharmacie/domaine/selection-lots.ts` ; `exigerEntier` par `src/pharmacie/domaine/quantites.ts`.
- `VenteService.annulerVente` lit l'origine à l'étape « 1. Origine » (`lignes: { include: { allocations: true } }`) AVANT ses verrous, puis « 4. Verrous des fiches », « 4b » (contrôle de qualification, D561) et « 5. Calcul des opposés » sur ces allocations lues avant les verrous.

### 1. `src/pharmacie/domaine/resolution.ts` (nouveau, règles pures, D576)

Sans Nest ni Prisma ni horloge.

```ts
import type { AllocationCalculee, LotCandidat } from './selection-lots';
import { comparerFefo, estPerime } from './selection-lots';
import { exigerEntier } from './quantites';

export interface ProvisoireAResoudre {
  allocationId: string;
  /** Horodatage de création de la vente, ISO 8601. */
  venteCreeLe: string;
  /** Unités minimales en attente, au moins 1. */
  quantite: number;
}

export interface ResolutionPlanifiee {
  allocationId: string;
  /** Lots pris, dans l'ordre FEFO, une entrée par lot (champs du lot recopiés). */
  prises: AllocationCalculee[];
  /** Unités qui restent en attente (0 si tout est couvert). */
  reste: number;
}

/** Plan de résolution des allocations provisoires d'une fiche (D576). */
export function planifierResolution(
  provisoires: readonly ProvisoireAResoudre[],
  lots: readonly LotCandidat[],
  jour: string,
): ResolutionPlanifiee[];
```

Règles, dans cet ordre :

1. Contrôles (RangeError en français sinon) : `exigerEntier(p.quantite, 'quantite', 1)` pour chaque provisoire, `Date.parse(p.venteCreeLe)` non `NaN`, `allocationId` sans doublon ; `exigerEntier(l.solde, 'solde', 0)` et identifiant de lot sans doublon.
2. Lots utilisables : `solde > 0` et `!estPerime(l.dateExpiration, jour)`, triés par `comparerFefo` ; soldes décrémentés en mémoire au fil des prises (aucune entrée n'est modifiée).
3. Provisoires triées par `venteCreeLe` croissant (`Date.parse`), puis `allocationId` croissant (comparaison `<`).
4. Pour chaque provisoire dans cet ordre : prendre sur les lots dans l'ordre FEFO, à hauteur du solde restant de chaque lot, jusqu'à couvrir `quantite` ; une prise = `{ lotId, numeroLot, dateExpiration, quantite, coutUnitaire, lotTechnique }`. Si aucune prise n'est possible (plus de stock utilisable), la provisoire n'apparaît pas dans le résultat et les suivantes non plus. Sinon `{ allocationId, prises, reste: quantite - somme des prises }`.
5. Résultat dans l'ordre de traitement.

### 2. `src/pharmacie/domaine/resolution.spec.ts` (nouveau)

Jour `'2026-10-27'`, aide `lot(id, solde, date, reception = '2026-10-01T00:00:00.000Z', cout = 100)` qui construit un `LotCandidat` (`coefficientReception` 1, `lotTechnique` faux, `numeroLot` = id). Tests exacts :

- `résolution complète sur un lot` : provisoire `{ a1, '2026-10-20T10:00:00.000Z', 2 }`, lot `L1` solde 10 : `toEqual([{ allocationId: 'a1', prises: [{ lotId: 'L1', numeroLot: 'L1', dateExpiration: '2027-06-30', quantite: 2, coutUnitaire: 100, lotTechnique: false }], reste: 0 }])`.
- `résolution partielle` : provisoire 5, lot solde 3 : une prise de 3, `reste` 2.
- `plusieurs lots en FEFO` : provisoire 7, lots `L2` (`'2027-12-31'`, 5) et `L1` (`'2027-01-31'`, 4) : prises `L1` 4 puis `L2` 3.
- `lot sans date d'abord, puis date croissante` : lots `L1` (`'2027-01-31'`, 4) et `L0` (null, 1), provisoire 2 : prises `L0` 1 puis `L1` 1.
- `ventes les plus anciennes d'abord` : provisoires `a2` (`'2026-10-21...'`, 3) et `a1` (`'2026-10-20...'`, 3), lot solde 4 : `a1` couvert (3), `a2` une prise de 1 et `reste` 2.
- `égalité d'horodatage : identifiant croissant` : mêmes `venteCreeLe`, `b` et `a` : `a` traité d'abord.
- `lot périmé jamais pris, le jour même accepté` : lot `LP` daté `'2026-10-26'` solde 10, provisoire 2 : `[]` ; lot daté `'2026-10-27'` : couvert.
- `plus de stock : provisoires suivantes absentes` : provisoires 3 et 2, lot 3 : un seul résultat.
- `aucun lot : résultat vide`.
- `entrées impossibles` : quantité 0, date de vente invalide, doublon d'allocation lèvent `RangeError`.

### 3. `src/pharmacie/stock/resolution-provisoires.ts` (nouveau, D576, D577)

Fonction réutilisable (PB15 et PB18 l'appelleront avec leur propre pièce) :

```ts
import type { Prisma } from 'generated/prisma/client';
import { planifierResolution } from '../domaine/resolution';
import { lireLotsCandidats, jourVersDate } from './lecture-stock';
import type { MouvementsStockService } from './mouvements-stock.service';

export interface ParametresResolution {
  pointDeVenteId: string;
  stockMedicamentIds: readonly string[];
  /** Pièce qui apporte le stock (réception ici) : remplaceeParPieceId et pieceOrigineId. */
  pieceId: string;
  auteurId: string | null;
  /** Jour courant à Conakry, AAAA-MM-JJ. */
  jour: string;
}

export interface ResolutionEcrite {
  allocationId: string;
  venteId: string;
  numeroVente: string;
  stockId: string;
  nom: string;
  quantiteProvisoire: number;
  quantiteResolue: number;
  resteProvisoire: number;
}

/** À appeler sous les verrous consultatifs des fiches (D507), dans la transaction de la pièce. */
export async function resoudreProvisoires(
  tx: Prisma.TransactionClient,
  mouvementsStock: MouvementsStockService,
  p: ParametresResolution,
): Promise<ResolutionEcrite[]>;
```

Déroulé, fiche par fiche dans l'ordre des identifiants triés (`sort()` par défaut) :

1. `await mouvementsStock.verrouillerFiches(tx, [stockId])` (réentrant, sans effet si déjà pris).
2. Provisoires éligibles (D576, D548) :

```ts
tx.allocationLot.findMany({
  where: {
    statut: 'PROVISOIRE',
    quantite: { gt: 0 },
    ligneVente: {
      stockMedicamentId: stockId,
      vente: {
        pointDeVenteId: p.pointDeVenteId,
        typePiece: { in: ['VENTE', 'REGULARISATION'] },
        pieceLiee: { is: null },
      },
    },
  },
  select: {
    id: true,
    quantite: true,
    ligneVenteId: true,
    ligneVente: {
      select: {
        nomMedicament: true,
        vente: { select: { id: true, numero: true, createdAt: true } },
      },
    },
  },
})
```

   Aucune : fiche suivante.
3. Lots : `(await lireLotsCandidats(tx, p.pointDeVenteId, [stockId])).get(stockId) ?? []` ; `plan = planifierResolution(provisoires.map((a) => ({ allocationId: a.id, venteCreeLe: a.ligneVente.vente.createdAt.toISOString(), quantite: a.quantite })), lots, p.jour)`.
4. Pour chaque `r` du plan, dans l'ordre :
   - pour chaque prise `x` : `mouvementsStock.ecrire(tx, { evenementId: \`resolution:${r.allocationId}:${x.lotId}\`, pointDeVenteId, stockMedicamentId: stockId, lotId: x.lotId, type: 'VENTE', quantite: -x.quantite, pieceOrigineType: 'RESOLUTION', pieceOrigineId: p.pieceId, motif: \`Résolution de la vente ${numeroVente}\`, auteurId: p.auteurId })` ;
   - puis la contrepartie : `ecrire(tx, { evenementId: \`resolution:${r.allocationId}:contrepartie\`, ..., lotId: null, type: 'VENTE', quantite: somme des prises, pieceOrigineType: 'RESOLUTION', pieceOrigineId: p.pieceId, motif: <même motif>, auteurId: p.auteurId })` ;
   - `const { count } = await tx.allocationLot.updateMany({ where: { id: r.allocationId, statut: 'PROVISOIRE' }, data: { statut: 'REMPLACEE', remplaceeParPieceId: p.pieceId } })` ; `count !== 1` : `throw new Error(\`Allocation provisoire déjà résolue : ${r.allocationId}.\`)` (impossible sous les verrous, erreur de programmation) ;
   - `tx.allocationLot.createMany({ data: [...prises.map((x) => ({ ligneVenteId, lotId: x.lotId, numeroLot: x.numeroLot, dateExpiration: x.dateExpiration ? jourVersDate(x.dateExpiration) : null, quantite: x.quantite, coutUnitaire: x.coutUnitaire, lotTechnique: x.lotTechnique, statut: 'DEFINITIVE', sortieManuelle: false, motif: null, auteurId: p.auteurId })), ...(r.reste > 0 ? [{ ligneVenteId, lotId: null, numeroLot: null, dateExpiration: null, quantite: r.reste, coutUnitaire: 0, lotTechnique: false, statut: 'PROVISOIRE', sortieManuelle: false, motif: null, auteurId: p.auteurId }] : [])] })` ;
   - résultat `{ allocationId, venteId, numeroVente, stockId, nom: nomMedicament, quantiteProvisoire: a.quantite, quantiteResolue: somme des prises, resteProvisoire: r.reste }`.
5. Les anomalies `STOCK_NEGATIF` ne sont pas modifiées (le titulaire les traite, D577). Aucune notification.

Le mouvement du lot est écrit avant la contrepartie : le solde du lot a été lu sous verrou, il ne peut pas devenir négatif ; l'agrégat produit revient à sa valeur après la contrepartie.

### 4. `src/pharmacie/receptions/receptions.service.ts`

4.1. `ReceptionEcrite` gagne `resolutions: ResolutionEcrite[]` (vide pour un rejeu). Les trois littéraux de `ReceptionEcrite` du fichier en reçoivent `resolutions` : rejeu de l'étape 2 (`[]`), retour de l'étape 14 (`resolutions`) et rejeu de course dans le `catch` de `enregistrer` (`[]`).

4.2. `enregistrerDansTransaction`, entre l'étape 11 (lots) et l'étape 12 (audit) : `const resolutions = await resoudreProvisoires(tx, this.mouvementsStock, { pointDeVenteId, stockMedicamentIds: ids, pieceId: reception.id, auteurId: acces.user.id, jour })` (même `jour` qu'à l'étape 6). L'audit de l'étape 12 gagne `nombreResolutions: resolutions.length` dans `metadata`.

4.3. `presenterReception` gagne `resolutions` relues en base (identiques pour la création, le rejeu et le détail) :
   - allocations `where: { remplaceeParPieceId: receptionId }` avec `ligneVente { stockMedicamentId, nomMedicament, vente { id, numero } }` ;
   - pour chacune, `quantiteResolue` = opposé de la somme des `quantite` des mouvements `where: { pieceOrigineType: 'RESOLUTION', pieceOrigineId: receptionId, lotId: { not: null }, evenementId: { startsWith: \`resolution:${allocationId}:\` } }` ;
   - élément `{ allocationId, venteId, numeroVente, stockId, nom, quantiteProvisoire, quantiteResolue, resteProvisoire: quantiteProvisoire - quantiteResolue }`, trié par `numeroVente` (`<`) puis `allocationId`.

4.4. Message de création (`enregistrer`) : si `resolutions.length > 0`, ajouter à `messageReceptionEnregistree(n)` la phrase ` ${MESSAGE_VENTES_RATTACHEES}` avec la constante exportée :

```ts
export const MESSAGE_VENTES_RATTACHEES =
  'Les ventes faites en attente de ce stock ont été rattachées aux lots reçus.';
```

4.5. Description Swagger de `POST receptions` (`receptions.controller.ts`) : ajouter à la fin `" Les ventes faites sans stock sur ces médicaments sont rattachées aux lots (FEFO, lots non périmés) : allocation provisoire remplacée, mouvements de pièce RESOLUTION, réponse resolutions."`.

### 5. `src/pharmacie/vente.service.ts` (D578)

Dans `annulerVente`, juste après « 4. Verrous des fiches » et avant « 4b » :

```ts
        // 4a. Allocations relues sous les verrous des fiches : une réception a pu résoudre une provisoire (D578)
        const allocationsRelues = await tx.allocationLot.findMany({
          where: { ligneVenteId: { in: origine.lignes.map((l) => l.id) } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        const lignesOrigine = origine.lignes.map((l) => ({
          ...l,
          allocations: allocationsRelues.filter((a) => a.ligneVenteId === l.id),
        }));
```

Puis remplacer `origine.lignes` par `lignesOrigine` dans « 4b » (`lotsAlloues`) et dans « 5 » (`lignesInverses(lignesOrigine)`). Aucun autre changement (ordre des verrous D545 inchangé).

### 6. `test/db/resolution.db-spec.ts` (nouveau)

Préparation copiée de `test/db/receptions.db-spec.ts` (mêmes doublures et services, plus les aides `annuler(venteId)` de `annulation.db-spec.ts`), `describe('Résolution des allocations provisoires, sur base de test (PB14b)')`. Aides supplémentaires : `allocations(venteId)` = `SELECT a."statut"::text AS "statut", a."quantite", a."lotId", a."coutUnitaire", a."remplaceeParPieceId" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."venteId" = $1 ORDER BY a."createdAt", a."id"` ; `mouvementsResolution(receptionId)` = `SELECT "type"::text AS "type", "quantite", "lotId", "evenementId", "motif" FROM "MouvementStock" WHERE "pieceOrigineType" = 'RESOLUTION' AND "pieceOrigineId" = $1 ORDER BY "horodatageServeur", "evenementId"` ; `sommeLots(stockId)` = somme des `AgregatStockLot.quantite` de la fiche. Comme dans PB14a, une « réception de N » est `recevoir({ lignes: [{ stockId, nombreBoites: N, dateExpiration: jour(300) }] })` sauf mention contraire, et une « vente de N sans stock » vise une fiche coef 1 qualifiée, `prixBoite` 1000, sans lot.

Tests (noms et assertions exacts) :

1. `résolution complète : provisoire remplacée, allocation définitive au coût du lot, pièce RESOLUTION, agrégats cohérents` : fiche coef 1 qualifiée, `prixBoite` 1000, sans stock ; vente V de 2 boîtes (provisoire, `soldeProduit` -2) ; réception de 10 boîtes à 700 (`jour(200)`) : `data.resolutions` `[{ allocationId, venteId: V, numeroVente, stockId, nom, quantiteProvisoire: 2, quantiteResolue: 2, resteProvisoire: 0 }]`, `message` = `messageReceptionEnregistree(1) + ' ' + MESSAGE_VENTES_RATTACHEES` ; `allocations(V)` : `[{ statut: 'REMPLACEE', quantite: 2, lotId: null, remplaceeParPieceId: <receptionId> }, { statut: 'DEFINITIVE', quantite: 2, lotId: <lot>, coutUnitaire: 700 }]` (champs vérifiés par `toMatchObject`) ; `mouvementsResolution` : `{ type: 'VENTE', quantite: -2, lotId: <lot>, evenementId: 'resolution:<a>:<lot>', motif: 'Résolution de la vente <numero>' }` et `{ type: 'VENTE', quantite: 2, lotId: null, evenementId: 'resolution:<a>:contrepartie' }` ; `soldeLot` 8, `soldeProduit` 8, `sommeLots` 8 ; `service.detailVente` de V : `provisoire` faux ; l'anomalie `STOCK_NEGATIF` de V reste `OUVERTE`.
2. `résolution partielle puis seconde réception qui termine` : vente de 5 sans stock ; réception de 3 : `resteProvisoire` 2, allocations `REMPLACEE` 5, `DEFINITIVE` 3, `PROVISOIRE` 2 ; `soldeProduit` -2, `sommeLots` 0 ; seconde réception de 10 : une résolution de la provisoire de 2 (`quantiteResolue` 2), allocations de V : `REMPLACEE` 5, `DEFINITIVE` 3, `REMPLACEE` 2, `DEFINITIVE` 2 ; `soldeProduit` 8, `sommeLots` 8.
3. `ordre : ventes les plus anciennes d'abord, lots en FEFO, lot périmé jamais pris` : fiche sans stock ; ventes V1 (3) puis V2 (3) ; réception de deux lignes : 2 boîtes `jour(300)` et 2 boîtes `jour(100)` : V1 couverte par le lot `jour(100)` (2) puis le lot `jour(300)` (1), V2 une prise de 1 et `resteProvisoire` 2. Autre fiche sans stock : vente W de 2 (provisoire) ; lot périmé E de 5 unités créé directement par `prisma.$transaction((tx) => mouvements.creerLot(tx, { ..., numeroLot: 'E', dateExpiration: jourVersDate(jour(-1)), quantite: 5, coutUnitaire: 0, coutAchatBoite: null, coefficientReception: 1, fournisseurId: null, receptionId: null, lotTechnique: false, auteurId: RESPONSABLE, pieceOrigineType: 'AJUSTEMENT', pieceOrigineId: null, motif: 'Lot périmé du test' }))` (aucune résolution hors réception) ; réception d'une boîte datée `jour(0)` : W une prise de 1 sur ce lot (le jour même est vendable), `resteProvisoire` 1, `soldeLot(E)` toujours 5.
4. `ventes annulées et pièces d'annulation jamais résolues (D548)` : vente V de 2 sans stock, `annuler(V)` ; réception de 10 : `data.resolutions` `[]` ; allocations de V et de sa pièce toujours `PROVISOIRE` ; `soldeProduit` 10, `sommeLots` 10.
5. `vente résolue puis annulée : stock rendu au lot de la résolution` : vente de 2 sans stock, réception de 10 (résolue, lot à 8) ; `annuler(V)` aboutit ; allocations de la pièce : une `DEFINITIVE` de -2 sur le lot ; `soldeLot` 10, `soldeProduit` 10, `sommeLots` 10.
6. `détail de la réception : résolutions relues, coûts masqués` : après le scénario du test 1, `receptions.detail(PHARMACIE, RESPONSABLE, receptionId)` : `data.resolutions` égal à celui de la création ; `detail(PHARMACIE, VENDEUR, ...)` : `cheminsCout(r.data)` vide.
7. `concurrence : vente provisoire en attente puis réception, la réception la résout` : fiche sans stock ; `tenirFiche` ; lancer `vendre` de 2 ; `attendreAttentes(1)` ; lancer `recevoir` de 10 ; `attendreAttentes(2)` ; `liberer()` : les deux `fulfilled` ; la réception a une résolution de 2 ; `soldeLot` 8, `soldeProduit` 8, `sommeLots` 8.
8. `concurrence : réception en attente puis annulation, l'annulation relit les allocations` : vente V de 2 sans stock ; `tenirFiche` ; lancer `recevoir` de 10 ; `attendreAttentes(1)` ; lancer `annuler(V)` ; `attendreAttentes(2)` ; `liberer()` : les deux `fulfilled` (aucun 40P01) ; la réception a résolu V ; la pièce d'annulation a une allocation `DEFINITIVE` de -2 sur le lot et aucune `PROVISOIRE` ; `soldeLot` 10, `soldeProduit` 10, `sommeLots` 10. Ce test est rouge sans le correctif 5 (lot à 8) : ne pas l'affaiblir.
9. `invariants` : `verifierStock(base.client).totalAnomalies` vaut 0.

Les tests 7 et 8 doivent rester verts sur trois exécutions consécutives.

### 7. `CLAUDE.md` du dépôt back

Compléter la puce PB14a : remplacer « Résolution des ventes en attente de stock : PB14b. » par : « Une réception rattache aux lots reçus les ventes faites sans stock sur ces médicaments (PB14b) : ventes les plus anciennes d'abord, lots non périmés en FEFO, allocation `PROVISOIRE` passée à `REMPLACEE` (`remplaceeParPieceId` = réception), allocation `DEFINITIVE` au coût du lot et `PROVISOIRE` du reste, deux mouvements `VENTE` de pièce `RESOLUTION` (sortie du lot, contrepartie sans lot, `evenementId` `resolution:<allocation>:<lot>` et `resolution:<allocation>:contrepartie`) ; jamais pour une vente annulée ni une pièce d'annulation ; réponse `resolutions` ; l'annulation relit les allocations sous les verrous des fiches. »

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (messages en français, actionnables, aucun tiret cadratin ni demi-cadratin nulle part). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Aucune migration, aucun `prisma generate`, jamais `prisma migrate dev`, `migrate reset` ni `db push` sur la base de dev. Ne jamais afficher ni écrire d'URL de base, de mot de passe ni de valeur de `.env`. Ne pas toucher à `docker-entrypoint.sh`. Ne pas commiter (le chef commite). Si une étape se révèle impossible telle qu'écrite (contrainte de base, trigger, type Prisma, ordre des verrous), s'arrêter en BLOCKED avec la commande et l'erreur, sans contournement.

Fichiers touchés attendus (et seulement eux) : `src/pharmacie/domaine/resolution.ts` (nouveau), `src/pharmacie/domaine/resolution.spec.ts` (nouveau), `src/pharmacie/stock/resolution-provisoires.ts` (nouveau), `src/pharmacie/receptions/receptions.service.ts`, `src/pharmacie/receptions/receptions.controller.ts`, `src/pharmacie/vente.service.ts`, `test/db/resolution.db-spec.ts` (nouveau), `CLAUDE.md`.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
2. `docker compose exec -T backend npx eslint src/pharmacie/domaine/resolution.ts src/pharmacie/domaine/resolution.spec.ts src/pharmacie/stock/resolution-provisoires.ts src/pharmacie/receptions/receptions.service.ts src/pharmacie/receptions/receptions.controller.ts src/pharmacie/vente.service.ts test/db/resolution.db-spec.ts` : aucune erreur.
3. `docker compose exec -T backend npm test` : tout vert, dont `resolution.spec.ts` (les 10 cas listés en 2).
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `test/db/resolution.db-spec.ts` (9 tests), et intouchés et verts `receptions.db-spec.ts`, `vente.db-spec.ts`, `annulation.db-spec.ts`, `qualification.db-spec.ts`, `non-regression-lectures.db-spec.ts`, `commandes-stock.db-spec.ts`, `schema-derive.db-spec.ts`. Relancer `docker compose exec -T backend npx jest --config ./test/db/jest-db.json --runInBand test/db/resolution.db-spec.ts` deux fois de plus : vert les deux fois.
5. `git status --porcelain` (depuis `back_medconnect`) ne liste que les fichiers de « Fichiers touchés attendus » (plus `docker-entrypoint.sh`) ; `git diff --stat -- prisma test/db/instantanes test/db/vente.db-spec.ts test/db/annulation.db-spec.ts test/db/receptions.db-spec.ts` est vide.
6. `git diff src/pharmacie/vente.service.ts` ne touche que `annulerVente` (bloc 4a et deux remplacements de `origine.lignes`).
7. Aucun caractère U+2014 ni U+2013 dans les lignes ajoutées (`git diff -U0 | grep -P "[\x{2013}\x{2014}]"` vide, et de même sur les fichiers nouveaux).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->

docker compose exec -T backend npx tsc --noEmit, eslint (7 fichiers), npm test, npm run test:db | 0 erreur, 0 erreur, 83 suites et 948 tests, 20 suites et 227 tests | commit « feat(pharmacie): résolution des allocations provisoires à la réception (PB14b) » (rapports/PB14b-chef.md)
