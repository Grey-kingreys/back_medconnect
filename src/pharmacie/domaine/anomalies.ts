import type { TypeAnomalie } from 'generated/prisma/enums';

export const LIBELLES_ANOMALIE: Record<TypeAnomalie, string> = {
  STOCK_NEGATIF: 'Vente sans stock',
  ECART_INVENTAIRE: "Écart d'inventaire",
  CONDITIONNEMENT_CONCURRENT: 'Deux boîtes entamées du même lot',
  REMONTEE_APRES_CLOTURE: 'Vente remontée après la clôture',
  ECART_CAISSE: 'Écart de caisse',
  FOND_NON_COMPTE: 'Fond de caisse non compté',
  PLAGE_EPUISEE: 'Numéros de tickets épuisés',
  PRIX_DIVERGENT: 'Prix différent du prix enregistré',
  ORDONNANCE_NON_CONFIRMEE: 'Ordonnance non confirmée',
  VENTE_UNITE_INTERDITE: "Vente à l'unité interdite",
  PRODUIT_ARCHIVE: 'Médicament archivé vendu',
  EVENEMENT_REJETE: 'Opération de caisse rejetée',
  SEQUENCE_MANQUANTE: 'Opération de caisse manquante',
};

export type EtatRattachement =
  | 'EN_ATTENTE'
  | 'PARTIELLE'
  | 'RATTACHEE'
  | 'VENTE_ANNULEE';

export interface Rattachement {
  etat: EtatRattachement;
  /** Unités vendues sans stock (somme des anomalies de la vente pour cette fiche). */
  quantiteInitiale: number;
  /** Unités encore en attente de stock (allocations PROVISOIRE). */
  quantiteEnAttente: number;
  message: string;
}

/** État du rattachement d'une vente sans stock (D586). */
export function etatRattachement(e: {
  quantiteInitiale: number;
  quantiteEnAttente: number;
  venteAnnulee: boolean;
}): Rattachement {
  const quantiteInitiale = Math.max(e.quantiteInitiale, e.quantiteEnAttente);
  const base = { quantiteInitiale, quantiteEnAttente: e.quantiteEnAttente };
  if (e.venteAnnulee) {
    return {
      ...base,
      etat: 'VENTE_ANNULEE',
      message: 'Cette vente a été annulée : aucun stock à rattacher.',
    };
  }
  if (e.quantiteEnAttente <= 0) {
    return {
      ...base,
      etat: 'RATTACHEE',
      message:
        "Le stock de cette vente a depuis été rattaché à un lot : il reste seulement à vérifier puis classer l'anomalie.",
    };
  }
  if (e.quantiteEnAttente < quantiteInitiale) {
    return {
      ...base,
      etat: 'PARTIELLE',
      message: `Une partie de cette vente attend encore du stock : ${e.quantiteEnAttente} unité(s).`,
    };
  }
  return {
    ...base,
    etat: 'EN_ATTENTE',
    message:
      "Cette vente attend encore du stock : enregistrez la réception ou faites l'inventaire de ce médicament.",
  };
}
