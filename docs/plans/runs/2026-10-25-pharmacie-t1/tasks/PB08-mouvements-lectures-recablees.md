# PB08 - Service de mouvements et lectures recâblées

Tier: dur (codeur Sonnet selon l'arbitrage A2 ; fiche très détaillée, aucune décision laissée ouverte)
Audience: mixte (API dev ; messages d'erreur et notifications lus par les pharmaciens, non-dev)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Deuxième pas du jalon J2 (PB07 à PB13, indissociables, D445). Depuis PB07 le compteur `StockMedicament.quantite` est gelé et le stock vit dans le journal `MouvementStock` et ses agrégats. Cette tâche :

1. crée `MouvementsStockService`, **seul écrivain** du journal, des lots et des conditionnements ouverts : verrous consultatifs triés, maintien de `ConditionnementOuvert`, 409 `CONDITIONNEMENT_DEJA_OUVERT`, 409 `STOCK_LOT_NEGATIF` ;
2. recâble les lectures sur les agrégats : `getStockPharmacie` (contrat du plan 1.7 conservé), ses alertes (seuil des paramètres, en boîtes, A4), la recherche publique et le détail catalogue (quantité vendable, D426) ;
3. recâble les écritures hors vente : upsert, `PATCH .../quantite` (lot, motif), `DELETE` de stock en archivage, refus de suppression d'un médicament utilisé ;
4. garde les instantanés de PB02 identiques sur la base migrée, sauf les divergences attendues de D460, traitées par exceptions nommées (D506), **jamais par régénération**.

**Aucune migration, aucun changement de `prisma/schema.prisma`.** Ne pas toucher à la vente (`vente.service.ts`, PB11), à l'annulation (PB12), à l'import Excel du stock (`apercuImportStock`, `importerStock`, `lireQuantitesEnStock`, `calculerQuantitesImport` : PB14 et PB15), au jeu démo, ni à `prisma/seed_medicaments.ts` : ces chemins écrivent encore le compteur gelé et échouent sur une base migrée, c'est attendu (D505, D512).

Décisions qui encadrent la tâche (lire par grep dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D404, D405, D416, D418, D426, D430, D433, D458 à D462, D466, D473, D476, D483, D486, D491, D493, D494, D498, D499, D500, D505 à D513. Arbitrages A3 (date de péremption obligatoire à la réception sauf « sans péremption ») et A4 (stock bas en boîtes) de `CORRECTIONS-PORTEUR.md` priment sur le plan.

### Contexte vérifié (ne pas re-découvrir)

- Tables de PB07 (`prisma/schema.prisma`, M4 `20261026120000_pharmacie_t1_lots_mouvements`) : `LotStock` (`coefficientReception`, `coutUnitaire`, `dateExpiration @db.Date`, `dateReception`, `lotTechnique`, `numeroLot`, relation `agregat AgregatStockLot?`), `MouvementStock` (`evenementId` unique, `lotId` nullable, `type TypeMouvementStock`, `quantite` signée, `pieceOrigineType TypePiece`, `pieceOrigineId`, `motif`, `auteurId`), `AgregatStockLot` (PK `lotId`, CHECK `AgregatStockLot_quantite_check` >= 0), `AgregatStockProduit` (`@@id([stockMedicamentId, pointDeVenteId])`, clé Prisma `stockMedicamentId_pointDeVenteId`, peut être négatif), `ConditionnementOuvert` (index unique partiel `WHERE "fermeLe" IS NULL` sur fiche, lot, point de vente ; CHECK `unitesParConditionnement >= 2`). Les agrégats sont tenus **uniquement** par le trigger `mouvement_stock_agreger` : ne jamais les écrire. `MouvementStock` est immuable (trigger). `LotStock` : seule `dateExpiration` se modifie après insertion. Le trigger `stock_medicament_geler_compteur` refuse tout UPDATE qui change `quantite` ou `disponible` et tout INSERT avec `quantite <> 0`.
- Constats du chef sur la base de dev (transactions annulées, rien d'écrit) :
  - `tx.$queryRaw` sur `SELECT pg_advisory_xact_lock(...)` échoue (« Failed to deserialize column of type 'void' ») ; `tx.$executeRaw` du même texte réussit. Utiliser **`$executeRaw`**.
  - Un mouvement qui rend un lot négatif via `tx.mouvementStock.create` lève une erreur `name === 'DriverAdapterError'` dont `cause.originalMessage` (et `message`) contient `AgregatStockLot_quantite_check`, `cause.code === '23514'`.
  - Une seconde ouverture via `tx.conditionnementOuvert.create` lève `PrismaClientKnownRequestError` `code === 'P2002'`, `meta.modelName === 'ConditionnementOuvert'`.
  - Après une erreur de requête dans une transaction interactive, la transaction est perdue : toujours relancer (traduite ou non), ne jamais continuer à écrire.
- Domaine pur existant (PB04, ne pas modifier) : `reliquatLot(solde, coefficientReception)`, `etatStock(quantiteUm, coefficientBoite, seuilBoites)` (`'RUPTURE' | 'BAS' | 'NORMAL'`) dans `src/pharmacie/domaine/quantites.ts` ; `LotCandidat`, `comparerFefo`, `ordonnerLotsPourVente(lots, jour)` dans `src/pharmacie/domaine/selection-lots.ts` (`dateExpiration` `AAAA-MM-JJ` ou `null`, `dateReception` ISO, lots éligibles = solde > 0 et non périmés, reliquats d'abord puis FEFO) ; `avertissementEcartPrix(prixBoite, prixUnite, coefficientBoite, seuilPct)` dans `src/pharmacie/domaine/prix.ts`. `jourConakry(d: Date): string` est exporté par `src/pharmacie/vente.service.ts`.
- `masquerCouts(donnees, peutVoirMarge)` et `cheminsCout(donnees)` : `src/pharmacie/masquer-couts.ts` (D466 ; les objets renvoyés par Prisma et les spreads sont des objets simples, les `Date` sont conservées). `PERMISSIONS.MARGE_READ` = `'marge:read'` (`src/common/rbac/permissions.constants.ts`). `PermissionsService` (`src/common/rbac/permissions.service.ts`, module global) expose `getUserPermissions(userId): Promise<string[]>`.
- `AccesPharmacieService.verifier(structureId, userId)` renvoie `{ user: { id, nom, prenom, structureId }, structure: { id, nom, type, adminId, isActive, ... } }`. `assurerPointDeVente(tx, { id, nom })` (`src/pharmacie/point-de-vente.ts`) renvoie `{ pointDeVente, parametres }` mais fait des upserts (dont `CompteurTicket`) : ne l'appeler que si le point de vente ou les paramètres manquent (D507).
- Erreurs à code : `throw new ConflictException({ message, code: 'LOT_REQUIS' })` (modèle : `fiche-produit.service.ts`) ; le filtre lit `code` s'il figure dans `CODES_ERREUR` (`src/common/filters/codes-erreur.ts`). Aucun des nouveaux codes ne porte `details`.
- `src/pharmacie/pharmacie.service.ts` porte déjà `/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */` : le garder. `src/pharmacie/pharmacie.controller.ts` a 7 avertissements `no-unsafe-argument` préexistants (0 erreur) : ne pas en ajouter.
- Jeu `chargerFormatActuel` (`test/db/fixtures/format-actuel.ts`) : `aujourdhui` = minuit UTC du jour (J) ; fiche d'indice i (0 à 39) : `id = stk-<i+1 sur 2 chiffres>`, `quantite = [0, 1, 9, 10, 11, 240][i % 6]`, `dateExpiration = [J-30, J, J+180, null][i % 4]`, `prixUnitaire = [1500, null, 2500, 0, 12000][i % 5]` ; `stk-01` à `stk-20` dans `str-pharma-1` (médicaments `med-01` à `med-20`), `stk-21` à `stk-35` dans `str-pharma-2` (`med-01` à `med-15`), `stk-36` à `stk-40` dans `str-pharma-3` (non configurée). Utilisateurs : `usr-admin-p1` (administrateur de `str-pharma-1`), `usr-pharm-p1` (pharmacien de `str-pharma-1`), `usr-admin-p2`, `usr-pharm-p2`, `usr-admin-p3`, `usr-admin-h1` (hôpital). M2 a créé pour chaque pharmacie un point de vente d'ordre 1 et des `ParametresPharmacie` (`seuilStockBas` 10, `seuilAvertissementPrixPct` 25) ; M4 un lot technique (coût 0, coefficient 1, date de la fiche) et un mouvement `RECEPTION` pièce `MIGRATION` par fiche à quantité positive. Ventes du jeu : lignes sur `stk-03`, `stk-11`, `stk-15`, `stk-16`, `stk-26`, `stk-35` (médicaments `med-03`, `med-06`, `med-11`, `med-15`, `med-16`).
- Instantanés PB02 (`test/db/instantanes/*.json`) : dates normalisées `J+0j 00:00:00.000`, `J-30j 00:00:00.000`, `J+180j 00:00:00.000` ; messages de la recherche au format `29 résultat(s) pour "undefined"`. **Ne jamais modifier ces fichiers, ne jamais lancer `MAJ_INSTANTANES=1`.**

### 1. Codes d'erreur (`src/common/filters/codes-erreur.ts`)

Ajouter à la fin de `CODES_ERREUR`, avant `] as const;`, dans cet ordre, chacun précédé de son commentaire :

```ts
  // Plusieurs lots (ou aucun) : préciser le lot ou faire un inventaire (409).
  'LOT_REQUIS',
  // Correction ou sortie qui rendrait un lot négatif (409).
  'STOCK_LOT_NEGATIF',
  // Une boîte de ce lot est déjà entamée dans ce point de vente (409).
  'CONDITIONNEMENT_DEJA_OUVERT',
  // Motif obligatoire absent ou trop court (400).
  'MOTIF_REQUIS',
  // Date de péremption obligatoire pour créer un lot, sauf « sans péremption » (400).
  'DATE_PEREMPTION_REQUISE',
  // Médicament du catalogue déjà utilisé par un lot, un mouvement ou une vente (409).
  'MEDICAMENT_UTILISE',
```

Ne pas toucher à `CODES_AVEC_DETAILS`.

### 2. Traduction des erreurs de base (`src/pharmacie/stock/erreurs-base.ts`, nouveau)

```ts
/**
 * Reconnaissance des erreurs PostgreSQL remontées par Prisma et l'adaptateur pg
 * (D507). Formes constatées : CHECK violé dans un trigger = DriverAdapterError
 * dont `cause.originalMessage` nomme la contrainte ; index unique = P2002 avec
 * `meta.modelName` ; clé étrangère = P2003 ou code PostgreSQL 23503.
 */
function texte(valeur: unknown): string {
  if (typeof valeur === 'string') return valeur;
  try {
    return JSON.stringify(valeur ?? null) ?? '';
  } catch {
    return '';
  }
}

function textesErreur(erreur: unknown): string[] {
  if (typeof erreur !== 'object' || erreur === null) return [];
  const e = erreur as { message?: unknown; cause?: unknown; meta?: unknown };
  return [texte(e.message), texte(e.cause), texte(e.meta)];
}

/** Vrai si l'erreur nomme cette contrainte (CHECK, unique, clé étrangère). */
export function violeContrainte(erreur: unknown, contrainte: string): boolean {
  return textesErreur(erreur).some((t) => t.includes(contrainte));
}

/** Vrai pour un conflit d'unicité Prisma (P2002) sur ce modèle. */
export function estDoublonSur(erreur: unknown, modele: string): boolean {
  if (typeof erreur !== 'object' || erreur === null) return false;
  const e = erreur as { code?: unknown; meta?: { modelName?: unknown } };
  return e.code === 'P2002' && e.meta?.modelName === modele;
}

/** Vrai pour une clé étrangère violée (P2003 ou code PostgreSQL 23503). */
export function estCleEtrangereViolee(erreur: unknown): boolean {
  if (typeof erreur !== 'object' || erreur === null) return false;
  if ((erreur as { code?: unknown }).code === 'P2003') return true;
  return textesErreur(erreur).some((t) => t.includes('"23503"'));
}
```

### 3. `MouvementsStockService` (`src/pharmacie/stock/mouvements-stock.service.ts`, nouveau)

Texte à reprendre tel quel (commentaires compris) :

```ts
import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  ConditionnementOuvert,
  LotStock,
  MouvementStock,
  Prisma,
} from 'generated/prisma/client';
import type { TypeMouvementStock, TypePiece } from 'generated/prisma/enums';
import { reliquatLot } from '../domaine/quantites';
import { estDoublonSur, violeContrainte } from './erreurs-base';

export const MESSAGE_CONDITIONNEMENT_DEJA_OUVERT =
  "Une boîte de ce lot est déjà entamée : terminez-la avant d'en ouvrir une autre.";
export const MESSAGE_STOCK_LOT_INSUFFISANT =
  "Ce lot n'a pas assez de stock pour cette sortie.";

/** Pièces qui peuvent porter un mouvement sans lot (stock négatif provisoire, O11, D404). */
export const PIECES_SANS_LOT: readonly TypePiece[] = [
  'VENTE',
  'ANNULATION',
  'RESOLUTION',
];
/** Pièces dont le motif est obligatoire. */
export const PIECES_AVEC_MOTIF: readonly TypePiece[] = [
  'SORTIE_MANUELLE',
  'AJUSTEMENT',
];

export interface MouvementAEcrire {
  /** Identifiant stable (UUID client hors ligne) ; UUID serveur par défaut. */
  evenementId?: string;
  pointDeVenteId: string;
  stockMedicamentId: string;
  lotId: string | null;
  type: TypeMouvementStock;
  /** Signée, en unités minimales ; nulle seulement pour un INVENTAIRE (D417). */
  quantite: number;
  pieceOrigineType: TypePiece;
  pieceOrigineId?: string | null;
  motif?: string | null;
  auteurId?: string | null;
  horodatageLocal?: Date | null;
  posteId?: string | null;
  sequencePoste?: number | null;
}

export interface MouvementEcrit {
  mouvement: MouvementStock;
  /** Solde du lot après le mouvement, null pour un mouvement sans lot. */
  soldeLot: number | null;
  /** Agrégat produit du point de vente après le mouvement. */
  soldeProduit: number;
}

export interface NouveauLot {
  stockMedicamentId: string;
  pointDeVenteId: string;
  numeroLot: string | null;
  dateExpiration: Date | null;
  /** Quantité reçue en unités minimales, au moins 1. */
  quantite: number;
  coutUnitaire: number;
  coutAchatBoite: number | null;
  coefficientReception: number;
  fournisseurId: string | null;
  receptionId: string | null;
  lotTechnique: boolean;
  auteurId: string | null;
  pieceOrigineType: TypePiece;
  pieceOrigineId: string | null;
  motif: string | null;
  evenementId?: string;
  dateReception?: Date;
}

export interface OuvertureConditionnement {
  stockMedicamentId: string;
  lotId: string;
  pointDeVenteId: string;
  unitesParConditionnement: number;
  ouvertParId: string | null;
  ouvertParPieceId: string | null;
}

/** Clé du verrou consultatif d'une fiche (D433, D507). */
export function cleVerrouFiche(stockMedicamentId: string): string {
  return `medconnecte:stock:${stockMedicamentId}`;
}

/** Contrôles de programmation : une entrée impossible lève une RangeError (le service appelant filtre avant). */
export function validerMouvement(m: MouvementAEcrire): void {
  if (!Number.isInteger(m.quantite)) {
    throw new RangeError(
      `La quantité d'un mouvement doit être un entier (reçu : ${m.quantite}).`,
    );
  }
  if (m.quantite === 0 && m.type !== 'INVENTAIRE') {
    throw new RangeError(`Un mouvement ${m.type} ne peut pas être nul.`);
  }
  if (m.lotId === null && !PIECES_SANS_LOT.includes(m.pieceOrigineType)) {
    throw new RangeError(
      `Un mouvement sans lot n'est permis que pour une vente, une annulation ou une résolution (reçu : ${m.pieceOrigineType}).`,
    );
  }
  if (
    PIECES_AVEC_MOTIF.includes(m.pieceOrigineType) &&
    !(m.motif ?? '').trim()
  ) {
    throw new RangeError(
      `Le motif est obligatoire pour une pièce ${m.pieceOrigineType}.`,
    );
  }
}

export function validerNouveauLot(l: NouveauLot): void {
  const entiers: Array<[string, number, number]> = [
    ['quantite', l.quantite, 1],
    ['coutUnitaire', l.coutUnitaire, 0],
    ['coefficientReception', l.coefficientReception, 1],
  ];
  for (const [champ, valeur, minimum] of entiers) {
    if (!Number.isInteger(valeur) || valeur < minimum) {
      throw new RangeError(`Lot invalide : ${champ} (reçu : ${valeur}).`);
    }
  }
}

/**
 * Seul écrivain du journal de stock, des lots et des conditionnements ouverts
 * (D401, D500, D507). Chaque méthode s'exécute dans la transaction de l'appelant.
 * Ordre des verrous : verrou de ligne de la fiche (s'il est pris) puis verrou
 * consultatif ; un écrivain multi fiches verrouille toutes ses fiches d'abord.
 */
@Injectable()
export class MouvementsStockService {
  /** Verrous consultatifs de transaction, identifiants dédoublonnés et triés (pas d'interblocage). */
  async verrouillerFiches(
    tx: Prisma.TransactionClient,
    stockMedicamentIds: readonly string[],
  ): Promise<void> {
    const tries = [...new Set(stockMedicamentIds)].sort();
    for (const id of tries) {
      // $executeRaw : $queryRaw ne sait pas lire la colonne void renvoyée (D507)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cleVerrouFiche(id)}, 0))`;
    }
  }

  /** Écrit un mouvement (agrégats tenus par trigger) puis maintient le conditionnement ouvert du lot. */
  async ecrire(
    tx: Prisma.TransactionClient,
    m: MouvementAEcrire,
  ): Promise<MouvementEcrit> {
    validerMouvement(m);
    await this.verrouillerFiches(tx, [m.stockMedicamentId]);

    let mouvement: MouvementStock;
    try {
      mouvement = await tx.mouvementStock.create({
        data: {
          evenementId: m.evenementId ?? randomUUID(),
          pointDeVenteId: m.pointDeVenteId,
          stockMedicamentId: m.stockMedicamentId,
          lotId: m.lotId,
          type: m.type,
          quantite: m.quantite,
          pieceOrigineType: m.pieceOrigineType,
          pieceOrigineId: m.pieceOrigineId ?? null,
          motif: m.motif?.trim() ? m.motif.trim() : null,
          auteurId: m.auteurId ?? null,
          horodatageLocal: m.horodatageLocal ?? null,
          posteId: m.posteId ?? null,
          sequencePoste: m.sequencePoste ?? null,
        },
      });
    } catch (erreur) {
      if (violeContrainte(erreur, 'AgregatStockLot_quantite_check')) {
        throw new ConflictException({
          message: MESSAGE_STOCK_LOT_INSUFFISANT,
          code: 'STOCK_LOT_NEGATIF',
        });
      }
      throw erreur;
    }

    let soldeLot: number | null = null;
    if (m.lotId !== null) {
      const lot = await tx.lotStock.findUniqueOrThrow({
        where: { id: m.lotId },
        select: { coefficientReception: true },
      });
      const agregat = await tx.agregatStockLot.findUniqueOrThrow({
        where: { lotId: m.lotId },
        select: { quantite: true },
      });
      soldeLot = agregat.quantite;
      await this.maintenirConditionnement(tx, {
        stockMedicamentId: m.stockMedicamentId,
        lotId: m.lotId,
        pointDeVenteId: m.pointDeVenteId,
        coefficientReception: lot.coefficientReception,
        soldeLot,
        auteurId: mouvement.auteurId,
        pieceOrigineId: mouvement.pieceOrigineId,
      });
    }

    const produit = await tx.agregatStockProduit.findUniqueOrThrow({
      where: {
        stockMedicamentId_pointDeVenteId: {
          stockMedicamentId: m.stockMedicamentId,
          pointDeVenteId: m.pointDeVenteId,
        },
      },
      select: { quantite: true },
    });
    return { mouvement, soldeLot, soldeProduit: produit.quantite };
  }

  /** Crée un lot et son premier mouvement RECEPTION dans la même transaction (D500). */
  async creerLot(
    tx: Prisma.TransactionClient,
    l: NouveauLot,
  ): Promise<{ lot: LotStock; reception: MouvementEcrit }> {
    validerNouveauLot(l);
    await this.verrouillerFiches(tx, [l.stockMedicamentId]);
    const lot = await tx.lotStock.create({
      data: {
        stockMedicamentId: l.stockMedicamentId,
        pointDeVenteId: l.pointDeVenteId,
        numeroLot: l.numeroLot,
        dateExpiration: l.dateExpiration,
        quantiteRecue: l.quantite,
        coutUnitaire: l.coutUnitaire,
        coutAchatBoite: l.coutAchatBoite,
        coefficientReception: l.coefficientReception,
        fournisseurId: l.fournisseurId,
        receptionId: l.receptionId,
        dateReception: l.dateReception ?? new Date(),
        lotTechnique: l.lotTechnique,
        auteurId: l.auteurId,
      },
    });
    const reception = await this.ecrire(tx, {
      evenementId: l.evenementId,
      pointDeVenteId: l.pointDeVenteId,
      stockMedicamentId: l.stockMedicamentId,
      lotId: lot.id,
      type: 'RECEPTION',
      quantite: l.quantite,
      pieceOrigineType: l.pieceOrigineType,
      pieceOrigineId: l.pieceOrigineId,
      motif: l.motif,
      auteurId: l.auteurId,
    });
    return { lot, reception };
  }

  /** Ouvre un conditionnement ; une seconde ouverture du même lot est refusée par l'index partiel (CA6). */
  async ouvrirConditionnement(
    tx: Prisma.TransactionClient,
    o: OuvertureConditionnement,
  ): Promise<ConditionnementOuvert> {
    await this.verrouillerFiches(tx, [o.stockMedicamentId]);
    try {
      return await tx.conditionnementOuvert.create({
        data: {
          stockMedicamentId: o.stockMedicamentId,
          lotId: o.lotId,
          pointDeVenteId: o.pointDeVenteId,
          unitesParConditionnement: o.unitesParConditionnement,
          ouvertParId: o.ouvertParId,
          ouvertParPieceId: o.ouvertParPieceId,
        },
      });
    } catch (erreur) {
      if (estDoublonSur(erreur, 'ConditionnementOuvert')) {
        throw new ConflictException({
          message: MESSAGE_CONDITIONNEMENT_DEJA_OUVERT,
          code: 'CONDITIONNEMENT_DEJA_OUVERT',
        });
      }
      throw erreur;
    }
  }

  /** La ligne ouverte existe si et seulement si le reliquat dérivé du lot est non nul (D405). */
  private async maintenirConditionnement(
    tx: Prisma.TransactionClient,
    e: {
      stockMedicamentId: string;
      lotId: string;
      pointDeVenteId: string;
      coefficientReception: number;
      soldeLot: number;
      auteurId: string | null;
      pieceOrigineId: string | null;
    },
  ): Promise<void> {
    const reliquat = reliquatLot(e.soldeLot, e.coefficientReception);
    let ouvert = await tx.conditionnementOuvert.findFirst({
      where: {
        stockMedicamentId: e.stockMedicamentId,
        lotId: e.lotId,
        pointDeVenteId: e.pointDeVenteId,
        fermeLe: null,
      },
    });
    if (
      ouvert &&
      (reliquat === 0 ||
        ouvert.unitesParConditionnement !== e.coefficientReception)
    ) {
      await tx.conditionnementOuvert.update({
        where: { id: ouvert.id },
        data: { fermeLe: new Date() },
      });
      ouvert = null;
    }
    if (reliquat > 0 && !ouvert) {
      await this.ouvrirConditionnement(tx, {
        stockMedicamentId: e.stockMedicamentId,
        lotId: e.lotId,
        pointDeVenteId: e.pointDeVenteId,
        unitesParConditionnement: e.coefficientReception,
        ouvertParId: e.auteurId,
        ouvertParPieceId: e.pieceOrigineId,
      });
    }
  }
}
```

Si `tsc` refuse `PIECES_SANS_LOT.includes(m.pieceOrigineType)` (tableau `readonly TypePiece[]`), ne rien changer d'autre que le typage minimal nécessaire ; le comportement doit rester celui-ci.

### 4. Lecture du stock (`src/pharmacie/stock/lecture-stock.ts`, nouveau)

```ts
import type { Prisma } from 'generated/prisma/client';
import { reliquatLot } from '../domaine/quantites';
import {
  comparerFefo,
  ordonnerLotsPourVente,
  type LotCandidat,
} from '../domaine/selection-lots';

/** Lot lu avec son solde (agrégat du lot). */
export interface LotStockLu {
  id: string;
  numeroLot: string | null;
  dateExpiration: Date | null;
  dateReception: Date;
  coefficientReception: number;
  coutUnitaire: number;
  lotTechnique: boolean;
  solde: number;
}

/** Lot exposé dans `lots` (coutUnitaire retiré par masquerCouts sans marge:read). */
export interface LotExpose {
  id: string;
  numeroLot: string | null;
  dateExpiration: Date | null;
  quantite: number;
  lotTechnique: boolean;
  coutUnitaire: number;
}

export interface ReliquatExpose {
  lotId: string;
  unitesRestantes: number;
}

/** Stock calculé d'une fiche (plan 1.7, D508). */
export interface EtatStockFiche {
  quantite: number;
  quantiteVendable: number;
  dateExpiration: Date | null;
  reliquat: ReliquatExpose[];
  lots: LotExpose[];
}

type ClientLecture = Pick<
  Prisma.TransactionClient,
  'lotStock' | 'agregatStockProduit'
>;

export function dateVersJour(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function jourVersDate(jour: string): Date {
  return new Date(`${jour}T00:00:00.000Z`);
}

function versCandidat(l: LotStockLu): LotCandidat {
  return {
    id: l.id,
    numeroLot: l.numeroLot,
    dateExpiration: l.dateExpiration ? dateVersJour(l.dateExpiration) : null,
    dateReception: l.dateReception.toISOString(),
    solde: l.solde,
    coefficientReception: l.coefficientReception,
    coutUnitaire: l.coutUnitaire,
    lotTechnique: l.lotTechnique,
  };
}

/**
 * Calcul pur : quantité = agrégat produit ; lots exposés = lots à solde positif
 * en ordre FEFO ; quantité vendable et reliquats sur les lots non périmés ; date =
 * celle du lot que la vente prendrait en premier, sinon la plus ancienne des lots
 * restants (tous périmés), sinon null.
 */
export function calculerEtatStock(
  soldeProduit: number,
  lots: readonly LotStockLu[],
  jour: string,
): EtatStockFiche {
  const enStock = lots.filter((l) => l.solde > 0);
  const parId = new Map(enStock.map((l) => [l.id, l]));
  const candidats = enStock.map(versCandidat);
  const ordre = ordonnerLotsPourVente(candidats, jour);

  let dateExpiration: Date | null = null;
  if (ordre.length > 0) {
    dateExpiration = parId.get(ordre[0].id)?.dateExpiration ?? null;
  } else {
    for (const l of enStock) {
      if (
        l.dateExpiration !== null &&
        (dateExpiration === null || l.dateExpiration < dateExpiration)
      ) {
        dateExpiration = l.dateExpiration;
      }
    }
  }

  return {
    quantite: soldeProduit,
    quantiteVendable: ordre.reduce((somme, c) => somme + c.solde, 0),
    dateExpiration,
    reliquat: ordre
      .map((c) => ({
        lotId: c.id,
        unitesRestantes: reliquatLot(c.solde, c.coefficientReception),
      }))
      .filter((r) => r.unitesRestantes > 0),
    lots: [...candidats].sort(comparerFefo).map((c) => {
      const l = parId.get(c.id) as LotStockLu;
      return {
        id: l.id,
        numeroLot: l.numeroLot,
        dateExpiration: l.dateExpiration,
        quantite: l.solde,
        lotTechnique: l.lotTechnique,
        coutUnitaire: l.coutUnitaire,
      };
    }),
  };
}

/**
 * Stock calculé de chaque fiche demandée (une entrée par identifiant, même sans
 * lot), somme sur tous les points de vente de la fiche (un seul en T1, D508).
 * Requêtes successives (utilisable dans une transaction interactive).
 */
export async function lireEtatsStock(
  client: ClientLecture,
  stockMedicamentIds: readonly string[],
  jour: string,
): Promise<Map<string, EtatStockFiche>> {
  const ids = [...new Set(stockMedicamentIds)];
  const resultat = new Map<string, EtatStockFiche>();
  if (ids.length === 0) return resultat;

  const lots = await client.lotStock.findMany({
    where: {
      stockMedicamentId: { in: ids },
      agregat: { is: { quantite: { gt: 0 } } },
    },
    select: {
      id: true,
      stockMedicamentId: true,
      numeroLot: true,
      dateExpiration: true,
      dateReception: true,
      coefficientReception: true,
      coutUnitaire: true,
      lotTechnique: true,
      agregat: { select: { quantite: true } },
    },
  });
  const agregats = await client.agregatStockProduit.findMany({
    where: { stockMedicamentId: { in: ids } },
    select: { stockMedicamentId: true, quantite: true },
  });

  const lotsParFiche = new Map<string, LotStockLu[]>();
  for (const l of lots) {
    const liste = lotsParFiche.get(l.stockMedicamentId) ?? [];
    liste.push({
      id: l.id,
      numeroLot: l.numeroLot,
      dateExpiration: l.dateExpiration,
      dateReception: l.dateReception,
      coefficientReception: l.coefficientReception,
      coutUnitaire: l.coutUnitaire,
      lotTechnique: l.lotTechnique,
      solde: l.agregat?.quantite ?? 0,
    });
    lotsParFiche.set(l.stockMedicamentId, liste);
  }
  const soldeParFiche = new Map<string, number>();
  for (const a of agregats) {
    soldeParFiche.set(
      a.stockMedicamentId,
      (soldeParFiche.get(a.stockMedicamentId) ?? 0) + a.quantite,
    );
  }
  for (const id of ids) {
    resultat.set(
      id,
      calculerEtatStock(
        soldeParFiche.get(id) ?? 0,
        lotsParFiche.get(id) ?? [],
        jour,
      ),
    );
  }
  return resultat;
}

/** Filtre Prisma « au moins un lot vendable » : solde positif et non périmé (le jour même reste vendable). */
export function filtreLotVendable(jour: string): Prisma.LotStockWhereInput {
  return {
    agregat: { is: { quantite: { gt: 0 } } },
    OR: [
      { dateExpiration: null },
      { dateExpiration: { gte: jourVersDate(jour) } },
    ],
  };
}

/** Fiche au contrat de `GET /pharmacie/stock/:structureId` (plan 1.7). */
export function avecStock<F extends { archiveLe: Date | null }>(
  fiche: F,
  etat: EtatStockFiche,
) {
  return {
    ...fiche,
    quantite: etat.quantite,
    disponible: etat.quantite > 0 && fiche.archiveLe === null,
    dateExpiration: etat.dateExpiration,
    quantiteVendable: etat.quantiteVendable,
    reliquat: etat.reliquat,
    lots: etat.lots,
  };
}

/** Fiche des sorties publiques (recherche, détail catalogue) : ni lots ni coûts (D426, D508). */
export function avecStockPublic<F extends object>(
  fiche: F,
  etat: EtatStockFiche,
) {
  return {
    ...fiche,
    quantite: etat.quantiteVendable,
    disponible: etat.quantiteVendable > 0,
    dateExpiration: etat.dateExpiration,
  };
}
```

### 5. DTO (`src/pharmacie/dto/pharmacie.dto.ts`)

5.1 Ajouter `NotEquals` et `MaxLength` à l'import `class-validator` existant.

5.2 Dans `UpsertStockDto`, remplacer le décorateur Swagger de `quantite` par `@ApiProperty({ example: 50, description: 'Quantité en stock, en unités minimales' })` (validation inchangée) et ajouter après `notes` :

```ts
  @ApiPropertyOptional({
    description:
      "Vrai pour un médicament sans date de péremption : autorise l'absence de date quand la saisie crée un lot.",
  })
  @IsOptional()
  @IsBoolean()
  sansPeremption?: boolean;
```

5.3 Remplacer `UpdateStockQuantiteDto` par :

```ts
export class UpdateStockQuantiteDto {
  @ApiProperty({
    example: -2,
    description: 'Ajouter ou retirer (négatif), en unités minimales',
  })
  @IsInt({ message: 'La variation doit être un nombre entier.' })
  @NotEquals(0, { message: 'La variation ne peut pas être nulle.' })
  variation: number;

  @ApiPropertyOptional({
    description:
      "Lot à corriger ; facultatif si le médicament n'a qu'un lot en stock",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  lotId?: string;

  @ApiPropertyOptional({
    example: 'Boîte abîmée au rangement',
    description: 'Motif de la correction, obligatoire (3 à 300 caractères)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300, {
    message: 'Le motif ne doit pas dépasser 300 caractères.',
  })
  motif?: string;

  @ApiPropertyOptional({ example: 'Livraison du 26/04/2026' })
  @IsOptional()
  @IsString()
  notes?: string;
}
```

(`motif` est optionnel au DTO pour que l'absence donne 400 `MOTIF_REQUIS` et non `VALIDATION`, D510.)

### 6. `PharmacieService` (`src/pharmacie/pharmacie.service.ts`)

6.1 Imports à ajouter : `BadRequestException` (dans l'import `@nestjs/common` existant) ; `import type { Prisma } from 'generated/prisma/client';` ; `import { PermissionsService } from 'src/common/rbac/permissions.service';` ; `import { PERMISSIONS } from 'src/common/rbac/permissions.constants';` (même import que `pharmacie.controller.ts`) ; `import { assurerPointDeVente } from './point-de-vente';` ; `import { jourConakry } from './vente.service';` ; `import { masquerCouts } from './masquer-couts';` ; `import { etatStock } from './domaine/quantites';` ; `import { avertissementEcartPrix } from './domaine/prix';` ; `import { MouvementsStockService } from './stock/mouvements-stock.service';` ; `import { estCleEtrangereViolee } from './stock/erreurs-base';` ; depuis `./stock/lecture-stock` : `avecStock`, `avecStockPublic`, `dateVersJour`, `jourVersDate`, `filtreLotVendable`, `lireEtatsStock`, `type EtatStockFiche`. (`vente.service.ts` n'importe pas `pharmacie.service.ts` : aucune dépendance circulaire, vérifié.)

6.2 Constantes de module, après `PRIX_MAX` :

```ts
/** Sélection du médicament dans les lectures de stock (contrat existant de getStockPharmacie). */
const SELECT_MEDICAMENT_STOCK = {
  id: true,
  nom: true,
  nomGenerique: true,
  categorie: true,
  formes: true,
  ordonnanceRequise: true,
} as const;

const MOTIF_SAISIE_FICHE = 'Quantité saisie sur la fiche de stock';
const MOTIF_CORRECTION_FICHE = 'Quantité corrigée sur la fiche de stock';

export const MESSAGE_LOT_REQUIS_QUANTITE =
  'Ce médicament a plusieurs lots : faites un inventaire.';
export const MESSAGE_LOT_REQUIS_DATE =
  'Ce médicament a plusieurs lots : corrigez la date de péremption lot par lot.';
export const MESSAGE_LOT_REQUIS_PROVISOIRE =
  'Des ventes de ce médicament attendent la réception de son stock : faites un inventaire.';
export const MESSAGE_LOT_REQUIS_CHOIX =
  'Ce médicament a plusieurs lots : choisissez le lot à corriger.';
export const MESSAGE_LOT_REQUIS_AUCUN =
  "Ce médicament n'a aucun lot en stock : modifiez la fiche pour saisir la quantité et la date de péremption.";
export const MESSAGE_LOT_INTROUVABLE =
  'Ce lot est introuvable pour ce médicament.';
export const MESSAGE_MOTIF_REQUIS =
  'Indiquez le motif de la correction (3 caractères au moins).';
export const MESSAGE_DATE_PEREMPTION_REQUISE =
  "Indiquez la date de péremption de ce stock, ou précisez que ce médicament n'a pas de date de péremption.";
export const MESSAGE_MEDICAMENT_UTILISE =
  'Ce médicament a déjà du stock ou des ventes dans une pharmacie : il ne peut pas être supprimé du catalogue.';

/** Message du refus d'une correction qui rendrait le lot négatif (testé avant écriture, D510). */
export function messageStockLotNegatif(solde: number): string {
  return `Ce lot n'a que ${solde} unité(s) en stock : la correction ne peut pas le rendre négatif.`;
}
```

6.3 Constructeur (ordre imposé, utilisé par les tests) :

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly accesPharmacie: AccesPharmacieService,
    private readonly mouvementsStock: MouvementsStockService,
    private readonly permissions: PermissionsService,
  ) {}
```

6.4 Méthodes privées à ajouter (section `Helpers`) :

```ts
  /** Vrai si l'utilisateur a marge:read (masquage des coûts, D466). */
  private async peutVoirMarge(userId: string): Promise<boolean> {
    const permissions = await this.permissions.getUserPermissions(userId);
    return permissions.includes(PERMISSIONS.MARGE_READ);
  }

  /** Fiches lues au contrat du plan 1.7, triées par nom de médicament. */
  private async lireFichesStock(
    where: Prisma.StockMedicamentWhereInput,
    jour: string,
  ) {
    const fiches = await this.prisma.stockMedicament.findMany({
      where,
      include: { medicament: { select: SELECT_MEDICAMENT_STOCK } },
      orderBy: { medicament: { nom: 'asc' } },
    });
    const etats = await lireEtatsStock(
      this.prisma,
      fiches.map((f) => f.id),
      jour,
    );
    return fiches.map((f) => avecStock(f, etats.get(f.id) as EtatStockFiche));
  }

  /** Point de vente d'ordre 1 et paramètres, lus sans verrou ; créés seulement s'ils manquent (D507). */
  private async pointDeVenteEtParametres(
    tx: Prisma.TransactionClient,
    structure: { id: string; nom: string },
  ) {
    const pointDeVente = await tx.pointDeVente.findUnique({
      where: { structureId_ordre: { structureId: structure.id, ordre: 1 } },
    });
    const parametres = await tx.parametresPharmacie.findUnique({
      where: { structureId: structure.id },
    });
    if (pointDeVente && parametres) return { pointDeVente, parametres };
    return assurerPointDeVente(tx, structure);
  }

  /** Destinataires des alertes de stock (règle existante). */
  private async alerterStock(structureId: string, message: string) {
    const staff = await this.prisma.user.findMany({
      where: { structureId, role: { in: ['PHARMACIEN', 'STRUCTURE_ADMIN'] } },
      select: { id: true },
    });
    await this.notificationsService.createManyNotifications(
      staff.map((u) => u.id),
      { type: 'STOCK_ALERTE', titre: 'Stock critique', message },
    );
  }
```

6.5 `getStockPharmacie(structureId, adminUserId)` devient :

```ts
  async getStockPharmacie(structureId: string, adminUserId: string) {
    const { user } = await this.accesPharmacie.verifier(structureId, adminUserId);
    const jour = jourConakry(new Date());
    const stocks = await this.lireFichesStock(
      { structureId, archiveLe: null },
      jour,
    );
    const parametres = await this.prisma.parametresPharmacie.findUnique({
      where: { structureId },
      select: { seuilStockBas: true },
    });
    const seuil = parametres?.seuilStockBas ?? SEUIL_STOCK_BAS;
    const etat = (s: { quantite: number; coefficientBoite: number }) =>
      etatStock(s.quantite, s.coefficientBoite, seuil);
    // Stock bas en boîtes (A4, D476) ; rupture : quantité nulle ou négative (D416)
    const stockBas = stocks.filter((s) => etat(s) === 'BAS');
    const rupture = stocks.filter((s) => etat(s) === 'RUPTURE');
    const peutVoirMarge = await this.peutVoirMarge(user.id);

    return {
      data: masquerCouts(
        {
          stocks,
          alertes: {
            stockBas: stockBas.map((s) => ({
              id: s.id,
              nom: s.medicament.nom,
              quantite: s.quantite,
            })),
            rupture: rupture.map((s) => ({ id: s.id, nom: s.medicament.nom })),
          },
        },
        peutVoirMarge,
      ),
      message: `${stocks.length} médicament(s) en stock`,
      success: true,
    };
  }
```

6.6 `upsertStock(structureId, adminUserId, dto)` devient (D509) :

```ts
  async upsertStock(
    structureId: string,
    adminUserId: string,
    dto: UpsertStockDto,
  ) {
    const { user, structure } = await this.accesPharmacie.verifier(
      structureId,
      adminUserId,
    );

    // Vérifier que le médicament existe
    const med = await this.prisma.medicament.findUnique({
      where: { id: dto.medicamentId },
    });
    if (!med)
      throw new NotFoundException('Médicament non trouvé dans le catalogue');

    const jour = jourConakry(new Date());
    const jourSaisi = dto.dateExpiration
      ? dateVersJour(new Date(dto.dateExpiration))
      : undefined;

    const { ficheId, seuilPrix, seuilStockBas } =
      await this.prisma.$transaction(async (tx) => {
        const cle = {
          medicamentId_structureId: {
            medicamentId: dto.medicamentId,
            structureId,
          },
        };
        const avant = await tx.stockMedicament.findUnique({
          where: cle,
          select: { archiveLe: true },
        });
        // Fiche créée à quantité nulle (D493) ; verrou de ligne avant le verrou consultatif (D507)
        const fiche = await tx.stockMedicament.upsert({
          where: cle,
          create: {
            medicamentId: dto.medicamentId,
            structureId,
            prixUnitaire: dto.prixUnitaire,
            notes: dto.notes?.trim(),
          },
          update: {
            prixUnitaire: dto.prixUnitaire,
            notes: dto.notes?.trim(),
            archiveLe: null,
          },
        });
        if (avant?.archiveLe) {
          await tx.auditLog.create({
            data: {
              userId: user.id,
              action: 'update',
              entityType: 'StockMedicament',
              entityId: fiche.id,
              ip: null,
              metadata: {
                avant: { archiveLe: avant.archiveLe.toISOString() },
                apres: { archiveLe: null },
              },
            },
          });
        }

        const { pointDeVente, parametres } =
          await this.pointDeVenteEtParametres(tx, structure);
        await this.mouvementsStock.verrouillerFiches(tx, [fiche.id]);
        const etat = (await lireEtatsStock(tx, [fiche.id], jour)).get(
          fiche.id,
        ) as EtatStockFiche;
        const sommeLots = etat.lots.reduce((s, l) => s + l.quantite, 0);
        const quantite = dto.quantite;

        if (etat.quantite !== sommeLots) {
          // Part provisoire sans lot (vente en négatif, O11) : seule une réception ou un inventaire la résout
          if (quantite !== etat.quantite) {
            throw new ConflictException({
              message: MESSAGE_LOT_REQUIS_PROVISOIRE,
              code: 'LOT_REQUIS',
            });
          }
        } else if (etat.lots.length === 0) {
          if (quantite > 0) {
            if (jourSaisi === undefined && dto.sansPeremption !== true) {
              throw new BadRequestException({
                message: MESSAGE_DATE_PEREMPTION_REQUISE,
                code: 'DATE_PEREMPTION_REQUISE',
              });
            }
            await this.mouvementsStock.creerLot(tx, {
              stockMedicamentId: fiche.id,
              pointDeVenteId: pointDeVente.id,
              numeroLot: null,
              dateExpiration: jourSaisi ? jourVersDate(jourSaisi) : null,
              quantite,
              coutUnitaire: 0,
              coutAchatBoite: null,
              coefficientReception: fiche.coefficientBoite,
              fournisseurId: null,
              receptionId: null,
              lotTechnique: false,
              auteurId: user.id,
              pieceOrigineType: 'AJUSTEMENT',
              pieceOrigineId: null,
              motif: MOTIF_SAISIE_FICHE,
            });
          }
        } else if (etat.lots.length === 1) {
          const lot = etat.lots[0];
          if (quantite !== lot.quantite) {
            await this.mouvementsStock.ecrire(tx, {
              pointDeVenteId: pointDeVente.id,
              stockMedicamentId: fiche.id,
              lotId: lot.id,
              type: 'INVENTAIRE',
              quantite: quantite - lot.quantite,
              pieceOrigineType: 'AJUSTEMENT',
              pieceOrigineId: null,
              motif: MOTIF_CORRECTION_FICHE,
              auteurId: user.id,
            });
          }
          const jourLot = lot.dateExpiration
            ? dateVersJour(lot.dateExpiration)
            : null;
          if (jourSaisi !== undefined && jourSaisi !== jourLot) {
            await tx.lotStock.update({
              where: { id: lot.id },
              data: { dateExpiration: jourVersDate(jourSaisi) },
            });
            await tx.auditLog.create({
              data: {
                userId: user.id,
                action: 'update',
                entityType: 'LotStock',
                entityId: lot.id,
                ip: null,
                metadata: {
                  avant: { dateExpiration: jourLot },
                  apres: { dateExpiration: jourSaisi },
                },
              },
            });
          }
        } else {
          if (quantite !== etat.quantite) {
            throw new ConflictException({
              message: MESSAGE_LOT_REQUIS_QUANTITE,
              code: 'LOT_REQUIS',
            });
          }
          const jourAffiche = etat.dateExpiration
            ? dateVersJour(etat.dateExpiration)
            : null;
          if (jourSaisi !== undefined && jourSaisi !== jourAffiche) {
            throw new ConflictException({
              message: MESSAGE_LOT_REQUIS_DATE,
              code: 'LOT_REQUIS',
            });
          }
        }
        return {
          ficheId: fiche.id,
          seuilPrix: parametres.seuilAvertissementPrixPct,
          seuilStockBas: parametres.seuilStockBas,
        };
      });

    const [fiche] = await this.lireFichesStock({ id: ficheId }, jour);
    const avertissement = avertissementEcartPrix(
      fiche.prixUnitaire,
      fiche.prixUnite,
      fiche.coefficientBoite,
      seuilPrix,
    );

    // Alerte stock bas ou épuisé (seuil en boîtes, A4)
    if (
      etatStock(fiche.quantite, fiche.coefficientBoite, seuilStockBas) !==
      'NORMAL'
    ) {
      await this.alerterStock(
        structureId,
        `Le stock de "${fiche.medicament.nom}" est ${fiche.quantite <= 0 ? 'épuisé' : `bas (${fiche.quantite} unités)`}.`,
      );
    }

    const peutVoirMarge = await this.peutVoirMarge(user.id);
    return {
      data: masquerCouts(
        { ...fiche, avertissements: avertissement ? [avertissement] : [] },
        peutVoirMarge,
      ),
      message: 'Stock mis à jour',
      success: true,
    };
  }
```

6.7 `updateStockQuantite(structureId, stockId, adminUserId, dto)` devient (D510) :

```ts
  async updateStockQuantite(
    structureId: string,
    stockId: string,
    adminUserId: string,
    dto: UpdateStockQuantiteDto,
  ) {
    const { user, structure } = await this.accesPharmacie.verifier(
      structureId,
      adminUserId,
    );
    const motif = dto.motif?.trim() ?? '';
    if (motif.length < 3) {
      throw new BadRequestException({
        message: MESSAGE_MOTIF_REQUIS,
        code: 'MOTIF_REQUIS',
      });
    }
    const jour = jourConakry(new Date());

    const { avant, apres, coefficientBoite, seuilStockBas } =
      await this.prisma.$transaction(async (tx) => {
        // Verrou de ligne de la fiche, puis verrou consultatif (D507)
        const lignes = await tx.$queryRaw<
          { id: string; coefficientBoite: number }[]
        >`SELECT "id", "coefficientBoite" FROM "StockMedicament" WHERE "id" = ${stockId} AND "structureId" = ${structureId} AND "archiveLe" IS NULL FOR UPDATE`;
        if (lignes.length === 0)
          throw new NotFoundException('Stock non trouvé');

        const { pointDeVente, parametres } =
          await this.pointDeVenteEtParametres(tx, structure);
        await this.mouvementsStock.verrouillerFiches(tx, [stockId]);
        const etat = (await lireEtatsStock(tx, [stockId], jour)).get(
          stockId,
        ) as EtatStockFiche;

        let lotId: string;
        let soldeLot: number;
        if (dto.lotId !== undefined) {
          const lot = await tx.lotStock.findFirst({
            where: {
              id: dto.lotId,
              stockMedicamentId: stockId,
              pointDeVenteId: pointDeVente.id,
            },
            select: { id: true, agregat: { select: { quantite: true } } },
          });
          if (!lot) throw new NotFoundException(MESSAGE_LOT_INTROUVABLE);
          lotId = lot.id;
          soldeLot = lot.agregat?.quantite ?? 0;
        } else if (etat.lots.length === 1) {
          lotId = etat.lots[0].id;
          soldeLot = etat.lots[0].quantite;
        } else {
          throw new ConflictException({
            message:
              etat.lots.length === 0
                ? MESSAGE_LOT_REQUIS_AUCUN
                : MESSAGE_LOT_REQUIS_CHOIX,
            code: 'LOT_REQUIS',
          });
        }

        if (soldeLot + dto.variation < 0) {
          throw new ConflictException({
            message: messageStockLotNegatif(soldeLot),
            code: 'STOCK_LOT_NEGATIF',
          });
        }

        const notes = dto.notes?.trim();
        if (notes) {
          await tx.stockMedicament.update({
            where: { id: stockId },
            data: { notes },
          });
        }

        const ecrit = await this.mouvementsStock.ecrire(tx, {
          pointDeVenteId: pointDeVente.id,
          stockMedicamentId: stockId,
          lotId,
          type: 'CORRECTION',
          quantite: dto.variation,
          pieceOrigineType: 'AJUSTEMENT',
          pieceOrigineId: null,
          motif,
          auteurId: user.id,
        });
        return {
          avant: etat.quantite,
          apres: ecrit.soldeProduit,
          coefficientBoite: lignes[0].coefficientBoite,
          seuilStockBas: parametres.seuilStockBas,
        };
      });

    const [fiche] = await this.lireFichesStock({ id: stockId }, jour);

    // Alerte au seul franchissement vers bas ou rupture (seuil en boîtes, A4)
    if (
      etatStock(avant, coefficientBoite, seuilStockBas) === 'NORMAL' &&
      etatStock(apres, coefficientBoite, seuilStockBas) !== 'NORMAL'
    ) {
      await this.alerterStock(
        structureId,
        `Le stock de "${fiche.medicament.nom}" est descendu à ${apres} unités.`,
      );
    }

    const peutVoirMarge = await this.peutVoirMarge(user.id);
    return {
      data: masquerCouts(fiche, peutVoirMarge),
      message: `Stock ${dto.variation > 0 ? 'augmenté' : 'réduit'} (nouvelle quantité : ${apres})`,
      success: true,
    };
  }
```

6.8 `removeStockItem(structureId, stockId, adminUserId)` devient un archivage (D511) :

```ts
  async removeStockItem(
    structureId: string,
    stockId: string,
    adminUserId: string,
  ) {
    const { user } = await this.accesPharmacie.verifier(
      structureId,
      adminUserId,
    );

    // Archivage, jamais de suppression physique (O12, D430) ; idempotent
    await this.prisma.$transaction(async (tx) => {
      const fiche = await tx.stockMedicament.findFirst({
        where: { id: stockId, structureId },
        select: { id: true, archiveLe: true },
      });
      if (!fiche) throw new NotFoundException('Stock non trouvé');
      if (fiche.archiveLe) return;
      const archiveLe = new Date();
      const { count } = await tx.stockMedicament.updateMany({
        where: { id: stockId, archiveLe: null },
        data: { archiveLe },
      });
      if (count === 1) {
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'update',
            entityType: 'StockMedicament',
            entityId: stockId,
            ip: null,
            metadata: {
              avant: { archiveLe: null },
              apres: { archiveLe: archiveLe.toISOString() },
            },
          },
        });
      }
    });
    return { data: null, message: 'Médicament retiré du stock', success: true };
  }
```

6.9 `deleteMedicament(medicamentId, actorId)` : juste après le `if (!med) throw new NotFoundException('Médicament non trouvé');`, insérer :

```ts
    // Refus si une pharmacie a un lot, un mouvement ou une vente de ce médicament (O12, D511)
    const fichesUtilisees = await this.prisma.stockMedicament.count({
      where: {
        medicamentId,
        OR: [{ lots: { some: {} } }, { mouvements: { some: {} } }],
      },
    });
    const lignesVendues = await this.prisma.ligneVente.count({
      where: { medicamentId },
    });
    if (fichesUtilisees > 0 || lignesVendues > 0) {
      throw new ConflictException({
        message: MESSAGE_MEDICAMENT_UTILISE,
        code: 'MEDICAMENT_UTILISE',
      });
    }
```

puis remplacer `await this.prisma.medicament.delete({ where: { id: medicamentId } });` par :

```ts
    try {
      await this.prisma.medicament.delete({ where: { id: medicamentId } });
    } catch (erreur) {
      // Lot créé entre le contrôle et la suppression : la clé étrangère Restrict refuse
      if (estCleEtrangereViolee(erreur)) {
        throw new ConflictException({
          message: MESSAGE_MEDICAMENT_UTILISE,
          code: 'MEDICAMENT_UTILISE',
        });
      }
      throw erreur;
    }
```

Le reste de la méthode (notification de catégorie supprimée, réponse) est inchangé.

6.10 `getMedicament(medicamentId)` : remplacer le `where` de `stocks` (`{ disponible: true, quantite: { gt: 0 } }`) par `{ archiveLe: null, lots: { some: filtreLotVendable(jour) } }` avec `const jour = jourConakry(new Date());` en tête de méthode ; après le `if (!med) throw ...` existant, remplacer le `return` par :

```ts
    const etats = await lireEtatsStock(
      this.prisma,
      med.stocks.map((s) => s.id),
      jour,
    );
    return {
      data: {
        ...med,
        stocks: med.stocks.map((s) =>
          avecStockPublic(s, etats.get(s.id) as EtatStockFiche),
        ),
      },
      message: 'Médicament trouvé',
      success: true,
    };
```

6.11 `rechercherDisponibilite(...)` : `const jour = jourConakry(new Date());` en tête ; dans `where`, remplacer `disponible: true, quantite: { gt: 0 },` par `archiveLe: null, lots: { some: filtreLotVendable(jour) },` (le reste du `where`, `include` et `orderBy` inchangés) ; juste après le `findMany`, insérer :

```ts
    const etats = await lireEtatsStock(
      this.prisma,
      stocks.map((s) => s.id),
      jour,
    );
    const publics = stocks.map((s) =>
      avecStockPublic(s, etats.get(s.id) as EtatStockFiche),
    );
```

puis utiliser `publics` à la place de `stocks` dans la suite (`let results = publics;` et `results = publics.map(...)`), sans autre changement (tri par distance, message).

6.12 Ne pas modifier : `createMedicament`, `getMedicaments`, `updateMedicament`, `getCategories`, `getModeleImportStock`, `apercuImportStock`, `importerStock`, `analyserImportStock`, `calculerQuantitesImport`, `lireQuantitesEnStock`, `messageImportStock`, `lireNombre`, `lireDate`, `calculateDistance`, `toRad`.

### 7. Module et contrôleur

7.1 `src/pharmacie/pharmacie.module.ts` : importer `MouvementsStockService` depuis `./stock/mouvements-stock.service` et l'ajouter à `providers` (après `FicheProduitService`). `PermissionsService` vient du module global RBAC : ne pas l'ajouter.

7.2 `src/pharmacie/pharmacie.controller.ts` : seulement les textes Swagger, aucune signature changée.
- `POST stock/:structureId` : `description` devient `"Crée ou met à jour la fiche (prix de la boîte, notes) et la désarchive. quantite est en unités minimales : sans lot en stock, une quantité positive crée un lot (date de péremption obligatoire sauf sansPeremption, 400 DATE_PEREMPTION_REQUISE) ; avec un seul lot, un mouvement INVENTAIRE amène le stock à la quantité saisie et dateExpiration corrige la date du lot ; avec plusieurs lots, une autre quantité ou une autre date est refusée (409 LOT_REQUIS). Réponse : fiche lue et avertissements."`
- `PATCH stock/:structureId/:stockId/quantite` : `summary: "Corriger la quantité d'un lot"`, `description: "Variation signée non nulle en unités minimales sur un lot (lotId facultatif si le médicament n'a qu'un lot en stock), motif obligatoire de 3 à 300 caractères (400 MOTIF_REQUIS). Écrit un mouvement CORRECTION. 409 LOT_REQUIS, 409 STOCK_LOT_NEGATIF, 404 si la fiche ou le lot est introuvable."`
- `DELETE stock/:structureId/:stockId` : `@ApiOperation({ summary: 'Archiver un médicament du stock', description: "Archivage, jamais de suppression : la fiche sort des listes, de la vente et de la recherche publique, son journal est conservé. Une nouvelle saisie de la fiche (POST) la désarchive." })`
- `DELETE catalogue/:medicamentId` : `@ApiOperation({ summary: 'Supprimer un médicament du catalogue (Admin)', description: 'Refusé (409 MEDICAMENT_UTILISE) si une pharmacie a un lot, un mouvement ou une vente de ce médicament.' })`

### 8. `FicheProduitService` (`src/pharmacie/fiche-produit.service.ts`)

Une seule modification (D511) : la requête de verrou devient

```ts
>`SELECT "id" FROM "StockMedicament" WHERE "id" = ${stockId} AND "structureId" = ${structure.id} AND "archiveLe" IS NULL FOR UPDATE`;
```

(une fiche archivée répond donc 404 `MESSAGE_FICHE_INTROUVABLE`). Rien d'autre (la règle `CONVERSION_REQUISE` sur `quantite` gelée reste à PB13, D487).

### 9. Instantanés PB02 (D506)

9.1 `test/db/outils-instantanes.ts` : `verifierInstantane` gagne un troisième paramètre facultatif ; l'écriture (`MAJ_INSTANTANES=1`) n'est pas modifiée.

```ts
export function verifierInstantane(
  nom: string,
  valeurNormalisee: unknown,
  ajusterAttendu?: (attendu: unknown) => unknown,
): void {
```

et, après `const attendu = JSON.parse(readFileSync(fichier, 'utf8')) as unknown;`, la comparaison porte sur `ajusterAttendu ? ajusterAttendu(attendu) : attendu` (le fichier n'est jamais réécrit). Ajouter au commentaire d'en-tête du fichier : `// Un ajustement de l'attendu n'est permis que pour une divergence nommée par une décision du chef (D506).`

9.2 `test/db/non-regression-lectures.db-spec.ts`, modifications **exhaustives** :

a) Imports à ajouter : `import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';` et `import type { PermissionsService } from 'src/common/rbac/permissions.service';`.

b) Bloc « construction des services » : `pharmacie = new PharmacieService(prisma, notifications, acces);` devient

```ts
    const permissionsFactices = {
      getUserPermissions: () => Promise.resolve([] as string[]),
    } as unknown as PermissionsService;
    pharmacie = new PharmacieService(
      prisma,
      notifications,
      acces,
      new MouvementsStockService(),
      permissionsFactices,
    );
```

c) Après la fonction `parId`, ajouter :

```ts
// Divergences attendues après le recâblage des lectures (D460, D506), nommées une à une
const DATE_PERIMEE = 'J-30j 00:00:00.000';
type EntreeInstantane = Record<string, unknown>;

/** D460 (2) : une fiche sans lot en stock a une date calculée nulle. */
function dateNulleSansStock(attendu: unknown): unknown {
  const objet = attendu as Record<string, { data: { stocks: EntreeInstantane[] } }>;
  for (const reponse of Object.values(objet)) {
    for (const s of reponse.data.stocks) {
      if (s.quantite === 0) s.dateExpiration = null;
    }
  }
  return objet;
}

/** D460 (1), D426 : la recherche publique n'annonce plus un stock périmé. */
function rechercheSansPerimes(attendu: unknown): unknown {
  const objet = attendu as Record<string, { data: EntreeInstantane[]; message: string }>;
  for (const reponse of Object.values(objet)) {
    reponse.data = reponse.data.filter((s) => s.dateExpiration !== DATE_PERIMEE);
    reponse.message = reponse.message.replace(
      /^\d+ résultat/,
      `${reponse.data.length} résultat`,
    );
  }
  return objet;
}

/** D460 (1), D426 : le détail catalogue n'annonce plus un stock périmé. */
function medicamentSansPerimes(attendu: unknown): unknown {
  const objet = attendu as Record<string, { data?: { stocks?: EntreeInstantane[] } }>;
  for (const reponse of Object.values(objet)) {
    if (reponse.data?.stocks) {
      reponse.data.stocks = reponse.data.stocks.filter(
        (s) => s.dateExpiration !== DATE_PERIMEE,
      );
    }
  }
  return objet;
}
```

d) Les trois appels deviennent `verifierInstantane('get-stock-pharmacie', normaliser(...), dateNulleSansStock)`, `verifierInstantane('rechercher-disponibilite', normaliser(...), rechercheSansPerimes)`, `verifierInstantane('get-medicament', normaliser(...), medicamentSansPerimes)`. Les appels de `listerVentes` et `detailVente` sont inchangés.

e) Test « instantané de rechercherDisponibilite », bloc `if (cle === 'sans filtre')` : `expect(liste.length).toBe(29);` devient `expect(liste.length).toBe(23);` et le filtre de l'attendu devient

```ts
            .filter(
              (f) =>
                ['str-pharma-1', 'str-pharma-2'].includes(f.structureId) &&
                f.quantite > 0 &&
                !(f.dateExpiration !== null && f.dateExpiration < J),
            )
```

f) Test « instantané de getMedicament » : le filtre de l'attendu devient `(f) => f.medicamentId === id && f.quantite > 0 && f.disponible && !(f.dateExpiration !== null && f.dateExpiration < J)`.

