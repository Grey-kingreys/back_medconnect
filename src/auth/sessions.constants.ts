import { SessionClientType } from 'generated/prisma/enums';
import type { CodeErreur } from 'src/common/filters/codes-erreur';

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
/** Durée de l'état « valide » d'une session en cache (secondes). */
export const ETAT_VALIDE_TTL_S = 30;
/** Durée de l'état « révoqué » en cache : durée du jeton d'accès plus une minute (secondes). */
export const ETAT_REVOQUE_TTL_S = DUREE_ACCES_SECONDES + 60;
/** Au-delà de ce délai, la lecture Redis est abandonnée au profit de PostgreSQL. */
export const DELAI_REDIS_MS = 250;
/** Intervalle de purge des sessions expirées ou révoquées. */
export const PURGE_SESSIONS_MS = 60 * 60 * 1000;
/** Conservation des sessions expirées ou révoquées avant purge. */
export const RETENTION_SESSIONS_MS = 30 * 24 * 60 * 60 * 1000;
/** Délai laissé au client pour recevoir l'événement avant la coupure de la connexion temps réel. */
export const DELAI_DECONNEXION_SOCKET_MS = 1000;

export type RaisonRevocation =
  | 'DECONNEXION'
  | 'REUTILISATION'
  | 'NOUVELLE_CONNEXION'
  | 'REVOCATION_UTILISATEUR'
  | 'MOT_DE_PASSE_MODIFIE'
  | 'MOT_DE_PASSE_REINITIALISE'
  | 'COMPTE_DESACTIVE';

/** Codes d'erreur qui signifient qu'une session n'est plus utilisable. */
export type CodeRevocation = Extract<
  CodeErreur,
  'SESSION_REVOQUEE' | 'SESSION_EXPIREE' | 'COMPTE_DESACTIVE'
>;

/** Messages affichés à l'utilisateur final (audience non-dev). */
export const MESSAGES_SESSION = {
  expiree: 'Votre connexion a expiré, reconnectez-vous.',
  revoquee: 'Vous avez été déconnecté. Reconnectez-vous pour continuer.',
  reutilisee:
    "Vous avez été déconnecté. Si ce n'est pas vous, changez votre mot de passe.",
  compteDesactive: "Votre compte a été désactivé. Contactez l'administrateur.",
  appareilManquant: "Mettez à jour l'application pour vous connecter.",
  appareilIntrouvable: 'Cet appareil est introuvable ou déjà déconnecté.',
  appareilDeconnecte: 'Appareil déconnecté.',
  autresDeconnectes: 'Vos autres appareils ont été déconnectés.',
  aucunAutreAppareil: "Aucun autre appareil n'était connecté.",
} as const;

/** Message affiché à l'utilisateur pour un code de révocation. */
export function messagePourCode(code: CodeRevocation): string {
  if (code === 'SESSION_REVOQUEE') return MESSAGES_SESSION.revoquee;
  if (code === 'SESSION_EXPIREE') return MESSAGES_SESSION.expiree;
  return MESSAGES_SESSION.compteDesactive;
}

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
