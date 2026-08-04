import { SetMetadata } from '@nestjs/common';
import { PermissionCode } from './permissions.constants';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Exige une ou plusieurs permissions sur une route (logique ET — toutes requises).
 * À utiliser avec `PermissionsGuard` (et après `AuthGuard`).
 *
 * Ex. `@RequirePermissions(PERMISSIONS.CONSULTATION_WRITE)`
 */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