Aucune autre ligne de ce fichier ne change (le test des alertes, ses totaux 14 et 7, les ventes, restent identiques). `git diff --stat test/db/instantanes` doit rester vide.

### 10. Autres constructeurs et test retiré

10.1 `test/db/fiche-produit.db-spec.ts` : la construction `pharmacie = new PharmacieService(prisma, new NotificationsService(prisma), acces);` devient `new PharmacieService(prisma, new NotificationsService(prisma), acces, new MouvementsStockService(), permissionsFactices)` avec `permissionsFactices` défini juste avant comme en 9.2 b, et les deux imports correspondants. Aucune assertion modifiée : le test « l upsert du stock change le prix de la boîte » reste vert (240 = stock du lot unique de `stk-06`, aucun mouvement).

10.2 `src/pharmacie/pharmacie.import.spec.ts` : la construction de `PharmacieService` gagne les deux derniers arguments `new MouvementsStockService()` et `{ getUserPermissions: () => Promise.resolve([]) } as unknown as PermissionsService` (imports ajoutés). Rien d'autre.

10.3 Supprimer `src/pharmacie/pharmacie.stock-quantite.spec.ts` (`git rm`), D512 ; ses sujets sont couverts par les tests en base de la section 11.

### 11. Tests

11.1 `src/pharmacie/stock/erreurs-base.spec.ts` (nouveau, `npm test`) :
- `violeContrainte` vrai pour `{ name: 'DriverAdapterError', cause: { code: '23514', originalMessage: 'new row for relation "AgregatStockLot" violates check constraint "AgregatStockLot_quantite_check"' } }` et `'AgregatStockLot_quantite_check'` ; faux pour une autre contrainte ; faux pour `null`, `'texte'` et `42`.
- `estDoublonSur({ code: 'P2002', meta: { modelName: 'ConditionnementOuvert' } }, 'ConditionnementOuvert')` vrai ; faux avec `modelName: 'LotStock'` ; faux avec `code: 'P2003'`.
- `estCleEtrangereViolee` vrai pour `{ code: 'P2003' }` et pour `{ cause: { originalCode: '23503' } }` ; faux pour `{ code: 'P2002' }` et `undefined`.

