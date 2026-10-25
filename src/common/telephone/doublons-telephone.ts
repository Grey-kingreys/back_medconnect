import { normaliserTelephone } from './telephone';

export interface CompteTelephone {
  id: string;
  email: string;
  role: string;
  telephone: string;
  createdAt: Date;
}

export interface GroupeDoublon {
  /** Forme normalisée commune. */
  numero: string;
  /** Du plus ancien au plus récent (createdAt, puis id). */
  comptes: CompteTelephone[];
}

export interface AnalyseDoublons {
  total: number;
  doublons: GroupeDoublon[];
  nonReconnus: CompteTelephone[];
}

function comparerComptes(a: CompteTelephone, b: CompteTelephone): number {
  const ecart = a.createdAt.getTime() - b.createdAt.getTime();
  return ecart !== 0 ? ecart : a.id.localeCompare(b.id);
}

/** Regroupe les comptes par numéro normalisé (lecture seule, aucune base). */
export function analyserDoublons(comptes: CompteTelephone[]): AnalyseDoublons {
  const groupes = new Map<string, CompteTelephone[]>();
  const nonReconnus: CompteTelephone[] = [];
  for (const compte of comptes) {
    const numero = normaliserTelephone(compte.telephone);
    if (!numero) {
      nonReconnus.push(compte);
      continue;
    }
    const groupe = groupes.get(numero);
    if (groupe) groupe.push(compte);
    else groupes.set(numero, [compte]);
  }
  const doublons: GroupeDoublon[] = [];
  for (const [numero, membres] of groupes) {
    if (membres.length >= 2) {
      doublons.push({ numero, comptes: [...membres].sort(comparerComptes) });
    }
  }
  doublons.sort((a, b) => a.numero.localeCompare(b.numero));
  return {
    total: comptes.length,
    doublons,
    nonReconnus: nonReconnus.sort(comparerComptes),
  };
}
