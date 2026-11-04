// Dette de typage préexistante, backlog points 21 et 22
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/common/services/prisma.service';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { assurerPointDeVente } from './point-de-vente';
import { jourConakry } from './jour-metier';
import { masquerCouts } from './masquer-couts';
import { etatStock } from './domaine/quantites';
import { avertissementEcartPrix } from './domaine/prix';
import { MouvementsStockService } from './stock/mouvements-stock.service';
import { estCleEtrangereViolee } from './stock/erreurs-base';
import {
  avecStock,
  avecStockPublic,
  dateVersJour,
  jourVersDate,
  filtreLotVendable,
  lireEtatsStock,
  type EtatStockFiche,
} from './stock/lecture-stock';
import { AccesPharmacieService } from './acces-pharmacie.service';
import {
  CreateMedicamentDto,
  UpdateMedicamentDto,
  UpsertStockDto,
  UpdateStockQuantiteDto,
  FichierImport,
  LigneImportStock,
  RapportImportStock,
  ModeImportStock,
} from './dto/pharmacie.dto';
import { Workbook } from 'exceljs';
import {
  ColonnesImport,
  lireLignesImport,
  normaliserNom,
  normaliserTitre,
  ouvrirFeuilleImport,
  ValeurImport,
} from './import-excel';

import { NotificationsService } from 'src/notifications/notifications.service';
import { ReceptionsService } from './receptions/receptions.service';
import {
  InventairesService,
  type LigneInventaireAEnregistrer,
  type RefusLigneInventaire,
} from './inventaires/inventaires.service';
import { normaliserNumeroLot } from './domaine/inventaire';

export { MIME_XLSX } from './import-excel';

const NOTES_MAX_IMPORT = 500;
const SEUIL_STOCK_BAS = 10;
/** Plus grande quantité enregistrable (colonne Int de PostgreSQL). */
const QUANTITE_MAX = 2147483647;
/** Plus grand prix enregistrable (colonne Int de PostgreSQL). */
const PRIX_MAX = 2147483647;
/** Longueur maximale du numéro de lot. */
const NUMERO_LOT_MAX = 64;

/** Sélection du médicament dans les lectures de stock (contrat existant de getStockPharmacie). */
const SELECT_MEDICAMENT_STOCK = {
  id: true,
  nom: true,
  nomGenerique: true,
  categorie: true,
  formes: true,
  ordonnanceRequise: true,
} as const;

const MOTIF_SAISIE_FICHE = 'Quantité saisie sur la fiche de stock';
const MOTIF_CORRECTION_FICHE = 'Quantité corrigée sur la fiche de stock';

export const MESSAGE_LOT_REQUIS_QUANTITE =
  'Ce médicament a plusieurs lots : faites un inventaire.';
export const MESSAGE_LOT_REQUIS_DATE =
  'Ce médicament a plusieurs lots : corrigez la date de péremption lot par lot.';
export const MESSAGE_LOT_REQUIS_PROVISOIRE =
  'Des ventes de ce médicament attendent la réception de son stock : faites un inventaire.';
export const MESSAGE_LOT_REQUIS_CHOIX =
  'Ce médicament a plusieurs lots : choisissez le lot à corriger.';
export const MESSAGE_LOT_REQUIS_AUCUN =
  "Ce médicament n'a aucun lot en stock : modifiez la fiche pour saisir la quantité et la date de péremption.";
export const MESSAGE_LOT_INTROUVABLE =
  'Ce lot est introuvable pour ce médicament.';
export const MESSAGE_MOTIF_REQUIS =
  'Indiquez le motif de la correction (3 caractères au moins).';
export const MESSAGE_DATE_PEREMPTION_REQUISE =
  "Indiquez la date de péremption de ce stock, ou précisez que ce médicament n'a pas de date de péremption.";
export const MESSAGE_MEDICAMENT_UTILISE =
  'Ce médicament a déjà du stock ou des ventes dans une pharmacie : il ne peut pas être supprimé du catalogue.';

/** Message du refus d'une correction qui rendrait le lot négatif (testé avant écriture, D510). */
export function messageStockLotNegatif(solde: number): string {
  return `Ce lot n'a que ${solde} unité(s) en stock : la correction ne peut pas le rendre négatif.`;
}
export const MESSAGE_IMPORT_INVENTAIRE_INTERDIT =
  "Vous n'avez pas le droit d'enregistrer un inventaire dans cette pharmacie. Demandez au titulaire de vous donner ce droit.";
export function messageAnomaliesImportInventaire(nombre: number): string {
  return nombre === 1
    ? '1 écart dépasse la tolérance : il est signalé dans les anomalies.'
    : `${nombre} écarts dépassent la tolérance : ils sont signalés dans les anomalies.`;
}
const MESSAGE_IMPORT_INVENTAIRE_DATE_REQUISE =
  'Ces boîtes ne correspondent à aucun lot en stock : indiquez leur date de péremption (AAAA-MM-JJ) ou « sans péremption ».';
export const MESSAGE_IMPORT_LIVRAISON_INTERDIT =
  "Vous n'avez pas le droit d'enregistrer une livraison dans cette pharmacie. Demandez au titulaire de vous donner ce droit.";
export function messageAlerteImportLivraison(nombre: number): string {
  return nombre === 1
    ? "Après l'import de la livraison, 1 médicament a encore un stock bas ou épuisé. Pensez à le réapprovisionner."
    : `Après l'import de la livraison, ${nombre} médicaments ont encore un stock bas ou épuisé. Pensez à les réapprovisionner.`;
}

/** Transaction interactive de l'import : jusqu'à 1000 écritures successives. */
const OPTIONS_TRANSACTION_IMPORT = { maxWait: 10_000, timeout: 60_000 };

type ColonneImport =
  | 'nom'
  | 'quantite'
  | 'unites'
  | 'prix'
  | 'date'
  | 'lot'
  | 'cout'
  | 'notes';