11.2 `src/pharmacie/stock/mouvements-stock.service.spec.ts` (nouveau, `npm test`) :
- `validerMouvement` : quantité 1.5 : `RangeError` « La quantité d'un mouvement doit être un entier (reçu : 1.5). » ; quantité 0 en `CORRECTION` : `RangeError` « Un mouvement CORRECTION ne peut pas être nul. » ; quantité 0 en `INVENTAIRE` (pièce `INVENTAIRE`, avec lot) : aucune erreur ; `lotId: null` en pièce `AJUSTEMENT` : `RangeError` qui contient « sans lot » ; `lotId: null` en pièce `VENTE` type `VENTE` quantité -2 : aucune erreur ; pièce `AJUSTEMENT` sans motif puis motif `'   '` : `RangeError` « Le motif est obligatoire pour une pièce AJUSTEMENT. » ; pièce `SORTIE_MANUELLE` sans motif : `RangeError`.
- `validerNouveauLot` : `quantite: 0`, `coefficientReception: 0`, `coutUnitaire: -1` : `RangeError` chacun ; lot valide : aucune erreur.
- `verrouillerFiches` avec une doublure `{ $executeRaw: jest.fn().mockResolvedValue(1) }` : `['b', 'a', 'b']` donne exactement 2 appels, les valeurs interpolées (deuxième argument de chaque appel de la fonction étiquette) valent `'medconnecte:stock:a'` puis `'medconnecte:stock:b'` ; liste vide : aucun appel.
- `cleVerrouFiche('x')` vaut `'medconnecte:stock:x'`.

