import type {
  ParametresPharmacie,
  PointDeVente,
  Prisma,
} from 'generated/prisma/client';

/** Poste technique qui porte les ventes d'avant la tranche (D421, D484). */
export const CODE_POSTE_REPRISE = 'REPRISE';
export const LIBELLE_POSTE_REPRISE = 'Reprise des ventes historiques';

export interface PointDeVenteAssure {
  pointDeVente: PointDeVente;
  parametres: ParametresPharmacie;
}

/**
 * Crée, s'ils manquent, le point de vente (ordre 1) d'une pharmacie, son poste
 * technique REPRISE, son compteur de tickets et ses paramètres (D478). Idempotent :
 * upserts sans mise à jour, mêmes lignes que la migration M2. L'appelant vérifie
 * que la structure est une PHARMACIE.
 */
export async function assurerPointDeVente(
  tx: Prisma.TransactionClient,
  structure: { id: string; nom: string },
): Promise<PointDeVenteAssure> {
  const pointDeVente = await tx.pointDeVente.upsert({
    where: { structureId_ordre: { structureId: structure.id, ordre: 1 } },
    create: { structureId: structure.id, ordre: 1, nom: structure.nom },
    update: {},
  });
  await tx.poste.upsert({
    where: {
      pointDeVenteId_code: {
        pointDeVenteId: pointDeVente.id,
        code: CODE_POSTE_REPRISE,
      },
    },
    create: {
      pointDeVenteId: pointDeVente.id,
      code: CODE_POSTE_REPRISE,
      libelle: LIBELLE_POSTE_REPRISE,
      type: 'TECHNIQUE',
      actif: false,
    },
    update: {},
  });
  await tx.compteurTicket.upsert({
    where: { pointDeVenteId: pointDeVente.id },
    create: { pointDeVenteId: pointDeVente.id },
    update: {},
  });
  const parametres = await tx.parametresPharmacie.upsert({
    where: { structureId: structure.id },
    create: { structureId: structure.id },
    update: {},
  });
  return { pointDeVente, parametres };
}

/**
 * Supprime la configuration de caisse des structures données, dans l'ordre des
 * clés étrangères (toutes en Restrict) ; à appeler juste avant de supprimer ces
 * structures (D479). Liste vide : aucune requête.
 */
export async function supprimerConfigurationPharmacies(
  tx: Prisma.TransactionClient,
  structureIds: string[],
): Promise<void> {
  if (structureIds.length === 0) return;
  const parPointDeVente = {
    pointDeVente: { structureId: { in: structureIds } },
  };
  const parStructure = { structureId: { in: structureIds } };
  await tx.anomalie.deleteMany({ where: parPointDeVente });
  await tx.plageTicket.deleteMany({ where: parPointDeVente });
  await tx.poste.deleteMany({ where: parPointDeVente });
  await tx.compteurTicket.deleteMany({ where: parPointDeVente });
  await tx.pointDeVente.deleteMany({ where: parStructure });
  await tx.parametresPharmacie.deleteMany({ where: parStructure });
  await tx.fournisseur.deleteMany({ where: parStructure });
}
