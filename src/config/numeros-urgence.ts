import type { ConfigService } from '@nestjs/config';

/** Numéro d'urgence médicale servi tant que NUMERO_URGENCE_MEDICALE n'est pas réglée (Q04 ouverte). */
export const NUMERO_URGENCE_MEDICALE_PAR_DEFAUT = '15';

export interface NumeroUrgence {
  code: 'URGENCE_MEDICALE';
  libelle: string;
  numero: string;
}

/** Numéro d'urgence médicale configuré (variable NUMERO_URGENCE_MEDICALE), « 15 » par défaut. */
export function numeroUrgenceMedicale(config: ConfigService): string {
  const valeur = config.get<string>('NUMERO_URGENCE_MEDICALE')?.trim();
  return valeur ? valeur : NUMERO_URGENCE_MEDICALE_PAR_DEFAUT;
}

/** Numéros d'urgence publiés dans GET /app/config. Liste extensible (pompiers, police après Q04). */
export function numerosUrgence(config: ConfigService): NumeroUrgence[] {
  return [
    {
      code: 'URGENCE_MEDICALE',
      libelle: 'Urgences médicales',
      numero: numeroUrgenceMedicale(config),
    },
  ];
}
