/** Format exigé dans les variables d'environnement (validateEnv). */
export const FORMAT_VERSION_CONFIG = /^\d{1,9}\.\d{1,9}\.\d{1,9}$/;

// 1 à 3 nombres ; tout suffixe après « - » ou « + » est ignoré (1.2.0-beta vaut 1.2.0).
const FORMAT_LECTURE = /^(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(?:[-+].*)?$/;

export type Version = [number, number, number];

/** Lit une version envoyée par un client (« 1.4 », « 1.4.2-beta »), null si illisible. */
export function lireVersion(brut: string | undefined | null): Version | null {
  const texte = brut?.trim();
  if (!texte) return null;
  const m = FORMAT_LECTURE.exec(texte);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Négatif si a < b, 0 si égales, positif si a > b. */
export function comparerVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}