11.3 `src/pharmacie/stock/lecture-stock.spec.ts` (nouveau, `npm test`), jour `'2026-10-25'`, fabrique `lot(id, date, solde, coef = 1, reception = '2026-01-01T00:00:00.000Z')` (date `AAAA-MM-JJ` ou `null` convertie par `jourVersDate`, coût 0, non technique) :
1. aucun lot, solde 0 : `{ quantite: 0, quantiteVendable: 0, dateExpiration: null, reliquat: [], lots: [] }` (`toEqual`).
2. un lot daté du jour (solde 12) : `dateExpiration` égale à `jourVersDate('2026-10-25')`, `quantiteVendable` 12, `reliquat` vide, `lots` d'un élément `{ id, numeroLot: null, dateExpiration, quantite: 12, lotTechnique: false, coutUnitaire: 0 }`.
3. tous périmés (`'2026-09-01'` solde 5, `'2026-08-01'` solde 3) : `dateExpiration` = `jourVersDate('2026-08-01')`, `quantiteVendable` 0, ordre des `lots` : août puis septembre.
4. reliquat d'abord : A (`'2027-01-01'`, solde 20, coef 10), B (`'2027-06-01'`, solde 15, coef 10) : `dateExpiration` = date de B, `reliquat` `[{ lotId: 'B', unitesRestantes: 5 }]`, `quantiteVendable` 35, `lots` dans l'ordre A puis B.
5. sans date avant daté : N (`null`, solde 4), D (`'2027-01-01'`, solde 6) : `dateExpiration` null, `lots` N puis D.
6. périmé et vendable : P (`'2026-01-01'`, solde 11), V (`'2027-01-01'`, solde 5), solde produit 16 : `quantite` 16, `quantiteVendable` 5, `dateExpiration` = date de V, `reliquat` vide.
7. stock négatif sans lot : solde produit -3, aucun lot : `quantite` -3, `quantiteVendable` 0, `dateExpiration` null.
8. lot à solde 0 ignoré : lot (`'2027-01-01'`, solde 0) : `lots` vide, `dateExpiration` null.
9. `avecStock({ id: 'f', archiveLe: null, quantite: 99, disponible: false, dateExpiration: null }, etat du cas 2)` : `quantite` 12, `disponible` true, `quantiteVendable` 12, clés `reliquat` et `lots` présentes ; avec `archiveLe` non nul : `disponible` false. `avecStockPublic(..., etat du cas 6)` : `quantite` 5, `disponible` true, aucune clé `lots`, `reliquat` ni `quantiteVendable`.
10. `filtreLotVendable('2026-10-25')` `toEqual` `{ agregat: { is: { quantite: { gt: 0 } } }, OR: [{ dateExpiration: null }, { dateExpiration: { gte: new Date('2026-10-25T00:00:00.000Z') } }] }`.

