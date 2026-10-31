import { ConflictException } from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import type { PrismaService } from 'src/common/services/prisma.service';
import { jourConakry, jourLisible, lendemain } from '../jour-metier';
import { jourVersDate } from '../stock/lecture-stock';

type Client = PrismaService | Prisma.TransactionClient;

/** Clé du verrou consultatif des journées d'une pharmacie. */
export function cleVerrouJournees(structureId: string): string {
  return `medconnecte:journees:${structureId}`;
}

/** Écrivain de caisse : verrou partagé, première instruction de sa transaction (réentrant). */
export async function verrouillerJourneesPartage(
  tx: Prisma.TransactionClient,
  structureId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${cleVerrouJournees(structureId)}, 0))`;
}

/** Clôture : verrou exclusif, première instruction de sa transaction. */
export async function verrouillerJourneesExclusif(
  tx: Prisma.TransactionClient,
  structureId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cleVerrouJournees(structureId)}, 0))`;
}

export async function estJourCloture(
  client: Client,
  pointDeVenteId: string,
  jour: string,
): Promise<boolean> {
  const cloture = await client.clotureJournaliere.findUnique({
    where: {
      pointDeVenteId_jourMetier: {
        pointDeVenteId,
        jourMetier: jourVersDate(jour),
      },
    },
    select: { id: true },
  });
  return cloture !== null;
}

export function messageJourneeCloturee(jour: string): string {
  return `La journée du ${jourLisible(jour)} est clôturée : plus rien ne peut y être enregistré. Les corrections se font sur la journée en cours.`;
}

export function messageCaisseJourneeCloturee(jour: string): string {
  return `Cette caisse compte pour la journée du ${jourLisible(jour)}, déjà clôturée : elle ne peut plus rien enregistrer. Encaissez sur un autre poste ; elle sera fermée quand ce poste aura envoyé ses ventes.`;
}

export function messageReceptionJourneeCloturee(jour: string): string {
  return `La journée du ${jourLisible(jour)} est clôturée : une réception ne peut plus y être datée. Indiquez la date d'aujourd'hui.`;
}

/** 409 JOURNEE_CLOTUREE si le jour est clôturé. */
export async function exigerJourOuvert(
  client: Client,
  pointDeVenteId: string,
  jour: string,
  message?: string,
): Promise<void> {
  if (await estJourCloture(client, pointDeVenteId, jour)) {
    throw new ConflictException({
      message: message ?? messageJourneeCloturee(jour),
      code: 'JOURNEE_CLOTUREE',
    });
  }
}

/** Jour de rattachement d'une écriture faite maintenant : aujourd'hui s'il n'est pas clôturé, sinon le lendemain (D615). */
export async function jourDeRattachement(
  client: Client,
  pointDeVenteId: string,
  maintenant: Date,
): Promise<{ jour: string; jourReel: string }> {
  const jourReel = jourConakry(maintenant);
  // Un lendemain n'est jamais clôturé (la clôture refuse un jour futur) : une lecture suffit.
  const jour = (await estJourCloture(client, pointDeVenteId, jourReel))
    ? lendemain(jourReel)
    : jourReel;
  return { jour, jourReel };
}
