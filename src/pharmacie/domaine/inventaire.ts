import {
  planifierResolution,
  type ProvisoireAResoudre,
  type ResolutionPlanifiee,
} from './resolution';
import { comparerFefo, type LotCandidat } from './selection-lots';
import { exigerEntier } from './quantites';

/** Numéro de lot comparable : espaces retirés, minuscules. */
export function normaliserNumeroLot(numero: string): string {
  return numero.replace(/\s+/g, '').toLowerCase();
}

export interface SaisieCible {
  lotId: string | null;
  /** Rogné, null si vide. */
  numeroLot: string | null;
  /** AAAA-MM-JJ valide ou null. */
  dateExpiration: string | null;
  sansPeremption: boolean;
  /** Vrai si la quantité comptée est nulle (connue avant toute conversion). */
  quantiteNulle: boolean;
}

export type CodeRefusCible =
  | 'LOT_INTROUVABLE'
  | 'LOT_REQUIS'
  | 'DATE_PEREMPTION_REQUISE'
  | 'LOT_INCONNU_VIDE';

export type CibleLot =
  | { type: 'LOT'; lotId: string }
  | { type: 'NOUVEAU'; numeroLot: string | null; dateExpiration: string | null }
  | { type: 'SANS_LOT' }
  | { type: 'REFUS'; code: CodeRefusCible };

/**
 * Lots à solde positif, en ordre FEFO (détails d'un LOT_REQUIS) ; tous les lots si
 * aucun n'est en stock (lots épuisés de même date, D600), pour que la liste ne soit
 * jamais vide.
 */
export function lotsEnStockFefo(lots: readonly LotCandidat[]): LotCandidat[] {
  const enStock = lots.filter((l) => l.solde > 0);
  return (enStock.length > 0 ? enStock : [...lots]).sort(comparerFefo);
}

/**
 * Lot visé par une ligne d'inventaire (D589, D600). `lots` = tous les lots de la
 * fiche au point de vente, solde nul ou négatif compris.
 */
export function ciblerLot(
  s: SaisieCible,
  lots: readonly LotCandidat[],
): CibleLot {
  const dateViseeConnue = s.dateExpiration !== null || s.sansPeremption;
  const dv = s.dateExpiration;
  const requis: CibleLot = { type: 'REFUS', code: 'LOT_REQUIS' };
  const unique = (liste: readonly LotCandidat[]): CibleLot | null =>
    liste.length === 1 ? { type: 'LOT', lotId: liste[0].id } : null;

  // 1. Identifiant du lot
  if (s.lotId !== null) {
    return lots.some((l) => l.id === s.lotId)
      ? { type: 'LOT', lotId: s.lotId }
      : { type: 'REFUS', code: 'LOT_INTROUVABLE' };
  }

  // 2. Numéro de lot
  if (s.numeroLot !== null) {
    const cherche = normaliserNumeroLot(s.numeroLot);
    const memes = lots.filter(
      (l) =>
        l.numeroLot !== null && normaliserNumeroLot(l.numeroLot) === cherche,
    );
    if (memes.length === 1) return { type: 'LOT', lotId: memes[0].id };
    if (memes.length > 1) {
      if (!dateViseeConnue) return requis;
      return unique(memes.filter((l) => l.dateExpiration === dv)) ?? requis;
    }
  } else if (dateViseeConnue) {
    // 3. Date de péremption, lot épuisé compris (D600) ; à date égale, le seul
    // lot à solde positif l'emporte
    const memeDate = lots.filter((l) => l.dateExpiration === dv);
    if (memeDate.length === 1) return { type: 'LOT', lotId: memeDate[0].id };
    if (memeDate.length > 1) {
      return unique(memeDate.filter((l) => l.solde > 0)) ?? requis;
    }
  } else {
    // 4. Ni lot, ni numéro, ni date
    const enStock = lots.filter((l) => l.solde > 0);
    if (enStock.length === 1) return { type: 'LOT', lotId: enStock[0].id };
    if (enStock.length > 1) return requis;
    // Lot unique de la fiche, même épuisé ou négatif (D600)
    if (lots.length === 1) return { type: 'LOT', lotId: lots[0].id };
    return s.quantiteNulle
      ? { type: 'SANS_LOT' }
      : { type: 'REFUS', code: 'DATE_PEREMPTION_REQUISE' };
  }

  // 5. Nouveau lot
  if (s.quantiteNulle) return { type: 'REFUS', code: 'LOT_INCONNU_VIDE' };
  if (!dateViseeConnue) {
    return { type: 'REFUS', code: 'DATE_PEREMPTION_REQUISE' };
  }
  return { type: 'NOUVEAU', numeroLot: s.numeroLot, dateExpiration: dv };
}

export interface LigneCiblee {
  /** Index de la ligne dans la saisie. */
  index: number;
  cible:
    | { type: 'LOT'; lotId: string }
    | {
        type: 'NOUVEAU';
        idVirtuel: string;
        numeroLot: string | null;
        dateExpiration: string | null;
      }
    | { type: 'SANS_LOT' };
  /** Unités minimales comptées, >= 0 (0 pour SANS_LOT). */
  quantiteComptee: number;
}

