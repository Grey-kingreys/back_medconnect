import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { StoredFileBucket } from 'generated/prisma/enums';
import { PrismaService } from 'src/common/services/prisma.service';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';

/** Utilisateur courant tel que porté par le JWT (`req.user`). */
export interface RequestUser {
  userId: string;
  role?: string;
  structureId?: string;
}

/** Le minimum nécessaire d'un `StoredFile` pour statuer sur l'accès. */
export interface AccessibleFile {
  id: string;
  key: string;
  bucket: StoredFileBucket;
  ownerId: string;
}

/**
 * Contrôle d'accès aux fichiers PRIVÉS (documents médicaux) + traçabilité.
 *
 * `StorageService.getSignedReadUrl` ne doit JAMAIS être appelée depuis un contrôleur
 * sans passer d'abord par `assertCanReadPrivate`. La décision s'appuie sur le RBAC
 * existant (rôles/permissions) et sur le modèle d'accès du carnet de santé :
 *   - le patient propriétaire du document ;
 *   - un professionnel de santé rattaché à son parcours de soin (médecin traitant,
 *     ou membre d'une structure que le patient a explicitement autorisée) disposant
 *     de la permission `carnet:read` ;
 *   - les rôles administratifs de niveau supérieur (plateforme).
 * Personne d'autre.
 *
 * Toute génération d'URL de lecture sur le bucket privé est journalisée (qui / quelle
 * clé / quand / IP) — donnée de santé : la traçabilité des accès est requise. L'écriture
 * de l'audit ne doit jamais faire échouer la requête (best-effort).
 */
@Injectable()
export class FileAccessService {
  private readonly logger = new Logger(FileAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Autorise (ou refuse via 403) la génération d'une URL de lecture privée.
   * Un refus est lui-même journalisé (un accès refusé à des données de santé est
   * précisément ce qu'un audit doit retenir).
   */
  async assertCanReadPrivate(
    user: RequestUser,
    file: AccessibleFile,
    ip?: string | null,
  ): Promise<void> {
    const autorise = await this.canReadPrivate(user, file);
    if (!autorise) {
      await this.enregistrerAcces(user.userId, file, ip, 'denied');
      throw new ForbiddenException("Vous n'êtes pas autorisé à consulter ce document.");
    }
  }

  /** Journalise une génération d'URL de lecture réussie (bucket privé). */
  async auditPrivateRead(
    userId: string,
    file: AccessibleFile,
    ip?: string | null,
  ): Promise<void> {
    await this.enregistrerAcces(userId, file, ip, 'read');
  }

  // ─── Décision d'accès ─────────────────────────────────────────

  private async canReadPrivate(user: RequestUser, file: AccessibleFile): Promise<boolean> {
    // Le propriétaire (patient) accède toujours à ses documents.
    if (file.ownerId === user.userId) return true;

    // Rôles administratifs de niveau supérieur (plateforme).
    if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') return true;
    if (await this.permissions.hasPermissions(user.userId, [PERMISSIONS.PLATFORM_ADMIN])) {
      return true;
    }

    // Professionnel de santé : exige la permission de lecture du carnet ET un
    // rattachement au parcours de soin du propriétaire.
    const peutLireCarnet = await this.permissions.hasPermissions(user.userId, [
      PERMISSIONS.CARNET_READ,
    ]);
    if (!peutLireCarnet) return false;

    return this.estDansEquipeDeSoin(user, file.ownerId);
  }

  /**
   * Rattachement au parcours de soin du propriétaire, aligné sur
   * `CarnetSanteService.checkAccess` : médecin traitant, ou membre d'une structure
   * que le patient a autorisée (l'appartenance à la structure est revérifiée en base,
   * pas seulement d'après le JWT).
   */
  private async estDansEquipeDeSoin(user: RequestUser, ownerId: string): Promise<boolean> {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { medecinTraitantId: true },
    });
    if (!owner) return false;
    if (owner.medecinTraitantId === user.userId) return true;

    if (user.structureId) {
      const actor = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { structureId: true },
      });
      if (actor?.structureId === user.structureId) {
        const auth = await this.prisma.autorisationStructure.findUnique({
          where: { patientId_structureId: { patientId: ownerId, structureId: user.structureId } },
        });
        if (auth) return true;
      }
    }
    return false;
  }

  // ─── Traçabilité (réutilise l'AuditLog du carnet de santé) ────

  private async enregistrerAcces(
    userId: string | null,
    file: AccessibleFile,
    ip: string | null | undefined,
    action: 'read' | 'denied',
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action,
          entityType: 'StoredFile',
          entityId: file.id,
          ip: ip ?? null,
          metadata: { key: file.key, bucket: 'private', reason: 'read-url' },
        },
      });
    } catch (error) {
      this.logger.error(
        `audit.write_failed — ${action} StoredFile:${file.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
