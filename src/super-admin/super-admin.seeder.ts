import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from 'src/common/services/prisma.service';
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
 */
@Injectable()
export class SuperAdminSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperAdminSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

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

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      this.logger.log(`Compte SUPER_ADMIN déjà présent (${email}) — aucune action.`);
      return;
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
      },
    });

    // On ne logue jamais le mot de passe (il vient du .env, connu de l'admin).
    this.logger.log(`🎉 Compte SUPER_ADMIN initial créé : ${email}`);
  }
}
