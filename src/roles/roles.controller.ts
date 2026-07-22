import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { RequirePermissions } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { RolesService } from 'src/common/rbac/roles.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

/**
 * Gestion des rôles d'une structure par son admin (PLAN §2.5.d).
 *
 * Première surface migrée vers le nouveau RBAC : gardée par `@RequirePermissions`
 * + `PermissionsGuard` (et non plus `@Roles`/`RolesGuard`). Toutes les opérations
 * sont **scopées à la structure de l'appelant** (anti-escalade : impossible de
 * toucher une autre structure, un rôle système, ou d'accorder une permission
 * plateforme — cf. RolesService).
 */
@ApiTags('Rôles & permissions')
@Controller('roles')
@UseGuards(AuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  private structureIdOf(req: any): string {
    const structureId = req.user?.structureId;
    if (!structureId) {
      throw new ForbiddenException(
        "Cette action est réservée aux administrateurs rattachés à une structure.",
      );
    }
    return structureId;
  }

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  @ApiOperation({ summary: 'Catalogue des permissions délégables (groupé par catégorie)' })
  listPermissions() {
    return this.rolesService.listCatalog();
  }

  @Get()
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  @ApiOperation({ summary: 'Lister les rôles de ma structure' })
  list(@Req() req: any) {
    return this.rolesService.listStructureRoles(this.structureIdOf(req));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  @ApiOperation({ summary: 'Créer un rôle dans ma structure' })
  create(@Req() req: any, @Body() dto: CreateRoleDto) {
    return this.rolesService.createRole(this.structureIdOf(req), dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  @ApiOperation({ summary: 'Modifier un rôle de ma structure (nom, description, permissions)' })
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.updateRole(this.structureIdOf(req), id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  @ApiOperation({ summary: 'Supprimer un rôle de ma structure' })
  remove(@Req() req: any, @Param('id') id: string) {
    return this.rolesService.deleteRole(this.structureIdOf(req), id);
  }
}
