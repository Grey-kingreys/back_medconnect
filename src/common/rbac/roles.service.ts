import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../services/prisma.service';
import { PermissionsService } from './permissions.service';
import {
  PERMISSION_CATALOG,
  SYSTEM_ROLES,
  DEFAULT_STRUCTURE_ROLES,
  DELEGABLE_PERMISSION_CODES,
  DefaultRoleDef,
} from './permissions.constants';

/**
 * Provisioning des rôles & permissions (RBAC dynamique — PLAN §2.5.c).
 *
 * Au boot (OnApplicationBootstrap, idempotent, comme SuperAdminSeeder) :
 *  1. synchronise le catalogue `Permission` (source de vérité = code),
 *  2. crée les rôles système (Patient, Admin plateforme, Super Admin),
 *  3. crée les rôles par défaut de chaque structure existante (selon son type),
 *  4. backfille les utilisateurs (`role` enum → `appRoleId`).
 *
 * Expose `seedStructureDefaultRoles()` pour les structures créées à l'exécution.
 */
@Injectable()
export class RolesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const codeToId = await this.syncCatalog();
      await this.seedSystemRoles(codeToId);
      await this.seedExistingStructures(codeToId);
      await this.backfillUsers();
    } catch (e) {
      // Ne jamais empêcher le démarrage de l'API à cause du seed RBAC.
      this.logger.error(`Seed RBAC échoué (l'app démarre quand même): ${(e as Error).message}`);
    }
  }

  /** Upsert du catalogue de permissions. Retourne une map code → id. */
  private async syncCatalog(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const def of PERMISSION_CATALOG) {
      const perm = await this.prisma.permission.upsert({
        where: { code: def.code },
        update: { libelle: def.libelle, categorie: def.categorie },
        create: { code: def.code, libelle: def.libelle, categorie: def.categorie },
      });
      map.set(perm.code, perm.id);
    }
    this.logger.log(`Catalogue de permissions synchronisé (${map.size} permissions).`);
    return map;
  }

  /**
   * Crée un rôle s'il n'existe pas (idempotent, par [structureId, nom]).
   * Les permissions ne sont (ré)appliquées qu'à la création — OU si `resync`
   * (réservé aux rôles système : ex. Super Admin doit toujours avoir tout le
   * catalogue, même après l'ajout d'une nouvelle permission). On ne RETIRE jamais
   * de permission → respecte les personnalisations faites par un admin de structure.
   */
  private async ensureRole(
    def: DefaultRoleDef,
    structureId: string | null,
    isSystem: boolean,
    codeToId: Map<string, string>,
    resync = false,
  ): Promise<string> {
    const existing = await this.prisma.appRole.findFirst({
      where: { structureId, nom: def.nom },
      select: { id: true },
    });

    const role =
      existing ??
      (await this.prisma.appRole.create({
        data: { nom: def.nom, description: def.description, isSystem, structureId },
        select: { id: true },
      }));

    if (!existing || resync) {
      const permissionIds = def.permissions
        .map((code) => codeToId.get(code))
        .filter((id): id is string => Boolean(id));
      if (permissionIds.length > 0) {
        await this.prisma.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ appRoleId: role.id, permissionId })),
          skipDuplicates: true,
        });
      }
    }

    return role.id;
  }

  private async seedSystemRoles(codeToId: Map<string, string>): Promise<void> {
    for (const def of SYSTEM_ROLES) {
      // Super Admin : resync complet pour absorber toute nouvelle permission du catalogue.
      const resync = def.legacyRole === 'SUPER_ADMIN';
      await this.ensureRole(def, null, true, codeToId, resync);
    }
    this.logger.log(`Rôles système synchronisés (${SYSTEM_ROLES.length}).`);
  }

  /** Crée les rôles par défaut d'une structure selon son type (idempotent). */
  async seedStructureDefaultRoles(
    structureId: string,
    type: string,
    codeToId?: Map<string, string>,
  ): Promise<void> {
    const defs = DEFAULT_STRUCTURE_ROLES[type];
    if (!defs) {
      this.logger.warn(`Type de structure inconnu pour le seed des rôles: ${type}`);
      return;
    }
    const map = codeToId ?? (await this.loadCatalogMap());
    for (const def of defs) {
      await this.ensureRole(def, structureId, false, map, false);
    }
  }

  private async seedExistingStructures(codeToId: Map<string, string>): Promise<void> {
    const structures = await this.prisma.structure.findMany({
      select: { id: true, type: true },
    });
    for (const s of structures) {
      await this.seedStructureDefaultRoles(s.id, s.type, codeToId);
    }
    if (structures.length > 0) {
      this.logger.log(`Rôles par défaut seedés pour ${structures.length} structure(s).`);
    }
  }

  /** Rattache les utilisateurs sans `appRoleId` au rôle correspondant à leur enum `role`. */
  private async backfillUsers(): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { appRoleId: null },
      select: { id: true, role: true, structureId: true },
    });
    if (users.length === 0) return;

    const legacyToNom = this.buildLegacyToNomMap();
    const systemLegacy = new Set(['PATIENT', 'ADMIN', 'SUPER_ADMIN']);

    const roles = await this.prisma.appRole.findMany({
      select: { id: true, structureId: true, nom: true },
    });
    const roleKey = (structureId: string | null, nom: string) =>
      `${structureId ?? 'system'}::${nom}`;
    const roleMap = new Map(roles.map((r) => [roleKey(r.structureId, r.nom), r.id]));

    let assigned = 0;
    let skipped = 0;
    for (const u of users) {
      const legacy = u.role as string;
      const nom = legacyToNom[legacy];
      if (!nom) {
        skipped++;
        continue;
      }
      const isSystem = systemLegacy.has(legacy);
      const id = roleMap.get(roleKey(isSystem ? null : u.structureId, nom));
      if (!id) {
        this.logger.warn(
          `Backfill: aucun rôle « ${nom} » trouvé pour l'utilisateur ${u.id} (role=${legacy}, structureId=${u.structureId ?? '∅'}).`,
        );
        skipped++;
        continue;
      }
      await this.prisma.user.update({ where: { id: u.id }, data: { appRoleId: id } });
      assigned++;
    }
    this.logger.log(`Backfill rôles utilisateurs : ${assigned} assigné(s), ${skipped} ignoré(s).`);
  }

  /** Construit le mapping enum `Role` → nom de rôle par défaut, depuis les constantes. */
  private buildLegacyToNomMap(): Record<string, string> {
    const map: Record<string, string> = {};
    const collect = (defs: DefaultRoleDef[]) => {
      for (const d of defs) if (d.legacyRole) map[d.legacyRole] = d.nom;
    };
    collect(SYSTEM_ROLES);
    for (const type of Object.keys(DEFAULT_STRUCTURE_ROLES)) {
      collect(DEFAULT_STRUCTURE_ROLES[type]);
    }
    return map;
  }

  private async loadCatalogMap(): Promise<Map<string, string>> {
    const perms = await this.prisma.permission.findMany({ select: { id: true, code: true } });
    return new Map(perms.map((p) => [p.code, p.id]));
  }

  // ─── Assignation de rôle (création d'utilisateur) ─────────────

  /**
   * Résout l'`appRoleId` à assigner à un utilisateur depuis son ancien enum `role`.
   * - rôles système (PATIENT/ADMIN/SUPER_ADMIN) → rôle global (`structureId = null`),
   * - rôles de structure (MEDECIN/PHARMACIEN/STRUCTURE_ADMIN) → rôle de `structureId`.
   * Retourne `null` si aucun rôle correspondant (ex. soignant sans structure).
   */
  async resolveAssignableRoleId(params: {
    legacyRole: string;
    structureId?: string | null;
  }): Promise<string | null> {
    const { legacyRole, structureId } = params;
    const nom = this.buildLegacyToNomMap()[legacyRole];
    if (!nom) return null;

    const isSystem = ['PATIENT', 'ADMIN', 'SUPER_ADMIN'].includes(legacyRole);
    const role = await this.prisma.appRole.findFirst({
      where: { nom, structureId: isSystem ? null : (structureId ?? '__none__') },
      select: { id: true },
    });
    return role?.id ?? null;
  }

  /** Vérifie qu'un rôle existe, appartient à la structure et n'est pas système. */
  async assertAssignableStructureRole(roleId: string, structureId: string): Promise<void> {
    const role = await this.prisma.appRole.findUnique({
      where: { id: roleId },
      select: { structureId: true, isSystem: true },
    });
    if (!role || role.structureId !== structureId || role.isSystem) {
      throw new BadRequestException("Rôle invalide pour cette structure.");
    }
  }

  // ─── Gestion des rôles (admin de structure) — anti-escalade ───

  /** Catalogue des permissions, groupé par catégorie (pour l'UI admin). */
  async listCatalog(): Promise<Record<string, { code: string; libelle: string }[]>> {
    const perms = await this.prisma.permission.findMany({
      orderBy: { categorie: 'asc' },
      select: { code: true, libelle: true, categorie: true },
    });
    const grouped: Record<string, { code: string; libelle: string }[]> = {};
    for (const p of perms) {
      (grouped[p.categorie] ??= []).push({ code: p.code, libelle: p.libelle });
    }
    return grouped;
  }

  /** Liste les rôles d'une structure (+ permissions + nb d'utilisateurs). */
  async listStructureRoles(structureId: string) {
    const roles = await this.prisma.appRole.findMany({
      where: { structureId },
      include: {
        permissions: { select: { permission: { select: { code: true } } } },
        _count: { select: { users: true } },
      },
      orderBy: { nom: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      nom: r.nom,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions.map((p) => p.permission.code),
      nbUtilisateurs: r._count.users,
    }));
  }

  /** Valide un ensemble de codes : existants ET délégables. Retourne les ids. */
  private async validateAndMapPermissions(codes: string[]): Promise<string[]> {
    const unique = [...new Set(codes)];
    const delegable = new Set<string>(DELEGABLE_PERMISSION_CODES);
    const forbidden = unique.filter((c) => !delegable.has(c));
    if (forbidden.length > 0) {
      throw new ForbiddenException(
        `Permissions non autorisées (réservées à la plateforme) : ${forbidden.join(', ')}`,
      );
    }
    const perms = await this.prisma.permission.findMany({
      where: { code: { in: unique } },
      select: { id: true, code: true },
    });
    if (perms.length !== unique.length) {
      const known = new Set(perms.map((p) => p.code));
      const unknown = unique.filter((c) => !known.has(c));
      throw new BadRequestException(`Permissions inconnues : ${unknown.join(', ')}`);
    }
    return perms.map((p) => p.id);
  }

  async createRole(
    structureId: string,
    dto: { nom: string; description?: string; permissions: string[] },
  ) {
    const permissionIds = await this.validateAndMapPermissions(dto.permissions);
    try {
      const role = await this.prisma.appRole.create({
        data: {
          nom: dto.nom.trim(),
          description: dto.description?.trim(),
          isSystem: false,
          structureId,
          permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
        },
        select: { id: true, nom: true },
      });
      return { id: role.id, nom: role.nom };
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException(`Un rôle « ${dto.nom} » existe déjà dans cette structure.`);
      }
      throw e;
    }
  }

  async updateRole(
    structureId: string,
    roleId: string,
    dto: { nom?: string; description?: string; permissions?: string[] },
  ) {
    const role = await this.prisma.appRole.findUnique({
      where: { id: roleId },
      select: { id: true, structureId: true, isSystem: true },
    });
    if (!role || role.structureId !== structureId) {
      throw new NotFoundException('Rôle introuvable dans cette structure.');
    }
    if (role.isSystem) {
      throw new ForbiddenException("Un rôle système ne peut pas être modifié.");
    }

    // Remplacement complet des permissions si fourni.
    if (dto.permissions) {
      const permissionIds = await this.validateAndMapPermissions(dto.permissions);
      await this.prisma.$transaction([
        this.prisma.rolePermission.deleteMany({ where: { appRoleId: roleId } }),
        this.prisma.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ appRoleId: roleId, permissionId })),
        }),
      ]);
    }

    if (dto.nom !== undefined || dto.description !== undefined) {
      try {
        await this.prisma.appRole.update({
          where: { id: roleId },
          data: {
            ...(dto.nom !== undefined ? { nom: dto.nom.trim() } : {}),
            ...(dto.description !== undefined ? { description: dto.description?.trim() } : {}),
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          throw new ConflictException(`Un rôle « ${dto.nom} » existe déjà dans cette structure.`);
        }
        throw e;
      }
    }

    // Les permissions ont pu changer → invalider le cache des users concernés.
    await this.permissionsService.invalidateRole(roleId);
    return { id: roleId };
  }

  async deleteRole(structureId: string, roleId: string) {
    const role = await this.prisma.appRole.findUnique({
      where: { id: roleId },
      select: { structureId: true, isSystem: true, _count: { select: { users: true } } },
    });
    if (!role || role.structureId !== structureId) {
      throw new NotFoundException('Rôle introuvable dans cette structure.');
    }
    if (role.isSystem) {
      throw new ForbiddenException("Un rôle système ne peut pas être supprimé.");
    }
    if (role._count.users > 0) {
      throw new BadRequestException(
        `Ce rôle est attribué à ${role._count.users} utilisateur(s). Réassignez-les avant de le supprimer.`,
      );
    }
    await this.prisma.appRole.delete({ where: { id: roleId } });
    return { id: roleId };
  }
}