export interface EntreePlanInventaire {
  lots: readonly LotCandidat[];
  lignes: readonly LigneCiblee[];
  provisoires: readonly ProvisoireAResoudre[];
  /** Unités par boîte de la fiche : coefficient d'un nouveau lot. */
  coefficientBoite: number;
  /** ISO 8601 : date de réception d'un nouveau lot (la même que celle passée à creerLot). */
  dateReceptionNouveaux: string;
  /** toleranceInventaire de la fiche, nul = 0 (D411). */
  tolerance: number;
  jour: string;
}

export interface LignePlanifiee {
  index: number;
  /** Lot visé ; idVirtuel pour un nouveau lot ; null pour SANS_LOT. */
  lotId: string | null;
  nouveauLot: boolean;
  /** Solde du lot avant l'inventaire (0 pour un nouveau lot ou SANS_LOT). */
  soldeAvant: number;
  quantiteTheorique: number;
  quantiteComptee: number;
  ecart: number;
  /** Quantité du mouvement INVENTAIRE (null pour SANS_LOT : aucun mouvement). */
  mouvement: number | null;
}

export interface PlanInventaireFiche {
  lignes: LignePlanifiee[];
  resolution: ResolutionPlanifiee[];
  ecartFiche: number;
  sousTolerance: boolean;
}

/** Plan d'inventaire d'une fiche : écarts par lot, rattachement des ventes sans stock, tolérance (D590 à D592). */
export function planifierInventaireFiche(
  e: EntreePlanInventaire,
): PlanInventaireFiche {
  // 1. Contrôles
  exigerEntier(e.tolerance, 'tolerance', 0);
  exigerEntier(e.coefficientBoite, 'coefficientBoite', 1);
  const vus = new Set<string>();
  for (const l of e.lignes) {
    exigerEntier(l.quantiteComptee, 'quantiteComptee', 0);
    const cle =
      l.cible.type === 'LOT'
        ? `lot:${l.cible.lotId}`
        : l.cible.type === 'NOUVEAU'
          ? `nouveau:${l.cible.idVirtuel}`
          : 'sans-lot';
    if (vus.has(cle)) {
      throw new RangeError(`Cible en double dans l'inventaire : ${cle}.`);
    }
    vus.add(cle);
    if (l.cible.type === 'SANS_LOT' && l.quantiteComptee !== 0) {
      throw new RangeError(
        'Une ligne sans lot ne peut pas avoir une quantité comptée non nulle.',
      );
    }
  }

  // 2. Ventes sans stock à rattacher
  const reste = e.provisoires.reduce((somme, p) => somme + p.quantite, 0);

  // 3. Candidats : le comptage est fait après les ventes sans stock (D592)
  const comptes = new Map<string, number>();
  for (const l of e.lignes) {
    if (l.cible.type === 'LOT') comptes.set(l.cible.lotId, l.quantiteComptee);
  }
  const candidats: LotCandidat[] = e.lots.map((l) => ({
    ...l,
    solde: comptes.has(l.id) ? (comptes.get(l.id) as number) + reste : l.solde,
  }));
  for (const l of e.lignes) {
    if (l.cible.type !== 'NOUVEAU') continue;
    candidats.push({
      id: l.cible.idVirtuel,
      numeroLot: l.cible.numeroLot,
      dateExpiration: l.cible.dateExpiration,
      dateReception: e.dateReceptionNouveaux,
      solde: l.quantiteComptee + reste,
      coefficientReception: e.coefficientBoite,
      coutUnitaire: 0,
      lotTechnique: false,
    });
  }

  // 4. Rattachement
  const resolution = planifierResolution(e.provisoires, candidats, e.jour);
  const prisParLot = new Map<string, number>();
  for (const r of resolution) {
    for (const p of r.prises) {
      prisParLot.set(p.lotId, (prisParLot.get(p.lotId) ?? 0) + p.quantite);
    }
  }

  // 5. Lignes
  const soldes = new Map(e.lots.map((l) => [l.id, l.solde]));
  const lignes: LignePlanifiee[] = [...e.lignes]
    .sort((a, b) => a.index - b.index)
    .map((l) => {
      const x = l.quantiteComptee;
      if (l.cible.type === 'SANS_LOT') {
        return {
          index: l.index,
          lotId: null,
          nouveauLot: false,
          soldeAvant: 0,
          quantiteTheorique: 0,
          quantiteComptee: 0,
          ecart: 0,
          mouvement: null,
        };
      }
      const nouveau = l.cible.type === 'NOUVEAU';
      const lotId =
        l.cible.type === 'NOUVEAU' ? l.cible.idVirtuel : l.cible.lotId;
      const soldeAvant = nouveau ? 0 : (soldes.get(lotId) ?? 0);
      const quantiteTheorique = soldeAvant - (prisParLot.get(lotId) ?? 0);
      const ecart = x - quantiteTheorique;
      return {
        index: l.index,
        lotId,
        nouveauLot: nouveau,
        soldeAvant,
        quantiteTheorique,
        quantiteComptee: x,
        ecart,
        mouvement: ecart,
      };
    });

  // 6. Tolérance par fiche (D591)
  const ecartFiche = lignes.reduce((somme, l) => somme + l.ecart, 0);
  return {
    lignes,
    resolution,
    ecartFiche,
    sousTolerance: Math.abs(ecartFiche) <= e.tolerance,
  };
}
