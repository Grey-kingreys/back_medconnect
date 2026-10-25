import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StructureType } from 'generated/prisma/enums';
import { PrismaService } from 'src/common/services/prisma.service';

export const MESSAGE_PHARMACIE_INTROUVABLE = 'Cette pharmacie est introuvable.';
export const MESSAGE_ACCES_PHARMACIE_REFUSE =
  "Vous n'avez pas accès à cette pharmacie.";
export const MESSAGE_PHARMACIE_DESACTIVEE =
  'Cette pharmacie est désactivée. Contactez l’administrateur de la plateforme.';

export interface UtilisateurPharmacie {
  id: string;
  nom: string;
  prenom: string;
  structureId: string | null;
}

export interface StructurePharmacie {
  id: string;
  type: StructureType;
  adminId: string | null;
  isActive: boolean;
  nom: string;
  adresse: string | null;
  ville: string | null;
  telephone: string | null;
  logoFile: { key: string } | null;
}

export interface AccesPharmacie {
  user: UtilisateurPharmacie;
  structure: StructurePharmacie;
}

/**
 * Contrôle d'accès unique aux routes d'une pharmacie (D406, D464) : membre
 * (`structureId`) ou administrateur (`adminId`), structure de type PHARMACIE,
 * active. La permission est vérifiée par PermissionsGuard, l'enum `role` n'est pas lu.
 */
@Injectable()
export class AccesPharmacieService {
  constructor(private readonly prisma: PrismaService) {}

  async verifier(structureId: string, userId: string): Promise<AccesPharmacie> {
    const [user, structure] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, nom: true, prenom: true, structureId: true },
      }),
      this.prisma.structure.findUnique({
        where: { id: structureId },
        select: {
          id: true,
          type: true,
          adminId: true,
          isActive: true,
          nom: true,
          adresse: true,
          ville: true,
          telephone: true,
          logoFile: { select: { key: true } },
        },
      }),
    ]);

    if (!structure) {
      throw new NotFoundException(MESSAGE_PHARMACIE_INTROUVABLE);
    }
    if (
      !user ||
      (user.structureId !== structureId && structure.adminId !== userId) ||
      structure.type !== 'PHARMACIE'
    ) {
      throw new ForbiddenException(MESSAGE_ACCES_PHARMACIE_REFUSE);
    }
    if (!structure.isActive) {
      throw new ForbiddenException(MESSAGE_PHARMACIE_DESACTIVEE);
    }
    return { user, structure };
  }
}
