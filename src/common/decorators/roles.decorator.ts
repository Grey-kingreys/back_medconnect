/**
 * CODE INUTILISÉ (constaté le 2026-10-06, point 25 du BACKLOG-PRIORISE racine).
 * Ce fichier n'est importé par aucun module : le contrôle d'accès passe par `PermissionsGuard` (`src/common/rbac/permissions.guard.ts`).
 * Conservé volontairement (consigne : ne supprimer aucun code existant).
 * À retirer lors d'un nettoyage dédié, après vérification.
 */
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
