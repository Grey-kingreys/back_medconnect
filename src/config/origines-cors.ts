/** Taille maximale d'un corps JSON (D636, branchée par PB18b). */
export const LIMITE_CORPS_JSON = '2mb';
export const MAX_ORIGINES_DESKTOP = 10;
const MOTIF_ORIGINE_DESKTOP = /^http:\/\/(127\.0\.0\.1|localhost):(\d{4,5})$/;

/**
 * Lit la liste `DESKTOP_ORIGINS` (D635). Les origines valides sont toujours
 * renvoyées, même si une erreur est signalée : la passerelle socket.io est
 * évaluée avant la validation de configuration et ne doit jamais lever.
 * Le message d'erreur ne contient jamais la valeur lue.
 */
export function analyserOriginesDesktop(valeur: string | undefined): {
  origines: string[];
  erreur: string | null;
} {
  if (valeur === undefined || valeur.trim() === '') {
    return { origines: [], erreur: null };
  }
  const elements = valeur
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e !== '');

  let erreur: string | null = null;
  if (elements.length > MAX_ORIGINES_DESKTOP) {
    erreur = `doit contenir ${MAX_ORIGINES_DESKTOP} origines au plus (actuellement ${elements.length})`;
  }

  const origines: string[] = [];
  elements.forEach((element, index) => {
    const correspondance = MOTIF_ORIGINE_DESKTOP.exec(element);
    const port = correspondance ? Number(correspondance[2]) : 0;
    if (!correspondance || port < 1024 || port > 65535) {
      erreur ??= `l'origine n°${index + 1} est invalide : attendu http://127.0.0.1:<port> ou http://localhost:<port> (port 1024 à 65535)`;
      return;
    }
    if (!origines.includes(element)) origines.push(element);
  });
  return { origines, erreur };
}

export function validerOriginesDesktop(valeur: string): string | null {
  return analyserOriginesDesktop(valeur).erreur;
}

/** Origines acceptées par le CORS HTTP et socket.io : le front web puis le serveur local du desktop. */
export function originesCors(
  env: Record<string, string | undefined>,
): string[] {
  const toutes = [
    env.FRONTEND_URL || 'http://localhost:3000',
    ...analyserOriginesDesktop(env.DESKTOP_ORIGINS).origines,
  ];
  return toutes.filter((o, i) => toutes.indexOf(o) === i);
}
