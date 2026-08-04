import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from 'src/common/services/prisma.service';
import { RolesService } from 'src/common/rbac/roles.service';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import * as bcrypt from 'bcrypt';

/**
 * Seeder du compte SUPER_ADMIN initial.
 *
 * S'exécute une fois l'application démarrée (OnApplicationBootstrap), dans TOUS
 * les environnements (dev & prod) : il tourne avec le code compilé, sans
 * dépendance ts-node ni commande manuelle à lancer au déploiement.
 *
 * Idempotent : ne crée le compte que s'il n'existe pas déjà. Les identifiants
 * proviennent de SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD (validés au boot par
 * `validateEnv`). L'email est normalisé en minuscules pour rester cohérent avec
 * l'auth (cf. auth.service.ts : recherche par `email.toLowerCase()`).
 *
 * ⚠️ RBAC : les permissions viennent de `user.appRole` (cf. PermissionsService),
 * PAS de l'enum `role`. Un super-admin sans `appRoleId` n'a AUCUNE permission →
 * 403 sur toutes les routes protégées. On rattache donc explicitement le rôle
 * système « Super Administrateur » (seedé par RolesService, qui s'exécute avant
 * ce seeder). On répare aussi un compte préexistant resté sans `appRoleId`.
 */
@Injectable()
export class SuperAdminSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperAdminSeeder.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rolesService: RolesService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async onApplicationBootstrap() {
    const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SUPER_ADMIN_PASSWORD;

    // Garde-fou : normalement garanti par validateEnv, mais on ne crée jamais
    // un compte privilégié avec des identifiants vides.
    if (!email || !password) {
      this.logger.warn(
        'SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD absents — seed du super-admin ignoré.',
      );
      return;
    }

    // Rôle système « Super Administrateur » (= toutes les permissions), seedé par
    // RolesService.onApplicationBootstrap. Sans lui, le PermissionsGuard renvoie 403.
    const appRoleId = await this.rolesService.resolveAssignableRoleId({
      legacyRole: 'SUPER_ADMIN',
    });

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, appRoleId: true },
    });

    if (existing) {
      // Auto-réparation : compte créé avant ce correctif (ou avant le RBAC) →
      // resté sans permissions. On lui recolle le rôle système et on purge le
      // cache de permissions (sinon un `[]` mis en cache subsiste jusqu'à 5 min).
      if (!existing.appRoleId && appRoleId) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { appRoleId },
        });
        await this.permissionsService.invalidateUser(existing.id);
        this.logger.log(
          `Rôle « Super Administrateur » rattaché au compte existant (${email}).`,
        );
      } else {
        this.logger.log(`Compte SUPER_ADMIN déjà présent (${email}) — aucune action.`);
      }
      return;
    }

    if (!appRoleId) {
      // Cas improbable (rôle système non encore seedé) : on crée quand même le
      // compte ; il sera rattaché au prochain démarrage par la branche ci-dessus.
      this.logger.warn(
        'Rôle système « Super Administrateur » introuvable au boot — compte créé sans appRoleId (rattachement au prochain démarrage).',
      );
    }

    const hashed = await bcrypt.hash(password, 12);
    await this.prisma.user.create({
      data: {
        nom: 'Admin',
        prenom: 'Super',
        email,
        password: hashed,
        role: 'SUPER_ADMIN',
        isActive: true,
        appRoleId: appRoleId ?? undefined,
      },
    });

    // On ne logue jamais le mot de passe (il vient du .env, connu de l'admin).
    this.logger.log(`🎉 Compte SUPER_ADMIN initial créé : ${email}`);
  }
}
