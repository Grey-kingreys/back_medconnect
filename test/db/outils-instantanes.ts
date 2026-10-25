// Outils des instantanés de non-régression (PB02) : normalisation des champs
// volatils, comparaison par projection sur les clés de l'instantané, écriture
// seulement avec MAJ_INSTANTANES=1 (D458 à D461).
// Un ajustement de l'attendu n'est permis que pour une divergence nommée par une décision du chef (D506).
import { HttpException } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RACINE_DEPOT } from './harnais';

export const DOSSIER_INSTANTANES = path.join(
  RACINE_DEPOT,
  'test',
  'db',
  'instantanes',
);
export const VOLATIL = '<volatil>';

const MS_PAR_JOUR = 86_400_000;

export interface OptionsNormalisation {
  /** Jour J du jeu de données. */
  aujourdhui: Date;
  /** Clés remplacées par VOLATIL où qu'elles soient. */
  clesVolatiles: readonly string[];
}

export function libelleRelatif(date: Date, aujourdhui: Date): string {
  const delta = date.getTime() - aujourdhui.getTime();
  const jours = Math.floor(delta / MS_PAR_JOUR);
  const reste = delta - jours * MS_PAR_JOUR;
  const heure = new Date(reste).toISOString().slice(11, 23);
  return `J${jours >= 0 ? '+' : ''}${jours}j ${heure}`;
}

export function jourRelatif(jour: string, aujourdhui: Date): string {
  const jours = Math.round(
    (Date.parse(jour + 'T00:00:00.000Z') - aujourdhui.getTime()) / MS_PAR_JOUR,
  );
  return `J${jours >= 0 ? '+' : ''}${jours}`;
}

export function normaliser(
  valeur: unknown,
  options: OptionsNormalisation,
): unknown {
  if (valeur instanceof Date) {
    return libelleRelatif(valeur, options.aujourdhui);
  }
  if (typeof valeur === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(valeur)) {
      return libelleRelatif(new Date(valeur), options.aujourdhui);
    }
    return valeur
      .replace(/V-\d{4}-/g, 'V-AAAA-')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, (j) =>
        jourRelatif(j, options.aujourdhui),
      );
  }
  if (typeof valeur === 'number' && !Number.isInteger(valeur)) {
    return Math.round(valeur * 1e6) / 1e6;
  }
  if (Array.isArray(valeur)) {
    return valeur.map((e) => normaliser(e, options));
  }
  if (typeof valeur === 'object' && valeur !== null) {
    const source = valeur as Record<string, unknown>;
    const resultat: Record<string, unknown> = {};
    for (const cle of Object.keys(source).sort()) {
      if (source[cle] === undefined) continue;
      resultat[cle] = options.clesVolatiles.includes(cle)
        ? VOLATIL
        : normaliser(source[cle], options);
    }
    return resultat;
  }
  return valeur;
}

function typeDe(valeur: unknown): string {
  if (valeur === null) return 'null';
  if (Array.isArray(valeur)) return 'tableau';
  return typeof valeur;
}

export function ecartsInstantane(
  attendu: unknown,
  recu: unknown,
  chemin = '$',
): string[] {
  if (Array.isArray(attendu)) {
    if (!Array.isArray(recu)) {
      return [`${chemin} : tableau attendu, reçu ${typeDe(recu)}`];
    }
    if (attendu.length !== recu.length) {
      return [
        `${chemin} : ${attendu.length} éléments attendus, ${recu.length} reçus`,
      ];
    }
    return attendu.flatMap((element, i) =>
      ecartsInstantane(element, recu[i], `${chemin}[${i}]`),
    );
  }
  if (typeof attendu === 'object' && attendu !== null) {
    if (typeof recu !== 'object' || recu === null || Array.isArray(recu)) {
      return [`${chemin} : objet attendu, reçu ${typeDe(recu)}`];
    }
    const attenduObjet = attendu as Record<string, unknown>;
    const ecarts: string[] = [];
    for (const cle of Object.keys(attenduObjet)) {
      if (!Object.prototype.hasOwnProperty.call(recu, cle)) {
        ecarts.push(`${chemin}.${cle} : clé absente`);
      } else {
        ecarts.push(
          ...ecartsInstantane(
            attenduObjet[cle],
            (recu as Record<string, unknown>)[cle],
            `${chemin}.${cle}`,
          ),
        );
      }
    }
    return ecarts;
  }
  if (!Object.is(attendu, recu)) {
    return [
      `${chemin} : attendu ${JSON.stringify(attendu)}, reçu ${JSON.stringify(recu)}`,
    ];
  }
  return [];
}

export function verifierInstantane(
  nom: string,
  valeurNormalisee: unknown,
  ajusterAttendu?: (attendu: unknown) => unknown,
): void {
  const fichier = path.join(DOSSIER_INSTANTANES, nom + '.json');
  if (process.env.MAJ_INSTANTANES === '1') {
    mkdirSync(DOSSIER_INSTANTANES, { recursive: true });
    writeFileSync(
      fichier,
      JSON.stringify(valeurNormalisee, null, 2) + '\n',
      'utf8',
    );
    return;
  }
  if (!existsSync(fichier)) {
    throw new Error(
      `Instantané absent : test/db/instantanes/${nom}.json. Il se génère une seule fois (PB02) avec MAJ_INSTANTANES=1 ; ensuite il ne se régénère jamais sans décision du chef.`,
    );
  }
  const attendu = JSON.parse(readFileSync(fichier, 'utf8')) as unknown;
  const ecarts = ecartsInstantane(
    ajusterAttendu ? ajusterAttendu(attendu) : attendu,
    JSON.parse(JSON.stringify(valeurNormalisee)) as unknown,
  );
  if (ecarts.length > 0) {
    throw new Error(
      `Instantané ${nom} différent (${ecarts.length} écart(s)) :\n${ecarts.slice(0, 20).join('\n')}`,
    );
  }
}

export function trierDansGroupes<T extends { id: string }>(
  liste: readonly T[],
  cleGroupe: (element: T) => string,
): T[] {
  const groupes: T[][] = [];
  let cleCourante: string | undefined;
  for (const element of liste) {
    const cle = cleGroupe(element);
    if (groupes.length === 0 || cle !== cleCourante) {
      groupes.push([]);
      cleCourante = cle;
    }
    groupes[groupes.length - 1].push(element);
  }
  return groupes.flatMap((groupe) =>
    [...groupe].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

export async function capturerErreur(
  promesse: Promise<unknown>,
): Promise<{ statut: number; reponse: unknown }> {
  try {
    await promesse;
  } catch (erreur) {
    if (erreur instanceof HttpException) {
      return { statut: erreur.getStatus(), reponse: erreur.getResponse() };
    }
    throw erreur;
  }
  throw new Error('Une erreur HTTP était attendue, la lecture a réussi.');
}
