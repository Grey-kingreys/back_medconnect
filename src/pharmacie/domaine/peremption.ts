import { arrondiGnf, exigerEntier, umVersBoites } from './quantites';
import { jourValide } from './reception';
import { estPerime } from './selection-lots';

export interface LotAlerte {
  lotId: string;
  stockId: string;
  nom: string;
  numeroLot: string | null;
  /** AAAA-MM-JJ, nul = sans date de péremption. */
  dateExpiration: string | null;
  /** Solde du lot en UM ; un lot à solde <= 0 est ignoré. */
  quantite: number;
  coefficientReception: number;
  /** Prix de la boîte de la fiche ; nul ou 0 = prix inconnu. */
  prixBoite: number | null;
  /** GNF par UM ; 0 = coût inconnu. */
  coutUnitaire: number;
  lotTechnique: boolean;
  ficheArchivee: boolean;
}

export interface LotAlerteValorise {
  lotId: string;
  stockId: string;
  nom: string;
  numeroLot: string | null;
  dateExpiration: string;
  /** Jours entre le jour courant et la date (0 = périme aujourd'hui, négatif = périmé). */
  joursRestants: number;
  quantite: number;
  quantiteBoites: number;
  unitesEnPlus: number;
  lotTechnique: boolean;
  ficheArchivee: boolean;
  valeurVente: number | null;
  valeurCout: number | null;
  coutConnu: boolean;
}

export interface GroupeAlerte {
  nombreLots: number;
  valeurVente: number | null;
  nombreLotsSansPrix: number;
  valeurCout: number | null;
  nombreLotsCoutInconnu: number;
  lots: LotAlerteValorise[];
}

export interface ResultatAlertes {
  jour: string;
  horizons: (GroupeAlerte & { jours: number })[];
  perimes: GroupeAlerte;
  sansDate: { nombreLots: number };
}

const MS_PAR_JOUR = 86_400_000;

/** Jours calendaires de `jour` à `date` (AAAA-MM-JJ tous deux, valeurs déjà validées). */
export function joursEntre(jour: string, date: string): number {
  const [a1, m1, j1] = jour.split('-').map(Number);
  const [a2, m2, j2] = date.split('-').map(Number);
  return (Date.UTC(a2, m2 - 1, j2) - Date.UTC(a1, m1 - 1, j1)) / MS_PAR_JOUR;
}

function validerHorizons(horizons: number[]): void {
  if (horizons.length === 0 || horizons.length > 5) {
    throw new RangeError('Il faut de 1 à 5 horizons de péremption.');
  }
  for (const h of horizons) {
    exigerEntier(h, 'horizon', 1);
    if (h > 365) {
      throw new RangeError(
        `horizon doit être au plus 365 jours (reçu : ${h}).`,
      );
    }
  }
  if (new Set(horizons).size !== horizons.length) {
    throw new RangeError('Les horizons de péremption doivent être distincts.');
  }
}

function comparerLots(a: LotAlerteValorise, b: LotAlerteValorise): number {
  if (a.dateExpiration !== b.dateExpiration) {
    return a.dateExpiration < b.dateExpiration ? -1 : 1;
  }
  const parNom = a.nom.localeCompare(b.nom, 'fr');
  if (parNom !== 0) return parNom;
  if (a.lotId === b.lotId) return 0;
  return a.lotId < b.lotId ? -1 : 1;
}

function sommeOuNull(valeurs: (number | null)[]): number | null {
  if (valeurs.length === 0) return 0;
  const connues = valeurs.filter((v): v is number => v !== null);
  if (connues.length === 0) return null;
  return connues.reduce((s, v) => s + v, 0);
}

function construireGroupe(lots: LotAlerteValorise[]): GroupeAlerte {
  const tries = [...lots].sort(comparerLots);
  return {
    nombreLots: tries.length,
    valeurVente: sommeOuNull(tries.map((l) => l.valeurVente)),
    nombreLotsSansPrix: tries.filter((l) => l.valeurVente === null).length,
    valeurCout: sommeOuNull(tries.map((l) => l.valeurCout)),
    nombreLotsCoutInconnu: tries.filter((l) => l.valeurCout === null).length,
    lots: tries,
  };
}

/** Classe les lots par horizon (D602) et les valorise (D603). */
export function classerAlertesPeremption(
  lots: LotAlerte[],
  horizons: number[],
  jour: string,
): ResultatAlertes {
  validerHorizons(horizons);
  // estPerime ne contrôle que le format du jour : on vérifie aussi qu'il existe.
  estPerime(null, jour);
  if (!jourValide(jour)) {
    throw new RangeError(`Jour inexistant (reçu : ${jour}).`);
  }
  for (const l of lots) {
    estPerime(l.dateExpiration, jour);
    exigerEntier(l.quantite, 'quantite', Number.MIN_SAFE_INTEGER);
    exigerEntier(l.coefficientReception, 'coefficientReception', 1);
    exigerEntier(l.coutUnitaire, 'coutUnitaire', 0);
    if (l.prixBoite !== null) exigerEntier(l.prixBoite, 'prixBoite', 0);
  }

  const ordonnes = [...horizons].sort((a, b) => b - a);
  const parHorizon = new Map<number, LotAlerteValorise[]>(
    ordonnes.map((h) => [h, []]),
  );
  const perimes: LotAlerteValorise[] = [];
  let sansDate = 0;

  for (const l of lots) {
    if (l.quantite <= 0) continue;
    if (l.dateExpiration === null) {
      sansDate += 1;
      continue;
    }
    const joursRestants = joursEntre(jour, l.dateExpiration);
    const { boites, unites } = umVersBoites(l.quantite, l.coefficientReception);
    const coutConnu = l.coutUnitaire > 0 && !l.lotTechnique;
    const valorise: LotAlerteValorise = {
      lotId: l.lotId,
      stockId: l.stockId,
      nom: l.nom,
      numeroLot: l.numeroLot,
      dateExpiration: l.dateExpiration,
      joursRestants,
      quantite: l.quantite,
      quantiteBoites: boites,
      unitesEnPlus: unites,
      lotTechnique: l.lotTechnique,
      ficheArchivee: l.ficheArchivee,
      valeurVente: l.prixBoite
        ? arrondiGnf((l.quantite * l.prixBoite) / l.coefficientReception)
        : null,
      valeurCout: coutConnu ? l.quantite * l.coutUnitaire : null,
      coutConnu,
    };
    if (estPerime(l.dateExpiration, jour)) {
      perimes.push(valorise);
      continue;
    }
    const cible = [...ordonnes].reverse().find((h) => joursRestants <= h);
    if (cible !== undefined) parHorizon.get(cible)?.push(valorise);
  }

  return {
    jour,
    horizons: ordonnes.map((h) => ({
      jours: h,
      ...construireGroupe(parHorizon.get(h) ?? []),
    })),
    perimes: construireGroupe(perimes),
    sansDate: { nombreLots: sansDate },
  };
}