11.4 `src/pharmacie/dto/pharmacie.dto.spec.ts` : ajouter un `describe('UpdateStockQuantiteDto et sansPeremption (PB08)', ...)` :
- `{ variation: 0 }` : erreur sur `variation` avec la contrainte `notEquals` et le message « La variation ne peut pas être nulle. » ;
- `{ variation: -2, motif: 'x'.repeat(301) }` : contrainte `maxLength` sur `motif` ;
- `{ variation: 1, lotId: '' }` : contrainte `isNotEmpty` sur `lotId` ;
- `{ variation: -2, lotId: 'lot-1', motif: 'Casse' }` : aucune erreur ;
- `UpsertStockDto` `{ medicamentId: 'med-1', quantite: 3, sansPeremption: 'oui' }` : contrainte `isBoolean` ; avec `sansPeremption: true` : aucune erreur.

11.5 `test/db/mouvements-stock.db-spec.ts` (nouveau, `npm run test:db`), tests **dans cet ordre** (ils partagent la base) :

Mise en place (`beforeAll`, modèle `test/db/fiche-produit.db-spec.ts`) : base vide, migrations jusqu'à `DERNIERE_MIGRATION_FORMAT_ACTUEL`, `resume = await chargerFormatActuel(base.client)`, migrations restantes, `prisma = creerPrismaDeTest(base)` ; `acces = new AccesPharmacieService(prisma)` ; `mouvements = new MouvementsStockService()` ; `notifications = new NotificationsService(prisma)` ; `permissions = { getUserPermissions: (id: string) => Promise.resolve(['usr-admin-p1', 'usr-admin-p2'].includes(id) ? ['marge:read'] : []) } as unknown as PermissionsService` ; `pharmacie = new PharmacieService(prisma, notifications, acces, mouvements, permissions)` ; `fiches = new FicheProduitService(prisma, acces)` ; `J = resume.aujourdhui` ; `jour(n)` = `AAAA-MM-JJ` de `J + n jours` ; `pv1` et `pv2` = identifiants des points de vente d'ordre 1 de `str-pharma-1` et `str-pharma-2` (requête SQL). `afterAll` comme le modèle. Helpers : `refus(promesse)` (copie de `fiche-produit.db-spec.ts`, renvoie `{ statut, corps }`), `sql(requete, valeurs)`, `lotTechnique(stockId)` (id du lot technique de la fiche), `mouvementsDe(stockId)` (lignes `type::text`, `quantite`, `"pieceOrigineType"::text`, `motif`, `"auteurId"`, `"lotId"` triées par `"horodatageServeur"`, `id`), `ouverts(lotId)` (nombre de `ConditionnementOuvert` du lot avec `"fermeLe" IS NULL`).

