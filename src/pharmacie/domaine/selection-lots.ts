import { exigerEntier, reliquatLot } from './quantites';
import { UniteVente } from './prix';

/** Lot candidat à une sortie, avec son solde courant (agrégat du lot). */
export interface LotCandidat {
  id: string;
  numeroLot: string | null;
  /** AAAA-MM-JJ ou null (sans péremption). */
  dateExpiration: string | null;
  /** ISO 8601. */
  dateReception: string;
  /** Solde du lot en UM, >= 0 (D404). */
  solde: number;
  coefficientReception: number;
  coutUnitaire: number;
  lotTechnique: boolean;
}

export interface DemandeSelection {
  /** Jour courant à Conakry, AAAA-MM-JJ. */
  jour: string;
  unite: UniteVente;
  quantiteUm: number;
  lots: LotCandidat[];
}

/** Allocation calculée : champs du lot recopiés (la demande exige une copie, pas une référence). */
export interface AllocationCalculee {
  lotId: string;
  numeroLot: string | null;
  dateExpiration: string | null;
  quantite: number;
  coutUnitaire: number;
  lotTechnique: boolean;
}

/** Forme identique aux `details[].lots` du futur 409 SORTIE_MANUELLE_REQUISE (plan 3.1). */
export interface LotPerimeDisponible {
  lotId: string;
  numeroLot: string | null;
  dateExpiration: string;
  quantite: number;
}

export interface ResultatSelection {
  allocations: AllocationCalculee[];
  resteProvisoire: number;
  lotsPerimesDisponibles: LotPerimeDisponible[];
}

const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/;

function exigerJour(jour: string): void {
  if (!FORMAT_JOUR.test(jour)) {
    throw new RangeError(
      `Jour invalide, format AAAA-MM-JJ attendu (reçu : ${jour}).`,
    );
  }
}

function exigerDateExpiration(dateExpiration: string | null): void {
  if (dateExpiration !== null && !FORMAT_JOUR.test(dateExpiration)) {
    throw new RangeError(
      `Date de péremption invalide, format AAAA-MM-JJ attendu (reçu : ${dateExpiration}).`,
    );
  }
}

/** Un lot est périmé si sa date est avant le jour courant ; le jour même reste vendable ; sans date, jamais périmé. */
export function estPerime(
  dateExpiration: string | null,
  jour: string,
): boolean {
  exigerJour(jour);
  exigerDateExpiration(dateExpiration);
  return dateExpiration !== null && dateExpiration < jour;
}

/** Ordre FEFO : date nulle d'abord, date croissante, réception croissante, identifiant croissant. */
export function comparerFefo(a: LotCandidat, b: LotCandidat): number {
  if (a.dateExpiration === null && b.dateExpiration !== null) return -1;
  if (a.dateExpiration !== null && b.dateExpiration === null) return 1;
  if (
    a.dateExpiration !== null &&
    b.dateExpiration !== null &&
    a.dateExpiration !== b.dateExpiration
  ) {
    return a.dateExpiration < b.dateExpiration ? -1 : 1;
  }
  const diff = Date.parse(a.dateReception) - Date.parse(b.dateReception);
  if (diff !== 0) return diff < 0 ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function validerLots(lots: LotCandidat[], jour: string): void {
  exigerJour(jour);
  const vus = new Set<string>();
  for (const lot of lots) {
    exigerEntier(lot.solde, 'solde', 0);
    exigerEntier(lot.coefficientReception, 'coefficientReception', 1);
    exigerEntier(lot.coutUnitaire, 'coutUnitaire', 0);
    exigerDateExpiration(lot.dateExpiration);
    if (Number.isNaN(Date.parse(lot.dateReception))) {
      throw new RangeError(
        `Date de réception invalide (reçue : ${lot.dateReception}).`,
      );
    }
    if (vus.has(lot.id)) {
      throw new RangeError(`Lot en double dans la sélection : ${lot.id}.`);
    }
    vus.add(lot.id);
  }
}

function eligibles(lots: LotCandidat[], jour: string): LotCandidat[] {
  return lots
    .filter((l) => l.solde > 0 && !estPerime(l.dateExpiration, jour))
    .sort(comparerFefo);
}

/** Lots dans l'ordre où une vente à l'unité les prendrait : lots éligibles à reliquat (FEFO), puis les autres (FEFO). */
export function ordonnerLotsPourVente(
  lots: LotCandidat[],
  jour: string,
): LotCandidat[] {
  validerLots(lots, jour);
  const tries = eligibles(lots, jour);
  const avecReliquat = tries.filter(
    (l) => reliquatLot(l.solde, l.coefficientReception) > 0,
  );
  const sansReliquat = tries.filter(
    (l) => reliquatLot(l.solde, l.coefficientReception) === 0,
  );
  return [...avecReliquat, ...sansReliquat];
}

/** Sélection automatique reliquat puis FEFO (D473), sans jamais prendre un lot périmé ; le reste non couvert est provisoire. */
export function selectionnerLots(demande: DemandeSelection): ResultatSelection {
  validerLots(demande.lots, demande.jour);
  exigerEntier(demande.quantiteUm, 'quantiteUm', 1);

  const candidats = eligibles(demande.lots, demande.jour);
  const pris = new Map<string, number>();
  let reste = demande.quantiteUm;

  const prendre = (lot: LotCandidat, maximum: number): void => {
    const q = Math.min(reste, maximum);
    if (q > 0) {
      pris.set(lot.id, (pris.get(lot.id) ?? 0) + q);
      reste -= q;
    }
  };
  const disponible = (lot: LotCandidat): number =>
    lot.solde - (pris.get(lot.id) ?? 0);

  const premierePasse = (lot: LotCandidat): number => {
    const rel = reliquatLot(lot.solde, lot.coefficientReception);
    return demande.unite === 'UNITE' ? rel : lot.solde - rel;
  };

  for (const lot of candidats) {
    if (reste === 0) break;
    prendre(lot, premierePasse(lot));
  }
  for (const lot of candidats) {
    if (reste === 0) break;
    prendre(lot, disponible(lot));
  }

  const parId = new Map(candidats.map((l) => [l.id, l]));
  const allocations: AllocationCalculee[] = [];
  for (const [lotId, quantite] of pris) {
    const lot = parId.get(lotId) as LotCandidat;
    allocations.push({
      lotId,
      numeroLot: lot.numeroLot,
      dateExpiration: lot.dateExpiration,
      quantite,
      coutUnitaire: lot.coutUnitaire,
      lotTechnique: lot.lotTechnique,
    });
  }

  const lotsPerimesDisponibles: LotPerimeDisponible[] =
    reste > 0
      ? demande.lots
          .filter(
            (l) => l.solde > 0 && estPerime(l.dateExpiration, demande.jour),
          )
          .sort(comparerFefo)
          .map((l) => ({
            lotId: l.id,
            numeroLot: l.numeroLot,
            dateExpiration: l.dateExpiration as string,
            quantite: l.solde,
          }))
      : [];

  return { allocations, resteProvisoire: reste, lotsPerimesDisponibles };
}
