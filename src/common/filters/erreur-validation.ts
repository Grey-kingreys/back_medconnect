import { BadRequestException, type ValidationError } from '@nestjs/common';

/**
 * Fabrique branchée sur le ValidationPipe global. Les noms de champs et les
 * contraintes partent au client, jamais la valeur saisie (données de santé).
 */
export interface ChampFautif {
  champ: string;
  contraintes: string[];
}

export function champsFautifs(
  erreurs: ValidationError[],
  parent = '',
): ChampFautif[] {
  const resultat: ChampFautif[] = [];
  for (const erreur of erreurs) {
    const chemin = parent ? `${parent}.${erreur.property}` : erreur.property;
    if (erreur.constraints && Object.keys(erreur.constraints).length > 0) {
      resultat.push({
        champ: chemin,
        contraintes: Object.keys(erreur.constraints),
      });
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
