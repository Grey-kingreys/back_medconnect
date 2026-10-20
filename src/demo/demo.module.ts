import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { DemoSeeder } from './demo.seeder';

/**
 * Mode démo : jeu de données fictif créé au démarrage et connexion sans mot de
 * passe aux comptes en `@demo.medconnecte.gn`. Tout est inerte si `DEMO_MODE`
 * ne vaut pas `true` (aucune donnée créée, routes en 404).
 *
 * `PrismaService`, `EncryptionService`, `RolesService` et `PermissionsService`
 * viennent des modules globaux (PrismaModule, SecurityModule, RbacModule).
 */
@Module({
  imports: [AuthModule],
  controllers: [DemoController],
  providers: [DemoService, DemoSeeder],
})
export class DemoModule {}
