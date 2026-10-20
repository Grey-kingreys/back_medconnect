import { Injectable } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { PrismaService } from 'src/common/services/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import {
  FichierImport,
  LigneImportCatalogue,
  RapportImportCatalogue,
  ResultatImportCatalogue,
} from './dto/pharmacie.dto';
import {
  ColonnesImport,
  lireLignesImport,
  normaliserNom,
  ouvrirFeuilleImport,
  ValeurImport,
} from './import-excel';

type ColonneCatalogue =
  | 'nom'
  | 'nomGenerique'
  | 'categorie'
  | 'description'
  | 'ordonnance'
  | 'formes';

/** Nom de la feuille à remplir dans le modèle. */
const FEUILLE_CATALOGUE = 'Catalogue';

/** Colonnes de la feuille « Catalogue ». */
const COLONNES_IMPORT_CATALOGUE: ColonnesImport<ColonneCatalogue> = {
  toutes: [
    'nom',
    'nomGenerique',
    'categorie',
    'description',
    'ordonnance',
    'formes',
  ],
  reconnaitre: (titre) => {
    if (titre === 'nom' || titre === 'medicament') return 'nom';
    if (titre.startsWith('nomgenerique')) return 'nomGenerique';
    if (titre.startsWith('categorie')) return 'categorie';
    if (titre.startsWith('description')) return 'description';
    if (titre.startsWith('ordonnance')) return 'ordonnance';
    if (titre.startsWith('forme')) return 'formes';
    return undefined;
  },
  obligatoires: [
    ['nom', 'Nom'],
    ['categorie', 'Catégorie'],
  ],
};

// Mêmes bornes que CreateMedicamentDto
const NOM_MIN = 2;
const NOM_MAX = 200;
const NOM_GENERIQUE_MAX = 200;
const CATEGORIE_MIN = 2;
const CATEGORIE_MAX = 100;
const DESCRIPTION_MAX = 1000;

/**
 * Import du catalogue des médicaments depuis un classeur Excel : modèle à
 * télécharger, aperçu sans écriture, puis création des médicaments acceptés en
 * une transaction. Un médicament déjà présent n'est jamais modifié.
 */
