import { instantLisible } from '../jour-metier';

export type RaisonPosteAttendu =
  | 'SESSION_OUVERTE'
  | 'FILE_NON_VIDE'
  | 'SYNCHRO_INCOMPLETE';

export interface PosteCaisse {
  id: string;
  code: string;
  libelle: string;
  type: 'WEB' | 'DESKTOP';
  actif: boolean;
  dernierContactLe: Date | null;
  dernierEtat: unknown;
}

export interface SessionOuverteDuJour {
  id: string;
  posteId: string;
  utilisateurNom: string;
}

export interface PosteManquant {
  posteId: string;
  posteCode: string;
  libelle: string;
  type: 'WEB' | 'DESKTOP';
  raison: RaisonPosteAttendu;
  sessionId: string | null;
  utilisateurNom: string | null;
  /** ISO 8601 ou null. */
  dernierContactLe: string | null;
}

export interface PosteAttendu extends PosteManquant {
  message: string;
}

/** Lit `fileVide` dans l'état écrit par le poste desktop ; `null` si l'état est inconnu. */
export function lireFileVide(etat: unknown): boolean | null {
  if (typeof etat !== 'object' || etat === null || Array.isArray(etat)) {
    return null;
  }
  const valeur = (etat as { fileVide?: unknown }).fileVide;
  return typeof valeur === 'boolean' ? valeur : null;
}

function messageDe(
  raison: RaisonPosteAttendu,
  poste: PosteCaisse,
  utilisateurNom: string | null,
): string {
  const { libelle, code } = poste;
  const contact = poste.dernierContactLe
    ? instantLisible(poste.dernierContactLe)
    : 'jamais';
  switch (raison) {
    case 'SESSION_OUVERTE':
      return poste.type === 'WEB'
        ? `La caisse de ${utilisateurNom} est encore ouverte sur ${libelle} (${code}) : elle doit être fermée avec le comptage du tiroir.`
        : `La caisse de ${utilisateurNom} est encore ouverte sur ${libelle} (${code}) : ses ventes ne sont peut-être pas toutes arrivées.`;
    case 'FILE_NON_VIDE':
      return `${libelle} (${code}) a encore des ventes à envoyer (dernier contact : ${contact}).`;
    case 'SYNCHRO_INCOMPLETE':
      return `${libelle} (${code}) a vendu ces derniers jours mais n'a pas envoyé ses ventes depuis le début de la journée (dernier contact : ${contact}).`;
  }
}

/** Postes dont on attend quelque chose avant de clôturer le jour (D616). */
export function postesAttendus(entree: {
  /** 00:00 UTC du jour à clôturer. */
  debutJour: Date;
  postes: PosteCaisse[];
  /** Sessions OUVERTE non techniques dont le jourMetier est le jour à clôturer. */
  sessionsOuvertes: SessionOuverteDuJour[];
  /** Postes DESKTOP qui ont une pièce de jourMetier entre J-7 et J inclus. */
  postesAyantVendu: ReadonlySet<string>;
}): PosteAttendu[] {
  const resultat: PosteAttendu[] = [];
  for (const poste of entree.postes) {
    const session = entree.sessionsOuvertes.find((s) => s.posteId === poste.id);
    let raison: RaisonPosteAttendu | null = null;
    if (session) {
      raison = 'SESSION_OUVERTE';
    } else if (poste.type === 'DESKTOP' && poste.actif) {
      const fileVide = lireFileVide(poste.dernierEtat);
      if (fileVide === false) {
        raison = 'FILE_NON_VIDE';
      } else if (entree.postesAyantVendu.has(poste.id)) {
        const synchroComplete =
          poste.dernierContactLe !== null &&
          poste.dernierContactLe >= entree.debutJour &&
          fileVide === true;
        if (!synchroComplete) raison = 'SYNCHRO_INCOMPLETE';
      }
    }
    if (raison === null) continue;
    const utilisateurNom = session ? session.utilisateurNom : null;
    resultat.push({
      posteId: poste.id,
      posteCode: poste.code,
      libelle: poste.libelle,
      type: poste.type,
      raison,
      sessionId: session ? session.id : null,
      utilisateurNom,
      dernierContactLe: poste.dernierContactLe
        ? poste.dernierContactLe.toISOString()
        : null,
      message: messageDe(raison, poste, utilisateurNom),
    });
  }
  return resultat.sort((a, b) =>
    a.posteCode < b.posteCode ? -1 : a.posteCode > b.posteCode ? 1 : 0,
  );
}

/** Forcer n'est permis que si tous les postes attendus sont des postes desktop (D617). */
export function forcageAutorise(attendus: PosteManquant[]): boolean {
  return attendus.length > 0 && attendus.every((a) => a.type === 'DESKTOP');
}

export function versPosteManquant(a: PosteAttendu): PosteManquant {
  return {
    posteId: a.posteId,
    posteCode: a.posteCode,
    libelle: a.libelle,
    type: a.type,
    raison: a.raison,
    sessionId: a.sessionId,
    utilisateurNom: a.utilisateurNom,
    dernierContactLe: a.dernierContactLe,
  };
}

export interface ResultatPourCloture {
  sessionId: string;
  mode: string;
  libelle: string;
  ordre: number;
  theorique: number;
  compte: number | null;
}

export interface TotalCloture {
  mode: string;
  libelle: string;
  theorique: number;
  compte: number | null;
  ecart: number | null;
  sessionsNonRapprochees: number;
}

/** Totaux par mode d'une clôture (D619) : le compté est inconnu si une caisse n'a pas de relevé pour un mode qu'elle a encaissé. */
export function totauxCloture(
  resultats: ResultatPourCloture[],
): TotalCloture[] {
  const parMode = new Map<string, ResultatPourCloture[]>();
  for (const r of resultats) {
    const liste = parMode.get(r.mode) ?? [];
    liste.push(r);
    parMode.set(r.mode, liste);
  }
  const ordres = new Map<string, number>();
  const totaux = [...parMode.values()].map((liste) => {
    ordres.set(liste[0].mode, liste[0].ordre);
    const theorique = liste.reduce((s, r) => s + r.theorique, 0);
    const sessionsNonRapprochees = liste.filter(
      (r) => r.compte === null && r.theorique !== 0,
    ).length;
    const compte =
      sessionsNonRapprochees > 0
        ? null
        : liste.reduce((s, r) => s + (r.compte ?? 0), 0);
    return {
      mode: liste[0].mode,
      libelle: liste[0].libelle,
      theorique,
      compte,
      ecart: compte === null ? null : compte - theorique,
      sessionsNonRapprochees,
    };
  });
  return totaux.sort((a, b) => {
    const ordreA = ordres.get(a.mode) as number;
    const ordreB = ordres.get(b.mode) as number;
    if (ordreA !== ordreB) return ordreA - ordreB;
    return a.mode < b.mode ? -1 : a.mode > b.mode ? 1 : 0;
  });
}
