// Dette de typage préexistante, backlog points 21 et 22
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
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
  ouvrirFeuilleImport,
  ValeurImport,
} from './import-excel';

import { NotificationsService } from 'src/notifications/notifications.service';

export { MIME_XLSX } from './import-excel';

const NOTES_MAX_IMPORT = 500;
const SEUIL_STOCK_BAS = 10;
/** Plus grande quantité enregistrable (colonne Int de PostgreSQL). */
const QUANTITE_MAX = 2147483647;
/** Plus grand prix enregistrable (colonne Int de PostgreSQL). */
const PRIX_MAX = 2147483647;

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
/** Transaction interactive de l'import : jusqu'à 1000 écritures successives. */
const OPTIONS_TRANSACTION_IMPORT = { maxWait: 10_000, timeout: 60_000 };

type ColonneImport = 'nom' | 'quantite' | 'prix' | 'date' | 'notes';

/** Colonnes de la feuille « Stock ». */
const COLONNES_IMPORT_STOCK: ColonnesImport<ColonneImport> = {
  toutes: ['nom', 'quantite', 'prix', 'date', 'notes'],
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
    prix: 'Prix',
    date: "Date d'expiration",
    notes: 'Notes',
  },
};

@Injectable()
export class PharmacieService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly accesPharmacie: AccesPharmacieService,
    private readonly mouvementsStock: MouvementsStockService,
    private readonly permissions: PermissionsService,
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
            archiveLe: null,
          },
        });
        if (avant?.archiveLe) {
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

    // Alerte stock bas ou épuisé (seuil en boîtes, A4)
    if (
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
        >`SELECT "id", "coefficientBoite" FROM "StockMedicament" WHERE "id" = ${stockId} AND "structureId" = ${structureId} AND "archiveLe" IS NULL FOR UPDATE`;
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
        `Le stock de "${fiche.medicament.nom}" est descendu à ${apres} unités.`,
      );
    }

    const peutVoirMarge = await this.peutVoirMarge(user.id);
    return {
      data: masquerCouts(fiche, peutVoirMarge),
      message: `Stock ${dto.variation > 0 ? 'augmenté' : 'réduit'} (nouvelle quantité : ${apres})`,
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
            rupture: rupture.map((s) => ({ id: s.id, nom: s.medicament.nom })),
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
  ): Promise<Buffer> {
    await this.accesPharmacie.verifier(structureId, adminUserId);

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
      'La quantité est un nombre entier, 0 ou plus.',
      "Au moment d'envoyer le fichier, choisissez « Inventaire » ou « Livraison ».",
      'Inventaire : vous avez compté les boîtes présentes dans la pharmacie. La quantité du fichier remplace la quantité en stock. Exemple : 20 en stock et 50 dans le fichier, il y aura 50.',
      "Livraison : vous venez de recevoir des médicaments. La quantité du fichier s'ajoute à la quantité en stock. Exemple : 20 en stock et 50 dans le fichier, il y aura 70. Un médicament qui n'est pas encore dans votre stock y est ajouté avec la quantité du fichier.",
      "Avant d'enregistrer, l'aperçu affiche pour chaque médicament la quantité avant et après.",
      "Le prix unitaire (en GNF), la date d'expiration (au format AAAA-MM-JJ, par exemple 2027-12-31) et les notes sont facultatifs. Une case laissée vide ne change pas ce qui est déjà enregistré.",
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
    const analyse = await this.analyserImportStock(fichier);
    const enStock = await this.lireQuantitesEnStock(
      this.prisma,
      structureId,
      analyse,
    );
    const rapport = this.calculerQuantitesImport(analyse, enStock, mode);

    return {
      data: { ...rapport, mode },
      message: this.messageImportStock(rapport, false),
      success: true,
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
    await this.accesPharmacie.verifier(structureId, adminUserId);
    const analyse = await this.analyserImportStock(fichier);

    // Lecture du stock, calcul et écriture dans la même transaction
    const rapport = await this.prisma.$transaction(async (tx) => {
      const enStock = await this.lireQuantitesEnStock(tx, structureId, analyse);
      const calcule = this.calculerQuantitesImport(analyse, enStock, mode);
      const lignes: LigneImportStock[] = [];
      for (const l of calcule.lignes) {
        if (l.statut !== 'acceptee') {
          lignes.push(l);
          continue;
        }
        const quantite = l.quantite ?? 0;
        // Case vide = undefined : Prisma garde la valeur enregistrée (date, prix, notes)
        const date = l.dateExpiration ? new Date(l.dateExpiration) : undefined;
        const notes = l.notes?.trim();
        const ecrit = await tx.stockMedicament.upsert({
          where: {
            medicamentId_structureId: {
              medicamentId: l.medicamentId as string,
              structureId,
            },
          },
          create: {
            medicamentId: l.medicamentId as string,
            structureId,
            quantite,
            prixUnitaire: l.prixUnitaire,
            disponible: quantite > 0,
            dateExpiration: date ?? null,
            notes,
          },
          update:
            mode === 'livraison'
              ? {
                  quantite: { increment: quantite },
                  prixUnitaire: l.prixUnitaire,
                  dateExpiration: date,
                  notes,
                  ...(quantite > 0 ? { disponible: true } : {}),
                }
              : {
                  quantite,
                  prixUnitaire: l.prixUnitaire,
                  disponible: quantite > 0,
                  dateExpiration: date,
                  notes,
                },
        });
        // En livraison, avant et après viennent de la ligne écrite : un import simultané déjà ajouté est compté, jamais écrasé.
        lignes.push(
          mode === 'livraison'
            ? {
                ...l,
                quantiteAvant: ecrit.quantite - quantite,
                quantiteApres: ecrit.quantite,
              }
            : l,
        );
      }
      return { ...calcule, lignes };
    }, OPTIONS_TRANSACTION_IMPORT);
    const aEcrire = rapport.lignes.filter((l) => l.statut === 'acceptee');

    // Une seule alerte groupée pour tout l'import
    const enAlerte = aEcrire.filter(
      (l) => (l.quantiteApres ?? 0) < SEUIL_STOCK_BAS,
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
      data: { ...rapport, mode, importees: aEcrire.length },
      message: this.messageImportStock(rapport, true),
      success: true,
    };
  }

  /** Analyse commune à l'aperçu et à l'import : aucune écriture en base. */
  private async analyserImportStock(
    fichier?: FichierImport,
  ): Promise<RapportImportStock> {
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
        quantite > QUANTITE_MAX
      ) {
        raisons.push(
          'La quantité doit être un nombre entier, 0 ou plus (exemple : 25).',
        );
      }

      let prixUnitaire = this.lireNombre(valeurs.prix);
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
      colonnes,
    };
  }

  /**
   * Calcule quantiteAvant et quantiteApres de chaque ligne acceptée selon le mode.
   * En livraison, une ligne dont le total dépasserait QUANTITE_MAX devient rejetée.
   * Renvoie un nouveau rapport (compteurs recalculés), sans modifier celui reçu.
   */
  private calculerQuantitesImport(
    rapport: RapportImportStock,
    enStock: Map<string, number>,
    mode: ModeImportStock,
  ): RapportImportStock {
    const lignes = rapport.lignes.map((l): LigneImportStock => {
      if (l.statut !== 'acceptee') return l;
      const avant = enStock.get(l.medicamentId as string) ?? 0;
      const quantite = l.quantite ?? 0;
      const apres = mode === 'livraison' ? avant + quantite : quantite;
      if (apres > QUANTITE_MAX) {
        return {
          ligne: l.ligne,
          nom: l.nom,
          statut: 'rejetee',
          raison:
            'Avec cette livraison, la quantité en stock deviendrait trop grande. Vérifiez la quantité.',
        };
      }
      return { ...l, quantiteAvant: avant, quantiteApres: apres };
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

  /** Quantités en stock de la pharmacie pour les médicaments des lignes acceptées. */
  private async lireQuantitesEnStock(
    client: Pick<PrismaService, 'stockMedicament'>,
    structureId: string,
    rapport: RapportImportStock,
  ): Promise<Map<string, number>> {
    const ids = rapport.lignes
      .filter((l) => l.statut === 'acceptee')
      .map((l) => l.medicamentId as string);
    if (ids.length === 0) return new Map();

    const stocks = await client.stockMedicament.findMany({
      where: { structureId, medicamentId: { in: ids } },
      select: { medicamentId: true, quantite: true },
    });
    return new Map(stocks.map((s) => [s.medicamentId, s.quantite]));
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
