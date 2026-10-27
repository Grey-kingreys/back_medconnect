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
): Promise<ResolutionEcrite[]> {
  const resultat: ResolutionEcrite[] = [];
  const ids = [...new Set(p.stockMedicamentIds)].sort();
  for (const stockId of ids) {
    await mouvementsStock.verrouillerFiches(tx, [stockId]);

    // Provisoires éligibles : ni vente annulée ni pièce d'annulation (D548)
    const provisoires = await tx.allocationLot.findMany({
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
    });
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
  }
  return resultat;
}
