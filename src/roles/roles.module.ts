import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesController } from './roles.controller';

/**
 * Expose les endpoints de gestion des rôles (`/roles`).
 * `RolesService` et `PermissionsGuard` viennent du `RbacModule` (global) ;
 * on importe `AuthModule` pour que `AuthGuard` dispose de `JwtService`.
 */
@Module({
  imports: [AuthModule],
  controllers: [RolesController],
})
export class RolesModule {}
