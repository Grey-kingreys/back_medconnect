import type { Role } from 'generated/prisma/enums';

/**
 * Règles d'activation et de reconnaissance du mode démo.
 *
 * Sécurité : le mode démo n'est actif que si `DEMO_MODE` vaut exactement `true`
 * (casse indifférente, espaces retirés). Toute autre valeur, ou son absence, le
 * laisse inactif. `validateEnv` refuse déjà au démarrage une valeur autre que
 * `true` ou `false` ; cette fonction reste stricte par prudence.
 */
export function estModeDemoActif(
  valeur: string | undefined = process.env.DEMO_MODE,
): boolean {
  return estVraiStrict(valeur);
}

/**
 * Remise à zéro des données démo au démarrage (`DEMO_RESET`), même analyse
 * stricte que `DEMO_MODE` : seule la valeur `true` (casse indifférente, espaces
 * retirés) l'active. Sans effet si le mode démo lui-même est inactif.
 */
export function estResetDemoDemande(
  valeur: string | undefined = process.env.DEMO_RESET,
): boolean {
  return estVraiStrict(valeur);
}

function estVraiStrict(valeur: string | undefined): boolean {
  return (valeur ?? '').trim().toLowerCase() === 'true';
}

/** Domaine réservé aux comptes de démonstration. */
export const DOMAINE_DEMO = 'demo.medconnecte.gn';

/** Suffixe d'email qui signe un compte démo. */
export const SUFFIXE_EMAIL_DEMO = `@${DOMAINE_DEMO}`;

/** Un compte démo se reconnaît uniquement à son email en `@demo.medconnecte.gn`. */
export function estCompteDemo(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase().endsWith(SUFFIXE_EMAIL_DEMO);
}

/** Libellés français des rôles, affichés dans le sélecteur de comptes démo. */
export const LIBELLES_ROLES: Record<Role, string> = {
  PATIENT: 'Patient',
  MEDECIN: 'Médecin',
  PHARMACIEN: 'Pharmacien',
  ACCUEIL: "Agent d'accueil",
  STRUCTURE_ADMIN: 'Administrateur de structure',
  ADMIN: 'Administrateur plateforme',
  SUPER_ADMIN: 'Super administrateur',
};

/** Ordre d'affichage des rôles dans la liste des comptes démo. */
export const ORDRE_ROLES: Role[] = [
  'PATIENT',
  'MEDECIN',
  'PHARMACIEN',
  'ACCUEIL',
  'STRUCTURE_ADMIN',
  'ADMIN',
  'SUPER_ADMIN',
];
