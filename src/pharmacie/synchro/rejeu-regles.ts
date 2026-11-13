import { createHash } from 'node:crypto';
import type { CorpsVenteDto } from '../dto/synchro.dto';
import { arrondiGnf } from '../domaine/quantites';

/** Règles pures du rejeu des opérations d'un poste desktop (PB18b, D637 à D660). */

export type StatutResultat =
  | 'APPLIQUE'
  | 'DEJA_APPLIQUE'
  | 'EN_ATTENTE'
  | 'REJETE'
  | 'A_RENVOYER';

export type CodeRejet =
  | 'EVENEMENT_INVALIDE'
  | 'EVENEMENT_MODIFIE'
  | 'SEQUENCE_DEJA_UTILISEE'
  | 'UTILISATEUR_NON_AUTORISE'
  | 'SESSION_INCONNUE'
  | 'SESSION_FERMEE'
  | 'COMPTAGE_DEJA_SAISI'
  | 'IDENTIFIANT_DEJA_UTILISE'
  | 'STOCK_INTROUVABLE'
  | 'EVENEMENT_INAPPLICABLE'
  | 'CREDIT_HORS_LIGNE';

export type CodeARenvoyer =
  | 'SERVICE_INDISPONIBLE'
  | 'REGULARISATION_INDISPONIBLE';

export const MESSAGES_REJET: Record<CodeRejet | CodeARenvoyer, string> = {
  EVENEMENT_INVALIDE:
    'Cette opération enregistrée sur le poste est illisible. Elle a été mise de côté : le responsable de la pharmacie la retrouvera dans les anomalies.',
  EVENEMENT_MODIFIE:
    'Cette opération avait déjà été reçue avec un contenu différent : la première version est gardée. Le responsable de la pharmacie en est informé.',
  SEQUENCE_DEJA_UTILISEE:
    "Le numéro d'ordre de cette opération est déjà pris par une autre opération de ce poste. Le responsable de la pharmacie en est informé.",
  UTILISATEUR_NON_AUTORISE:
    "Le vendeur de cette opération ne fait pas partie de la pharmacie. L'opération a été mise de côté pour le responsable.",
  SESSION_INCONNUE:
    "La caisse de cette opération est inconnue. L'opération a été mise de côté pour le responsable de la pharmacie.",
  SESSION_FERMEE:
    "Cette caisse était déjà fermée. L'opération a été mise de côté pour le responsable de la pharmacie.",
  COMPTAGE_DEJA_SAISI:
    'Ce comptage était déjà enregistré pour cette caisse. Le second a été mis de côté pour le responsable.',
  IDENTIFIANT_DEJA_UTILISE:
    "Cette opération porte l'identifiant d'un autre enregistrement. Elle a été mise de côté pour le responsable.",
  STOCK_INTROUVABLE:
    'Un médicament de cette vente est inconnu de la pharmacie. La vente a été mise de côté pour le responsable.',
  EVENEMENT_INAPPLICABLE:
    "Cette opération n'a pas pu être enregistrée après plusieurs essais. Elle a été mise de côté : le responsable de la pharmacie la retrouvera dans les anomalies.",
  CREDIT_HORS_LIGNE:
    'Le crédit demande une connexion. Cette vente à crédit a été mise de côté : le responsable de la pharmacie la retrouvera dans les anomalies.',
  SERVICE_INDISPONIBLE:
    'Le service est momentanément indisponible : cette opération sera renvoyée automatiquement.',
  REGULARISATION_INDISPONIBLE:
    'Cette vente sera enregistrée plus tard : elle sera renvoyée automatiquement.',
};

/** Refus métier d'un événement : annule sa transaction, puis est enregistré par une seconde. */
export class RejetSynchro extends Error {
  constructor(
    readonly code: CodeRejet,
    readonly options: { stocker?: boolean; champs?: string[] } = {},
  ) {
    super(code);
  }
}

/** Erreur passagère : rien n'est écrit pour cet événement, le poste le renverra. */
export class ARenvoyerSynchro extends Error {
  constructor(readonly code: CodeARenvoyer) {
    super(code);
  }
}