1. `lecture : quantité, lots et date calculés depuis le journal, coûts masqués sans marge:read` : `getStockPharmacie('str-pharma-1', 'usr-admin-p1')` : `stk-06` a `quantite` 240, `quantiteVendable` 240, `disponible` true, `reliquat` `[]`, `lots` d'un élément (`lotTechnique` true, `numeroLot` null, `quantite` 240, `coutUnitaire` 0), `dateExpiration.toISOString().slice(0, 10)` = `jour(0)` ; `stk-01` a `quantite` 0, `lots` `[]`, `dateExpiration` null, `disponible` false ; `cheminsCout(r)` non vide. Même appel avec `usr-pharm-p1` : `cheminsCout(r)` vaut `[]`.
2. `upsert d'une fiche nouvelle avec stock : lot non technique sans coût et mouvement RECEPTION` : `upsertStock('str-pharma-2', 'usr-admin-p2', { medicamentId: 'med-16', quantite: 12, prixUnitaire: 3000, dateExpiration: jour(200) })` : `message` « Stock mis à jour », `data.quantite` 12, `data.disponible` true, `data.avertissements` `[]`, `data.lots[0].coutUnitaire` 0 ; en base : la fiche (`structureId` `str-pharma-2`, `medicamentId` `med-16`) a `quantite` 0 ; un seul lot : `lotTechnique` false, `coutUnitaire` 0, `numeroLot` null, `coefficientReception` 1, `quantiteRecue` 12, `"dateExpiration"::text` = `jour(200)`, `auteurId` `usr-admin-p2`, `pointDeVenteId` = `pv2` ; un seul mouvement `RECEPTION`, pièce `AJUSTEMENT`, quantité 12, motif « Quantité saisie sur la fiche de stock », auteur `usr-admin-p2`.
3. `création de lot sans date : 400 DATE_PEREMPTION_REQUISE sans rien écrire ; sansPeremption l'autorise ; quantité nulle sans lot` : `upsertStock('str-pharma-1', 'usr-admin-p1', { medicamentId: 'med-01', quantite: 5, prixUnitaire: 999 })` : statut 400, `corps.code` `DATE_PEREMPTION_REQUISE`, `corps.message` = `MESSAGE_DATE_PEREMPTION_REQUISE` ; `stk-01` a toujours `prixUnitaire` 1500 et aucun lot. Puis `{ medicamentId: 'med-01', quantite: 5, sansPeremption: true }` : un lot de 5 à `dateExpiration` nulle, `data.quantite` 5, `data.dateExpiration` null. Puis `upsertStock('str-pharma-2', 'usr-admin-p2', { medicamentId: 'med-17', quantite: 0 })` : fiche créée, aucun lot ni mouvement, `data.quantite` 0, `data.dateExpiration` null.
4. `un seul lot : INVENTAIRE vers la quantité saisie, rien à quantité égale, date du lot corrigée et auditée` : `stk-02` (1, `jour(0)`) : `upsertStock(..., { medicamentId: 'med-02', quantite: 1, prixUnitaire: 1800 })` : `mouvementsDe('stk-02')` garde 1 ligne, `prixUnitaire` en base 1800 ; `{ medicamentId: 'med-02', quantite: 5 }` : 2 lignes, la dernière `INVENTAIRE`, pièce `AJUSTEMENT`, quantité 4, motif « Quantité corrigée sur la fiche de stock », `data.quantite` 5 ; `{ medicamentId: 'med-02', quantite: 5, dateExpiration: jour(30) }` : toujours 2 lignes, date du lot technique = `jour(30)`, une ligne `AuditLog` (`entityType` `LotStock`, `entityId` = lot, `action` `update`) dont `metadata` `toEqual` `{ avant: { dateExpiration: jour(0) }, apres: { dateExpiration: jour(30) } }`, `data.dateExpiration` au jour `jour(30)`.
5. `plusieurs lots : LOT_REQUIS pour une autre quantité ou une autre date, prix seul accepté` : dans `prisma.$transaction`, `mouvements.creerLot(tx, { stockMedicamentId: 'stk-06', pointDeVenteId: pv1, numeroLot: 'L-TEST', dateExpiration: jourVersDate(jour(60)), quantite: 20, coutUnitaire: 150, coutAchatBoite: null, coefficientReception: 1, fournisseurId: null, receptionId: null, lotTechnique: false, auteurId: 'usr-admin-p1', pieceOrigineType: 'RECEPTION', pieceOrigineId: null, motif: null })`. Puis : `upsertStock(..., { medicamentId: 'med-06', quantite: 250 })` : 409 `LOT_REQUIS`, message `MESSAGE_LOT_REQUIS_QUANTITE` ; `{ medicamentId: 'med-06', quantite: 260, prixUnitaire: 4000 }` : succès, `data.quantite` 260, `data.lots` de 2 éléments (lot technique d'abord), `prixUnitaire` 4000 ; `{ medicamentId: 'med-06', quantite: 260, dateExpiration: jour(10) }` : 409 `LOT_REQUIS`, message `MESSAGE_LOT_REQUIS_DATE` ; `{ medicamentId: 'med-06', quantite: 260, dateExpiration: jour(0) }` : succès ; `updateStockQuantite('str-pharma-1', 'stk-06', 'usr-admin-p1', { variation: -1, motif: 'Casse' })` : 409 `LOT_REQUIS`, message `MESSAGE_LOT_REQUIS_CHOIX` ; `mouvementsDe('stk-06')` a 2 lignes (reprise et réception de L-TEST).
6. `PATCH : motif requis, lot inconnu, lot jamais négatif` : sur `stk-04` (10, sans date), utilisateur `usr-pharm-p1` : sans motif : 400 `MOTIF_REQUIS` ; motif `'ab'` : 400 `MOTIF_REQUIS` ; `{ variation: -1, motif: 'Casse', lotId: 'lot-inconnu' }` : 404, message `MESSAGE_LOT_INTROUVABLE` ; `{ variation: -11, motif: 'Casse' }` : 409 `STOCK_LOT_NEGATIF`, message `messageStockLotNegatif(10)` ; filet du CHECK : `prisma.$transaction((tx) => mouvements.ecrire(tx, { pointDeVenteId: pv1, stockMedicamentId: 'stk-04', lotId: <lot technique de stk-04>, type: 'PERTE', quantite: -1000, pieceOrigineType: 'SORTIE_MANUELLE', motif: 'Test', auteurId: 'usr-admin-p1' }))` : rejet `ConflictException` dont la réponse a `code` `STOCK_LOT_NEGATIF` et `message` `MESSAGE_STOCK_LOT_INSUFFISANT` ; `mouvementsDe('stk-04')` a toujours 1 ligne.
7. `PATCH : mouvement CORRECTION motivé et attribué, alerte au seul franchissement du seuil` : `const espion = jest.spyOn(notifications, 'createManyNotifications')` ; `{ variation: -1, motif: 'Boîte abîmée' }` par `usr-pharm-p1` : message « Stock réduit (nouvelle quantité : 9) », dernier mouvement `CORRECTION`, pièce `AJUSTEMENT`, quantité -1, motif « Boîte abîmée », auteur `usr-pharm-p1`, `lotId` = lot technique ; `espion` appelé une fois, avec un second argument dont `message` contient « est descendu à 9 unités. » ; `espion.mockClear()` ; `{ variation: -1, motif: 'Boîte abîmée' }` : `espion` non appelé ; `{ variation: 5, motif: 'Retour client', notes: 'Retour du 25' }` : message « Stock augmenté (nouvelle quantité : 13) », `notes` de la fiche « Retour du 25 » ; `espion.mockRestore()`.
8. `PATCH concurrents sur un même lot : aucune mise à jour perdue` : lot technique de `stk-06` (solde 240) ; trois appels simultanés `updateStockQuantite('str-pharma-1', 'stk-06', 'usr-admin-p1', { variation: -100, lotId, motif: 'Inventaire tournant' })` par `Promise.allSettled` : exactement 2 réussis, 1 rejeté dont la réponse a `code` `STOCK_LOT_NEGATIF` ; `AgregatStockLot.quantite` du lot = 40 ; somme des mouvements `CORRECTION` du lot = -200.
9. `conditionnement ouvert tenu par le service, seconde ouverture refusée (CA6)` : `UPDATE "StockMedicament" SET "coefficientBoite" = 10 WHERE "id" = 'stk-07'` (SQL) ; `upsertStock('str-pharma-1', 'usr-admin-p1', { medicamentId: 'med-07', quantite: 30, dateExpiration: jour(100) })` : un lot `coefficientReception` 10, `ouverts(lot)` 0 ; `updateStockQuantite(..., 'stk-07', ..., { variation: -3, lotId, motif: 'Vente au détail' })` : `ouverts(lot)` 1, la ligne ouverte a `unitesParConditionnement` 10 et `ouvertParId` `usr-admin-p1`, `getStockPharmacie` donne pour `stk-07` `reliquat` `[{ lotId, unitesRestantes: 7 }]` ; `{ variation: -7, ... }` : 1 ligne au total, fermée (`fermeLe` non nul), `ouverts(lot)` 0, `reliquat` `[]` ; `{ variation: -5, ... }` : 2 lignes au total, `ouverts(lot)` 1 ; puis `prisma.$transaction((tx) => mouvements.ouvrirConditionnement(tx, { stockMedicamentId: 'stk-07', lotId, pointDeVenteId: pv1, unitesParConditionnement: 10, ouvertParId: 'usr-admin-p1', ouvertParPieceId: null }))` : rejet `ConflictException`, réponse `code` `CONDITIONNEMENT_DEJA_OUVERT`, `message` `MESSAGE_CONDITIONNEMENT_DEJA_OUVERT` ; `ouverts(lot)` toujours 1.
10. `périmés : quantité vendable, date calculée, recherche et détail sans le lot périmé` : `creerLot` sur `stk-05` (11, lot technique à `jour(-30)`) : 5 unités, `dateExpiration` `jourVersDate(jour(90))`, coût 0, coefficient 1, non technique, pièce `RECEPTION`, motif null, auteur `usr-admin-p1`, `pointDeVenteId` `pv1` ; `getStockPharmacie(..., 'usr-admin-p1')` : `stk-05` `quantite` 16, `quantiteVendable` 5, `disponible` true, `dateExpiration` au jour `jour(90)`, `lots` de 2 éléments dont le premier daté `jour(-30)` ; `rechercherDisponibilite(undefined, undefined, undefined, undefined, 'str-pharma-1')` : l'entrée `stk-05` a `quantite` 5, `disponible` true, `dateExpiration` au jour `jour(90)`, ni `lots`, ni `reliquat`, ni `quantiteVendable` ; `cheminsCout` de la réponse `[]` ; `getMedicament('med-05')` : l'entrée `stk-05` a `quantite` 5 ; `cheminsCout` `[]`.
11. `archivage : DELETE archive, la fiche sort des lectures, 404 aux corrections, l'upsert désarchive` : `stk-08` (1, sans date) : `removeStockItem('str-pharma-1', 'stk-08', 'usr-admin-p1')` : message « Médicament retiré du stock » ; en base la fiche existe, `archiveLe` non nul, `mouvementsDe('stk-08')` 1 ligne, une ligne `AuditLog` (`StockMedicament`, `stk-08`, `update`) dont `metadata.avant` vaut `{ archiveLe: null }` ; `getStockPharmacie('str-pharma-1', ...)` : 19 fiches, aucune `stk-08`, `stk-08` absente de `alertes.stockBas` ; `rechercherDisponibilite` (pharmacie `str-pharma-1`) et `getMedicament('med-08')` sans `stk-08` ; `updateStockQuantite(..., 'stk-08', ..., { variation: 1, motif: 'Retour' })` : 404 message « Stock non trouvé » ; `fiches.modifierFiche('str-pharma-1', 'usr-admin-p1', 'stk-08', { prixUnitaire: 10 })` : 404 message `MESSAGE_FICHE_INTROUVABLE` ; second `removeStockItem` : même réponse, toujours une seule ligne d'audit d'archivage ; `upsertStock(..., { medicamentId: 'med-08', quantite: 1 })` : `archiveLe` nul, 20 fiches listées, `data.quantite` 1, toujours 1 mouvement, une ligne d'audit de désarchivage (`metadata.apres` vaut `{ archiveLe: null }`).
12. `catalogue : MEDICAMENT_UTILISE si lot ou ligne de vente, suppression sinon` : `deleteMedicament('med-06', 'usr-admin-p1')` : 409, `code` `MEDICAMENT_UTILISE`, message `MESSAGE_MEDICAMENT_UTILISE`, le médicament existe toujours ; SQL : `INSERT INTO "Medicament" ("id", "nom", "categorie", "updatedAt") VALUES ('med-test-vendu', 'Médicament vendu (test)', 'Test PB08', now())` puis `INSERT INTO "LigneVente" ("id", "venteId", "medicamentId", "stockMedicamentId", "nomMedicament", "prixUnitaire", "quantite", "sousTotal") VALUES ('lv-test-vendu', 'vte-p1-1', 'med-test-vendu', 'stk-inexistant', 'Médicament vendu (test)', 100, 1, 100)` : `deleteMedicament('med-test-vendu')` : 409 `MEDICAMENT_UTILISE` ; SQL : `INSERT INTO "Medicament" ("id", "nom", "categorie", "updatedAt") VALUES ('med-test-libre', 'Médicament libre (test)', 'Test PB08 libre', now())` et `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "updatedAt") VALUES ('stk-test-libre', 'med-test-libre', 'str-pharma-2', 0, false, now())` : `deleteMedicament('med-test-libre', 'usr-admin-p1')` : message « Médicament supprimé du catalogue », ni `med-test-libre` ni `stk-test-libre` en base.
13. `journal cohérent après le scénario` : `verifierStock(base.client)` (`src/pharmacie/stock/commandes-stock.ts`) : `totalAnomalies` 0.

### 12. `CLAUDE.md` du dépôt back

Ajouter, juste après la puce « **Journal de stock (tranche pharmacie 1, PB07)** », la puce suivante (texte exact) :

```markdown
- **Stock recâblé sur le journal (tranche pharmacie 1, PB08)** : `MouvementsStockService` (`src/pharmacie/stock/mouvements-stock.service.ts`) est le seul écrivain de `MouvementStock`, des lots et de `ConditionnementOuvert` : verrou consultatif par fiche (`pg_advisory_xact_lock(hashtextextended('medconnecte:stock:<id>', 0))`, identifiants triés, par `$executeRaw`, jamais `$queryRaw` qui échoue sur le type `void`), verrou de ligne de la fiche toujours pris avant le verrou consultatif, conditionnement ouvert quand le reliquat d'un lot devient non nul et fermé à zéro (409 `CONDITIONNEMENT_DEJA_OUVERT` pour une seconde ouverture), lot jamais négatif (409 `STOCK_LOT_NEGATIF`). Lectures (`src/pharmacie/stock/lecture-stock.ts`) : `GET /pharmacie/stock/:structureId` garde son contrat ; `quantite` = stock calculé en unités minimales, `dateExpiration` = date du lot que la vente prendrait en premier (sinon la plus ancienne des lots restants, tous périmés, sinon `null`), `disponible` = quantité positive, plus `quantiteVendable`, `reliquat` `[{ lotId, unitesRestantes }]` et `lots` `[{ id, numeroLot, dateExpiration, quantite, lotTechnique, coutUnitaire }]` (`coutUnitaire` retiré sans `marge:read`) ; alertes : stock bas si 0 < quantité < `seuilStockBas` (boîtes) x `coefficientBoite`, rupture si quantité <= 0 ; fiches archivées exclues. Recherche publique et détail catalogue : seuls les lots non périmés comptent (`quantite` = quantité vendable), fiches archivées exclues, ni lots ni coûts. Écritures : upsert (`quantite` en unités minimales ; sans lot en stock, crée un lot sans coût, date de péremption obligatoire sauf `sansPeremption: true`, 400 `DATE_PEREMPTION_REQUISE` ; un seul lot : mouvement `INVENTAIRE` vers la quantité saisie et correction auditée de la date du lot ; plusieurs lots : 409 `LOT_REQUIS` si la quantité ou la date diffère ; désarchive la fiche ; réponse = fiche lue + `avertissements`) ; `PATCH .../quantite` `{ variation (non nulle), lotId?, motif (3 à 300 caractères, 400 MOTIF_REQUIS), notes? }` écrit un mouvement `CORRECTION` (409 `LOT_REQUIS`, 409 `STOCK_LOT_NEGATIF`, 404 « Ce lot est introuvable pour ce médicament. ») ; `DELETE /pharmacie/stock/:structureId/:stockId` archive (`archiveLe`, audité), une fiche archivée répond 404 aux corrections et à `PATCH .../fiche` ; `DELETE /pharmacie/catalogue/:medicamentId` : 409 `MEDICAMENT_UTILISE` si une pharmacie a un lot, un mouvement ou une vente de ce médicament. L'import Excel du stock et la vente écrivent encore le compteur gelé jusqu'à PB11, PB14 et PB15.
```

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Propres à cette tâche :
- Aucune migration, aucun changement de `prisma/schema.prisma`, jamais `prisma migrate dev`, `migrate reset` ni `db push` sur la base de dev.
- Ne jamais modifier `test/db/instantanes/*.json` ni lancer `MAJ_INSTANTANES=1`. Dans `non-regression-lectures.db-spec.ts`, seules les modifications de la section 9.2 sont permises.
- Jamais d'écriture d'un agrégat, jamais de mise à jour ni de suppression d'un mouvement, jamais d'écriture de `StockMedicament.quantite`, `disponible` ou `dateExpiration`.
- Toute sortie qui porte un coût passe par `masquerCouts` (D466). Aucune clé autre qu'un coût ne contient « cout » ou « marge ».
- Ne jamais afficher ni écrire d'URL de base, de mot de passe ni de valeur de `.env` (D454).
- Français partout ; aucun tiret cadratin ni demi-cadratin, aucun caractère de points de suspension.
- Si une instruction de cette fiche se révèle impossible (erreur de type Prisma, comportement constaté différent), s'arrêter en BLOCKED avec la commande et l'erreur, sans improviser une autre règle métier.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (racine du monorepo) :

1. `docker compose exec -T backend npx tsc --noEmit` : code 0.
2. `docker compose exec -T backend npx eslint src/common/filters/codes-erreur.ts src/pharmacie/stock/erreurs-base.ts src/pharmacie/stock/erreurs-base.spec.ts src/pharmacie/stock/mouvements-stock.service.ts src/pharmacie/stock/mouvements-stock.service.spec.ts src/pharmacie/stock/lecture-stock.ts src/pharmacie/stock/lecture-stock.spec.ts src/pharmacie/dto/pharmacie.dto.ts src/pharmacie/dto/pharmacie.dto.spec.ts src/pharmacie/pharmacie.service.ts src/pharmacie/pharmacie.module.ts src/pharmacie/pharmacie.controller.ts src/pharmacie/fiche-produit.service.ts src/pharmacie/pharmacie.import.spec.ts test/db/outils-instantanes.ts test/db/non-regression-lectures.db-spec.ts test/db/fiche-produit.db-spec.ts test/db/mouvements-stock.db-spec.ts` : 0 erreur ; seuls les 7 avertissements `no-unsafe-argument` préexistants de `pharmacie.controller.ts` sont tolérés.
3. `docker compose exec -T backend npm test` : tout vert (les nouvelles suites `erreurs-base`, `mouvements-stock.service`, `lecture-stock` présentes ; `pharmacie.stock-quantite.spec.ts` n'existe plus).
4. `docker compose exec -T backend npm run test:db` : tout vert, dont `mouvements-stock.db-spec.ts` (13 tests), `non-regression-lectures.db-spec.ts` et `fiche-produit.db-spec.ts`.
5. `git -C back_medconnect status --short test/db/instantanes prisma` : vide (aucun instantané, aucun schéma ni migration modifiés).
6. Aucune base `mc_test_` restante après les tests (requête de liste des bases sur le serveur de test, sans afficher d'URL).
7. `git -C back_medconnect diff -U0 | LC_ALL=C.UTF-8 grep -nP '[\x{2013}\x{2014}\x{2026}]'` et la même recherche sur les fichiers non suivis : aucune ligne.

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

Fichiers attendus : `src/common/filters/codes-erreur.ts`, `src/pharmacie/stock/erreurs-base.ts`, `src/pharmacie/stock/erreurs-base.spec.ts`, `src/pharmacie/stock/mouvements-stock.service.ts`, `src/pharmacie/stock/mouvements-stock.service.spec.ts`, `src/pharmacie/stock/lecture-stock.ts`, `src/pharmacie/stock/lecture-stock.spec.ts`, `src/pharmacie/dto/pharmacie.dto.ts`, `src/pharmacie/dto/pharmacie.dto.spec.ts`, `src/pharmacie/pharmacie.service.ts`, `src/pharmacie/pharmacie.module.ts`, `src/pharmacie/pharmacie.controller.ts`, `src/pharmacie/fiche-produit.service.ts`, `src/pharmacie/pharmacie.import.spec.ts`, `src/pharmacie/pharmacie.stock-quantite.spec.ts` (supprimé), `test/db/outils-instantanes.ts`, `test/db/non-regression-lectures.db-spec.ts`, `test/db/fiche-produit.db-spec.ts`, `test/db/mouvements-stock.db-spec.ts`, `CLAUDE.md`.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
2026-10-25 | tsc, eslint (18 fichiers), npm test, npm run test:db relancés par le chef | 0 erreur, 882 tests unitaires et 107 tests en base verts, 0 base mc_test_ restante | voir le commit (PB08) sur orch/pharmacie-t1-back
