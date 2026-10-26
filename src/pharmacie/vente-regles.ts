import type { UniteVente } from './domaine/prix';
import { etatStock } from './domaine/quantites';
import {
  selectionnerLots,
  type AllocationCalculee,
  type LotCandidat,
  type LotPerimeDisponible,
} from './domaine/selection-lots';
import { CODE_ESPECES } from './domaine/caisse';

/** Numéro lisible d'un ticket : T<ordre du PV>-<numéro sur 7 chiffres au moins> (D423, D539). */
export function formaterNumeroTicket(ordre: number, numero: number): string {
  if (!Number.isInteger(ordre) || ordre < 1) {
    throw new RangeError(
      `L'ordre du point de vente doit être un entier supérieur ou égal à 1 (reçu : ${ordre}).`,
    );
  }
  if (!Number.isInteger(numero) || numero < 1) {
    throw new RangeError(
      `Le numéro de ticket doit être un entier supérieur ou égal à 1 (reçu : ${numero}).`,
    );
  }
  return `T${ordre}-${String(numero).padStart(7, '0')}`;
}

/** Clé d'unicité d'une ligne du corps : une fiche au plus une fois par unité (D414) ; unité absente = BOITE (D415). */
export function cleLigneVente(stockId: string, unite?: UniteVente): string {
  return `${stockId}|${unite ?? 'BOITE'}`;
}

export interface LigneAAllouer {
  /** Position de la ligne dans le corps. */
  index: number;
  stockMedicamentId: string;
  unite: UniteVente;
  quantiteUm: number;
  /** Motif déjà nettoyé (3 à 300 caractères) par le service. */
  sortieManuelle: { lotId: string; motif: string } | null;
}

export interface AllocationPrevue extends AllocationCalculee {
  sortieManuelle: boolean;
  motif: string | null;
}

export interface LigneAllouee {
  index: number;
  allocations: AllocationPrevue[];
  resteProvisoire: number;
  /** Vide si la ligne porte une sortie manuelle ou si tout est couvert. */
  lotsPerimesDisponibles: LotPerimeDisponible[];
  /** Unités minimales non périmées prises automatiquement ou manuellement. */
  quantiteAllouee: number;
}

/** Allocation de toutes les lignes, dans l'ordre reçu, soldes décrémentés en mémoire (D537). */
export function allouerLignes(
  jour: string,
  lignes: readonly LigneAAllouer[],
  lotsParFiche: ReadonlyMap<string, readonly LotCandidat[]>,
): LigneAllouee[] {
  const soldes = new Map<string, number>();
  for (const lots of lotsParFiche.values()) {
    for (const lot of lots) soldes.set(lot.id, lot.solde);
  }

  return lignes.map((ligne) => {
    const lots = (lotsParFiche.get(ligne.stockMedicamentId) ?? []).map((l) => ({
      ...l,
      solde: soldes.get(l.id) ?? l.solde,
    }));
    let reste = ligne.quantiteUm;
    const allocations: AllocationPrevue[] = [];

    if (ligne.sortieManuelle) {
      const { lotId, motif } = ligne.sortieManuelle;
      const lot = lots.find((l) => l.id === lotId);
      if (!lot) {
        throw new RangeError(
          `Lot de sortie manuelle absent des lots de la fiche : ${lotId}.`,
        );
      }
      const prise = Math.min(lot.solde, reste);
      if (prise > 0) {
        allocations.push({
          lotId: lot.id,
          numeroLot: lot.numeroLot,
          dateExpiration: lot.dateExpiration,
          quantite: prise,
          coutUnitaire: lot.coutUnitaire,
          lotTechnique: lot.lotTechnique,
          sortieManuelle: true,
          motif,
        });
        soldes.set(lot.id, lot.solde - prise);
        lot.solde -= prise;
        reste -= prise;
      }
    }

    let resteProvisoire = 0;
    let lotsPerimesDisponibles: LotPerimeDisponible[] = [];
    if (reste > 0) {
      const r = selectionnerLots({
        jour,
        unite: ligne.unite,
        quantiteUm: reste,
        lots,
      });
      for (const a of r.allocations) {
        allocations.push({ ...a, sortieManuelle: false, motif: null });
        soldes.set(a.lotId, (soldes.get(a.lotId) ?? 0) - a.quantite);
      }
      resteProvisoire = r.resteProvisoire;
      lotsPerimesDisponibles = ligne.sortieManuelle
        ? []
        : r.lotsPerimesDisponibles;
    }

    return {
      index: ligne.index,
      allocations,
      resteProvisoire,
      lotsPerimesDisponibles,
      quantiteAllouee: allocations.reduce((s, a) => s + a.quantite, 0),
    };
  });
}

