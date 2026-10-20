import { SessionClientType } from 'generated/prisma/enums';

/** Fenêtre de grâce de l'ancien refresh après rotation (refresh concurrents, réponse perdue). */
export const GRACE_REFRESH_MS = 30_000;
/** Intervalle d'effacement des secrets de grâce échus (D20). */
export const PURGE_GRACE_MS = 60_000;
/** Durée de vie du jeton d'accès. */
export const DUREE_ACCES = '15m';
export const DUREE_ACCES_SECONDES = 15 * 60;
/** Session glissante de 30 jours (web tous rôles, mobile patient). Q11, révisable. */
export const DUREE_SESSION_LONGUE_MS = 30 * 24 * 60 * 60 * 1000;
/** Session glissante de 12 h (mobile, rôles autres que patient). Q11, révisable. */
export const DUREE_SESSION_COURTE_MS = 12 * 60 * 60 * 1000;
export const NOM_COOKIE_REFRESH = 'refresh_token';

export type RaisonRevocation =
  | 'DECONNEXION'
  | 'REUTILISATION'
  | 'NOUVELLE_CONNEXION';

/** Messages affichés à l'utilisateur final (audience non-dev). */
export const MESSAGES_SESSION = {
  expiree: 'Votre connexion a expiré, reconnectez-vous.',
  revoquee: 'Vous avez été déconnecté. Reconnectez-vous pour continuer.',
  reutilisee:
    "Vous avez été déconnecté. Si ce n'est pas vous, changez votre mot de passe.",
  compteDesactive: "Votre compte a été désactivé. Contactez l'administrateur.",
  appareilManquant: "Mettez à jour l'application pour vous connecter.",
} as const;

/** Sessions par appareil actives sauf si SESSIONS_MULTI_APPAREILS vaut `false`. */
export function estSessionsMultiAppareilsActif(
  valeur: string | undefined = process.env.SESSIONS_MULTI_APPAREILS,
): boolean {
  return (valeur ?? '').trim().toLowerCase() !== 'false';
}

/** Durée glissante d'une session selon le type de client et le rôle (Q11, révisable). */
export function dureeSession(
  clientType: SessionClientType,
  role: string,
): number {
  if (clientType === SessionClientType.MOBILE && role !== 'PATIENT') {
    return DUREE_SESSION_COURTE_MS;
  }
  return DUREE_SESSION_LONGUE_MS;
}