@Injectable()
export class CatalogueImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Construit le modèle Excel du catalogue, avec une notice en seconde feuille. */
  async getModeleImportCatalogue(): Promise<Buffer> {
    const workbook = new Workbook();
    const feuille = workbook.addWorksheet(FEUILLE_CATALOGUE);
    feuille.columns = [
      { header: 'Nom', key: 'nom', width: 32 },
      { header: 'Nom générique', key: 'nomGenerique', width: 30 },
      { header: 'Catégorie', key: 'categorie', width: 22 },
      { header: 'Description', key: 'description', width: 45 },
      { header: 'Ordonnance requise', key: 'ordonnance', width: 20 },
      { header: 'Formes', key: 'formes', width: 28 },
    ];
    feuille.getRow(1).font = { bold: true };
    feuille.addRow({
      nom: 'Coartem 20mg/120mg',
      nomGenerique: 'Artéméther/Luméfantrine',
      categorie: 'Antipaludéen',
      description: 'Traitement du paludisme non compliqué',
      ordonnance: 'oui',
      formes: 'comprimé',
    });

    const aide = workbook.addWorksheet("Mode d'emploi");
    aide.getColumn(1).width = 110;
    [
      'Remplissez la feuille « Catalogue » : une ligne par médicament, à partir de la ligne 2. Ne modifiez pas les titres de la ligne 1.',
      'Le nom (2 à 200 caractères) et la catégorie (2 à 100 caractères, par exemple Antipaludéen ou Antibiotique) sont obligatoires.',
      'Le nom générique, la description et les formes sont facultatifs.',
      'Ordonnance requise : écrivez oui ou non. Une case vide compte comme non.',
      'Formes : séparez-les par des virgules, par exemple : comprimé, sirop, injectable.',
      "Un médicament qui existe déjà dans le catalogue (même nom, sans tenir compte des majuscules ni des accents) est ignoré : il n'est jamais modifié.",
      "Un même fichier peut contenir jusqu'à 1000 médicaments. Remplacez la ligne d'exemple par vos propres médicaments.",
    ].forEach((texte) => aide.addRow([texte]));

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Analyse le fichier sans rien écrire et renvoie le rapport ligne par ligne. */
  async apercuImportCatalogue(fichier?: FichierImport) {
    const rapport = await this.analyserImportCatalogue(fichier);
    return {
      data: rapport,
      message: this.messageImportCatalogue(rapport, false),
      success: true,
    };
  }

  /** Refait la même analyse puis crée les médicaments acceptés en une transaction. */
  async importerCatalogue(fichier?: FichierImport, actorId?: string) {
    const rapport = await this.analyserImportCatalogue(fichier);
    const aCreer = rapport.lignes.filter((l) => l.statut === 'acceptee');

    if (aCreer.length > 0) {
      // Catégories connues avant l'écriture, pour repérer celles que l'import crée
      const avant = await this.prisma.medicament.findMany({
        select: { categorie: true },
        distinct: ['categorie'],
      });
      const connues = new Set(avant.map((c) => normaliserNom(c.categorie)));
      const nouvelles = [
        ...new Set(aCreer.map((l) => l.categorie as string)),
      ].filter((c) => !connues.has(normaliserNom(c)));

      await this.prisma.$transaction(
        aCreer.map((l) =>
          this.prisma.medicament.create({
            data: {
              nom: l.nom,
              nomGenerique: l.nomGenerique,
              categorie: l.categorie as string,
              description: l.description,
              ordonnanceRequise: l.ordonnanceRequise ?? false,
              formes: l.formes ?? [],
            },
          }),
        ),
      );
      await this.notifierNouvellesCategories(nouvelles, actorId);
    }

    const resultat: ResultatImportCatalogue = {
      ...rapport,
      importees: aCreer.length,
    };
    return {
      data: resultat,
      message: this.messageImportCatalogue(rapport, true),
      success: true,
    };
  }

  /** Analyse commune à l'aperçu et à l'import : aucune écriture en base. */
  private async analyserImportCatalogue(
    fichier?: FichierImport,
  ): Promise<RapportImportCatalogue> {
    const feuille = await ouvrirFeuilleImport(fichier, FEUILLE_CATALOGUE);
    const brutes = lireLignesImport(feuille, COLONNES_IMPORT_CATALOGUE);

    // Catalogue chargé une seule fois : noms existants et orthographe des catégories
    const existants = await this.prisma.medicament.findMany({
      select: { nom: true, categorie: true },
    });
    const nomsExistants = new Set(existants.map((m) => normaliserNom(m.nom)));
    const categories = new Map<string, string>();
    for (const { categorie } of existants) {
      const cle = normaliserNom(categorie);
      if (!categories.has(cle)) categories.set(cle, categorie);
    }

    const dejaVus = new Map<string, number>();
    const lignes = brutes.map(({ numero, valeurs }): LigneImportCatalogue => {
      const nom = this.texte(valeurs.nom).replace(/\s+/g, ' ');
      const raisons: string[] = [];

      if (!nom) {
        raisons.push('Indiquez le nom du médicament.');
      } else {
        const cle = normaliserNom(nom);
        if (nomsExistants.has(cle)) {
          raisons.push(
            "Déjà au catalogue : cette ligne est ignorée, le médicament existant n'est pas modifié.",
          );
        } else {
          const premiere = dejaVus.get(cle);
          if (premiere !== undefined) {
            raisons.push(`Médicament déjà présent à la ligne ${premiere}.`);
          } else {
            dejaVus.set(cle, numero);
          }
        }
        if (nom.length < NOM_MIN || nom.length > NOM_MAX) {
          raisons.push(
            `Le nom doit compter entre ${NOM_MIN} et ${NOM_MAX} caractères.`,
          );
        }
      }

      const nomGenerique = this.texte(valeurs.nomGenerique);
      if (nomGenerique.length > NOM_GENERIQUE_MAX) {
        raisons.push(
          `Le nom générique ne doit pas dépasser ${NOM_GENERIQUE_MAX} caractères.`,
        );
      }

      const categorieSaisie = this.texte(valeurs.categorie).replace(
        /\s+/g,
        ' ',
      );
      if (!categorieSaisie) {
        raisons.push(
          'Indiquez la catégorie du médicament (par exemple Antipaludéen).',
        );
      } else if (
        categorieSaisie.length < CATEGORIE_MIN ||
        categorieSaisie.length > CATEGORIE_MAX
      ) {
        raisons.push(
          `La catégorie doit compter entre ${CATEGORIE_MIN} et ${CATEGORIE_MAX} caractères.`,
        );
      }

      const description = this.texte(valeurs.description);
      if (description.length > DESCRIPTION_MAX) {
        raisons.push(
          `La description ne doit pas dépasser ${DESCRIPTION_MAX} caractères.`,
        );
      }

      const ordonnanceRequise = this.lireOuiNon(valeurs.ordonnance);
      if (ordonnanceRequise === undefined) {
        raisons.push(
          'Pour « Ordonnance requise », écrivez oui ou non (une case vide compte comme non).',
        );
      }

      if (raisons.length > 0) {
        return {
          ligne: numero,
          nom,
          statut: 'rejetee',
          raison: raisons.join(' '),
        };
      }

      // Une catégorie déjà connue garde l'orthographe du catalogue
      const cleCategorie = normaliserNom(categorieSaisie);
      const categorie = categories.get(cleCategorie) ?? categorieSaisie;
      if (!categories.has(cleCategorie)) {
        categories.set(cleCategorie, categorie);
      }

      return {
        ligne: numero,
        nom,
        statut: 'acceptee',
        nomGenerique: nomGenerique || undefined,
        categorie,
        description: description || undefined,
        ordonnanceRequise,
        formes: this.lireFormes(valeurs.formes),
      };
    });

    const acceptees = lignes.filter((l) => l.statut === 'acceptee').length;
    return {
      totalLignes: lignes.length,
      acceptees,
      rejetees: lignes.length - acceptees,
      lignes,
    };
  }

  /** Prévient les super-administrateurs des catégories créées par l'import. */
  private async notifierNouvellesCategories(
    nouvelles: string[],
    actorId?: string,
  ) {
    if (nouvelles.length === 0) return;

    let actorName = 'Un administrateur';
    if (actorId) {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorId },
        include: { structure: true },
      });
      if (actor) {
        actorName = `${actor.prenom} ${actor.nom}${actor.structure ? ` (${actor.structure.nom})` : ''}`;
      }
    }

    const superAdmins = await this.prisma.user.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true },
    });
    const liste = nouvelles.map((c) => `"${c}"`).join(', ');
    await this.notificationsService.createManyNotifications(
      superAdmins.map((u) => u.id),
      {
        type: 'CATALOGUE_MODIF',
        titre:
          nouvelles.length === 1
            ? 'Nouvelle catégorie ajoutée'
            : 'Nouvelles catégories ajoutées',
        message:
          nouvelles.length === 1
            ? `${actorName} a ajouté la catégorie ${liste} au catalogue en important un fichier Excel.`
            : `${actorName} a ajouté les catégories ${liste} au catalogue en important un fichier Excel.`,
      },
    );
  }

  /** Message de synthèse : « 12 médicaments prêts à être ajoutés au catalogue, 2 lignes écartées. » */
  private messageImportCatalogue(
    rapport: RapportImportCatalogue,
    importe: boolean,
  ): string {
    const { acceptees, rejetees } = rapport;
    let debut: string;
    if (importe) {
      debut =
        acceptees === 0
          ? 'Aucun médicament ajouté au catalogue'
          : acceptees === 1
            ? '1 médicament ajouté au catalogue'
            : `${acceptees} médicaments ajoutés au catalogue`;
    } else {
      debut =
        acceptees === 0
          ? 'Aucun médicament prêt à être ajouté au catalogue'
          : acceptees === 1
            ? '1 médicament prêt à être ajouté au catalogue'
            : `${acceptees} médicaments prêts à être ajoutés au catalogue`;
    }
    const fin =
      rejetees === 0
        ? 'aucune ligne écartée'
        : rejetees === 1
          ? '1 ligne écartée'
          : `${rejetees} lignes écartées`;
    return `${debut}, ${fin}.`;
  }

  /** Texte d'une cellule, chaîne vide si elle est vide. */
  private texte(valeur: ValeurImport): string {
    if (valeur === null) return '';
    if (valeur instanceof Date) return valeur.toISOString().slice(0, 10);
    return String(valeur).trim();
  }

  /** true pour oui, false pour non ou vide, undefined si la réponse est illisible. */
  private lireOuiNon(valeur: ValeurImport): boolean | undefined {
    if (valeur === null) return false;
    if (typeof valeur === 'boolean') return valeur;
    const reponse = normaliserNom(this.texte(valeur));
    if (reponse === 'oui' || reponse === 'o') return true;
    if (reponse === 'non' || reponse === 'n') return false;
    return undefined;
  }

  /** Formes séparées par des virgules (ou des points-virgules), sans doublons. */
  private lireFormes(valeur: ValeurImport): string[] {
    const formes: string[] = [];
    const vues = new Set<string>();
    for (const morceau of this.texte(valeur).split(/[,;]/)) {
      const forme = morceau.trim().replace(/\s+/g, ' ');
      const cle = normaliserNom(forme);
      if (!forme || vues.has(cle)) continue;
      vues.add(cle);
      formes.push(forme);
    }
    return formes;
  }
}