const CODES_HTTP_GARDES: readonly CodeRejet[] = [
  'COMPTAGE_DEJA_SAISI',
  'IDENTIFIANT_DEJA_UTILISE',
  'SESSION_FERMEE',
  'STOCK_INTROUVABLE',
];

export function codeRejetDepuisHttp(code: string | undefined): CodeRejet {
  const garde = CODES_HTTP_GARDES.find((c) => c === code);
  return garde ?? 'EVENEMENT_INVALIDE';
}

/** Essais en erreur imprévue d'un même événement avant de le mettre de côté (D664). */
export const SEUIL_ECHECS_IMPREVUS = 3;

// Panne passagère de la base (connexion, délai, interblocage, sérialisation) : jamais
// comptée comme un échec de l'événement, qui serait sinon rejeté à tort (D664).
const CODES_PASSAGERS = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2028',
  'P2034',
  '40001',
  '40P01',
  '53300',
  '57014',
]);
const NOMS_PASSAGERS = new Set([
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
]);
const MOTIF_PASSAGER =
  /timeout|timed out|deadlock|could not serialize|connection|ECONN/i;

export function echecPassager(erreur: unknown): boolean {
  if (!(erreur instanceof Error)) return false;
  if (NOMS_PASSAGERS.has(erreur.name)) return true;
  const code = (erreur as { code?: unknown }).code;
  if (typeof code === 'string' && CODES_PASSAGERS.has(code)) return true;
  return MOTIF_PASSAGER.test(erreur.message);
}

/** Vrai si une chaîne, une clé ou une valeur imbriquée contient le caractère NUL. */
export function contientNul(valeur: unknown): boolean {
  if (typeof valeur === 'string') return valeur.includes('\u0000');
  if (Array.isArray(valeur)) return valeur.some((v) => contientNul(v));
  if (valeur !== null && typeof valeur === 'object') {
    return Object.entries(valeur as Record<string, unknown>).some(
      ([cle, v]) => cle.includes('\u0000') || contientNul(v),
    );
  }
  return false;
}

/** Clé du corps stocké en texte quand PostgreSQL ne peut pas le garder tel quel (D664). */
export const CLE_CORPS_ILLISIBLE = 'corpsIllisible';

/**
 * Corps tel qu'il est stocké : PostgreSQL refuse le caractère NUL dans jsonb, un tel
 * corps est gardé en texte JSON échappé (sans perte, consultable par le titulaire).
 */
export function corpsStockable(corps: unknown): unknown {
  if (corps === undefined || corps === null) return {};
  return contientNul(corps)
    ? { [CLE_CORPS_ILLISIBLE]: JSON.stringify(corps) }
    : corps;
}

/** Corps reçu avec un NUL, ou relu depuis une ligne qui l'a stocké en texte. */
export function corpsIllisible(corps: unknown): boolean {
  return (
    contientNul(corps) ||
    (corps !== null &&
      typeof corps === 'object' &&
      !Array.isArray(corps) &&
      CLE_CORPS_ILLISIBLE in corps)
  );
}

