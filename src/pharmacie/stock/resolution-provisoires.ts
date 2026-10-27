import type { Prisma } from 'generated/prisma/client';
import {
  planifierResolution,
  type ResolutionPlanifiee,
} from '../domaine/resolution';
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

export interface ProvisoireEligible {
  id: string;
  quantite: number;
  ligneVenteId: string;
  ligneVente: {
    nomMedicament: string;
    vente: { id: string; numero: string; createdAt: Date };
  };
}

/** Provisoires éligibles d'une fiche : ni vente annulée ni pièce d'annulation (D548). */
export async function lireProvisoiresEligibles(
  tx: Pick<Prisma.TransactionClient, 'allocationLot'>,
  pointDeVenteId: string,
  stockId: string,
): Promise<ProvisoireEligible[]> {
  return tx.allocationLot.findMany({
    where: {
      statut: 'PROVISOIRE',
      quantite: { gt: 0 },
      ligneVente: {
        stockMedicamentId: stockId,
        vente: {
          pointDeVenteId,
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
  });
}

/** Écrit un plan de résolution d'une fiche : mouvements, allocations remplacées et définitives. */
export async function ecrireResolutions(
  tx: Prisma.TransactionClient,
  mouvementsStock: MouvementsStockService,
  p: {
    pointDeVenteId: string;
    stockId: string;
    pieceId: string;
    auteurId: string | null;
  },
  provisoires: readonly ProvisoireEligible[],
  plan: readonly ResolutionPlanifiee[],
): Promise<ResolutionEcrite[]> {
  const resultat: ResolutionEcrite[] = [];
  const stockId = p.stockId;
  for (const r of plan) {
    const a = provisoires.find((x) => x.id === r.allocationId);
    if (!a) continue;
    const numeroVente = a.ligneVente.vente.numero;
    const motif = `Résolution de la vente ${numeroVente}`;
    const base = {
      pointDeVenteId: p.pointDeVenteId,
      stockMedicamentId: stockId,
      type: 'VENTE' as const,
      pieceOrigineType: 'RESOLUTION' as const,
      pieceOrigineId: p.pieceId,
      motif,
      auteurId: p.auteurId,
    };
    let resolue = 0;
    for (const x of r.prises) {
      await mouvementsStock.ecrire(tx, {
        ...base,
        evenementId: `resolution:${r.allocationId}:${x.lotId}`,
        lotId: x.lotId,
        quantite: -x.quantite,
      });
      resolue += x.quantite;
    }
    await mouvementsStock.ecrire(tx, {
      ...base,
      evenementId: `resolution:${r.allocationId}:contrepartie`,
      lotId: null,
      quantite: resolue,
    });

    const { count } = await tx.allocationLot.updateMany({
      where: { id: r.allocationId, statut: 'PROVISOIRE' },
      data: { statut: 'REMPLACEE', remplaceeParPieceId: p.pieceId },
    });
    if (count !== 1) {
      throw new Error(
        `Allocation provisoire déjà résolue : ${r.allocationId}.`,
      );
    }

    await tx.allocationLot.createMany({
      data: [
        ...r.prises.map((x) => ({
          ligneVenteId: a.ligneVenteId,
          lotId: x.lotId,
          numeroLot: x.numeroLot,
          dateExpiration: x.dateExpiration
            ? jourVersDate(x.dateExpiration)
            : null,
          quantite: x.quantite,
          coutUnitaire: x.coutUnitaire,
          lotTechnique: x.lotTechnique,
          statut: 'DEFINITIVE' as const,
          sortieManuelle: false,
          motif: null,
          auteurId: p.auteurId,
        })),
        ...(r.reste > 0
          ? [
              {
                ligneVenteId: a.ligneVenteId,
                lotId: null,
                numeroLot: null,
                dateExpiration: null,
                quantite: r.reste,
                coutUnitaire: 0,
                lotTechnique: false,
                statut: 'PROVISOIRE' as const,
                sortieManuelle: false,
                motif: null,
                auteurId: p.auteurId,
              },
            ]
          : []),
      ],
    });

    resultat.push({
      allocationId: r.allocationId,
      venteId: a.ligneVente.vente.id,
      numeroVente,
      stockId,
      nom: a.ligneVente.nomMedicament,
      quantiteProvisoire: a.quantite,
      quantiteResolue: resolue,
      resteProvisoire: r.reste,
    });
  }
  return resultat;
}

/** À appeler sous les verrous consultatifs des fiches (D507), dans la transaction de la pièce. */
export async function resoudreProvisoires(
  tx: Prisma.TransactionClient,
  mouvementsStock: MouvementsStockService,
  p: ParametresResolution,
): Promise<ResolutionEcrite[]> {
  const resultat: ResolutionEcrite[] = [];
  const ids = [...new Set(p.stockMedicamentIds)].sort();
  for (const stockId of ids) {
    await mouvementsStock.verrouillerFiches(tx, [stockId]);

    const provisoires = await lireProvisoiresEligibles(
      tx,
      p.pointDeVenteId,
      stockId,
    );
    if (provisoires.length === 0) continue;

    const lots =
      (await lireLotsCandidats(tx, p.pointDeVenteId, [stockId])).get(stockId) ??
      [];
    const plan = planifierResolution(
      provisoires.map((a) => ({
        allocationId: a.id,
        venteCreeLe: a.ligneVente.vente.createdAt.toISOString(),
        quantite: a.quantite,
      })),
      lots,
      p.jour,
    );
    resultat.push(
      ...(await ecrireResolutions(
        tx,
        mouvementsStock,
        {
          pointDeVenteId: p.pointDeVenteId,
          stockId,
          pieceId: p.pieceId,
          auteurId: p.auteurId,
        },
        provisoires,
        plan,
      )),
    );
  }
  return resultat;
}

/** Résolutions écrites pour une pièce (réception ou inventaire), triées par numéro de vente puis allocation. */
export async function lireResolutionsDePiece(
  client: Pick<Prisma.TransactionClient, 'allocationLot' | 'mouvementStock'>,
  pieceId: string,
): Promise<ResolutionEcrite[]> {
  const allocations = await client.allocationLot.findMany({
    where: { remplaceeParPieceId: pieceId },
    select: {
      id: true,
      quantite: true,
      ligneVente: {
        select: {
          stockMedicamentId: true,
          nomMedicament: true,
          vente: { select: { id: true, numero: true } },
        },
      },
    },
  });
  const resolutions: ResolutionEcrite[] = [];
  for (const a of allocations) {
    const somme = await client.mouvementStock.aggregate({
      _sum: { quantite: true },
      where: {
        pieceOrigineType: 'RESOLUTION',
        pieceOrigineId: pieceId,
        lotId: { not: null },
        evenementId: { startsWith: `resolution:${a.id}:` },
      },
    });
    const quantiteResolue = -(somme._sum.quantite ?? 0);
    resolutions.push({
      allocationId: a.id,
      venteId: a.ligneVente.vente.id,
      numeroVente: a.ligneVente.vente.numero,
      stockId: a.ligneVente.stockMedicamentId,
      nom: a.ligneVente.nomMedicament,
      quantiteProvisoire: a.quantite,
      quantiteResolue,
      resteProvisoire: a.quantite - quantiteResolue,
    });
  }
  resolutions.sort((a, b) =>
    a.numeroVente !== b.numeroVente
      ? a.numeroVente < b.numeroVente
        ? -1
        : 1
      : a.allocationId < b.allocationId
        ? -1
        : a.allocationId > b.allocationId
          ? 1
          : 0,
  );
  return resolutions;
}
