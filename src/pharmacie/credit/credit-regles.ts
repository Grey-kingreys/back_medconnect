/** Règles pures du cahier de crédit : reste à payer, prises soldées, statut. Aucune base, aucune horloge. */

/** Code du mode de paiement d'une prise à crédit : jamais compté comme argent encaissé. */
export const CODE_CREDIT = 'CREDIT';

/** Vrai si le corps d'une vente demande un crédit : client de crédit fourni ou paiement CREDIT. */
export function estVenteACredit(corps: {
  clientCreditId?: string;
  nouveauClientCredit?: unknown;
  paiements?: readonly { mode: string }[];
}): boolean {
  return (
    Boolean(corps.clientCreditId) ||
    corps.nouveauClientCredit !== undefined ||
    (corps.paiements?.some((p) => p.mode === CODE_CREDIT) ?? false)
  );
}

export type StatutCredit = 'EN_COURS' | 'EN_RETARD' | 'SOLDE';

export interface PriseCalcul {
  venteId: string;
  /** Total de la vente à crédit, GNF, positif. */
  total: number;
  /** Une prise annulée sort du reste à payer. */
  annulee: boolean;
  /** AAAA-MM-JJ ou null. */
  dateLimite: string | null;
  createdAt: Date;
}

export interface PriseRepartie extends PriseCalcul {
  /** Part des remboursements imputée à cette prise (plus anciennes d'abord), 0 si annulée. */
  rembourse: number;
  /** Ce qu'il reste à payer sur cette prise, 0 si annulée. */
  reste: number;
  /** Vrai si la prise n'est pas annulée et qu'il reste quelque chose à payer. */
  nonSoldee: boolean;
}

export interface EtatCredit {
  resteAPayer: number;
  totalPris: number;
  totalRembourse: number;
  statut: StatutCredit;
  /** Date limite (AAAA-MM-JJ) la plus proche parmi les prises non soldées, sinon null. */
  dateLimiteProche: string | null;
  prises: PriseRepartie[];
}

/**
 * Impute les remboursements aux prises non annulées, la plus ancienne d'abord (ordre de date, puis
 * d'identifiant). Un remboursement qui dépasserait le total des prises (prise annulée après coup)
 * n'est imputé nulle part : le reste à payer ne descend jamais sous zéro.
 */
export function repartirRemboursements(
  prises: readonly PriseCalcul[],
  totalRembourse: number,
): PriseRepartie[] {
  const ordre = [...prises].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.venteId < b.venteId ? -1 : a.venteId > b.venteId ? 1 : 0),
  );
  let disponible = Math.max(0, totalRembourse);
  const parId = new Map<string, PriseRepartie>();
  for (const p of ordre) {
    if (p.annulee) {
      parId.set(p.venteId, { ...p, rembourse: 0, reste: 0, nonSoldee: false });
      continue;
    }
    const rembourse = Math.min(disponible, p.total);
    disponible -= rembourse;
    const reste = p.total - rembourse;
    parId.set(p.venteId, { ...p, rembourse, reste, nonSoldee: reste > 0 });
  }
  return prises.map((p) => parId.get(p.venteId) as PriseRepartie);
}

/** Reste à payer, statut et date limite la plus proche. `aujourdhui` : AAAA-MM-JJ (jour de Conakry). */
export function calculerEtatCredit(
  prises: readonly PriseCalcul[],
  totalRembourse: number,
  aujourdhui: string,
): EtatCredit {
  const reparties = repartirRemboursements(prises, totalRembourse);
  const totalPris = reparties
    .filter((p) => !p.annulee)
    .reduce((s, p) => s + p.total, 0);
  const resteAPayer = reparties.reduce((s, p) => s + p.reste, 0);
  const nonSoldees = reparties.filter((p) => p.nonSoldee);
  const dates = nonSoldees
    .map((p) => p.dateLimite)
    .filter((d): d is string => d !== null)
    .sort();
  let statut: StatutCredit = 'EN_COURS';
  if (resteAPayer <= 0) statut = 'SOLDE';
  else if (dates.some((d) => d < aujourdhui)) statut = 'EN_RETARD';
  return {
    resteAPayer,
    totalPris,
    totalRembourse: Math.max(0, totalRembourse),
    statut,
    dateLimiteProche: dates[0] ?? null,
    prises: reparties,
  };
}

/** Noms distincts, dans l'ordre, tronqués : « A, B, C et 2 autres ». */
export function resumerMedicaments(noms: readonly string[], max = 3): string {
  const distincts = [...new Set(noms.map((n) => n.trim()).filter(Boolean))];
  if (distincts.length <= max) return distincts.join(', ');
  const reste = distincts.length - max;
  return `${distincts.slice(0, max).join(', ')} et ${reste} autre${reste > 1 ? 's' : ''}`;
}

/** Texte de recherche normalisé : minuscules, sans accents, sans espace de bord. */
export function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Chiffres seuls d'un téléphone (recherche tolérante aux espaces, + et tirets). */
export function chiffres(texte: string): string {
  return texte.replace(/\D/g, '');
}
