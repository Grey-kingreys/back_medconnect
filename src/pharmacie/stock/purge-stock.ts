import type { Prisma } from 'generated/prisma/client';

/**
 * Supprime le journal de stock des structures données : conditionnements ouverts,
 * agrégats, mouvements et lots de leurs points de vente (D503). Réservé à la purge du
 * jeu démo et au harnais : le contournement `medconnecte.purge_autorisee` (local à la
 * transaction, D496) n'autorise que les suppressions, et il est retiré à la fin.
 * À appeler avant `supprimerConfigurationPharmacies` (les lots référencent les points
 * de vente). Jamais pour la suppression d'une vraie pharmacie. Liste vide : aucune requête.
 */
export async function purgerStockPharmacies(
  tx: Prisma.TransactionClient,
  structureIds: string[],
): Promise<void> {
  if (structureIds.length === 0) return;
  const parPointDeVente = {
    pointDeVente: { structureId: { in: structureIds } },
  };
  await tx.$queryRaw`SELECT set_config('medconnecte.purge_autorisee', 'on', true)`;
  await tx.conditionnementOuvert.deleteMany({ where: parPointDeVente });
  await tx.agregatStockLot.deleteMany({ where: parPointDeVente });
  await tx.agregatStockProduit.deleteMany({ where: parPointDeVente });
  await tx.mouvementStock.deleteMany({ where: parPointDeVente });
  await tx.lotStock.deleteMany({ where: parPointDeVente });
  await tx.$queryRaw`SELECT set_config('medconnecte.purge_autorisee', 'off', true)`;
}
