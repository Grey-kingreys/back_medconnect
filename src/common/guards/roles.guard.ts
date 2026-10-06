/**
 * CODE INUTILISÉ (constaté le 2026-10-06, point 25 du BACKLOG-PRIORISE racine).
 * Ce fichier n'est importé par aucun module : le contrôle d'accès passe par `PermissionsGuard` (`src/common/rbac/permissions.guard.ts`).
 * Conservé volontairement (consigne : ne supprimer aucun code existant).
 * À retirer lors d'un nettoyage dédié, après vérification.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- code inutilisé, dette de typage préexistante non corrigée */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException("Vous n'êtes pas authentifié.");
    }

    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException(
        `Accès refusé. Rôle(s) requis : ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
