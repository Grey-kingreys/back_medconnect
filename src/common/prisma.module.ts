import { Global, Module } from '@nestjs/common';
import { PrismaService } from './services/prisma.service';

/**
 * Expose `PrismaService` à toute l'application sans avoir à le redéclarer dans
 * chaque module. Nécessaire aux providers déclarés au niveau de `AppModule`
 * (ex. `AuditInterceptor`).
 *
 * ⚠️ Les modules métier déclarent encore `PrismaService` dans leurs propres
 * `providers` : chacun instancie alors son propre pool de connexions. À terme,
 * retirer ces déclarations locales pour ne garder que cette instance partagée.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
