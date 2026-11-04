import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

/** Nom rendu pour une clé que le DTO ne déclare pas : la clé du poste n'est jamais recopiée (D665). */
export const CHAMP_INCONNU = 'champInconnu';
/** Chemins rendus au plus, stockés dans le résultat et l'anomalie (D665). */
export const MAX_CHAMPS = 20;

/** Chemins (`coupures.0.valeurFaciale`) des propriétés en erreur, jamais les valeurs. */
function cheminsEnErreur(erreurs: ValidationError[], prefixe = ''): string[] {
  return erreurs.flatMap((erreur) => {
    const nom =
      erreur.constraints && 'whitelistValidation' in erreur.constraints
        ? CHAMP_INCONNU
        : erreur.property;
    const chemin = prefixe ? `${prefixe}.${nom}` : nom;
    const enfants = erreur.children ?? [];
    if (enfants.length > 0) return cheminsEnErreur(enfants, chemin);
    return [chemin];
  });
}

/**
 * Valide le corps d'un événement contre une classe de DTO (D637). Le corps vient d'un
 * poste : il n'est jamais validé par le ValidationPipe, un corps fautif est rejeté
 * événement par événement sans bloquer le lot.
 */
export async function validerCorps<T extends object>(
  classe: new () => T,
  corps: unknown,
): Promise<{ ok: true; valeur: T } | { ok: false; champs: string[] }> {
  if (corps === null || typeof corps !== 'object' || Array.isArray(corps)) {
    return { ok: false, champs: ['corps'] };
  }
  const instance = plainToInstance(classe, corps);
  const erreurs = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (erreurs.length > 0) {
    return {
      ok: false,
      champs: [...new Set(cheminsEnErreur(erreurs))].slice(0, MAX_CHAMPS),
    };
  }
  return { ok: true, valeur: instance };
}
