import { instantLisible } from '../jour-metier';

/** Pièce de vente d'une journée, réduite à ce que l'export a le droit de montrer (D622). */
export interface PieceExport {
  numero: string;
  typePiece: 'VENTE' | 'ANNULATION' | 'REGULARISATION';
  numeroOrigine: string | null;
  createdAt: Date;
  posteCode: string;
  vendeurNom: string;
  total: number;
  /** Motif d'annulation d'une pièce d'annulation, sinon null. */
  motif: string | null;
  caisseIncluse: boolean;
  paiements: {
    libelleMode: string;
    ordreMode: number;
    codeMode: string;
    reference: string | null;
    montant: number;
    createdAt: Date;
  }[];
}

/** Mouvement de caisse d'une journée (montant positif en base). */
export interface MouvementExport {
  type: 'PRELEVEMENT' | 'APPORT' | 'REMBOURSEMENT';
  horodatage: Date;
  posteCode: string;
  utilisateurNom: string;
  libelleMode: string;
  montant: number;
  motif: string;
  caisseIncluse: boolean;
}

export const ENTETES_EXPORT_CLOTURE: readonly string[] = [
  'Jour',
  'Ligne',
  'Numéro',
  'Type de pièce',
  "Pièce d'origine",
  'Date et heure',
  'Poste',
  'Vendeur',
  'Mode de paiement',
  'Référence',
  'Montant (GNF)',
  'Motif',
  'Caisse incluse dans la clôture',
];

/** Marque d'ordre des octets : Excel reconnaît ainsi l'UTF-8. */
const BOM = '\u{FEFF}';

const LIBELLES_PIECE = {
  VENTE: 'Vente',
  ANNULATION: 'Annulation',
  REGULARISATION: 'Régularisation',
} as const;

const LIBELLES_MOUVEMENT = {
  PRELEVEMENT: 'Prélèvement',
  APPORT: 'Apport',
  REMBOURSEMENT: 'Remboursement',
} as const;

/** Champ CSV : un texte qui ressemble à une formule est neutralisé, un champ à séparateur est entouré de guillemets. */
export function champCsv(
  valeur: string | number | null,
  texte: boolean,
): string {
  if (valeur === null) {
    return '';
  }
  let chaine = String(valeur);
  if (texte && typeof valeur === 'string' && /^[=+\-@\t\r]/.test(chaine)) {
    chaine = `'${chaine}`;
  }
  if (/[;"\r\n]/.test(chaine)) {
    chaine = `"${chaine.replace(/"/g, '""')}"`;
  }
  return chaine;
}

type Cellule = string | number | null;

/** Une ligne : tout est du texte sauf la colonne des montants (index 10). */
function ligne(cellules: Cellule[]): string {
  return cellules.map((c, i) => champCsv(c, i !== 10)).join(';');
}

/**
 * Référence de paiement faite uniquement de chiffres : préfixée d'une apostrophe, sinon Excel
 * la lirait comme un nombre (zéros initiaux perdus, notation scientifique au-delà de 11 chiffres) (D628).
 */
function referenceTexte(reference: string | null): string | null {
  return reference !== null && /^\d+$/.test(reference)
    ? `'${reference}`
    : reference;
}

function oui(inclus: boolean): string {
  return inclus ? 'Oui' : 'Non';
}

function signe(m: MouvementExport): number {
  return m.type === 'APPORT' ? m.montant : -m.montant;
}

/** Fichier CSV d'une journée clôturée : BOM, séparateur point-virgule, fins de ligne CRLF. */
export function exporterCloture(
  jour: string,
  pieces: PieceExport[],
  mouvements: MouvementExport[],
): string {
  const rangees: string[] = [ligne([...ENTETES_EXPORT_CLOTURE])];

  const piecesTriees = [...pieces].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.numero < b.numero ? -1 : a.numero > b.numero ? 1 : 0),
  );
  for (const p of piecesTriees) {
    const type = LIBELLES_PIECE[p.typePiece];
    rangees.push(
      ligne([
        jour,
        'Pièce',
        p.numero,
        type,
        p.numeroOrigine,
        instantLisible(p.createdAt),
        p.posteCode,
        p.vendeurNom,
        null,
        null,
        p.total,
        p.motif,
        oui(p.caisseIncluse),
      ]),
    );
    const paiements = [...p.paiements].sort(
      (a, b) =>
        a.ordreMode - b.ordreMode ||
        (a.codeMode < b.codeMode ? -1 : a.codeMode > b.codeMode ? 1 : 0),
    );
    for (const pa of paiements) {
      rangees.push(
        ligne([
          jour,
          'Paiement',
          p.numero,
          type,
          p.numeroOrigine,
          instantLisible(pa.createdAt),
          p.posteCode,
          p.vendeurNom,
          pa.libelleMode,
          referenceTexte(pa.reference),
          pa.montant,
          null,
          oui(p.caisseIncluse),
        ]),
      );
    }
  }

  const mouvementsTries = [...mouvements].sort(
    (a, b) => a.horodatage.getTime() - b.horodatage.getTime(),
  );
  for (const m of mouvementsTries) {
    rangees.push(
      ligne([
        jour,
        'Mouvement de caisse',
        null,
        LIBELLES_MOUVEMENT[m.type],
        null,
        instantLisible(m.horodatage),
        m.posteCode,
        m.utilisateurNom,
        m.libelleMode,
        null,
        signe(m),
        m.motif,
        oui(m.caisseIncluse),
      ]),
    );
  }

  return BOM + rangees.join('\r\n') + '\r\n';
}
