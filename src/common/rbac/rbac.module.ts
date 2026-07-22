import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../services/prisma.service';
import { PermissionsService } from './permissions.service';
import { PermissionsGuard } from './permissions.guard';
import { RolesService } from './roles.service';

/**
 * Module RBAC (permissions dynamiques). Global → `PermissionsService`,
 * `PermissionsGuard` et `RolesService` injectables partout sans réimport.
 *
 * Dépend du `RedisModule` (cache, global) et de `PrismaService`.
 */
@Global()
@Module({
  providers: [PermissionsService, PermissionsGuard, RolesService, PrismaService],
  exports: [PermissionsService, PermissionsGuard, RolesService],
})
export class RbacModule {}
