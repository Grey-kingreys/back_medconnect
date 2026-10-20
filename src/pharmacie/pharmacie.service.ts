// Dette de typage préexistante, backlog points 21 et 22
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/common/services/prisma.service';
import {
  CreateMedicamentDto,
  UpdateMedicamentDto,
  UpsertStockDto,
  UpdateStockQuantiteDto,
  FichierImport,
  LigneImportStock,
  RapportImportStock,
} from './dto/pharmacie.dto';
import { Workbook } from 'exceljs';
import {
  ColonnesImport,
  lireLignesImport,
  normaliserNom,
  ouvrirFeuilleImport,
  ValeurImport,
} from './import-excel';

import { NotificationsService } from 'src/notifications/notifications.service';

export { MIME_XLSX } from './import-excel';

const NOTES_MAX_IMPORT = 500;
const SEUIL_STOCK_BAS = 10;

type ColonneImport = 'nom' | 'quantite' | 'prix' | 'date' | 'notes';

/** Colonnes de la feuille « Stock ». */
const COLONNES_IMPORT_STOCK: ColonnesImport<ColonneImport> = {
  toutes: ['nom', 'quantite', 'prix', 'date', 'notes'],
  reconnaitre: (titre) => {
    if (titre === 'medicament') return 'nom';
    if (titre === 'quantite') return 'quantite';
    if (titre.startsWith('prix')) return 'prix';
    if (titre.startsWith('date')) return 'date';
    if (titre.startsWith('note')) return 'notes';
    return undefined;
  },
  obligatoires: [
    ['nom', 'Médicament'],
    ['quantite', 'Quantité'],
  ],
};

