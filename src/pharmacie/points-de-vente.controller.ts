import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { RequestWithUser } from 'src/auth/jwt.strategy';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { RequirePermissions } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { PointsDeVenteService } from './points-de-vente.service';
import {
  EnregistrerPosteDto,
  ModifierParametresDto,
  ModifierPosteDto,
} from './dto/points-de-vente.dto';

@ApiTags('Pharmacie : caisse')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class PointsDeVenteController {
  constructor(private readonly pointsDeVente: PointsDeVenteService) {}

  @Get(':structureId/referentiels')
  @RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
  @ApiOperation({
    summary:
      'Référentiels de caisse : modes de paiement, coupures et paramètres',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  referentiels(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
  ) {
    return this.pointsDeVente.referentiels(structureId, req.user.userId);
  }

  @Get(':structureId/parametres')
  @RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
  @ApiOperation({ summary: 'Paramètres de la pharmacie' })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  parametres(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
  ) {
    return this.pointsDeVente.parametres(structureId, req.user.userId);
  }

  @Patch(':structureId/parametres')
  @RequirePermissions(PERMISSIONS.STRUCTURE_WRITE)
  @ApiOperation({ summary: 'Modifier les paramètres de la pharmacie' })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  modifierParametres(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Body() dto: ModifierParametresDto,
    @Ip() ip: string,
  ) {
    return this.pointsDeVente.modifierParametres(
      structureId,
      req.user.userId,
      dto,
      ip,
    );
  }

  @Post(':structureId/postes')
  @RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enregistrer le poste de caisse de cet appareil',
    description:
      'Idempotent par appareilId : un appareil déjà enregistré renvoie son poste (data.cree faux).',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiResponse({
    status: 409,
    description:
      'Appareil déjà enregistré comme un autre type de poste (POSTE_TYPE_DIFFERENT).',
  })
  enregistrerPoste(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Body() dto: EnregistrerPosteDto,
    @Ip() ip: string,
  ) {
    return this.pointsDeVente.enregistrerPoste(
      structureId,
      req.user.userId,
      dto,
      ip,
    );
  }

  @Get(':structureId/postes')
  @RequirePermissions(PERMISSIONS.CAISSE_SUPERVISER)
  @ApiOperation({ summary: 'Postes de caisse de la pharmacie' })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  listerPostes(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
  ) {
    return this.pointsDeVente.listerPostes(structureId, req.user.userId);
  }

  @Patch(':structureId/postes/:posteId')
  @RequirePermissions(PERMISSIONS.STRUCTURE_WRITE)
  @ApiOperation({ summary: 'Modifier un poste de caisse' })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'posteId', description: 'Identifiant du poste' })
  @ApiResponse({
    status: 404,
    description: 'Poste inconnu, technique ou d’une autre pharmacie.',
  })
  modifierPoste(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('posteId') posteId: string,
    @Body() dto: ModifierPosteDto,
    @Ip() ip: string,
  ) {
    return this.pointsDeVente.modifierPoste(
      structureId,
      req.user.userId,
      posteId,
      dto,
      ip,
    );
  }
}
