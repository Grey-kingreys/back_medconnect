/**
 * Permissions effectives selon le type de structure.
 *
 * Une pharmacie n'a aucun accès au dossier médical, quel que soit son rôle, y compris
 * un rôle personnalisé. Les rôles en base ne sont pas modifiés : la permission y reste
 * présente mais devient inopérante au calcul des permissions effectives.
 *
 * Liste blanche : toute nouvelle permission du catalogue est refusée aux pharmacies
 * tant qu'on ne l'ajoute pas ici. Inversement, les permissions de vente sont retirées
 * à tout autre type de structure.
 */
import type { StructureType } from 'generated/prisma/enums';
import { PERMISSIONS, type PermissionCode } from './permissions.constants';

/** Permissions conservées par tout membre d'une pharmacie (liste blanche). */
export const PERMISSIONS_AUTORISEES_PHARMACIE: readonly PermissionCode[] = [
  PERMISSIONS.STOCK_READ,
  PERMISSIONS.STOCK_WRITE,
  PERMISSIONS.CATALOGUE_WRITE,
  PERMISSIONS.CATALOGUE_MANAGE,
  PERMISSIONS.VENTE_READ,
  PERMISSIONS.VENTE_WRITE,
  PERMISSIONS.VENTE_ANNULER,
  PERMISSIONS.STRUCTURE_READ,
  PERMISSIONS.STRUCTURE_WRITE,
  PERMISSIONS.MEMBRE_READ,
  PERMISSIONS.MEMBRE_MANAGE,
  PERMISSIONS.ROLE_MANAGE,
  PERMISSIONS.CHAT_STRUCTURE,
];

/** Permissions réservées aux pharmacies : retirées pour tout autre type de structure. */
export const PERMISSIONS_RESERVEES_PHARMACIE: readonly PermissionCode[] = [
  PERMISSIONS.VENTE_READ,
  PERMISSIONS.VENTE_WRITE,
  PERMISSIONS.VENTE_ANNULER,
];

const autorisees = new Set<string>(PERMISSIONS_AUTORISEES_PHARMACIE);
const reservees = new Set<string>(PERMISSIONS_RESERVEES_PHARMACIE);

/** Type de la structure de l'utilisateur : rattachement, à défaut structure administrée. */
export function typeStructureEffectif(
  user:
    | {
        structure?: { type: StructureType } | null;
        administeredStructure?: { type: StructureType } | null;
      }
    | null
    | undefined,
): StructureType | null {
  return user?.structure?.type ?? user?.administeredStructure?.type ?? null;
}

/** Liste blanche pour une pharmacie ; sinon retire seulement les permissions réservées aux pharmacies. */
export function filtrerPermissionsSelonTypeStructure(
  codes: string[],
  type: StructureType | null,
): string[] {
  if (type === 'PHARMACIE') {
    return codes.filter((c) => autorisees.has(c));
  }
  // Même référence quand rien n'est retiré (comportement d'avant B13).
  const restants = codes.filter((c) => !reservees.has(c));
  return restants.length === codes.length ? codes : restants;
}
