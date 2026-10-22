/** Rôles qui doivent appartenir à un établissement. */
export const ROLES_ETABLISSEMENT = [
  'MEDECIN',
  'PHARMACIEN',
  'STRUCTURE_ADMIN',
  'ACCUEIL',
] as const;

export interface CompteRattachement {
  id: string;
  email: string;
  role: string;
  structureId: string | null;
  structureNom: string | null;
  structureAdministreeId: string | null;
  structureAdministreeNom: string | null;
}

export interface AnalyseRattachements {
  total: number;
  /** Administre une structure mais User.structureId est vide. */
  adminsSansStructure: CompteRattachement[];
  /** Administre une structure mais User.structureId pointe vers une autre. */
  adminsRattachesAilleurs: CompteRattachement[];
  /** Rôle d'établissement, sans User.structureId ni structure administrée. */
  rolesSansStructure: CompteRattachement[];
}

export function analyserRattachements(
  comptes: CompteRattachement[],
): AnalyseRattachements {
  const analyse: AnalyseRattachements = {
    total: comptes.length,
    adminsSansStructure: [],
    adminsRattachesAilleurs: [],
    rolesSansStructure: [],
  };
  for (const compte of comptes) {
    if (compte.structureAdministreeId !== null) {
      if (compte.structureId === null) {
        analyse.adminsSansStructure.push(compte);
      } else if (compte.structureId !== compte.structureAdministreeId) {
        analyse.adminsRattachesAilleurs.push(compte);
      }
    } else if (
      compte.structureId === null &&
      (ROLES_ETABLISSEMENT as readonly string[]).includes(compte.role)
    ) {
      analyse.rolesSansStructure.push(compte);
    }
  }
  return analyse;
}
