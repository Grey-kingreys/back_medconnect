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
