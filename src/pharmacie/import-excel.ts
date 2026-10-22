import { BadRequestException } from '@nestjs/common';
import { CellValue, Workbook, Worksheet } from 'exceljs';
import { ColonnesLuesImport, FichierImport } from './dto/pharmacie.dto';

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
/** Les titres sont cherchés dans les premières lignes (logo ou nom de la pharmacie au-dessus). */
export const LIGNES_MAX_RECHERCHE_TITRES = 10;

const MESSAGE_FICHIER_VIDE =
  'Le fichier ne contient aucun médicament. Remplissez une ligne par médicament sous les titres, puis réessayez.';

/** Valeur simple lue dans une cellule. */
export type ValeurImport = string | number | boolean | Date | null;

/** Ligne de données lue dans le classeur, avant validation métier. */
export interface LigneBruteImport<C extends string> {
  /** Numéro de la ligne dans Excel (sous la ligne des titres). */
  numero: number;
  valeurs: Record<C, ValeurImport>;
}

/** Description des colonnes attendues dans la ligne de titres. */
export interface ColonnesImport<C extends string> {
  /** Toutes les colonnes lues, obligatoires ou non. */
  toutes: readonly C[];
  /** Associe un titre normalisé (minuscules sans accents, lettres et chiffres seuls) à une colonne. */
  reconnaitre: (titre: string) => C | undefined;
  /** Colonnes obligatoires, dans l'ordre du message d'erreur, avec leur libellé. */
  obligatoires: readonly (readonly [C, string])[];
  /** Libellé de chaque colonne, montré dans l'aperçu (« Désignation » lue comme « Médicament »). */
  libelles: Readonly<Record<C, string>>;
}

/** Lignes lues et colonnes comprises. */
export interface LectureImport<C extends string> {
  brutes: LigneBruteImport<C>[];
  colonnes: ColonnesLuesImport;
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

/** Titre de colonne comparable : « Prix unitaire (GNF) » devient « prixunitairegnf ». */
export function normaliserTitre(texte: string): string {
  return normaliserNom(texte).replace(/[^a-z0-9]/g, '');
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

/** Titres lus dans une ligne : colonne reconnue (première occurrence) ou titre ignoré. */
function lireTitres<C extends string>(
  feuille: Worksheet,
  numeroLigne: number,
  definition: ColonnesImport<C>,
): {
  positions: Partial<Record<C, number>>;
  reconnues: { titre: string; colonne: string }[];
  ignorees: string[];
} {
  const positions: Partial<Record<C, number>> = {};
  const reconnues: { titre: string; colonne: string }[] = [];
  const ignorees: string[] = [];
  feuille.getRow(numeroLigne).eachCell((cell, numero) => {
    const valeur = valeurCellule(cell.value);
    if (valeur === null) return;
    const titre = String(valeur).trim();
    const colonne = definition.reconnaitre(normaliserTitre(titre));
    if (colonne && positions[colonne] === undefined) {
      positions[colonne] = numero;
      reconnues.push({ titre, colonne: definition.libelles[colonne] });
    } else {
      ignorees.push(titre);
    }
  });
  return { positions, reconnues, ignorees };
}

/**
 * Repère la ligne des titres (la première, parmi les 10 premières, qui contient
 * toutes les colonnes obligatoires), puis lit les lignes de données en dessous
 * (lignes vides ignorées, 1000 lignes au plus).
 */
export function lireLignesImport<C extends string>(
  feuille: Worksheet,
  definition: ColonnesImport<C>,
): LectureImport<C> {
  const derniere = Math.min(
    LIGNES_MAX_RECHERCHE_TITRES,
    Math.max(feuille.rowCount, 1),
  );
  // À défaut de ligne complète, la ligne qui reconnaît le plus d'obligatoires sert au message
  let meilleure: { numero: number; manquantes: string[] } | undefined;
  let trouvee:
    | (ReturnType<typeof lireTitres<C>> & { numero: number })
    | undefined;
  for (let numero = 1; numero <= derniere && !trouvee; numero++) {
    const titres = lireTitres(feuille, numero, definition);
    const manquantes = definition.obligatoires
      .filter(([colonne]) => titres.positions[colonne] === undefined)
      .map(([, libelle]) => `« ${libelle} »`);
    if (manquantes.length === 0) trouvee = { ...titres, numero };
    else if (!meilleure || manquantes.length < meilleure.manquantes.length) {
      meilleure = { numero, manquantes };
    }
  }

  if (!trouvee) {
    const manquantes = meilleure?.manquantes ?? [];
    throw new BadRequestException(
      manquantes.length === 1
        ? `La colonne ${manquantes[0]} est introuvable dans les titres du fichier. Ajoutez-la, ou partez du modèle à télécharger.`
        : `Les colonnes ${manquantes.join(' et ')} sont introuvables dans les titres du fichier. Ajoutez-les, ou partez du modèle à télécharger.`,
    );
  }
  const colonnes = trouvee.positions;
  const ligneTitres = trouvee.numero;

  // Lecture des lignes de données, lignes vides ignorées
  const brutes: LigneBruteImport<C>[] = [];
  feuille.eachRow((row, numero) => {
    if (numero <= ligneTitres) return;
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
  return {
    brutes,
    colonnes: {
      ligneTitres: trouvee.numero,
      reconnues: trouvee.reconnues,
      ignorees: trouvee.ignorees,
    },
  };
}
