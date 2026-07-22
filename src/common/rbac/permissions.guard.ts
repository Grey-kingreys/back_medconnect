import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import { PermissionsService } from './permissions.service';

/**
 * Vérifie que l'utilisateur possède les permissions exigées par `@RequirePermissions`.
 * Doit s'exécuter APRÈS `AuthGuard` (a besoin de `req.user`).
 *
 * Migration incrémentale : on remplace progressivement `@Roles(...)` + `RolesGuard`
 * par `@RequirePermissions(...)` + ce guard, controller par controller.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true; // aucune permission exigée sur cette route
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.userId) {
      throw new ForbiddenException("Vous n'êtes pas authentifié.");
    }

    const ok = await this.permissionsService.hasPermissions(user.userId, required);
    if (!ok) {
      throw new ForbiddenException("Vous n'avez pas la permission d'effectuer cette action.");
    }

    return true;
  }
}
