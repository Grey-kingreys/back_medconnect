import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { RequestWithUser } from 'src/auth/jwt.strategy';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { RequirePermissions } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { RapportsService } from './rapports.service';
import { RapportMargeQueryDto } from '../dto/rapports.dto';

@ApiTags('Pharmacie : alertes et marge')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class RapportsController {
  constructor(private readonly rapports: RapportsService) {}

  @Get(':structureId/stock/alertes-peremption')
  @RequirePermissions(PERMISSIONS.STOCK_READ)
  @ApiOperation({
    summary: 'Alertes de péremption par lot',
    description:
      "Permission : stock:read. Succès : 200. Lots à surveiller : horizons des paramètres (défaut 90, 30, 7 jours), chaque lot dans le plus petit horizon qui le contient, périmés à part, lots sans date comptés. valeurVente au prix de la boîte ; valeurCout, coutConnu et nombreLotsCoutInconnu seulement avec marge:read ; un lot à coût inconnu (reprise, trouvé à l'inventaire, reçu sans coût) n'est jamais compté pour 0.",
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  alertesPeremption(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
  ) {
    return this.rapports.alertesPeremption(structureId, req.user.userId);
  }

  @Get(':structureId/rapports/marge')
  @RequirePermissions(PERMISSIONS.MARGE_READ)
  @ApiOperation({
    summary: 'Rapport de marge',
    description:
      "Permission : marge:read. Succès : 200. Marge réelle depuis les allocations de lot, pièces d'annulation comprises par leur signe. Une vente dont un lot a un coût inconnu ou est un lot technique est non valorisable (à part, jamais comptée à 100 %) ; une ligne vendue sans stock attend son rattachement (provisoires). Période de 92 jours au plus (400 VALIDATION). debutFiabilite : avant cette date, les ventes n'ont pas de coût.",
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  rapportMarge(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Query() dto: RapportMargeQueryDto,
  ) {
    return this.rapports.rapportMarge(structureId, req.user.userId, dto);
  }
}
