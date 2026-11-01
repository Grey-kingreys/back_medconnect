import type { Prisma } from 'generated/prisma/client';

export interface PlageLue {
  id: string;
  debut: number;
  fin: number;
}

/**
 * Plages non épuisées d'un poste (D632), par début croissant. Une plage est épuisée
 * quand une pièce du poste porte son dernier numéro, ou quand une pièce du poste
 * porte un numéro d'une plage plus récente du même poste.
 */
export async function lirePlagesNonEpuisees(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
  posteId: string,
): Promise<PlageLue[]> {
  return client.$queryRaw<PlageLue[]>`
    SELECT p."id", p."debut", p."fin" FROM "PlageTicket" p
    WHERE p."posteId" = ${posteId}
      AND NOT EXISTS (SELECT 1 FROM "Vente" v WHERE v."pointDeVenteId" = p."pointDeVenteId" AND v."posteId" = p."posteId" AND v."numeroTicket" = p."fin")
      AND NOT EXISTS (SELECT 1 FROM "PlageTicket" q JOIN "Vente" v2 ON v2."pointDeVenteId" = q."pointDeVenteId" AND v2."posteId" = q."posteId" AND v2."numeroTicket" BETWEEN q."debut" AND q."fin"
                      WHERE q."posteId" = p."posteId" AND q."debut" > p."fin")
    ORDER BY p."debut" ASC, p."id" ASC`;
}
