// Idempotence de la création d'une alerte SOS (en-tête `Idempotency-Key`, D59 à D61).
import { Prisma } from 'generated/prisma/client';
import type { QualitePositionSos } from './sos-position';

export const SOS_IDEMPOTENCE_HEURES = 24;

const FORMAT_CLE = /^[A-Za-z0-9._:-]{8,128}$/;

export const MESSAGE_SOS_DIFFUSION_EN_COURS =
  "Votre alerte est déjà en cours d'envoi. En cas de danger immédiat, appelez les secours.";

/** Clé lue dans l'en-tête (trim), ou null si absente ou mal formée (D60). */
export function lireCleIdempotence(enTete: string | undefined): string | null {
  if (typeof enTete !== 'string') return null;
  const cle = enTete.trim();
  return FORMAT_CLE.test(cle) ? cle : null;
}

/** Bilan de diffusion enregistré avec l'alerte et renvoyé tel quel à un rejeu. */
export interface BilanSos {
  structuresAlertees: number;
  soignantsAlertes: number;
  procheAlerte: boolean;
  positionTransmise: boolean;
  positionUtilisee: boolean;
  qualitePosition: QualitePositionSos;
  precisionMetres: number | null;
  message: string;
}

export function estBilanSos(valeur: unknown): valeur is BilanSos {
  if (typeof valeur !== 'object' || valeur === null) return false;
  const v = valeur as Record<string, unknown>;
  return (
    typeof v.structuresAlertees === 'number' &&
    typeof v.soignantsAlertes === 'number' &&
    typeof v.procheAlerte === 'boolean' &&
    typeof v.positionTransmise === 'boolean' &&
    typeof v.positionUtilisee === 'boolean' &&
    typeof v.qualitePosition === 'string' &&
    typeof v.message === 'string' &&
    (typeof v.precisionMetres === 'number' || v.precisionMetres === null)
  );
}

/** Vrai pour un P2002 levé par l'unicité (patientId, cleIdempotence) : rejeu concurrent. */
export function estConflitCleIdempotence(erreur: unknown): boolean {
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
  return `${erreur.message} ${meta}`.includes('cleIdempotence');
}

/** Champs de l'alerte renvoyables au client : sans patient, clé ni bilan (D61). */
export function donneesUrgencePubliques(
  urgence: Record<string, unknown>,
): Record<string, unknown> {
  const champsExclus = new Set(['patient', 'cleIdempotence', 'bilanDiffusion']);
  return Object.fromEntries(
    Object.entries(urgence).filter(([cle]) => !champsExclus.has(cle)),
  );
}