export interface ModeConnu {
  id: string;
  code: string;
  libelle: string;
  comptagePhysique: boolean;
  referenceAutorisee: boolean;
  ordre: number;
}

export interface PaiementDemande {
  mode: string;
  montant: number;
  reference?: string;
  montantRecu?: number;
}

export interface PaiementPrevu {
  modePaiementId: string;
  code: string;
  montant: number;
  referenceExterne: string | null;
  montantRecu: number | null;
}

export type ResultatPaiements =
  | { ok: true; paiements: PaiementPrevu[] }
  | { ok: false; code: 'MODE_PAIEMENT_INCONNU'; mode: string }
  | { ok: false; code: 'MODE_EN_DOUBLE' }
  | { ok: false; code: 'MONTANT_RECU_INSUFFISANT' }
  | { ok: false; code: 'PAIEMENTS_INCOHERENTS'; somme: number };

/** Paiements d'une vente (D538). `modes` = modes ACTIFS seulement. */
export function preparerPaiements(
  total: number,
  demandes: readonly PaiementDemande[] | undefined,
  modes: readonly ModeConnu[],
): ResultatPaiements {
  const liste: readonly PaiementDemande[] = demandes ?? [
    { mode: CODE_ESPECES, montant: total },
  ];
  const parCode = new Map(modes.map((m) => [m.code, m]));

  for (const d of liste) {
    if (!parCode.has(d.mode)) {
      return { ok: false, code: 'MODE_PAIEMENT_INCONNU', mode: d.mode };
    }
  }
  if (new Set(liste.map((d) => d.mode)).size !== liste.length) {
    return { ok: false, code: 'MODE_EN_DOUBLE' };
  }
  for (const d of liste) {
    const mode = parCode.get(d.mode) as ModeConnu;
    if (
      mode.comptagePhysique &&
      d.montantRecu !== undefined &&
      d.montantRecu < d.montant
    ) {
      return { ok: false, code: 'MONTANT_RECU_INSUFFISANT' };
    }
  }
  const somme = liste.reduce((s, d) => s + d.montant, 0);
  if (somme !== total) {
    return { ok: false, code: 'PAIEMENTS_INCOHERENTS', somme };
  }

  return {
    ok: true,
    paiements: liste.map((d) => {
      const mode = parCode.get(d.mode) as ModeConnu;
      const reference = d.reference?.trim() ?? '';
      return {
        modePaiementId: mode.id,
        code: mode.code,
        montant: d.montant,
        referenceExterne:
          mode.referenceAutorisee && reference !== '' ? reference : null,
        montantRecu: mode.comptagePhysique ? (d.montantRecu ?? null) : null,
      };
    }),
  };
}

export interface FicheVendue {
  nom: string;
  coefficientBoite: number;
  /** Agrégat produit du PV avant et après la vente, en UM. */
  avant: number;
  apres: number;
}

/** Fiches passées de NORMAL à BAS ou RUPTURE par la vente (D541). */
export function passagesStockBas(
  fiches: readonly FicheVendue[],
  seuilBoites: number,
): { nom: string; apres: number }[] {
  return fiches
    .filter(
      (f) =>
        etatStock(f.avant, f.coefficientBoite, seuilBoites) === 'NORMAL' &&
        etatStock(f.apres, f.coefficientBoite, seuilBoites) !== 'NORMAL',
    )
    .map((f) => ({ nom: f.nom, apres: f.apres }));
}
