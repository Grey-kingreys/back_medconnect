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
} from './dto/pharmacie.dto';

import { NotificationsService } from 'src/notifications/notifications.service';

@Injectable()
export class PharmacieService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService
  ) { }

  // ─── Catalogue Global (ADMIN/SUPER_ADMIN) ─────────────────────

  async createMedicament(dto: CreateMedicamentDto, actorId?: string) {
    // Vérifier doublon par nom
    const existing = await this.prisma.medicament.findFirst({
      where: { nom: { equals: dto.nom.trim(), mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException(`Un médicament nommé "${dto.nom}" existe déjà dans le catalogue`);
    }

    // Vérifier si c'est une nouvelle catégorie
    const existingCategory = await this.prisma.medicament.findFirst({
      where: { categorie: { equals: dto.categorie.trim(), mode: 'insensitive' } },
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
          include: { structure: true }
        });
        if (actor) {
          actorName = `${actor.prenom} ${actor.nom}${actor.structure ? ` (${actor.structure.nom})` : ''}`;
        }
      }

      const superAdmins = await this.prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
      await this.notificationsService.createManyNotifications(
        superAdmins.map(u => u.id),
        {
          type: 'CATALOGUE_MODIF',
          titre: 'Nouvelle catégorie ajoutée',
          message: `${actorName} a ajouté la catégorie "${dto.categorie.trim()}" au catalogue via le médicament "${med.nom}".`,
        }
      );
    }

    return { data: med, message: 'Médicament ajouté au catalogue', success: true };
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

  async updateMedicament(medicamentId: string, dto: UpdateMedicamentDto, actorId?: string) {
    const med = await this.prisma.medicament.findUnique({ where: { id: medicamentId } });
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

    if (dto.categorie && dto.categorie.trim().toLowerCase() !== oldCategory.toLowerCase()) {
      let actorName = 'Un administrateur';
      if (actorId) {
        const actor = await this.prisma.user.findUnique({
          where: { id: actorId },
          include: { structure: true }
        });
        if (actor) {
          actorName = `${actor.prenom} ${actor.nom}${actor.structure ? ` (${actor.structure.nom})` : ''}`;
        }
      }

      const superAdmins = await this.prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
      await this.notificationsService.createManyNotifications(
        superAdmins.map(u => u.id),
        {
          type: 'CATALOGUE_MODIF',
          titre: 'Catégorie modifiée',
          message: `${actorName} a changé la catégorie de "${updated.nom}" (de "${oldCategory}" à "${updated.categorie}").`,
        }
      );
    }

    return { data: updated, message: 'Médicament mis à jour', success: true };
  }

  async deleteMedicament(medicamentId: string, actorId?: string) {
    const med = await this.prisma.medicament.findUnique({ where: { id: medicamentId } });
    if (!med) throw new NotFoundException('Médicament non trouvé');

    const categoryToDelete = med.categorie;
    await this.prisma.medicament.delete({ where: { id: medicamentId } });

    // Vérifier si c'était le dernier de sa catégorie
    const remainingInCategory = await this.prisma.medicament.count({
      where: { categorie: categoryToDelete }
    });

    if (remainingInCategory === 0) {
      let actorName = 'Un administrateur';
      if (actorId) {
        const actor = await this.prisma.user.findUnique({
          where: { id: actorId },
          include: { structure: true }
        });
        if (actor) {
          actorName = `${actor.prenom} ${actor.nom}${actor.structure ? ` (${actor.structure.nom})` : ''}`;
        }
      }

      const superAdmins = await this.prisma.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
      await this.notificationsService.createManyNotifications(
        superAdmins.map(u => u.id),
        {
          type: 'CATALOGUE_MODIF',
          titre: 'Catégorie supprimée',
          message: `${actorName} a supprimé le dernier médicament de la catégorie "${categoryToDelete}", celle-ci disparaît donc du catalogue.`,
        }
      );
    }

    return { data: null, message: 'Médicament supprimé du catalogue', success: true };
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

  async upsertStock(structureId: string, adminUserId: string, dto: UpsertStockDto) {
    await this.checkPharmacieAccess(structureId, adminUserId);

    // Vérifier que le médicament existe
    const med = await this.prisma.medicament.findUnique({
      where: { id: dto.medicamentId },
    });
    if (!med) throw new NotFoundException('Médicament non trouvé dans le catalogue');

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
        dateExpiration: dto.dateExpiration ? new Date(dto.dateExpiration) : null,
        notes: dto.notes?.trim(),
      },
      update: {
        quantite: dto.quantite,
        prixUnitaire: dto.prixUnitaire,
        disponible: dto.quantite > 0,
        dateExpiration: dto.dateExpiration ? new Date(dto.dateExpiration) : null,
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
        select: { id: true }
      });
      await this.notificationsService.createManyNotifications(
        staff.map(u => u.id),
        {
          type: 'STOCK_ALERTE',
          titre: 'Stock critique',
          message: `Le stock de "${stock.medicament.nom}" est ${dto.quantite === 0 ? 'épuisé' : `bas (${dto.quantite} unités)`}.`,
        }
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
        select: { id: true }
      });
      await this.notificationsService.createManyNotifications(
        staff.map(u => u.id),
        {
          type: 'STOCK_ALERTE',
          titre: 'Stock critique',
          message: `Le stock de "${updated.medicament.nom}" est descendu à ${newQuantite} unités.`,
        }
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
          stockBas: stockBas.map((s) => ({ id: s.id, nom: s.medicament.nom, quantite: s.quantite })),
          rupture: rupture.map((s) => ({ id: s.id, nom: s.medicament.nom })),
        },
      },
      message: `${stocks.length} médicament(s) en stock`,
      success: true,
    };
  }

  async removeStockItem(structureId: string, stockId: string, adminUserId: string) {
    await this.checkPharmacieAccess(structureId, adminUserId);

    const stock = await this.prisma.stockMedicament.findFirst({
      where: { id: stockId, structureId },
    });
    if (!stock) throw new NotFoundException('Stock non trouvé');

    await this.prisma.stockMedicament.delete({ where: { id: stockId } });
    return { data: null, message: 'Médicament retiré du stock', success: true };
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
              ? this.calculateDistance(lat, lng, s.structure.latitude, s.structure.longitude)
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
    const isAuthorizedRole = user?.role === 'STRUCTURE_ADMIN' || user?.role === 'PHARMACIEN';
    if (!user || user.structureId !== structureId || !isAuthorizedRole) {
      throw new ForbiddenException("Vous n'êtes pas autorisé à gérer cette pharmacie");
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
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }
}