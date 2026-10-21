/** Version servie quand aucune n'est réglée : 0.0.0, donc aucun téléphone n'est bloqué. */
export const VERSION_PAR_DEFAUT = '0.0.0';

/** Version des CGU et de la politique de confidentialité quand aucune n'est réglée. */
export const VERSION_DOCUMENT_PAR_DEFAUT = '1.0';

/** Cache court (D34) : la version sert aussi de sonde de connectivité au téléphone. */
export const CACHE_VERSION = 'public, max-age=60';
export const CACHE_CONFIG = 'public, max-age=300';

/** Message du 426, affiché tel quel par l'application mobile. */
export const MESSAGE_VERSION_OBSOLETE =
  "Cette version de MedConnecte n'est plus prise en charge. Mettez à jour l'application pour continuer.";
