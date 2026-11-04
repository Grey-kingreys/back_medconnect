/** Lève une RangeError si la valeur n'est pas un entier supérieur ou égal au minimum. */
export function exigerEntier(
  valeur: number,
  nom: string,
  minimum: number,
): void {
  if (!Number.isInteger(valeur) || valeur < minimum) {
    throw new RangeError(
      `${nom} doit être un entier supérieur ou égal à ${minimum} (reçu : ${valeur}).`,
    );
  }
}

/** Arrondi à l'entier GNF le plus proche, moitié éloignée de zéro ; jamais -0. */
export function arrondiGnf(valeur: number): number {
  if (!Number.isFinite(valeur)) {
    throw new RangeError(`Montant non fini (reçu : ${valeur}).`);
  }
  const r = Math.sign(valeur) * Math.round(Math.abs(valeur));
  return r === 0 ? 0 : r;
}

/** Nombre de boîtes vers unités minimales : n x coefficient. */
export function boitesVersUm(
  nombreBoites: number,
  coefficientBoite: number,
): number {
  exigerEntier(nombreBoites, 'nombreBoites', 0);
  exigerEntier(coefficientBoite, 'coefficientBoite', 1);
  return nombreBoites * coefficientBoite;
}

export interface BoitesEtUnites {
  boites: number;
  unites: number;
}

/** Unités minimales vers boîtes entières et unités restantes, tronqué vers zéro (symétrique pour un stock négatif). */
export function umVersBoites(
  quantiteUm: number,
  coefficientBoite: number,
): BoitesEtUnites {
  exigerEntier(quantiteUm, 'quantiteUm', Number.MIN_SAFE_INTEGER);
  exigerEntier(coefficientBoite, 'coefficientBoite', 1);
  const boites = Math.trunc(quantiteUm / coefficientBoite);
  const unites = quantiteUm - boites * coefficientBoite;
  return {
    boites: boites === 0 ? 0 : boites,
    unites: unites === 0 ? 0 : unites,
  };
}

export type UniteMinimaleLisible =
  | 'COMPRIME'
  | 'GELULE'
  | 'ML'
  | 'SACHET'
  | 'GRAMME'
  | 'AMPOULE'
  | 'PLAQUETTE'
  | 'UNITE';

const LIBELLES_UNITE_MINIMALE: Record<
  UniteMinimaleLisible,
  { singulier: string; pluriel: string }
> = {
  COMPRIME: { singulier: 'comprimé', pluriel: 'comprimés' },
  GELULE: { singulier: 'gélule', pluriel: 'gélules' },
  ML: { singulier: 'ml', pluriel: 'ml' },
  SACHET: { singulier: 'sachet', pluriel: 'sachets' },
  GRAMME: { singulier: 'gramme', pluriel: 'grammes' },
  AMPOULE: { singulier: 'ampoule', pluriel: 'ampoules' },
  PLAQUETTE: { singulier: 'plaquette', pluriel: 'plaquettes' },
  UNITE: { singulier: 'unité', pluriel: 'unités' },
};

/**
 * Quantité lisible, mêmes sorties que `formaterQuantite` du front pour une quantité
 * positive ou nulle : « 12 boîtes », « 2 boîtes et 6 comprimés », « 6 comprimés »,
 * « 1 boîte », « 0 boîte ». RangeError si la quantité est négative (D713 : jamais
 * affichée).
 */
export function formaterQuantiteLisible(
  um: number,
  coefficient: number,
  uniteMinimale: UniteMinimaleLisible,
): string {
  exigerEntier(um, 'quantiteUm', 0);
  exigerEntier(coefficient, 'coefficientBoite', 1);
  const libelle = LIBELLES_UNITE_MINIMALE[uniteMinimale];
  const nombre = (n: number) => n.toLocaleString('fr-FR');
  const boite = (n: number) => `${nombre(n)} ${n > 1 ? 'boîtes' : 'boîte'}`;
  const unites = (n: number) =>
    `${nombre(n)} ${n > 1 ? libelle.pluriel : libelle.singulier}`;

  if (coefficient <= 1) return boite(um);
  const { boites, unites: reste } = umVersBoites(um, coefficient);
  if (boites === 0) return reste === 0 ? boite(0) : unites(reste);
  if (reste === 0) return boite(boites);
  return `${boite(boites)} et ${unites(reste)}`;
}

/** Coût d'achat par unité minimale depuis le coût d'une boîte, arrondi GNF (D413). */
export function coutUnitaireDepuisBoite(
  coutAchatBoite: number,
  coefficientBoite: number,
): number {
  exigerEntier(coutAchatBoite, 'coutAchatBoite', 0);
  exigerEntier(coefficientBoite, 'coefficientBoite', 1);
  return arrondiGnf(coutAchatBoite / coefficientBoite);
}

/** Reliquat dérivé d'un lot : solde modulo coefficient de réception si solde > 0 et coefficient > 1, sinon 0 (D405). */
export function reliquatLot(
  soldeLot: number,
  coefficientReception: number,
): number {
  exigerEntier(soldeLot, 'soldeLot', Number.MIN_SAFE_INTEGER);
  exigerEntier(coefficientReception, 'coefficientReception', 1);
  return soldeLot > 0 && coefficientReception > 1
    ? soldeLot % coefficientReception
    : 0;
}

export type EtatStock = 'RUPTURE' | 'BAS' | 'NORMAL';

/** Rupture si quantité <= 0 ; bas si 0 < quantité < seuil x coefficient (seuil en boîtes, arbitrage A4) ; sinon normal. */
export function etatStock(
  quantiteUm: number,
  coefficientBoite: number,
  seuilBoites: number,
): EtatStock {
  exigerEntier(quantiteUm, 'quantiteUm', Number.MIN_SAFE_INTEGER);
  exigerEntier(coefficientBoite, 'coefficientBoite', 1);
  exigerEntier(seuilBoites, 'seuilBoites', 0);
  if (quantiteUm <= 0) return 'RUPTURE';
  if (quantiteUm < seuilBoites * coefficientBoite) return 'BAS';
  return 'NORMAL';
}