/** Colonnes de la feuille « Stock ». */
const COLONNES_IMPORT_STOCK: ColonnesImport<ColonneImport> = {
  toutes: ['nom', 'quantite', 'unites', 'prix', 'date', 'lot', 'cout', 'notes'],
  // Titres des modèles et des logiciels de pharmacie courants (minuscules, sans accents ni espaces)
  reconnaitre: (titre) => {
    if (
      [
        'medicament',
        'medicaments',
        'nom',
        'nomdumedicament',
        'nomcommercial',
        'designation',
        'produit',
        'libelle',
        'article',
      ].includes(titre)
    ) {
      return 'nom';
    }
    // « Quantité minimale », « Qté seuil » : un seuil d'alerte, pas la quantité en stock
    const seuil = /min|max|seuil|alerte|commande/.test(titre);
    if (
      !seuil &&
      (titre.startsWith('quantite') ||
        titre.startsWith('qte') ||
        ['qty', 'qt', 'stock', 'stockactuel', 'enstock'].includes(titre))
    ) {
      return 'quantite';
    }
    if (titre.startsWith('unite') || ['vrac', 'detail'].includes(titre)) {
      return 'unites';
    }
    if (
      titre.startsWith('cout') ||
      titre.startsWith('prixdachat') ||
      titre.startsWith('prixachat')
    ) {
      return 'cout';
    }
    if (
      [
        'lot',
        'nlot',
        'nolot',
        'numlot',
        'numerolot',
        'numerodelot',
        'ndelot',
        'nodelot',
        'lotn',
        'lotno',
        'batch',
      ].includes(titre)
    ) {
      return 'lot';
    }
    if (
      titre.startsWith('prix') ||
      titre.startsWith('tarif') ||
      // « P.U. », « PU (GNF) », « PV TTC »
      /^p[uv](gnf|fg|ttc|ht)?$/.test(titre)
    ) {
      return 'prix';
    }
    if (
      titre.startsWith('date') ||
      titre.startsWith('peremption') ||
      titre.startsWith('expiration') ||
      ['dlu', 'dlc', 'exp'].includes(titre)
    ) {
      return 'date';
    }
    if (
      titre.startsWith('note') ||
      titre.startsWith('remarque') ||
      titre.startsWith('commentaire') ||
      titre.startsWith('observation')
    ) {
      return 'notes';
    }
    return undefined;
  },
  obligatoires: [
    ['nom', 'Médicament'],
    ['quantite', 'Quantité'],
  ],
  libelles: {
    nom: 'Médicament',
    quantite: 'Quantité',
    unites: 'Unités en plus',
    prix: 'Prix',
    date: "Date d'expiration",
    lot: 'Lot',
    cout: "Coût d'achat",
    notes: 'Notes',
  },
};

/** Ligne d'import de livraison à la présentation : jamais de quantité négative, part à régulariser avant à part (D717). */
function ecreterLigneLivraison(l: LigneImportStock): LigneImportStock {
  if (l.statut !== 'acceptee' || l.quantiteAvant === undefined) return l;
  return {
    ...l,
    quantiteAvant: Math.max(0, l.quantiteAvant),
    ...(l.quantiteApres === undefined
      ? {}
      : { quantiteApres: Math.max(0, l.quantiteApres) }),
    ...(l.quantiteAvant < 0
      ? { quantiteARegulariserAvant: -l.quantiteAvant }
      : {}),
  };
}