@Injectable()
export class PharmacieService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Catalogue Global (ADMIN/SUPER_ADMIN) ─────────────────────

  async createMedicament(dto: CreateMedicamentDto, actorId?: string) {
    // Vérifier doublon par nom
    const existing = await this.prisma.medicament.findFirst({
      where: { nom: { equals: dto.nom.trim(), mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException(
        `Un médicament nommé "${dto.nom}" existe déjà dans le catalogue`,
      );
    }

    // Vérifier si c'est une nouvelle catégorie
    const existingCategory = await this.prisma.medicament.findFirst({
      where: {
        categorie: { equals: dto.categorie.trim(), mode: 'insensitive' },
      },
    });

    const med = await this.prisma.medicament.create({
      data: {
        nom: dto.nom.trim(),
        nomGenerique: dto.nomGenerique?.trim(),
        categorie: dto.categorie.trim(),
        description: dto.description?.trim(),
        ordonnanceRequise: dto.ordonnanceRequise,
        formes: dto.formes || [],
      },
    });

    if (!existingCategory) {
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
      await this.notificationsService.createManyNotifications(
        superAdmins.map((u) => u.id),
        {
          type: 'CATALOGUE_MODIF',
          titre: 'Nouvelle catégorie ajoutée',
          message: `${actorName} a ajouté la catégorie "${dto.categorie.trim()}" au catalogue via le médicament "${med.nom}".`,
        },
      );
    }

    return {
      data: med,
      message: 'Médicament ajouté au catalogue',
      success: true,
    };
  }

  async getMedicaments(search?: string, categorie?: string) {
    const where: any = {};

    if (search) {
      where.OR = [
        { nom: { contains: search, mode: 'insensitive' } },
        { nomGenerique: { contains: search, mode: 'insensitive' } },
        { categorie: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categorie) {
      where.categorie = { equals: categorie, mode: 'insensitive' };
    }

    const medicaments = await this.prisma.medicament.findMany({
      where,
      orderBy: { nom: 'asc' },
      include: {
        _count: { select: { stocks: true } },
      },
    });

    return {
      data: medicaments,
      message: `${medicaments.length} médicament(s) trouvé(s)`,
      success: true,
    };
  }

  async getMedicament(medicamentId: string) {
    const med = await this.prisma.medicament.findUnique({
      where: { id: medicamentId },
      include: {
        stocks: {
          where: { disponible: true, quantite: { gt: 0 } },
          include: {
            structure: {
              select: {
                id: true,
                nom: true,
                adresse: true,
                ville: true,
                telephone: true,
                latitude: true,
                longitude: true,
              },
            },
          },
        },
      },
    });

    if (!med) throw new NotFoundException('Médicament non trouvé');

    return { data: med, message: 'Médicament trouvé', success: true };
  }

  async updateMedicament(
    medicamentId: string,
    dto: UpdateMedicamentDto,
    actorId?: string,
  ) {
    const med = await this.prisma.medicament.findUnique({
      where: { id: medicamentId },
    });
    if (!med) throw new NotFoundException('Médicament non trouvé');

    const oldCategory = med.categorie;
    const updated = await this.prisma.medicament.update({
      where: { id: medicamentId },
      data: {
        nom: dto.nom?.trim(),
        nomGenerique: dto.nomGenerique?.trim(),
        categorie: dto.categorie?.trim(),
        description: dto.description?.trim(),
        ordonnanceRequise: dto.ordonnanceRequise,
        formes: dto.formes,
      },
    });

    if (
      dto.categorie &&
      dto.categorie.trim().toLowerCase() !== oldCategory.toLowerCase()
    ) {
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
      await this.notificationsService.createManyNotifications(
        superAdmins.map((u) => u.id),
        {
          type: 'CATALOGUE_MODIF',
          titre: 'Catégorie modifiée',
          message: `${actorName} a changé la catégorie de "${updated.nom}" (de "${oldCategory}" à "${updated.categorie}").`,
        },
      );
    }

    return { data: updated, message: 'Médicament mis à jour', success: true };
  }

  async deleteMedicament(medicamentId: string, actorId?: string) {
    const med = await this.prisma.medicament.findUnique({
      where: { id: medicamentId },
    });
    if (!med) throw new NotFoundException('Médicament non trouvé');

    const categoryToDelete = med.categorie;
    await this.prisma.medicament.delete({ where: { id: medicamentId } });

    // Vérifier si c'était le dernier de sa catégorie
    const remainingInCategory = await this.prisma.medicament.count({
      where: { categorie: categoryToDelete },
    });

    if (remainingInCategory === 0) {
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
      await this.notificationsService.createManyNotifications(
        superAdmins.map((u) => u.id),
        {
          type: 'CATALOGUE_MODIF',
          titre: 'Catégorie supprimée',
          message: `${actorName} a supprimé le dernier médicament de la catégorie "${categoryToDelete}", celle-ci disparaît donc du catalogue.`,
        },
      );
    }

    return {
      data: null,
      message: 'Médicament supprimé du catalogue',
      success: true,
    };
  }

  async getCategories() {
    const categories = await this.prisma.medicament.findMany({
      select: { categorie: true },
      distinct: ['categorie'],
      orderBy: { categorie: 'asc' },
    });

    return {
      data: categories.map((c) => c.categorie),
      message: 'Catégories récupérées',
      success: true,
    };
  }

  // ─── Stock Pharmacie (STRUCTURE_ADMIN de pharmacie) ───────────

  async upsertStock(
    structureId: string,
    adminUserId: string,
    dto: UpsertStockDto,
  ) {
    await this.checkPharmacieAccess(structureId, adminUserId);

    // Vérifier que le médicament existe
    const med = await this.prisma.medicament.findUnique({
      where: { id: dto.medicamentId },
    });
    if (!med)
      throw new NotFoundException('Médicament non trouvé dans le catalogue');

    const stock = await this.prisma.stockMedicament.upsert({
      where: {
        medicamentId_structureId: {
          medicamentId: dto.medicamentId,
          structureId,
        },
      },
      create: {
        medicamentId: dto.medicamentId,
        structureId,
        quantite: dto.quantite,
        prixUnitaire: dto.prixUnitaire,
        disponible: dto.quantite > 0,
        dateExpiration: dto.dateExpiration
          ? new Date(dto.dateExpiration)
          : null,
        notes: dto.notes?.trim(),
      },
      update: {
        quantite: dto.quantite,
        prixUnitaire: dto.prixUnitaire,
        disponible: dto.quantite > 0,
        dateExpiration: dto.dateExpiration
          ? new Date(dto.dateExpiration)
          : null,
        notes: dto.notes?.trim(),
      },
      include: {
        medicament: { select: { id: true, nom: true, categorie: true } },
      },
    });

    // Alerte stock bas
    if (dto.quantite < 10) {
      const staff = await this.prisma.user.findMany({
        where: { structureId, role: { in: ['PHARMACIEN', 'STRUCTURE_ADMIN'] } },
        select: { id: true },
      });
      await this.notificationsService.createManyNotifications(
        staff.map((u) => u.id),
        {
          type: 'STOCK_ALERTE',
          titre: 'Stock critique',
          message: `Le stock de "${stock.medicament.nom}" est ${dto.quantite === 0 ? 'épuisé' : `bas (${dto.quantite} unités)`}.`,
        },
      );
    }

    return {
      data: stock,
      message: 'Stock mis à jour',
      success: true,
    };
  }

  async updateStockQuantite(
    structureId: string,
    stockId: string,
    adminUserId: string,
    dto: UpdateStockQuantiteDto,
  ) {
    await this.checkPharmacieAccess(structureId, adminUserId);

    const stock = await this.prisma.stockMedicament.findFirst({
      where: { id: stockId, structureId },
    });
    if (!stock) throw new NotFoundException('Stock non trouvé');

    const newQuantite = Math.max(0, stock.quantite + dto.variation);

    const updated = await this.prisma.stockMedicament.update({
      where: { id: stockId },
      data: {
        quantite: newQuantite,
        disponible: newQuantite > 0,
        notes: dto.notes?.trim() || stock.notes,
      },
      include: {
        medicament: { select: { id: true, nom: true, categorie: true } },
      },
    });

    // Alerte stock bas
    if (newQuantite < 10 && stock.quantite >= 10) {
      const staff = await this.prisma.user.findMany({
        where: { structureId, role: { in: ['PHARMACIEN', 'STRUCTURE_ADMIN'] } },
        select: { id: true },
      });
      await this.notificationsService.createManyNotifications(
        staff.map((u) => u.id),
        {
          type: 'STOCK_ALERTE',
          titre: 'Stock critique',
          message: `Le stock de "${updated.medicament.nom}" est descendu à ${newQuantite} unités.`,
        },
      );
    }

    return {
      data: updated,
      message: `Stock ${dto.variation > 0 ? 'augmenté' : 'réduit'} (nouvelle quantité : ${newQuantite})`,
      success: true,
    };
  }

  async getStockPharmacie(structureId: string, adminUserId: string) {
    await this.checkPharmacieAccess(structureId, adminUserId);

    const stocks = await this.prisma.stockMedicament.findMany({
      where: { structureId },
      include: {
        medicament: {
          select: {
            id: true,
            nom: true,
            nomGenerique: true,
            categorie: true,
            formes: true,
            ordonnanceRequise: true,
          },
        },
      },
      orderBy: { medicament: { nom: 'asc' } },
    });

    // Alertes stock bas (< 10 unités)
    const stockBas = stocks.filter((s) => s.quantite > 0 && s.quantite < 10);
    const rupture = stocks.filter((s) => s.quantite === 0);

    return {
      data: {
        stocks,
        alertes: {
          stockBas: stockBas.map((s) => ({
            id: s.id,
            nom: s.medicament.nom,
            quantite: s.quantite,
          })),
          rupture: rupture.map((s) => ({ id: s.id, nom: s.medicament.nom })),
        },
      },
      message: `${stocks.length} médicament(s) en stock`,
      success: true,
    };
  }

  async removeStockItem(
    structureId: string,
    stockId: string,
    adminUserId: string,
  ) {
    await this.checkPharmacieAccess(structureId, adminUserId);

    const stock = await this.prisma.stockMedicament.findFirst({
      where: { id: stockId, structureId },
    });
    if (!stock) throw new NotFoundException('Stock non trouvé');

    await this.prisma.stockMedicament.delete({ where: { id: stockId } });
    return { data: null, message: 'Médicament retiré du stock', success: true };
  }

  // Import Excel du stock (D07, D08)

  /** Construit le modèle Excel à remplir par la pharmacie. */
  async getModeleImportStock(
    structureId: string,
    adminUserId: string,
  ): Promise<Buffer> {
    await this.checkPharmacieAccess(structureId, adminUserId);

    const exemple = await this.prisma.medicament.findFirst({
      orderBy: { nom: 'asc' },
      select: { nom: true },
    });

    const workbook = new Workbook();
    const feuille = workbook.addWorksheet('Stock');
    feuille.columns = [
      { header: 'Médicament', key: 'nom', width: 40 },
      { header: 'Quantité', key: 'quantite', width: 12 },
      { header: 'Prix unitaire (GNF)', key: 'prix', width: 22 },
      { header: "Date d'expiration (AAAA-MM-JJ)", key: 'date', width: 32 },
      { header: 'Notes', key: 'notes', width: 40 },
    ];
    feuille.getRow(1).font = { bold: true };
    const ligneExemple = feuille.addRow({
      nom: exemple?.nom ?? 'Paracétamol 500 mg',
      quantite: 50,
      prix: 35000,
      date: new Date(Date.UTC(2027, 11, 31)),
      notes: 'Livraison du mois',
    });
    ligneExemple.getCell('date').numFmt = 'yyyy-mm-dd';

    const aide = workbook.addWorksheet("Mode d'emploi");
    aide.getColumn(1).width = 110;
    [
      'Remplissez la feuille « Stock » : une ligne par médicament, à partir de la ligne 2. Ne modifiez pas les titres de la ligne 1.',
      "Écrivez le nom du médicament tel qu'il apparaît dans le catalogue MedConnecte (les majuscules et les accents ne comptent pas).",
      'La quantité est un nombre entier, 0 ou plus. Elle remplace la quantité actuellement en stock pour ce médicament.',
      "Le prix unitaire (en GNF), la date d'expiration (au format AAAA-MM-JJ, par exemple 2027-12-31) et les notes sont facultatifs.",
      "Un même fichier peut contenir jusqu'à 1000 médicaments. Remplacez la ligne d'exemple par vos propres médicaments.",
    ].forEach((texte) => aide.addRow([texte]));

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Analyse le fichier sans rien écrire et renvoie le rapport ligne par ligne. */
  async apercuImportStock(
    structureId: string,
    adminUserId: string,
    fichier?: FichierImport,
  ) {
    await this.checkPharmacieAccess(structureId, adminUserId);
    const rapport = await this.analyserImportStock(fichier);

    return {
      data: rapport,
      message: this.messageImportStock(rapport, false),
      success: true,
    };
  }

  /** Refait la même analyse puis écrit les lignes acceptées en une transaction. */
  async importerStock(
    structureId: string,
    adminUserId: string,
    fichier?: FichierImport,
  ) {
    await this.checkPharmacieAccess(structureId, adminUserId);
    const rapport = await this.analyserImportStock(fichier);
    const aEcrire = rapport.lignes.filter((l) => l.statut === 'acceptee');

    if (aEcrire.length > 0) {
      // Même sémantique que upsertStock : la quantité remplace celle en stock
      await this.prisma.$transaction(
        aEcrire.map((l) => {
          const quantite = l.quantite ?? 0;
          const donnees = {
            quantite,
            prixUnitaire: l.prixUnitaire,
            disponible: quantite > 0,
            dateExpiration: l.dateExpiration
              ? new Date(l.dateExpiration)
              : null,
            notes: l.notes?.trim(),
          };
          return this.prisma.stockMedicament.upsert({
            where: {
              medicamentId_structureId: {
                medicamentId: l.medicamentId as string,
                structureId,
              },
            },
            create: {
              medicamentId: l.medicamentId as string,
              structureId,
              ...donnees,
            },
            update: donnees,
          });
        }),
      );
    }

    // Une seule alerte groupée pour tout l'import
    const enAlerte = aEcrire.filter(
      (l) => (l.quantite ?? 0) < SEUIL_STOCK_BAS,
    ).length;
    if (enAlerte > 0) {
      const staff = await this.prisma.user.findMany({
        where: { structureId, role: { in: ['PHARMACIEN', 'STRUCTURE_ADMIN'] } },
        select: { id: true },
      });
      await this.notificationsService.createManyNotifications(
        staff.map((u) => u.id),
        {
          type: 'STOCK_ALERTE',
          titre: 'Stock critique',
          message:
            enAlerte === 1
              ? `Après l'import du fichier Excel, 1 médicament a un stock bas ou épuisé (moins de ${SEUIL_STOCK_BAS} unités). Pensez à le réapprovisionner.`
              : `Après l'import du fichier Excel, ${enAlerte} médicaments ont un stock bas ou épuisé (moins de ${SEUIL_STOCK_BAS} unités). Pensez à les réapprovisionner.`,
        },
      );
    }

    return {
      data: { ...rapport, importees: aEcrire.length },
      message: this.messageImportStock(rapport, true),
      success: true,
    };
  }

  /** Analyse commune à l'aperçu et à l'import : aucune écriture en base. */
  private async analyserImportStock(
    fichier?: FichierImport,
  ): Promise<RapportImportStock> {
    const feuille = await ouvrirFeuilleImport(fichier, 'Stock');
    const brutes = lireLignesImport(feuille, COLONNES_IMPORT_STOCK);

    // Catalogue chargé une seule fois, indexé par nom et nom générique normalisés
    const { data: catalogue } = await this.getMedicaments();
    const parNom = new Map<string, { id: string; nom: string }[]>();
    const parGenerique = new Map<string, { id: string; nom: string }[]>();
    for (const med of catalogue) {
      const entree = { id: med.id, nom: med.nom };
      const cleNom = normaliserNom(med.nom);
      parNom.set(cleNom, [...(parNom.get(cleNom) ?? []), entree]);
      if (med.nomGenerique) {
        const cleGen = normaliserNom(med.nomGenerique);
        if (cleGen) {
          parGenerique.set(cleGen, [
            ...(parGenerique.get(cleGen) ?? []),
            entree,
          ]);
        }
      }
    }

    const dejaVus = new Map<string, number>();
    const lignes = brutes.map(({ numero, valeurs }): LigneImportStock => {
      const nom = valeurs.nom === null ? '' : String(valeurs.nom).trim();
      const raisons: string[] = [];

      let med: { id: string; nom: string } | undefined;
      if (!nom) {
        raisons.push('Indiquez le nom du médicament.');
      } else {
        const cle = normaliserNom(nom);
        const candidats = parNom.get(cle) ?? parGenerique.get(cle) ?? [];
        if (candidats.length === 0) {
          raisons.push('Médicament absent du catalogue.');
        } else if (candidats.length > 1) {
          raisons.push(
            'Plusieurs médicaments du catalogue portent ce nom, ajoutez-le à la main depuis la liste.',
          );
        } else {
          med = candidats[0];
          const premiere = dejaVus.get(med.id);
          if (premiere !== undefined) {
            raisons.push(`Médicament déjà présent à la ligne ${premiere}.`);
          } else {
            dejaVus.set(med.id, numero);
          }
        }
      }

      const quantite = this.lireNombre(valeurs.quantite);
      if (quantite === undefined) {
        raisons.push('Indiquez la quantité (un nombre entier, 0 ou plus).');
      } else if (
        !Number.isInteger(quantite) ||
        quantite < 0 ||
        quantite > 2147483647
      ) {
        raisons.push(
          'La quantité doit être un nombre entier, 0 ou plus (exemple : 25).',
        );
      }

      const prixUnitaire = this.lireNombre(valeurs.prix);
      if (
        prixUnitaire !== undefined &&
        (!Number.isFinite(prixUnitaire) || prixUnitaire < 0)
      ) {
        raisons.push(
          'Le prix unitaire doit être un nombre, 0 ou plus, sans texte (exemple : 35000).',
        );
      }

      const dateExpiration = this.lireDate(valeurs.date);
      if (dateExpiration === false) {
        raisons.push(
          "La date d'expiration doit être une date valide au format AAAA-MM-JJ (exemple : 2027-12-31).",
        );
      }

      if (raisons.length > 0 || !med) {
        return {
          ligne: numero,
          nom,
          statut: 'rejetee',
          raison: raisons.join(' '),
        };
      }

      const notes =
        valeurs.notes === null
          ? ''
          : (valeurs.notes instanceof Date
              ? valeurs.notes.toISOString().slice(0, 10)
              : String(valeurs.notes)
            )
              .trim()
              .slice(0, NOTES_MAX_IMPORT);

      return {
        ligne: numero,
        nom,
        statut: 'acceptee',
        medicamentId: med.id,
        medicamentNom: med.nom,
        quantite,
        prixUnitaire,
        dateExpiration: dateExpiration || undefined,
        notes: notes || undefined,
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

  /** Message de synthèse : « 12 lignes prêtes à être importées, 2 lignes à corriger. » */
  private messageImportStock(
    rapport: RapportImportStock,
    importe: boolean,
  ): string {
    const { acceptees, rejetees } = rapport;
    let debut: string;
    if (importe) {
      debut =
        acceptees === 0
          ? 'Aucune ligne importée'
          : acceptees === 1
            ? '1 ligne importée dans votre stock'
            : `${acceptees} lignes importées dans votre stock`;
    } else {
      debut =
        acceptees === 0
          ? 'Aucune ligne prête à être importée'
          : acceptees === 1
            ? '1 ligne prête à être importée'
            : `${acceptees} lignes prêtes à être importées`;
    }
    const fin =
      rejetees === 0
        ? 'aucune ligne à corriger'
        : rejetees === 1
          ? '1 ligne à corriger'
          : `${rejetees} lignes à corriger`;
    return `${debut}, ${fin}.`;
  }

  /** undefined si la cellule est vide, NaN si ce n'est pas un nombre. */
  private lireNombre(valeur: ValeurImport): number | undefined {
    if (valeur === null) return undefined;
    if (typeof valeur === 'number') return valeur;
    if (typeof valeur === 'string') {
      const texte = valeur
        .replace(/\s/g, '')
        .replace(/gnf$/i, '')
        .replace(',', '.');
      return /^-?\d+(\.\d+)?$/.test(texte) ? Number(texte) : NaN;
    }
    return NaN;
  }

  /** Date ISO, undefined si la cellule est vide, false si la date est invalide. */
  private lireDate(valeur: ValeurImport): string | undefined | false {
    if (valeur === null) return undefined;
    if (valeur instanceof Date) {
      return Number.isNaN(valeur.getTime()) ? false : valeur.toISOString();
    }
    if (typeof valeur === 'string') {
      const morceaux = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur);
      if (!morceaux) return false;
      const [annee, mois, jour] = morceaux.slice(1).map(Number);
      const date = new Date(Date.UTC(annee, mois - 1, jour));
      return date.getUTCFullYear() === annee &&
        date.getUTCMonth() === mois - 1 &&
        date.getUTCDate() === jour
        ? date.toISOString()
        : false;
    }
    return false;
  }

  // ─── Recherche disponibilité (PUBLIC) ─────────────────────────

  async rechercherDisponibilite(
    search?: string,
    ville?: string,
    lat?: number,
    lng?: number,
    pharmacieId?: string,
  ) {
    const where: any = {
      disponible: true,
      quantite: { gt: 0 },
      structure: {
        type: 'PHARMACIE',
        isActive: true,
        isConfigured: true,
      },
    };

    if (search && search.trim().length >= 2) {
      where.medicament = {
        OR: [
          { nom: { contains: search.trim(), mode: 'insensitive' } },
          { nomGenerique: { contains: search.trim(), mode: 'insensitive' } },
        ],
      };
    }

    if (ville) {
      where.structure.ville = { contains: ville.trim(), mode: 'insensitive' };
    }

    if (pharmacieId) {
      where.structureId = pharmacieId;
    }

    const stocks = await this.prisma.stockMedicament.findMany({
      where,
      include: {
        medicament: {
          select: {
            id: true,
            nom: true,
            nomGenerique: true,
            categorie: true,
            ordonnanceRequise: true,
            formes: true,
          },
        },
        structure: {
          select: {
            id: true,
            nom: true,
            adresse: true,
            ville: true,
            telephone: true,
            latitude: true,
            longitude: true,
            estDeGarde: true,
          },
        },
      },
      orderBy: { structure: { nom: 'asc' } },
    });

    // Calculer distance si lat/lng fournis
    let results = stocks;
    if (lat !== undefined && lng !== undefined) {
      results = stocks
        .map((s) => ({
          ...s,
          distanceKm:
            s.structure.latitude && s.structure.longitude
              ? this.calculateDistance(
                  lat,
                  lng,
                  s.structure.latitude,
                  s.structure.longitude,
                )
              : null,
        }))
        .sort((a: any, b: any) => {
          if (a.distanceKm === null) return 1;
          if (b.distanceKm === null) return -1;
          return a.distanceKm - b.distanceKm;
        }) as any;
    }

    return {
      data: results,
      message: `${results.length} résultat(s) pour "${search}"`,
      success: true,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private async checkPharmacieAccess(structureId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const isAuthorizedRole =
      user?.role === 'STRUCTURE_ADMIN' || user?.role === 'PHARMACIEN';
    if (!user || user.structureId !== structureId || !isAuthorizedRole) {
      throw new ForbiddenException(
        "Vous n'êtes pas autorisé à gérer cette pharmacie",
      );
    }

    const structure = await this.prisma.structure.findUnique({
      where: { id: structureId },
    });
    if (!structure) throw new NotFoundException('Structure non trouvée');
    if (structure.type !== 'PHARMACIE') {
      throw new BadRequestException(
        'Cette fonctionnalité est réservée aux pharmacies',
      );
    }

    return { user, structure };
  }

  // Distance Haversine en km
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }
}
