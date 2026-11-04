/**
 * Reconnaissance des erreurs PostgreSQL remontées par Prisma et l'adaptateur pg
 * (D507). Formes constatées : CHECK violé dans un trigger = DriverAdapterError
 * dont `cause.originalMessage` nomme la contrainte ; index unique = P2002 avec
 * `meta.modelName` ; clé étrangère = P2003 ou code PostgreSQL 23503.
 */
function texte(valeur: unknown): string {
  if (typeof valeur === 'string') return valeur;
  try {
    return JSON.stringify(valeur ?? null) ?? '';
  } catch {
    return '';
  }
}

function textesErreur(erreur: unknown): string[] {
  if (typeof erreur !== 'object' || erreur === null) return [];
  const e = erreur as { message?: unknown; cause?: unknown; meta?: unknown };
  return [texte(e.message), texte(e.cause), texte(e.meta)];
}

/** Vrai si l'erreur nomme cette contrainte (CHECK, unique, clé étrangère). */
export function violeContrainte(erreur: unknown, contrainte: string): boolean {
  return textesErreur(erreur).some((t) => t.includes(contrainte));
}

/** Vrai pour un conflit d'unicité Prisma (P2002) sur ce modèle. */
export function estDoublonSur(erreur: unknown, modele: string): boolean {
  if (typeof erreur !== 'object' || erreur === null) return false;
  const e = erreur as { code?: unknown; meta?: { modelName?: unknown } };
  return e.code === 'P2002' && e.meta?.modelName === modele;
}

/** Vrai pour une clé étrangère violée (P2003 ou code PostgreSQL 23503). */
export function estCleEtrangereViolee(erreur: unknown): boolean {
  if (typeof erreur !== 'object' || erreur === null) return false;
  if ((erreur as { code?: unknown }).code === 'P2003') return true;
  return textesErreur(erreur).some((t) => t.includes('"23503"'));
}
