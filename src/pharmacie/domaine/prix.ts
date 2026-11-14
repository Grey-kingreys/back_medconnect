import { arrondiGnf, exigerEntier } from './quantites';

/** Unité d'une ligne de vente (valeurs identiques au futur enum Prisma UniteVente, PB09). */
export type UniteVente = 'BOITE' | 'UNITE';

export interface EntreeLigne {
  unite: UniteVente;
  /** Nombre saisi : boîtes ou unités minimales. */
  nombre: number;
  coefficientBoite: number;
  /** Prix de vente de la boîte (colonne StockMedicament.prixUnitaire, D409). */
  prixBoite: number | null;
  prixUnite: number | null;
  deconditionnable: boolean;
}

export type CodeRefusLigne =
  | 'VENTE_UNITE_INTERDITE'
  | 'PRIX_UNITE_MANQUANT'
  | 'PRIX_MANQUANT';

export interface LigneCalculee {
  ok: true;
  uniteAffichee: UniteVente;
  nombreAffiche: number;
  coefficientApplique: number;
  quantiteUm: number;
  prixAppliqueParUm: number;
  montantLigne: number;
}

export interface RefusLigne {
  ok: false;
  code: CodeRefusLigne;
}

export type ResultatLigne = LigneCalculee | RefusLigne;

/** Calcule une ligne de vente : quantité en UM, prix appliqué par UM (affichage), montant de ligne (référence des totaux). */
export function calculerLigne(entree: EntreeLigne): ResultatLigne {
  exigerEntier(entree.nombre, 'nombre', 1);
  exigerEntier(entree.coefficientBoite, 'coefficientBoite', 1);
  if (entree.prixBoite !== null) exigerEntier(entree.prixBoite, 'prixBoite', 0);
  if (entree.prixUnite !== null) exigerEntier(entree.prixUnite, 'prixUnite', 0);

  if (entree.unite === 'UNITE') {
    if (!entree.deconditionnable) {
      return { ok: false, code: 'VENTE_UNITE_INTERDITE' };
    }
    if (entree.prixUnite === null || entree.prixUnite === 0) {
      return { ok: false, code: 'PRIX_UNITE_MANQUANT' };
    }
    return {
      ok: true,
      uniteAffichee: 'UNITE',
      nombreAffiche: entree.nombre,
      coefficientApplique: 1,
      quantiteUm: entree.nombre,
      prixAppliqueParUm: entree.prixUnite,
      montantLigne: entree.nombre * entree.prixUnite,
    };
  }

  if (entree.prixBoite === null || entree.prixBoite === 0) {
    return { ok: false, code: 'PRIX_MANQUANT' };
  }
  return {
    ok: true,
    uniteAffichee: 'BOITE',
    nombreAffiche: entree.nombre,
    coefficientApplique: entree.coefficientBoite,
    quantiteUm: entree.nombre * entree.coefficientBoite,
    prixAppliqueParUm: arrondiGnf(entree.prixBoite / entree.coefficientBoite),
    montantLigne: entree.nombre * entree.prixBoite,
  };
}

export interface AvertissementPrix {
  code: 'ECART_PRIX';
  ecartPct: number;
}

/** Avertissement non bloquant si prix unité x coefficient s'écarte du prix boîte de plus de seuilPct % (D472). */
export function avertissementEcartPrix(
  prixBoite: number | null,
  prixUnite: number | null,
  coefficientBoite: number,
  seuilPct: number,
): AvertissementPrix | null {
  exigerEntier(coefficientBoite, 'coefficientBoite', 1);
  exigerEntier(seuilPct, 'seuilPct', 0);
  if (prixBoite !== null) exigerEntier(prixBoite, 'prixBoite', 0);
  if (prixUnite !== null) exigerEntier(prixUnite, 'prixUnite', 0);
  if (
    prixBoite === null ||
    prixBoite === 0 ||
    prixUnite === null ||
    prixUnite === 0
  ) {
    return null;
  }
  const ecart = Math.abs(prixUnite * coefficientBoite - prixBoite);
  if (ecart * 100 > seuilPct * prixBoite) {
    return {
      code: 'ECART_PRIX',
      ecartPct: Math.round((ecart * 100) / prixBoite),
    };
  }
  return null;
}
