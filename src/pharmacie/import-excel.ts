import { BadRequestException } from '@nestjs/common';
import { CellValue, Workbook, Worksheet } from 'exceljs';
import { FichierImport } from './dto/pharmacie.dto';

/**
 * Briques communes aux imports Excel de la pharmacie (stock et catalogue) :
 * contrôle du fichier reçu, ouverture du classeur, repérage des colonnes,
 * lecture des lignes et normalisation des noms. Aucune écriture en base.
 */

/** Type MIME d'un classeur Excel .xlsx. */
export const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// Certains navigateurs envoient un type générique pour un .xlsx
const MIMES_IMPORT_ACCEPTES = [
  MIME_XLSX,
  'application/octet-stream',
  'application/zip',
  '',
];
export const TAILLE_MAX_IMPORT = 2 * 1024 * 1024;
export const LIGNES_MAX_IMPORT = 1000;

const MESSAGE_FICHIER_VIDE =
  'Le fichier ne contient aucun médicament. Remplissez une ligne par médicament sous les titres, puis réessayez.';

/** Valeur simple lue dans une cellule. */
export type ValeurImport = string | number | boolean | Date | null;

/** Ligne de données lue dans le classeur, avant validation métier. */
export interface LigneBruteImport<C extends string> {
  /** Numéro de la ligne dans Excel (la ligne 1 contient les titres). */
  numero: number;
  valeurs: Record<C, ValeurImport>;
}

/** Description des colonnes attendues dans la ligne de titres. */
export interface ColonnesImport<C extends string> {
  /** Toutes les colonnes lues, obligatoires ou non. */
  toutes: readonly C[];
  /** Associe un titre normalisé (sans accents, casse ni espaces) à une colonne. */
  reconnaitre: (titre: string) => C | undefined;
  /** Colonnes obligatoires, dans l'ordre du message d'erreur, avec leur libellé. */
  obligatoires: readonly (readonly [C, string])[];
}

/** Minuscules, sans accents, espaces multiples réduits. */
export function normaliserNom(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Valeur simple d'une cellule Excel (formules, texte enrichi et liens déballés). */
export function valeurCellule(valeur: CellValue): ValeurImport {
  if (valeur === null || valeur === undefined) return null;
  if (valeur instanceof Date) return valeur;
  if (typeof valeur === 'string') {
    const texte = valeur.trim();
    return texte === '' ? null : texte;
  }
  if (typeof valeur === 'number' || typeof valeur === 'boolean') {
    return valeur;
  }
  if ('richText' in valeur) {
    return valeurCellule(valeur.richText.map((r) => r.text).join(''));
  }
  if ('result' in valeur) {
    return valeurCellule(valeur.result as CellValue);
  }
  if ('text' in valeur) {
    return valeurCellule(valeur.text as CellValue);
  }
  return null;
}

/**
 * Vérifie le fichier reçu (présence, taille, format) puis ouvre la feuille
 * `nomFeuille`, ou à défaut la première feuille du classeur.
 */
export async function ouvrirFeuilleImport(
  fichier: FichierImport | undefined,
  nomFeuille: string,
): Promise<Worksheet> {
  if (!fichier || !fichier.buffer) {
    throw new BadRequestException('Choisissez un fichier Excel à importer.');
  }
  if (fichier.size > TAILLE_MAX_IMPORT) {
    throw new BadRequestException(
      `Le fichier dépasse 2 Mo. Gardez seulement vos médicaments dans la feuille « ${nomFeuille} », puis réessayez.`,
    );
  }
  const extensionValide = /\.xlsx$/i.test(fichier.originalname ?? '');
  const typeValide = MIMES_IMPORT_ACCEPTES.includes(fichier.mimetype ?? '');
  if (!extensionValide || !typeValide) {
    throw new BadRequestException(
      "Le fichier doit être un classeur Excel (.xlsx). Téléchargez le modèle pour partir d'un fichier valide.",
    );
  }

  const workbook = new Workbook();
  try {
    // Le type Buffer déclaré par exceljs diffère de celui de Node
    await workbook.xlsx.load(fichier.buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException(
      "Ce fichier Excel n'a pas pu être ouvert. Enregistrez-le à nouveau au format .xlsx, ou partez du modèle à télécharger.",
    );
  }

  const feuille = workbook.getWorksheet(nomFeuille) ?? workbook.worksheets[0];
  if (!feuille) {
    throw new BadRequestException(MESSAGE_FICHIER_VIDE);
  }
  return feuille;
}

/**
 * Repère les colonnes dans la ligne 1, vérifie les colonnes obligatoires puis
 * lit les lignes de données (lignes vides ignorées, 1000 lignes au plus).
 */
export function lireLignesImport<C extends string>(
  feuille: Worksheet,
  definition: ColonnesImport<C>,
): LigneBruteImport<C>[] {
  // Repérage des colonnes en ligne 1 (sans accents, casse ni espaces)
  const colonnes: Partial<Record<C, number>> = {};
  feuille.getRow(1).eachCell((cell, numero) => {
    const valeur = valeurCellule(cell.value);
    const titre = normaliserNom(valeur === null ? '' : String(valeur)).replace(
      /\s/g,
      '',
    );
    const colonne = definition.reconnaitre(titre);
    if (colonne && colonnes[colonne] === undefined) colonnes[colonne] = numero;
  });

  const manquantes = definition.obligatoires
    .filter(([colonne]) => colonnes[colonne] === undefined)
    .map(([, libelle]) => `« ${libelle} »`);
  if (manquantes.length > 0) {
    throw new BadRequestException(
      manquantes.length === 1
        ? `La colonne ${manquantes[0]} est introuvable dans la première ligne du fichier. Ajoutez-la, ou partez du modèle à télécharger.`
        : `Les colonnes ${manquantes.join(' et ')} sont introuvables dans la première ligne du fichier. Ajoutez-les, ou partez du modèle à télécharger.`,
    );
  }

  // Lecture des lignes de données, lignes vides ignorées
  const brutes: LigneBruteImport<C>[] = [];
  feuille.eachRow((row, numero) => {
    if (numero === 1) return;
    const valeurs = {} as Record<C, ValeurImport>;
    for (const colonne of definition.toutes) {
      const col = colonnes[colonne];
      valeurs[colonne] =
        col === undefined ? null : valeurCellule(row.getCell(col).value);
    }
    if (Object.values<ValeurImport>(valeurs).every((v) => v === null)) return;
    brutes.push({ numero, valeurs });
  });

  if (brutes.length === 0) {
    throw new BadRequestException(MESSAGE_FICHIER_VIDE);
  }
  if (brutes.length > LIGNES_MAX_IMPORT) {
    throw new BadRequestException(
      `Le fichier contient ${brutes.length} lignes, le maximum est de ${LIGNES_MAX_IMPORT}. Répartissez vos médicaments dans plusieurs fichiers.`,
    );
  }
  return brutes;
}
