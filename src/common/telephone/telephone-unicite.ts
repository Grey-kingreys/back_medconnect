/**
 * Contrôles d'unicité du téléphone partagés par toutes les écritures de
 * `User.telephone` (TB17, décisions D40 à D49).
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import {
  MESSAGE_TELEPHONE_DEJA_UTILISE,
  MESSAGE_TELEPHONE_INVALIDE,
  normaliserTelephone,
} from './telephone';

/** Nom de la colonne dérivée portant l'index unique partiel (TB17). */
export const COLONNE_TELEPHONE_NORMALISE = 'telephoneNormalise';

/** 409 TELEPHONE_DEJA_UTILISE, message affiché tel quel. */
export function erreurTelephoneDejaUtilise(): ConflictException {
  return new ConflictException({
    message: MESSAGE_TELEPHONE_DEJA_UTILISE,
    code: 'TELEPHONE_DEJA_UTILISE',
  });
}

/** Numéro normalisé, ou 400 VALIDATION sur le champ telephone. */
export function exigerTelephone(brut: string): string {
  const e164 = normaliserTelephone(brut);
  if (!e164) {
    throw new BadRequestException({
      message: MESSAGE_TELEPHONE_INVALIDE,
      code: 'VALIDATION',
      champs: [{ champ: 'telephone', contraintes: ['formatTelephone'] }],
    });
  }
  return e164;
}

/** 409 si un autre compte porte déjà ce numéro (comparaison sur la forme normalisée). */
export async function verifierTelephoneLibre(
  client: Prisma.TransactionClient,
  telephoneE164: string,
  userIdExclu?: string,
): Promise<void> {
  const autre = await client.user.findFirst({
    where: {
      telephoneNormalise: telephoneE164,
      ...(userIdExclu ? { id: { not: userIdExclu } } : {}),
    },
    select: { id: true },
  });
  if (autre) throw erreurTelephoneDejaUtilise();
}

/** Vrai pour un P2002 levé par l'index unique du téléphone (course entre deux écritures). */
export function estConflitTelephone(erreur: unknown): boolean {
  if (
    !(erreur instanceof Prisma.PrismaClientKnownRequestError) ||
    erreur.code !== 'P2002'
  ) {
    return false;
  }
  let meta = '';
  try {
    meta = JSON.stringify(erreur.meta ?? {});
  } catch {
    meta = '';
  }
  return `${erreur.message} ${meta}`.includes(COLONNE_TELEPHONE_NORMALISE);
}

/** Exécute l'écriture et traduit un P2002 du téléphone en 409 TELEPHONE_DEJA_UTILISE. */
export async function avecTelephoneUnique<T>(ecriture: Promise<T>): Promise<T> {
  try {
    return await ecriture;
  } catch (erreur) {
    if (estConflitTelephone(erreur)) throw erreurTelephoneDejaUtilise();
    throw erreur;
  }
}