@Injectable()
export class PharmacieService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly accesPharmacie: AccesPharmacieService,
    private readonly mouvementsStock: MouvementsStockService,
    private readonly permissions: PermissionsService,
    private readonly receptions: ReceptionsService,
    private readonly inventaires: InventairesService,
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
    const jour = jourConakry(new Date());
    const med = await this.prisma.medicament.findUnique({
      where: { id: medicamentId },
      include: {
        stocks: {
          where: { archiveLe: null, lots: { some: filtreLotVendable(jour) } },
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

    const etats = await lireEtatsStock(
      this.prisma,
      med.stocks.map((s) => s.id),
      jour,
    );
    return {
      data: {
        ...med,
        stocks: med.stocks.map((s) =>
          avecStockPublic(s, etats.get(s.id) as EtatStockFiche),
        ),
      },
      message: 'Médicament trouvé',
      success: true,
    };
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

    // Refus si une pharmacie a un lot, un mouvement ou une vente de ce médicament (O12, D511)
    const fichesUtilisees = await this.prisma.stockMedicament.count({
      where: {
        medicamentId,
        OR: [{ lots: { some: {} } }, { mouvements: { some: {} } }],
      },
    });
    const lignesVendues = await this.prisma.ligneVente.count({
      where: { medicamentId },
    });
    if (fichesUtilisees > 0 || lignesVendues > 0) {
      throw new ConflictException({
        message: MESSAGE_MEDICAMENT_UTILISE,
        code: 'MEDICAMENT_UTILISE',
      });
    }

    const categoryToDelete = med.categorie;
    try {
      await this.prisma.medicament.delete({ where: { id: medicamentId } });
    } catch (erreur) {
      // Lot créé entre le contrôle et la suppression : la clé étrangère Restrict refuse
      if (estCleEtrangereViolee(erreur)) {
        throw new ConflictException({
          message: MESSAGE_MEDICAMENT_UTILISE,
          code: 'MEDICAMENT_UTILISE',
        });
      }
      throw erreur;
    }

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
    const { user, structure } = await this.accesPharmacie.verifier(
      structureId,
      adminUserId,
    );

    // Vérifier que le médicament existe
    const med = await this.prisma.medicament.findUnique({
      where: { id: dto.medicamentId },
    });
    if (!med)
      throw new NotFoundException('Médicament non trouvé dans le catalogue');

    const jour = jourConakry(new Date());
    const jourSaisi = dto.dateExpiration
      ? dateVersJour(new Date(dto.dateExpiration))
      : undefined;

    const { ficheId, seuilPrix, seuilStockBas } =
      await this.prisma.$transaction(async (tx) => {
        const cle = {
          medicamentId_structureId: {
            medicamentId: dto.medicamentId,
            structureId,
          },
        };
        const avant = await tx.stockMedicament.findUnique({
          where: cle,
          select: { archiveLe: true },
        });
        // Fiche créée à quantité nulle (D493) ; verrou de ligne avant le verrou consultatif (D507)
        const fiche = await tx.stockMedicament.upsert({
          where: cle,
          create: {
            medicamentId: dto.medicamentId,
            structureId,
            prixUnitaire: dto.prixUnitaire,
            notes: dto.notes?.trim(),
          },
          update: {
            prixUnitaire: dto.prixUnitaire,
            notes: dto.notes?.trim(),
            // Sans quantité, une fiche archivée reste archivée
            archiveLe: dto.quantite === undefined ? undefined : null,
          },
        });
        if (avant?.archiveLe && dto.quantite !== undefined) {
          await tx.auditLog.create({
            data: {
              userId: user.id,
              action: 'update',
              entityType: 'StockMedicament',
              entityId: fiche.id,
              ip: null,
              metadata: {
                avant: { archiveLe: avant.archiveLe.toISOString() },
                apres: { archiveLe: null },
              },
            },
          });
        }

        const { pointDeVente, parametres } =
          await this.pointDeVenteEtParametres(tx, structure);
        // Sans quantité : aucune écriture de stock (ni lot, ni mouvement, ni contrôle de date)
        if (dto.quantite === undefined) {
          return {
            ficheId: fiche.id,
            seuilPrix: parametres.seuilAvertissementPrixPct,
            seuilStockBas: parametres.seuilStockBas,
          };
        }
        await this.mouvementsStock.verrouillerFiches(tx, [fiche.id]);
        const etat = (await lireEtatsStock(tx, [fiche.id], jour)).get(
          fiche.id,
        ) as EtatStockFiche;
        const sommeLots = etat.lots.reduce((s, l) => s + l.quantite, 0);
        const quantite = dto.quantite;

        if (etat.quantite !== sommeLots) {
          // Part provisoire sans lot (vente en négatif, O11) : seule une réception ou un inventaire la résout
          if (quantite !== etat.quantite) {
            throw new ConflictException({
              message: MESSAGE_LOT_REQUIS_PROVISOIRE,
              code: 'LOT_REQUIS',
            });
          }
        } else if (etat.lots.length === 0) {
          if (quantite > 0) {
            if (jourSaisi === undefined && dto.sansPeremption !== true) {
              throw new BadRequestException({
                message: MESSAGE_DATE_PEREMPTION_REQUISE,
                code: 'DATE_PEREMPTION_REQUISE',
              });
            }
            await this.mouvementsStock.creerLot(tx, {
              stockMedicamentId: fiche.id,
              pointDeVenteId: pointDeVente.id,
              numeroLot: null,
              dateExpiration: jourSaisi ? jourVersDate(jourSaisi) : null,
              quantite,
              coutUnitaire: 0,
              coutAchatBoite: null,
              coefficientReception: fiche.coefficientBoite,
              fournisseurId: null,
              receptionId: null,
              lotTechnique: false,
              auteurId: user.id,
              pieceOrigineType: 'AJUSTEMENT',
              pieceOrigineId: null,
              motif: MOTIF_SAISIE_FICHE,
            });
          }
        } else if (etat.lots.length === 1) {
          const lot = etat.lots[0];
          if (quantite !== lot.quantite) {
            await this.mouvementsStock.ecrire(tx, {
              pointDeVenteId: pointDeVente.id,
              stockMedicamentId: fiche.id,
              lotId: lot.id,
              type: 'INVENTAIRE',
              quantite: quantite - lot.quantite,
              pieceOrigineType: 'AJUSTEMENT',
              pieceOrigineId: null,
              motif: MOTIF_CORRECTION_FICHE,
              auteurId: user.id,
            });
          }
          const jourLot = lot.dateExpiration
            ? dateVersJour(lot.dateExpiration)
            : null;
          if (jourSaisi !== undefined && jourSaisi !== jourLot) {
            await tx.lotStock.update({
              where: { id: lot.id },
              data: { dateExpiration: jourVersDate(jourSaisi) },
            });
            await tx.auditLog.create({
              data: {
                userId: user.id,
                action: 'update',
                entityType: 'LotStock',
                entityId: lot.id,
                ip: null,
                metadata: {
                  avant: { dateExpiration: jourLot },
                  apres: { dateExpiration: jourSaisi },
                },
              },
            });
          }
        } else {
          if (quantite !== etat.quantite) {
            throw new ConflictException({
              message: MESSAGE_LOT_REQUIS_QUANTITE,
              code: 'LOT_REQUIS',
            });
          }
          const jourAffiche = etat.dateExpiration
            ? dateVersJour(etat.dateExpiration)
            : null;
          if (jourSaisi !== undefined && jourSaisi !== jourAffiche) {
            throw new ConflictException({
              message: MESSAGE_LOT_REQUIS_DATE,
              code: 'LOT_REQUIS',
            });
          }
        }
        return {
          ficheId: fiche.id,
          seuilPrix: parametres.seuilAvertissementPrixPct,
          seuilStockBas: parametres.seuilStockBas,
        };
      });

    const [fiche] = await this.lireFichesStock({ id: ficheId }, jour);
    const avertissement = avertissementEcartPrix(
      fiche.prixUnitaire,
      fiche.prixUnite,
      fiche.coefficientBoite,
      seuilPrix,
    );

    // Alerte stock bas ou épuisé (seuil en boîtes, A4), seulement si le stock a pu changer
    if (
      dto.quantite !== undefined &&
      etatStock(fiche.quantite, fiche.coefficientBoite, seuilStockBas) !==
        'NORMAL'
    ) {
      await this.alerterStock(
        structureId,
        `Le stock de "${fiche.medicament.nom}" est ${fiche.quantite <= 0 ? 'épuisé' : `bas (${fiche.quantite} unités)`}.`,
      );
    }

    const peutVoirMarge = await this.peutVoirMarge(user.id);
    return {
      data: masquerCouts(
        { ...fiche, avertissements: avertissement ? [avertissement] : [] },
        peutVoirMarge,
      ),
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
    const { user, structure } = await this.accesPharmacie.verifier(
      structureId,
      adminUserId,
    );
    const motif = dto.motif?.trim() ?? '';
    if (motif.length < 3) {
      throw new BadRequestException({
        message: MESSAGE_MOTIF_REQUIS,
        code: 'MOTIF_REQUIS',
      });
    }
    const jour = jourConakry(new Date());

    const { avant, apres, coefficientBoite, seuilStockBas } =
      await this.prisma.$transaction(async (tx) => {
        // Verrou de ligne de la fiche, puis verrou consultatif (D507)
        const lignes = await tx.$queryRaw<
          { id: string; coefficientBoite: number }[]
        >`SELECT "id", "coefficientBoite" FROM "StockMedicament" WHERE "id" = ${stockId} AND "structureId" = ${structureId} AND "archiveLe" IS NULL FOR NO KEY UPDATE`;
        if (lignes.length === 0)
          throw new NotFoundException('Stock non trouvé');

        const { pointDeVente, parametres } =
          await this.pointDeVenteEtParametres(tx, structure);
        await this.mouvementsStock.verrouillerFiches(tx, [stockId]);
        const etat = (await lireEtatsStock(tx, [stockId], jour)).get(
          stockId,
        ) as EtatStockFiche;

        let lotId: string;
        let soldeLot: number;
        if (dto.lotId !== undefined) {
          const lot = await tx.lotStock.findFirst({
            where: {
              id: dto.lotId,
              stockMedicamentId: stockId,
              pointDeVenteId: pointDeVente.id,
            },
            select: { id: true, agregat: { select: { quantite: true } } },
          });
          if (!lot) throw new NotFoundException(MESSAGE_LOT_INTROUVABLE);
          lotId = lot.id;
          soldeLot = lot.agregat?.quantite ?? 0;
        } else if (etat.lots.length === 1) {
          lotId = etat.lots[0].id;
          soldeLot = etat.lots[0].quantite;
        } else {
          throw new ConflictException({
            message:
              etat.lots.length === 0
                ? MESSAGE_LOT_REQUIS_AUCUN
                : MESSAGE_LOT_REQUIS_CHOIX,
            code: 'LOT_REQUIS',
          });
        }

        if (soldeLot + dto.variation < 0) {
          throw new ConflictException({
            message: messageStockLotNegatif(soldeLot),
            code: 'STOCK_LOT_NEGATIF',
          });
        }

        const notes = dto.notes?.trim();
        if (notes) {
          await tx.stockMedicament.update({
            where: { id: stockId },
            data: { notes },
          });
        }

        const ecrit = await this.mouvementsStock.ecrire(tx, {
          pointDeVenteId: pointDeVente.id,
          stockMedicamentId: stockId,
          lotId,
          type: 'CORRECTION',
          quantite: dto.variation,
          pieceOrigineType: 'AJUSTEMENT',
          pieceOrigineId: null,
          motif,
          auteurId: user.id,
        });
        return {
          avant: etat.quantite,
          apres: ecrit.soldeProduit,
          coefficientBoite: lignes[0].coefficientBoite,
          seuilStockBas: parametres.seuilStockBas,
        };
      });

    const [fiche] = await this.lireFichesStock({ id: stockId }, jour);

    // Alerte au seul franchissement vers bas ou rupture (seuil en boîtes, A4)
    if (
      etatStock(avant, coefficientBoite, seuilStockBas) === 'NORMAL' &&
      etatStock(apres, coefficientBoite, seuilStockBas) !== 'NORMAL'
    ) {
      await this.alerterStock(
        structureId,
        `Le stock de "${fiche.medicament.nom}" est descendu à ${Math.max(0, apres)} unités.`,
      );
    }

    const peutVoirMarge = await this.peutVoirMarge(user.id);
    return {
      data: masquerCouts(fiche, peutVoirMarge),
      message: `Stock ${dto.variation > 0 ? 'augmenté' : 'réduit'} (nouvelle quantité : ${Math.max(0, apres)})`,
      success: true,
    };
  }

  async getStockPharmacie(structureId: string, adminUserId: string) {
    const { user } = await this.accesPharmacie.verifier(
      structureId,
      adminUserId,
    );
    const jour = jourConakry(new Date());
    const stocks = await this.lireFichesStock(
      { structureId, archiveLe: null },
      jour,
    );
    const parametres = await this.prisma.parametresPharmacie.findUnique({
      where: { structureId },
      select: { seuilStockBas: true },
    });
    const seuil = parametres?.seuilStockBas ?? SEUIL_STOCK_BAS;
    const etat = (s: { quantite: number; coefficientBoite: number }) =>
      etatStock(s.quantite, s.coefficientBoite, seuil);
    // Stock bas en boîtes (A4, D476) ; rupture : quantité nulle ou négative (D416)
    const stockBas = stocks.filter((s) => etat(s) === 'BAS');
    const rupture = stocks.filter((s) => etat(s) === 'RUPTURE');
    const peutVoirMarge = await this.peutVoirMarge(user.id);

    return {
      data: masquerCouts(
        {
          stocks,
          alertes: {
            stockBas: stockBas.map((s) => ({
              id: s.id,
              nom: s.medicament.nom,
              quantite: s.quantite,
            })),
            rupture: rupture.map((s) => ({
              id: s.id,
              nom: s.medicament.nom,
              quantiteARegulariser: s.quantiteARegulariser,
            })),
          },
        },
        peutVoirMarge,
      ),
      message: `${stocks.length} médicament(s) en stock`,
      success: true,
    };
  }

  async removeStockItem(
    structureId: string,
    stockId: string,
    adminUserId: string,
  ) {
    const { user } = await this.accesPharmacie.verifier(
      structureId,
      adminUserId,
    );

    // Archivage, jamais de suppression physique (O12, D430) ; idempotent
    await this.prisma.$transaction(async (tx) => {
      const fiche = await tx.stockMedicament.findFirst({
        where: { id: stockId, structureId },
        select: { id: true, archiveLe: true },
      });
      if (!fiche) throw new NotFoundException('Stock non trouvé');
      if (fiche.archiveLe) return;
      const archiveLe = new Date();
      const { count } = await tx.stockMedicament.updateMany({
        where: { id: stockId, archiveLe: null },
        data: { archiveLe },
      });
      if (count === 1) {
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'update',
            entityType: 'StockMedicament',
            entityId: stockId,
            ip: null,
            metadata: {
              avant: { archiveLe: null },
              apres: { archiveLe: archiveLe.toISOString() },
            },
          },
        });
      }
    });
    return { data: null, message: 'Médicament retiré du stock', success: true };
  }

  // Import Excel du stock (D07, D08)

  /** Construit le modèle Excel à remplir par la pharmacie. */
  async getModeleImportStock(
    structureId: string,
    adminUserId: string,
    mode: ModeImportStock = 'livraison',
  ): Promise<Buffer> {
    await this.accesPharmacie.verifier(structureId, adminUserId);

    const exemple = await this.prisma.medicament.findFirst({
      orderBy: { nom: 'asc' },
      select: { nom: true },
    });

    const workbook = new Workbook();
    const feuille = workbook.addWorksheet('Stock');
    if (mode === 'inventaire') {
      feuille.columns = [
        { header: 'Médicament', key: 'nom', width: 40 },
        { header: 'Quantité comptée (boîtes)', key: 'quantite', width: 26 },
        {
          header: 'Unités en plus (boîte entamée)',
          key: 'unites',
          width: 30,
        },
        { header: 'Lot', key: 'lot', width: 16 },
        { header: "Date d'expiration (AAAA-MM-JJ)", key: 'date', width: 32 },
      ];
      feuille.getRow(1).font = { bold: true };
      const ligneInventaire = feuille.addRow({
        nom: exemple?.nom ?? 'Paracétamol 500 mg',
        quantite: 12,
        unites: 7,
        lot: 'A2417',
        date: new Date(Date.UTC(2027, 11, 31)),
      });
      ligneInventaire.getCell('date').numFmt = 'yyyy-mm-dd';

      const aideInventaire = workbook.addWorksheet("Mode d'emploi");
      aideInventaire.getColumn(1).width = 110;
      [
        'Remplissez la feuille « Stock » : une ligne par lot compté, à partir de la ligne 2. Ne modifiez pas les titres de la ligne 1.',
        "Écrivez le nom du médicament tel qu'il apparaît dans le catalogue MedConnecte (les majuscules et les accents ne comptent pas).",
        "Quantité comptée : le nombre de boîtes entières trouvées en rayon (0 si aucune). Unités en plus : les comprimés, sachets ou ampoules d'une boîte entamée (case vide : 0).",
        "Au moment d'envoyer le fichier, choisissez « Inventaire » : la quantité comptée remplace le stock enregistré du lot. L'écart est enregistré ; au-delà de la tolérance du médicament, il est signalé au titulaire.",
        'Si un médicament a plusieurs lots en stock, faites une ligne par lot et indiquez le numéro de lot ou la date de péremption inscrite sur la boîte.',
        "Des boîtes d'un lot qui n'est pas encore enregistré sont ajoutées au stock : indiquez alors leur date de péremption (AAAA-MM-JJ), ou « sans péremption ».",
        'Saisissez le comptage sans vendre entre-temps les médicaments comptés : une vente faite après le comptage apparaîtrait comme un écart.',
        "Un même fichier peut contenir jusqu'à 1000 lignes. Remplacez la ligne d'exemple par vos propres comptages.",
      ].forEach((texte) => aideInventaire.addRow([texte]));

      return Buffer.from(await workbook.xlsx.writeBuffer());
    }
    feuille.columns = [
      { header: 'Médicament', key: 'nom', width: 40 },
      { header: 'Quantité (boîtes)', key: 'quantite', width: 16 },
      { header: 'Prix de la boîte (GNF)', key: 'prix', width: 22 },
      { header: "Date d'expiration (AAAA-MM-JJ)", key: 'date', width: 32 },
      { header: 'Lot', key: 'lot', width: 16 },
      { header: "Coût d'achat de la boîte (GNF)", key: 'cout', width: 30 },
      { header: 'Notes', key: 'notes', width: 40 },
    ];
    feuille.getRow(1).font = { bold: true };
    const ligneExemple = feuille.addRow({
      nom: exemple?.nom ?? 'Paracétamol 500 mg',
      quantite: 50,
      prix: 35000,
      date: new Date(Date.UTC(2027, 11, 31)),
      lot: 'A2417',
      cout: 25000,
      notes: 'Livraison du mois',
    });
    ligneExemple.getCell('date').numFmt = 'yyyy-mm-dd';

    const aide = workbook.addWorksheet("Mode d'emploi");
    aide.getColumn(1).width = 110;
    [
      'Remplissez la feuille « Stock » : une ligne par médicament reçu, à partir de la ligne 2. Ne modifiez pas les titres de la ligne 1.',
      "Écrivez le nom du médicament tel qu'il apparaît dans le catalogue MedConnecte (les majuscules et les accents ne comptent pas).",
      'La quantité est le nombre de boîtes reçues : un nombre entier, 1 ou plus.',
      "Au moment d'envoyer le fichier, choisissez « Livraison » : la quantité du fichier s'ajoute à votre stock. Exemple : 20 en stock et 50 dans le fichier, il y aura 70. Un médicament qui n'est pas encore dans votre stock y est ajouté.",
      "La date d'expiration est obligatoire, au format AAAA-MM-JJ (par exemple 2027-12-31). Pour un produit qui n'en a pas, écrivez « sans péremption ».",
      "Le lot (numéro inscrit sur la boîte) et le coût d'achat d'une boîte (en GNF) sont facultatifs. Sans coût d'achat, la marge de ces boîtes ne pourra pas être calculée.",
      "Le prix de la boîte (en GNF) et les notes sont facultatifs. Une case laissée vide ne change pas ce qui est déjà enregistré. Avant d'enregistrer, l'aperçu affiche pour chaque médicament la quantité avant et après.",
      "Un même fichier peut contenir jusqu'à 1000 médicaments. Remplacez la ligne d'exemple par vos propres médicaments.",
    ].forEach((texte) => aide.addRow([texte]));

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Analyse le fichier sans rien écrire et renvoie le rapport ligne par ligne. */
  async apercuImportStock(
    structureId: string,
    adminUserId: string,
    fichier?: FichierImport,
    mode: ModeImportStock = 'inventaire',
  ) {
    await this.accesPharmacie.verifier(structureId, adminUserId);
    await this.verifierModeImport(adminUserId, mode);
    const jour = jourConakry(new Date());
    const analyse = await this.analyserImportStock(fichier, jour, mode);

    if (mode === 'inventaire') {
      const acceptees = analyse.lignes.filter((l) => l.statut === 'acceptee');
      const ficheDe = await this.lireFichesImport(
        this.prisma,
        structureId,
        acceptees,
      );
      const avecFiche = acceptees.filter((l) =>
        ficheDe.has(l.medicamentId as string),
      );
      const simule =
        avecFiche.length === 0
          ? { lignes: [], refusees: [] }
          : await this.inventaires.simuler(
              this.prisma,
              structureId,
              this.lignesInventaire(avecFiche, ficheDe),
              jour,
            );
      const rapport = this.rapportInventaire(
        analyse,
        avecFiche,
        simule.lignes,
        simule.refusees,
      );
      return {
        data: { ...rapport, mode },
        message: this.messageImportStock(rapport, false),
        success: true,
      };
    }

    const enStock = await this.lireQuantitesEnStock(
      this.prisma,
      structureId,
      analyse,
    );
    const rapport = this.calculerQuantitesImport(analyse, enStock);
    const peutVoirMarge = await this.peutVoirMarge(adminUserId);

    return {
      data: masquerCouts(
        {
          ...rapport,
          lignes: rapport.lignes.map(ecreterLigneLivraison),
          mode,
        },
        peutVoirMarge,
      ),
      message: this.messageImportStock(rapport, false),
      success: true,
    };
  }

  /** Inventaire réservé à inventaire:write, livraison à reception:write. */
  private async verifierModeImport(
    userId: string,
    mode: ModeImportStock,
  ): Promise<void> {
    const permissions = await this.permissions.getUserPermissions(userId);
    if (mode === 'inventaire') {
      if (!permissions.includes(PERMISSIONS.INVENTAIRE_WRITE)) {
        throw new ForbiddenException(MESSAGE_IMPORT_INVENTAIRE_INTERDIT);
      }
      return;
    }
    if (!permissions.includes(PERMISSIONS.RECEPTION_WRITE)) {
      throw new ForbiddenException(MESSAGE_IMPORT_LIVRAISON_INTERDIT);
    }
  }

  /** Fiche de stock (identifiant) de chaque médicament des lignes. */
  private async lireFichesImport(
    client: Pick<Prisma.TransactionClient, 'stockMedicament'>,
    structureId: string,
    lignes: LigneImportStock[],
  ): Promise<Map<string, string>> {
    const fiches = await client.stockMedicament.findMany({
      where: {
        structureId,
        medicamentId: { in: lignes.map((l) => l.medicamentId as string) },
      },
      select: { id: true, medicamentId: true },
    });
    return new Map(fiches.map((f) => [f.medicamentId, f.id]));
  }

  /** Lignes du cœur de l'inventaire, dans l'ordre des lignes reçues. */
  private lignesInventaire(
    acceptees: LigneImportStock[],
    ficheDe: Map<string, string>,
  ): LigneInventaireAEnregistrer[] {
    return acceptees.map((l) => ({
      stockId: ficheDe.get(l.medicamentId as string) as string,
      lotId: null,
      numeroLot: l.numeroLot ?? null,
      dateExpiration: l.dateExpiration
        ? dateVersJour(new Date(l.dateExpiration))
        : null,
      sansPeremption: l.sansPeremption === true,
      quantiteComptee: null,
      nombreBoites: l.quantite as number,
      unitesEnPlus: l.unitesEnPlus ?? 0,
    }));
  }

  private raisonRefusInventaire(r: RefusLigneInventaire): string {
    switch (r.code) {
      case 'LOT_REQUIS': {
        const lots = r.lots ?? [];
        const liste =
          lots
            .slice(0, 5)
            .map(
              (lot) =>
                `${lot.numeroLot ?? 'sans numéro'} (${
                  lot.dateExpiration
                    ? `péremption ${lot.dateExpiration}`
                    : 'sans péremption'
                })`,
            )
            .join(', ') + (lots.length > 5 ? ', ...' : '');
        return `Ce médicament a plusieurs lots en stock (${liste}) : indiquez le lot ou la date de péremption, une ligne par lot.`;
      }
      case 'DATE_PEREMPTION_REQUISE':
        return MESSAGE_IMPORT_INVENTAIRE_DATE_REQUISE;
      case 'LOT_INCONNU_VIDE':
        return "Ce lot n'est pas dans votre stock et la quantité comptée est 0 : rien à enregistrer. Retirez la ligne ou vérifiez le numéro de lot.";
      case 'LOT_EN_DOUBLE':
        return 'Ce lot est déjà compté sur une autre ligne du fichier.';
      case 'QUANTITE_TROP_GRANDE':
        return 'La quantité comptée est trop grande. Vérifiez la quantité.';
      default:
        return 'Ce médicament est introuvable dans votre stock.';
    }
  }

  /** Médicament absent du stock : fiche créée à l'import si la quantité comptée est positive. */
  private evaluerAbsent(l: LigneImportStock): LigneImportStock {
    const comptee = (l.quantite ?? 0) + (l.unitesEnPlus ?? 0);
    if (comptee === 0) {
      return {
        ligne: l.ligne,
        nom: l.nom,
        statut: 'rejetee',
        raison:
          "Ce médicament n'est pas dans votre stock et la quantité comptée est 0 : rien à enregistrer. Retirez la ligne.",
      };
    }
    if (!l.dateExpiration && l.sansPeremption !== true) {
      return {
        ligne: l.ligne,
        nom: l.nom,
        statut: 'rejetee',
        raison: MESSAGE_IMPORT_INVENTAIRE_DATE_REQUISE,
      };
    }
    return {
      ...l,
      nouveauLot: true,
      quantiteAvant: 0,
      quantiteApres: comptee,
      quantiteComptee: comptee,
      quantiteTheorique: 0,
      quantiteARegulariser: 0,
      ecart: comptee,
      sousTolerance: false,
    };
  }

  /**
   * Rapport d'un import d'inventaire : la k-ième ligne retenue correspond à
   * l'index k du cœur. Les médicaments absents du stock et non retenus sont
   * évalués par `evaluerAbsent`.
   */
  private rapportInventaire(
    analyse: RapportImportStock,
    retenues: LigneImportStock[],
    evaluees: {
      index: number;
      lotId: string | null;
      nouveauLot: boolean;
      soldeAvant: number;
      quantiteTheorique: number;
      quantiteComptee: number;
      ecart: number;
      sousTolerance: boolean;
    }[],
    refusees: RefusLigneInventaire[],
  ): RapportImportStock {
    const indexDe = new Map(retenues.map((l, i) => [l.ligne, i]));
    const evalueeDe = new Map(evaluees.map((e) => [e.index, e]));
    const refusDe = new Map(refusees.map((r) => [r.index, r]));
    const lignes = analyse.lignes.map((l): LigneImportStock => {
      if (l.statut !== 'acceptee') return l;
      const index = indexDe.get(l.ligne);
      if (index === undefined) {
        // Médicament absent du stock et non retenu (règle pure, identique à l'import)
        return this.evaluerAbsent(l);
      }
      const refus = refusDe.get(index);
      const e = evalueeDe.get(index);
      if (refus || !e) {
        return {
          ligne: l.ligne,
          nom: l.nom,
          statut: 'rejetee',
          raison: refus
            ? this.raisonRefusInventaire(refus)
            : 'Ce médicament est introuvable dans votre stock.',
        };
      }
      return {
        ...l,
        lotId: e.lotId ?? undefined,
        nouveauLot: e.nouveauLot,
        quantiteAvant: e.soldeAvant,
        quantiteApres: e.quantiteComptee,
        quantiteComptee: e.quantiteComptee,
        quantiteTheorique: Math.max(0, e.quantiteTheorique),
        quantiteARegulariser: Math.max(0, -e.quantiteTheorique),
        ecart: e.ecart,
        sousTolerance: e.sousTolerance,
      };
    });
    const acceptees = lignes.filter((l) => l.statut === 'acceptee').length;
    return {
      totalLignes: lignes.length,
      acceptees,
      rejetees: lignes.length - acceptees,
      lignes,
      colonnes: analyse.colonnes,
    };
  }

  /**
   * Refait l'analyse puis, dans une transaction, relit le stock, calcule les
   * quantités et écrit les lignes acceptées.
   */
  async importerStock(
    structureId: string,
    adminUserId: string,
    fichier?: FichierImport,
    mode: ModeImportStock = 'inventaire',
  ) {
    const acces = await this.accesPharmacie.verifier(structureId, adminUserId);
    await this.verifierModeImport(adminUserId, mode);
    const jour = jourConakry(new Date());
    const analyse = await this.analyserImportStock(fichier, jour, mode);

    if (mode === 'inventaire') {
      const { rapport, inventaireId, nombreAnomalies } =
        await this.prisma.$transaction(async (tx) => {
          const acceptees = analyse.lignes.filter(
            (l) => l.statut === 'acceptee',
          );
          let ficheDe = await this.lireFichesImport(tx, structureId, acceptees);

          // Médicaments absents du stock : fiche créée à quantité nulle (D493), si le comptage est positif
          const absents = acceptees.filter(
            (l) => !ficheDe.has(l.medicamentId as string),
          );
          const aCreer = absents.filter(
            (l) => this.evaluerAbsent(l).statut === 'acceptee',
          );
          if (aCreer.length > 0) {
            await tx.stockMedicament.createMany({
              data: aCreer.map((l) => ({
                medicamentId: l.medicamentId as string,
                structureId,
              })),
              skipDuplicates: true,
            });
            ficheDe = await this.lireFichesImport(tx, structureId, acceptees);
          }
          const rejetesAbsents = new Set(
            absents
              .filter((l) => this.evaluerAbsent(l).statut === 'rejetee')
              .map((l) => l.ligne),
          );
          const retenues = acceptees.filter(
            (l) =>
              !rejetesAbsents.has(l.ligne) &&
              ficheDe.has(l.medicamentId as string),
          );
          if (retenues.length === 0) {
            return {
              rapport: this.rapportInventaire(analyse, [], [], []),
              inventaireId: null,
              nombreAnomalies: 0,
            };
          }

          const ecrit = await this.inventaires.enregistrerDansTransaction(
            tx,
            acces,
            {
              commentaire: 'Import Excel',
              lignes: this.lignesInventaire(retenues, ficheDe),
            },
            null,
            { rejeterLignes: true },
          );
          // Les valeurs du cœur, sous verrou, font foi
          return {
            rapport: this.rapportInventaire(
              analyse,
              retenues,
              ecrit.lignes,
              ecrit.refusees,
            ),
            inventaireId: ecrit.inventaireId,
            nombreAnomalies: ecrit.anomalies.length,
          };
        }, OPTIONS_TRANSACTION_IMPORT);

      return {
        data: {
          ...rapport,
          mode,
          importees: rapport.acceptees,
          receptionId: null,
          inventaireId,
        },
        message:
          this.messageImportStock(rapport, true) +
          (nombreAnomalies > 0
            ? ` ${messageAnomaliesImportInventaire(nombreAnomalies)}`
            : ''),
        success: true,
      };
    }

    // Lecture du stock, calcul et réception dans la même transaction
    const { rapport, receptionId, enStock } = await this.prisma.$transaction(
      async (tx) => {
        const enStock = await this.lireQuantitesEnStock(
          tx,
          structureId,
          analyse,
        );
        const calcule = this.calculerQuantitesImport(analyse, enStock);
        const acceptees = calcule.lignes.filter((l) => l.statut === 'acceptee');
        if (acceptees.length === 0) {
          return { rapport: calcule, receptionId: null, enStock };
        }

        // Médicaments absents du stock : fiche créée à quantité nulle (D493)
        const absents = acceptees
          .map((l) => l.medicamentId as string)
          .filter((id) => !enStock.has(id));
        if (absents.length > 0) {
          await tx.stockMedicament.createMany({
            data: absents.map((medicamentId) => ({
              medicamentId,
              structureId,
            })),
            skipDuplicates: true,
          });
        }
        const fiches = await tx.stockMedicament.findMany({
          where: {
            structureId,
            medicamentId: {
              in: acceptees.map((l) => l.medicamentId as string),
            },
          },
          select: { id: true, medicamentId: true },
        });
        const ficheDe = new Map(fiches.map((f) => [f.medicamentId, f.id]));

        const ecrite = await this.receptions.enregistrerDansTransaction(
          tx,
          acces,
          {
            fournisseurId: null,
            reference: null,
            recueLe: new Date(),
            lignes: acceptees.map((l) => ({
              stockId: ficheDe.get(l.medicamentId as string) as string,
              numeroLot: l.numeroLot ?? null,
              dateExpiration: l.dateExpiration
                ? dateVersJour(new Date(l.dateExpiration))
                : null,
              sansPeremption: l.sansPeremption === true,
              nombreBoites: l.quantite as number,
              quantiteUnites: null,
              coutAchatBoite: l.coutAchatBoite ?? null,
              majFiche: {
                prixUnitaire: l.prixUnitaire,
                notes: l.notes?.trim(),
              },
            })),
          },
        );

        // Le stock relu sous verrou fait foi : un import simultané est compté
        let k = 0;
        const lignes = calcule.lignes.map((l): LigneImportStock => {
          if (l.statut !== 'acceptee') return l;
          const ecriteK = ecrite.lignes[k++];
          return {
            ...l,
            lotId: ecriteK.lotId,
            unitesRecues: ecriteK.quantiteUm,
            quantiteAvant: ecriteK.soldeProduitApres - ecriteK.quantiteUm,
            quantiteApres: ecriteK.soldeProduitApres,
          };
        });
        return {
          rapport: { ...calcule, lignes },
          receptionId: ecrite.receptionId,
          enStock,
        };
      },
      OPTIONS_TRANSACTION_IMPORT,
    );
    const aEcrire = rapport.lignes.filter((l) => l.statut === 'acceptee');

    // Une seule alerte groupée pour tout l'import (A4, D476)
    if (aEcrire.length > 0) {
      const parametres = await this.prisma.parametresPharmacie.findUnique({
        where: { structureId },
        select: { seuilStockBas: true },
      });
      const seuil = parametres?.seuilStockBas ?? SEUIL_STOCK_BAS;
      const enAlerte = aEcrire.filter(
        (l) =>
          etatStock(
            l.quantiteApres ?? 0,
            enStock.get(l.medicamentId as string)?.coefficientBoite ?? 1,
            seuil,
          ) !== 'NORMAL',
      ).length;
      if (enAlerte > 0) {
        await this.alerterStock(
          structureId,
          messageAlerteImportLivraison(enAlerte),
        );
      }
    }

    const peutVoirMarge = await this.peutVoirMarge(adminUserId);
    return {
      data: masquerCouts(
        {
          ...rapport,
          // Réponse seulement : l'alerte ci-dessus a lu la vérité (D717)
          lignes: rapport.lignes.map(ecreterLigneLivraison),
          mode,
          importees: aEcrire.length,
          receptionId,
          inventaireId: null,
        },
        peutVoirMarge,
      ),
      message: this.messageImportStock(rapport, true),
      success: true,
    };
  }

  /** Analyse commune à l'aperçu et à l'import : aucune écriture en base. */
  private async analyserImportStock(
    fichier: FichierImport | undefined,
    jour: string,
    mode: ModeImportStock,
  ): Promise<RapportImportStock> {
    const inventaire = mode === 'inventaire';
    const feuille = await ouvrirFeuilleImport(fichier, 'Stock');
    const { brutes, colonnes } = lireLignesImport(
      feuille,
      COLONNES_IMPORT_STOCK,
    );

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
          if (!inventaire) {
            const premiere = dejaVus.get(med.id);
            if (premiere !== undefined) {
              raisons.push(`Médicament déjà présent à la ligne ${premiere}.`);
            } else {
              dejaVus.set(med.id, numero);
            }
          }
        }
      }
      // Inventaire : le doublon se juge après la lecture du lot et de la date
      const nombreRaisonsNom = raisons.length;

      const quantite = this.lireNombre(valeurs.quantite);
      if (inventaire) {
        if (quantite === undefined) {
          raisons.push(
            'Indiquez le nombre de boîtes comptées (un nombre entier, 0 ou plus).',
          );
        } else if (
          !Number.isInteger(quantite) ||
          quantite < 0 ||
          quantite > 1_000_000
        ) {
          raisons.push(
            'Le nombre de boîtes comptées doit être un nombre entier, 0 ou plus (exemple : 12).',
          );
        }
      } else if (quantite === undefined) {
        raisons.push(
          'Indiquez la quantité reçue (un nombre entier de boîtes, 1 ou plus).',
        );
      } else if (
        !Number.isInteger(quantite) ||
        quantite < 1 ||
        quantite > QUANTITE_MAX
      ) {
        raisons.push(
          'La quantité reçue doit être un nombre entier de boîtes, 1 ou plus (exemple : 25).',
        );
      }

      let unitesEnPlus = 0;
      if (inventaire) {
        const unites = this.lireNombre(valeurs.unites);
        if (unites !== undefined) {
          if (
            !Number.isInteger(unites) ||
            unites < 0 ||
            unites > 1_000_000_000
          ) {
            raisons.push(
              "Les unités en plus doivent être un nombre entier, 0 ou plus (exemple : 7 comprimés d'une boîte entamée).",
            );
          } else {
            unitesEnPlus = unites;
          }
        }
      }

      let prixUnitaire = inventaire ? undefined : this.lireNombre(valeurs.prix);
      if (
        prixUnitaire !== undefined &&
        (!Number.isFinite(prixUnitaire) || prixUnitaire < 0)
      ) {
        raisons.push(
          'Le prix unitaire doit être un nombre, 0 ou plus, sans texte (exemple : 35000).',
        );
      } else if (prixUnitaire !== undefined) {
        // Le prix du stock est un entier de francs guinéens (lot 7).
        prixUnitaire = Math.round(prixUnitaire);
        if (prixUnitaire > PRIX_MAX) {
          raisons.push(
            'Le prix unitaire est trop grand. Vérifiez le montant (exemple : 35000).',
          );
        }
      }

      const sansPeremption =
        typeof valeurs.date === 'string' &&
        normaliserTitre(valeurs.date) === 'sansperemption';
      const dateExpiration = sansPeremption
        ? undefined
        : this.lireDate(valeurs.date);
      if (inventaire) {
        // Date facultative, une date passée est acceptée (le stock existe déjà)
        if (dateExpiration === false) {
          raisons.push(
            "La date d'expiration doit être une date valide au format AAAA-MM-JJ (exemple : 2027-12-31).",
          );
        }
      } else if (!sansPeremption) {
        if (dateExpiration === undefined) {
          raisons.push(
            "Indiquez la date de péremption (AAAA-MM-JJ), ou écrivez « sans péremption » si ce médicament n'en a pas.",
          );
        } else if (dateExpiration === false) {
          raisons.push(
            "La date d'expiration doit être une date valide au format AAAA-MM-JJ (exemple : 2027-12-31).",
          );
        } else if (dateVersJour(new Date(dateExpiration)) < jour) {
          raisons.push(
            'Cette date de péremption est déjà passée : vérifiez-la. Un médicament périmé ne doit pas entrer en stock.',
          );
        }
      }

      const numeroLot =
        valeurs.lot === null
          ? ''
          : (valeurs.lot instanceof Date
              ? valeurs.lot.toISOString().slice(0, 10)
              : String(valeurs.lot)
            ).trim();
      if (numeroLot.length > NUMERO_LOT_MAX) {
        raisons.push('Le numéro de lot est trop long (64 caractères au plus).');
      }

      if (inventaire && med) {
        const cle = numeroLot
          ? normaliserNumeroLot(numeroLot)
          : typeof dateExpiration === 'string'
            ? dateVersJour(new Date(dateExpiration))
            : sansPeremption
              ? 'sansperemption'
              : '';
        const cleLigne = `${med.id}|${cle}`;
        const premiere = dejaVus.get(cleLigne);
        if (premiere !== undefined) {
          raisons.splice(
            nombreRaisonsNom,
            0,
            cle === ''
              ? `Médicament déjà présent à la ligne ${premiere}.`
              : `Ce lot de ce médicament est déjà compté à la ligne ${premiere}.`,
          );
        } else {
          dejaVus.set(cleLigne, numero);
        }
      }

      let coutAchatBoite = inventaire
        ? undefined
        : this.lireNombre(valeurs.cout);
      if (
        coutAchatBoite !== undefined &&
        (!Number.isFinite(coutAchatBoite) || coutAchatBoite < 0)
      ) {
        raisons.push(
          "Le coût d'achat doit être un nombre, 0 ou plus, sans texte (exemple : 25000).",
        );
      } else if (coutAchatBoite !== undefined) {
        coutAchatBoite = Math.round(coutAchatBoite);
        if (coutAchatBoite > PRIX_MAX) {
          raisons.push(
            "Le coût d'achat est trop grand. Vérifiez le montant (exemple : 25000).",
          );
        }
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
        inventaire || valeurs.notes === null
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
        sansPeremption,
        ...(inventaire ? { unitesEnPlus } : {}),
        ...(numeroLot ? { numeroLot } : {}),
        ...(coutAchatBoite !== undefined ? { coutAchatBoite } : {}),
      };
    });

    const acceptees = lignes.filter((l) => l.statut === 'acceptee').length;
    return {
      totalLignes: lignes.length,
      acceptees,
      rejetees: lignes.length - acceptees,
      lignes,
      colonnes,
    };
  }

  /**
   * Calcule unitesRecues, quantiteAvant et quantiteApres (en unités) de chaque ligne acceptée.
   * Une ligne dont le total dépasserait QUANTITE_MAX devient rejetée.
   * Renvoie un nouveau rapport (compteurs recalculés), sans modifier celui reçu.
   */
  private calculerQuantitesImport(
    rapport: RapportImportStock,
    enStock: Map<string, { quantite: number; coefficientBoite: number }>,
  ): RapportImportStock {
    const lignes = rapport.lignes.map((l): LigneImportStock => {
      if (l.statut !== 'acceptee') return l;
      const fiche = enStock.get(l.medicamentId as string);
      const avant = fiche?.quantite ?? 0;
      const coefficient = fiche?.coefficientBoite ?? 1;
      const unites = (l.quantite ?? 0) * coefficient;
      const apres = avant + unites;
      if (unites > QUANTITE_MAX || apres > QUANTITE_MAX) {
        return {
          ligne: l.ligne,
          nom: l.nom,
          statut: 'rejetee',
          raison:
            'Avec cette livraison, la quantité en stock deviendrait trop grande. Vérifiez la quantité.',
        };
      }
      return {
        ...l,
        unitesRecues: unites,
        quantiteAvant: avant,
        quantiteApres: apres,
      };
    });

    const acceptees = lignes.filter((l) => l.statut === 'acceptee').length;
    return {
      totalLignes: lignes.length,
      acceptees,
      rejetees: lignes.length - acceptees,
      lignes,
      colonnes: rapport.colonnes,
    };
  }

  /** Stock calculé (somme des agrégats) et unités par boîte des médicaments des lignes acceptées. */
  private async lireQuantitesEnStock(
    client: Pick<Prisma.TransactionClient, 'stockMedicament'>,
    structureId: string,
    rapport: RapportImportStock,
  ): Promise<Map<string, { quantite: number; coefficientBoite: number }>> {
    const ids = rapport.lignes
      .filter((l) => l.statut === 'acceptee')
      .map((l) => l.medicamentId as string);
    if (ids.length === 0) return new Map();

    const stocks = await client.stockMedicament.findMany({
      where: { structureId, medicamentId: { in: ids } },
      select: {
        medicamentId: true,
        coefficientBoite: true,
        agregatsProduit: { select: { quantite: true } },
      },
    });
    return new Map(
      stocks.map((s) => [
        s.medicamentId,
        {
          quantite: s.agregatsProduit.reduce(
            (somme, a) => somme + a.quantite,
            0,
          ),
          coefficientBoite: s.coefficientBoite,
        },
      ]),
    );
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
    const jour = jourConakry(new Date());
    const where: any = {
      archiveLe: null,
      lots: { some: filtreLotVendable(jour) },
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
    const etats = await lireEtatsStock(
      this.prisma,
      stocks.map((s) => s.id),
      jour,
    );
    const publics = stocks.map((s) =>
      avecStockPublic(s, etats.get(s.id) as EtatStockFiche),
    );

    // Calculer distance si lat/lng fournis
    let results = publics;
    if (lat !== undefined && lng !== undefined) {
      results = publics
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

  /** Vrai si l'utilisateur a marge:read (masquage des coûts, D466). */
  private async peutVoirMarge(userId: string): Promise<boolean> {
    const permissions = await this.permissions.getUserPermissions(userId);
    return permissions.includes(PERMISSIONS.MARGE_READ);
  }

  /** Fiches lues au contrat du plan 1.7, triées par nom de médicament. */
  private async lireFichesStock(
    where: Prisma.StockMedicamentWhereInput,
    jour: string,
  ) {
    const fiches = await this.prisma.stockMedicament.findMany({
      where,
      include: { medicament: { select: SELECT_MEDICAMENT_STOCK } },
      orderBy: { medicament: { nom: 'asc' } },
    });
    const etats = await lireEtatsStock(
      this.prisma,
      fiches.map((f) => f.id),
      jour,
    );
    return fiches.map((f) => avecStock(f, etats.get(f.id) as EtatStockFiche));
  }

  /** Point de vente d'ordre 1 et paramètres, lus sans verrou ; créés seulement s'ils manquent (D507). */
  private async pointDeVenteEtParametres(
    tx: Prisma.TransactionClient,
    structure: { id: string; nom: string },
  ) {
    const pointDeVente = await tx.pointDeVente.findUnique({
      where: { structureId_ordre: { structureId: structure.id, ordre: 1 } },
    });
    const parametres = await tx.parametresPharmacie.findUnique({
      where: { structureId: structure.id },
    });
    if (pointDeVente && parametres) return { pointDeVente, parametres };
    return assurerPointDeVente(tx, structure);
  }

  /** Destinataires des alertes de stock (règle existante). */
  private async alerterStock(structureId: string, message: string) {
    const staff = await this.prisma.user.findMany({
      where: { structureId, role: { in: ['PHARMACIEN', 'STRUCTURE_ADMIN'] } },
      select: { id: true },
    });
    await this.notificationsService.createManyNotifications(
      staff.map((u) => u.id),
      { type: 'STOCK_ALERTE', titre: 'Stock critique', message },
    );
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
