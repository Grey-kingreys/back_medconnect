import { BadRequestException, type ValidationError } from '@nestjs/common';

/**
 * Fabrique branchée sur le ValidationPipe global. Les noms de champs et les
 * contraintes partent au client, jamais la valeur saisie (données de santé).
 */
export interface ChampFautif {
  champ: string;
  contraintes: string[];
  /** Règle lisible, texte constant du code (jamais la saisie), seulement pour les champs de MESSAGES_REGLES. */
  message?: string;
}

/** Message lisible de la règle d'un champ, choisi par le nom du champ (texte constant). */
export const MESSAGES_REGLES: ReadonlyMap<string, string> = new Map([
  [
    'newPassword',
    'Le nouveau mot de passe doit contenir de 8 à 50 caractères, dont au moins une majuscule, une minuscule et un chiffre.',
  ],
]);

export function champsFautifs(
  erreurs: ValidationError[],
  parent = '',
): ChampFautif[] {
  const resultat: ChampFautif[] = [];
  for (const erreur of erreurs) {
    const chemin = parent ? `${parent}.${erreur.property}` : erreur.property;
    if (erreur.constraints && Object.keys(erreur.constraints).length > 0) {
      const contraintes = Object.keys(erreur.constraints);
      const message = MESSAGES_REGLES.get(erreur.property);
      resultat.push(
        message === undefined
          ? { champ: chemin, contraintes }
          : { champ: chemin, contraintes, message },
      );
    }
    resultat.push(...champsFautifs(erreur.children ?? [], chemin));
  }
  return resultat;
}

function messagesValidation(erreurs: ValidationError[]): string[] {
  const messages: string[] = [];
  for (const erreur of erreurs) {
    if (erreur.constraints) messages.push(...Object.values(erreur.constraints));
    messages.push(...messagesValidation(erreur.children ?? []));
  }
  return messages;
}

export function fabriquerErreurValidation(
  erreurs: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    message: messagesValidation(erreurs),
    code: 'VALIDATION',
    champs: champsFautifs(erreurs),
  });
}
