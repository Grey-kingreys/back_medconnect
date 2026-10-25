import type { Prisma } from 'generated/prisma/client';

/**
 * Supprime les pièces de caisse et de vente des structures données (D523) :
 * allocations, paiements, lignes et pièces de vente (pièces liées à une origine
 * d'abord), mouvements de caisse, résultats, relevés, lignes de comptage, comptages,
 * sessions (techniques comprises), totaux et clôtures, lignes d'inventaire et
 * inventaires, événements de synchronisation. Réservé à la purge du jeu démo et au
 * harnais : le contournement `medconnecte.purge_autorisee` (local à la transaction,
 * D496) n'autorise que les suppressions, et il est retiré à la fin. À appeler avant
 * `purgerStockPharmacies` (les lignes d'inventaire référencent les lots). Jamais pour
 * la suppression d'une vraie pharmacie. Liste vide : aucune requête.
 */
export async function purgerPiecesPharmacies(
  tx: Prisma.TransactionClient,
  structureIds: string[],
): Promise<void> {
  if (structureIds.length === 0) return;
  const parStructure = { structureId: { in: structureIds } };
  const parPointDeVente = { pointDeVente: parStructure };
  const parSession = { sessionCaisse: parPointDeVente };
  await tx.$queryRaw`SELECT set_config('medconnecte.purge_autorisee', 'on', true)`;
  await tx.allocationLot.deleteMany({
    where: { ligneVente: { vente: parStructure } },
  });
  await tx.paiement.deleteMany({ where: { vente: parStructure } });
  await tx.ligneVente.deleteMany({ where: { vente: parStructure } });
  await tx.vente.deleteMany({
    where: { ...parStructure, venteOrigineId: { not: null } },
  });
  await tx.vente.deleteMany({ where: parStructure });
  await tx.mouvementCaisse.deleteMany({ where: parPointDeVente });
  await tx.resultatSessionMode.deleteMany({ where: parSession });
  await tx.releveModePaiement.deleteMany({ where: { comptage: parSession } });
  await tx.ligneComptage.deleteMany({ where: { comptage: parSession } });
  await tx.comptageCaisse.deleteMany({ where: parSession });
  await tx.sessionCaisse.deleteMany({ where: parPointDeVente });
  await tx.totalClotureMode.deleteMany({
    where: { cloture: parPointDeVente },
  });
  await tx.clotureJournaliere.deleteMany({ where: parPointDeVente });
  await tx.ligneInventaire.deleteMany({
    where: { inventaire: parPointDeVente },
  });
  await tx.inventaire.deleteMany({ where: parPointDeVente });
  await tx.evenementSynchro.deleteMany({ where: { poste: parPointDeVente } });
  await tx.$queryRaw`SELECT set_config('medconnecte.purge_autorisee', 'off', true)`;
}
