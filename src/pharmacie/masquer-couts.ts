/**
 * Masquage des coûts côté serveur (D407, D466). Toute clé qui contient « cout »
 * ou « marge » (sans tenir compte de la casse) est une donnée de coût : aucune
 * autre clé ne doit contenir ces mots.
 */
export const MOTIF_CLE_COUT = /cout|marge/i;

function estObjetSimple(valeur: unknown): valeur is Record<string, unknown> {
  if (typeof valeur !== 'object' || valeur === null) return false;
  const proto = Object.getPrototypeOf(valeur) as unknown;
  return proto === Object.prototype || proto === null;
}

function masquer(valeur: unknown): unknown {
  if (Array.isArray(valeur)) {
    return valeur.map((element) => masquer(element));
  }
  if (estObjetSimple(valeur)) {
    const resultat: Record<string, unknown> = {};
    for (const cle of Object.keys(valeur)) {
      if (MOTIF_CLE_COUT.test(cle)) continue;
      resultat[cle] = masquer(valeur[cle]);
    }
    return resultat;
  }
  return valeur;
}

/** Sans `marge:read`, retire toute clé de coût à toute profondeur ; ne mute pas l'entrée. */
export function masquerCouts<T>(donnees: T, peutVoirMarge: boolean): T {
  if (peutVoirMarge) return donnees;
  return masquer(donnees) as T;
}

function collecter(valeur: unknown, chemin: string, sortie: string[]): void {
  if (Array.isArray(valeur)) {
    valeur.forEach((element, i) =>
      collecter(element, `${chemin}[${i}]`, sortie),
    );
    return;
  }
  if (estObjetSimple(valeur)) {
    for (const cle of Object.keys(valeur)) {
      const sousChemin = chemin === '' ? cle : `${chemin}.${cle}`;
      if (MOTIF_CLE_COUT.test(cle)) {
        sortie.push(sousChemin);
      } else {
        collecter(valeur[cle], sousChemin, sortie);
      }
    }
  }
}

/** Chemins des clés de coût présentes (`lots[0].coutUnitaire`), pour les tests. */
export function cheminsCout(donnees: unknown): string[] {
  const sortie: string[] = [];
  collecter(donnees, '', sortie);
  return sortie;
}
