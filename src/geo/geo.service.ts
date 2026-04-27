import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/common/services/prisma.service';

@Injectable()
export class GeoService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Recherche les structures proches (avec filtre type, ville, garde)
   */
  async rechercherStructures(params: {
    type?: string;
    ville?: string;
    estDeGarde?: boolean;
    lat?: number;
    lng?: number;
    rayon?: number; // km
  }) {
    const { type, ville, estDeGarde, lat, lng, rayon = 50 } = params;

    const where: any = {
      isActive: true,
      isConfigured: true,
    };

    if (type) {
      const validTypes = ['HOPITAL', 'CLINIQUE', 'PHARMACIE'];
      if (!validTypes.includes(type.toUpperCase())) {
        throw new BadRequestException('Type invalide. Valeurs : HOPITAL, CLINIQUE, PHARMACIE');
      }
      where.type = type.toUpperCase();
    }

    if (ville) {
      where.ville = { contains: ville.trim(), mode: 'insensitive' };
    }

    if (estDeGarde !== undefined) {
      where.estDeGarde = estDeGarde;
    }

    const structures = await this.prisma.structure.findMany({
      where,
      select: {
        id: true,
        nom: true,
        type: true,
        adresse: true,
        ville: true,
        telephone: true,
        description: true,
        horaires: true,
        estDeGarde: true,
        latitude: true,
        longitude: true,
        _count: { select: { membres: true } },
      },
      orderBy: { nom: 'asc' },
    });

    // Calculer distances et filtrer par rayon si lat/lng fournis
    let results: any[] = structures;

    if (lat !== undefined && lng !== undefined) {
      results = structures
        .map((s) => ({
          ...s,
          distanceKm:
            s.latitude && s.longitude
              ? this.calculateDistance(lat, lng, s.latitude, s.longitude)
              : null,
        }))
        .filter((s) => s.distanceKm === null || s.distanceKm <= rayon)
        .sort((a, b) => {
          if (a.distanceKm === null) return 1;
          if (b.distanceKm === null) return -1;
          return a.distanceKm - b.distanceKm;
        });
    }

    return {
      data: results,
      message: `${results.length} structure(s) trouvée(s)`,
      success: true,
    };
  }

  async getStructurePublique(structureId: string) {
    const structure = await this.prisma.structure.findFirst({
      where: { id: structureId, isActive: true, isConfigured: true },
      select: {
        id: true,
        nom: true,
        type: true,
        adresse: true,
        ville: true,
        telephone: true,
        description: true,
        horaires: true,
        estDeGarde: true,
        latitude: true,
        longitude: true,
        membres: {
          where: {
            role: { in: ['MEDECIN', 'PHARMACIEN'] },
            isActive: true,
          },
          select: {
            id: true,
            nom: true,
            prenom: true,
            role: true,
          },
        },
      },
    });

    if (!structure) throw new NotFoundException('Structure non trouvée');

    return { data: structure, message: 'Structure trouvée', success: true };
  }

  /**
   * Structures de garde en ce moment
   */
  async getStructuresDeGarde(ville?: string) {
    const where: any = {
      isActive: true,
      isConfigured: true,
      estDeGarde: true,
    };

    if (ville) {
      where.ville = { contains: ville.trim(), mode: 'insensitive' };
    }

    const structures = await this.prisma.structure.findMany({
      where,
      select: {
        id: true,
        nom: true,
        type: true,
        adresse: true,
        ville: true,
        telephone: true,
        latitude: true,
        longitude: true,
        horaires: true,
      },
      orderBy: { type: 'asc' },
    });

    return {
      data: structures,
      message: `${structures.length} structure(s) de garde`,
      success: true,
    };
  }

  // ─── Haversine ────────────────────────────────────────────────

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

  private toRad(v: number): number {
    return (v * Math.PI) / 180;
  }
}