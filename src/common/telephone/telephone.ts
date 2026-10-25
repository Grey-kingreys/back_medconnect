/**
 * Numéro de téléphone guinéen au format E.164 (TB17). Source unique de la règle,
 * reprise à l'identique par la fonction SQL "telephone_e164" de la migration
 * 20261021120000_tb17_telephone_unique : modifier les deux ensemble.
 */

// Séparateurs tolérés à la saisie : espace, tabulation, espaces insécables
// (U+00A0 et U+202F, construits par code pour rester lisibles), point, tiret.
const SEPARATEURS = new RegExp(
  `[ \\t${String.fromCharCode(0xa0, 0x202f)}.-]`,
  'g',
);
// Indicatif facultatif (+224, 00224 ou 224), puis exactement 9 chiffres.
const FORMAT = /^(?:\+224|00224|224)?([0-9]{9})$/;

export const INDICATIF_GUINEE = '+224';

export const MESSAGE_TELEPHONE_INVALIDE =
  "Ce numéro de téléphone n'est pas valide. Saisissez un numéro guinéen à 9 chiffres, par exemple 622 12 34 56.";

export const MESSAGE_TELEPHONE_DEJA_UTILISE =
  'Ce numéro est déjà utilisé par un autre compte.';

/** « 622 98 87 76 », « 00224-622-98-87-76 » ou « +224622988776 » donnent « +224622988776 » ; null si invalide. */
export function normaliserTelephone(
  brut: string | null | undefined,
): string | null {
  if (typeof brut !== 'string') return null;
  const correspondance = FORMAT.exec(brut.replace(SEPARATEURS, ''));
  return correspondance ? `${INDICATIF_GUINEE}${correspondance[1]}` : null;
}