/** JSON dont les clés d'objet sont triées récursivement, sans espace. */
export function jsonCanonique(valeur: unknown): string {
  if (valeur === undefined || valeur === null) return 'null';
  if (Array.isArray(valeur)) {
    return `[${valeur.map((v) => jsonCanonique(v)).join(',')}]`;
  }
  if (typeof valeur === 'object') {
    const objet = valeur as Record<string, unknown>;
    const cles = Object.keys(objet)
      .filter((cle) => objet[cle] !== undefined)
      .sort();
    return `{${cles
      .map((cle) => `${JSON.stringify(cle)}:${jsonCanonique(objet[cle])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valeur);
}

/** Empreinte d'un événement tel que reçu (D638). */
export function empreinteEvenement(e: {
  sequence: number;
  type: unknown;
  horodatageLocal: unknown;
  utilisateurId: unknown;
  corps: unknown;
}): string {
  return createHash('sha256')
    .update(
      jsonCanonique({
        sequence: e.sequence,
        type: e.type ?? null,
        horodatageLocal: e.horodatageLocal ?? null,
        utilisateurId: e.utilisateurId ?? null,
        corps: e.corps ?? null,
      }),
    )
    .digest('hex');
}

const TOLERANCE_HORLOGE_MS = 5 * 60 * 1000;

/** Horodatage local gardé s'il n'est pas en avance de plus de 5 minutes, sinon maintenant. */
export function horodatageBorne(local: Date, maintenant: Date): Date {
  return local.getTime() <= maintenant.getTime() + TOLERANCE_HORLOGE_MS
    ? local
    : maintenant;
}

export function messageSynthese(
  resultats: { statut: StatutResultat }[],
): string {
  if (resultats.length === 0) {
    return 'Poste à jour : aucune opération à envoyer.';
  }
  const nombre = (statut: StatutResultat) =>
    resultats.filter((r) => r.statut === statut).length;
  const categories: [StatutResultat, (n: number) => string][] = [
    ['APPLIQUE', (n) => `${n} enregistrée(s)`],
    ['DEJA_APPLIQUE', (n) => `${n} déjà enregistrée(s)`],
    ['EN_ATTENTE', (n) => `${n} en attente`],
    ['REJETE', (n) => `${n} mise(s) de côté`],
    ['A_RENVOYER', (n) => `${n} à renvoyer`],
  ];
  const parties = categories
    .map(([statut, formater]) => ({ n: nombre(statut), formater }))
    .filter(({ n }) => n > 0)
    .map(({ n, formater }) => formater(n));
  return `Synchronisation : ${parties.join(', ')}.`;
}

type Resume = Record<string, string | number | null>;

function texteLisible(valeur: unknown): string | null {
  return typeof valeur === 'string' &&
    valeur.length > 0 &&
    !valeur.includes('\u0000')
    ? valeur.slice(0, 80)
    : null;
}

function entierLisible(valeur: unknown): number | null {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null;
}

/** Résumé d'un événement pour une anomalie : jamais le corps, jamais une donnée du client. */
export function resumeEvenement(type: unknown, corps: unknown): Resume {
  const c =
    corps !== null && typeof corps === 'object' && !Array.isArray(corps)
      ? (corps as Record<string, unknown>)
      : {};
  switch (type) {
    case 'SESSION_OUVERTE':
    case 'SESSION_FERMEE':
      return { sessionId: texteLisible(c.sessionId) };
    case 'COMPTAGE_SAISI':
      return {
        comptageId: texteLisible(c.comptageId),
        sessionId: texteLisible(c.sessionId),
        moment: texteLisible(c.moment),
      };
    case 'MOUVEMENT_CAISSE':
      return {
        mouvementId: texteLisible(c.mouvementId),
        sessionId: texteLisible(c.sessionId),
        typeMouvement: texteLisible(c.type),
        montant: entierLisible(c.montant),
      };
    case 'VENTE':
      return {
        venteId: texteLisible(c.venteId),
        sessionId: texteLisible(c.sessionId),
        numeroTicket:
          entierLisible(c.numeroTicket) ?? texteLisible(c.numeroTicket),
        numeroSecours:
          entierLisible(c.numeroSecours) ?? texteLisible(c.numeroSecours),
        total: entierLisible(c.total),
        nombreLignes: Array.isArray(c.lignes) ? c.lignes.length : null,
      };
    default:
      return {};
  }
}

// ------------------------------------------------------------------ ventes (PB18c)

/** Ligne d'une vente rejouée, exprimée en unités minimales (D652). */
export function calculerLigneRejeu(e: {
  unite: 'BOITE' | 'UNITE';
  nombre: number;
  prixTicket: number;
  coefficientBoite: number;
}): {
  prixAppliqueParUm: number;
  quantiteUm: number;
  montantLigne: number;
  uniteAffichee: 'BOITE' | 'UNITE';
  nombreAffiche: number;
  coefficientApplique: number;
} {
  const montantLigne = e.nombre * e.prixTicket;
  if (e.unite === 'BOITE') {
    return {
      prixAppliqueParUm: arrondiGnf(e.prixTicket / e.coefficientBoite),
      quantiteUm: e.nombre * e.coefficientBoite,
      montantLigne,
      uniteAffichee: 'BOITE',
      nombreAffiche: e.nombre,
      coefficientApplique: e.coefficientBoite,
    };
  }
  return {
    prixAppliqueParUm: e.prixTicket,
    quantiteUm: e.nombre,
    montantLigne,
    uniteAffichee: 'UNITE',
    nombreAffiche: e.nombre,
    coefficientApplique: 1,
  };
}

/** Cohérence interne du corps d'une vente : un seul numéro, total égal à la somme des lignes. */
export function verifierCoherenceVente(
  c: CorpsVenteDto,
): { ok: true } | { ok: false; champs: string[] } {
  const champs: string[] = [];
  if ((c.numeroTicket === undefined) === (c.numeroSecours === undefined)) {
    champs.push('numeroTicket');
  }
  const somme = c.lignes.reduce((s, l) => s + l.nombre * l.prixUnitaire, 0);
  if (somme !== c.total) champs.push('total');
  return champs.length === 0 ? { ok: true } : { ok: false, champs };
}

/** Numéro d'une vente faite avec un numéro de secours du poste (D655). */
export function numeroSecours(
  ordre: number,
  codePoste: string,
  n: number,
): string {
  return `S${ordre}-${codePoste}-${n}`;
}

/** Numéro d'une vente dont le numéro imprimé est hors plage ou déjà pris (D655). */
export function numeroHorsPlage(
  ordre: number,
  codePoste: string,
  sequence: number,
): string {
  return `N${ordre}-${codePoste}-${sequence}`;
}

export interface FicheRejeu {
  id: string;
  nom: string;
  prixUnitaire: number | null;
  prixUnite: number | null;
  deconditionnable: boolean;
  ordonnanceRequise: boolean;
  archive: boolean;
}

/** Causes d'anomalie d'une vente rejouée : une entrée par fiche et par cause, dans l'ordre des lignes (D653). */
export function anomaliesApplication(
  lignes: {
    fiche: FicheRejeu;
    unite: 'BOITE' | 'UNITE';
    prixTicket: number;
  }[],
  ordonnanceVerifiee: boolean,
): {
  prixDivergents: {
    stockId: string;
    nom: string;
    unite: 'BOITE' | 'UNITE';
    prixTicket: number;
    prixFiche: number | null;
  }[];
  uniteInterdite: { stockId: string; nom: string }[];
  ordonnance: { stockId: string; nom: string }[];
  archives: { stockId: string; nom: string }[];
} {
  const vus = {
    prix: new Set<string>(),
    unite: new Set<string>(),
    ordonnance: new Set<string>(),
    archive: new Set<string>(),
  };
  const resultat: ReturnType<typeof anomaliesApplication> = {
    prixDivergents: [],
    uniteInterdite: [],
    ordonnance: [],
    archives: [],
  };
  for (const { fiche, unite, prixTicket } of lignes) {
    const ref = { stockId: fiche.id, nom: fiche.nom };
    // Unité sur une fiche non déconditionnable : seule l'anomalie d'unité, pas de prix divergent (D666)
    const uniteInterdite = unite === 'UNITE' && !fiche.deconditionnable;
    if (uniteInterdite && !vus.unite.has(fiche.id)) {
      vus.unite.add(fiche.id);
      resultat.uniteInterdite.push(ref);
    }
    const prixFiche = unite === 'BOITE' ? fiche.prixUnitaire : fiche.prixUnite;
    if (
      !uniteInterdite &&
      prixFiche !== prixTicket &&
      !vus.prix.has(fiche.id)
    ) {
      vus.prix.add(fiche.id);
      resultat.prixDivergents.push({ ...ref, unite, prixTicket, prixFiche });
    }
    if (
      fiche.ordonnanceRequise &&
      !ordonnanceVerifiee &&
      !vus.ordonnance.has(fiche.id)
    ) {
      vus.ordonnance.add(fiche.id);
      resultat.ordonnance.push(ref);
    }
    if (fiche.archive && !vus.archive.has(fiche.id)) {
      vus.archive.add(fiche.id);
      resultat.archives.push(ref);
    }
  }
  return resultat;
}
