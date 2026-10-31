/** Jour calendaire (AAAA-MM-JJ) d'une date. Conakry est à UTC+0, donc le jour UTC. */
export function jourConakry(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Bornes [début, fin[ d'un jour AAAA-MM-JJ. */
export function bornesDuJour(jour: string): { debut: Date; fin: Date } {
  const debut = new Date(`${jour}T00:00:00.000Z`);
  const fin = new Date(debut.getTime() + 24 * 60 * 60 * 1000);
  return { debut, fin };
}

/** Jour AAAA-MM-JJ décalé de n jours (calcul par Date.UTC, aucune horloge). */
function decalerJour(jour: string, n: number): string {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

/** Jour suivant (AAAA-MM-JJ), fins de mois et d'année comprises. */
export function lendemain(jour: string): string {
  return decalerJour(jour, 1);
}

/** Jour qui précède de n jours (n >= 0). */
export function joursAvant(jour: string, n: number): string {
  return decalerJour(jour, -n);
}

/** « 30/10/2026 » pour un jour AAAA-MM-JJ. */
export function jourLisible(jour: string): string {
  const [a, m, j] = jour.split('-');
  return `${j}/${m}/${a}`;
}

const sur2 = (n: number): string => String(n).padStart(2, '0');

/** « 30/10/2026 à 14:05 » (heure de Conakry, UTC+0). */
export function instantLisible(d: Date): string {
  return `${sur2(d.getUTCDate())}/${sur2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} à ${sur2(d.getUTCHours())}:${sur2(d.getUTCMinutes())}`;
}
