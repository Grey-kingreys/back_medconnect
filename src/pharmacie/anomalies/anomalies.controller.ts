import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
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
import { AnomaliesService } from './anomalies.service';
import { ListerAnomaliesDto, TraiterAnomalieDto } from '../dto/anomalies.dto';

@ApiTags('Pharmacie : anomalies')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class AnomaliesController {
  constructor(private readonly anomalies: AnomaliesService) {}

  @Get(':structureId/anomalies')
  @RequirePermissions(PERMISSIONS.ANOMALIE_GERER)
  @ApiOperation({
    summary: "File d'anomalies de la pharmacie",
    description:
      "20 par page, les plus récentes d'abord. statut OUVERTE par défaut, filtre type. Une anomalie STOCK_NEGATIF porte rattachement (etat EN_ATTENTE, PARTIELLE, RATTACHEE ou VENTE_ANNULEE) : le stock a-t-il depuis été rattaché à un lot. ouvertes = nombre d'anomalies à traiter.",
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  lister(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Query() dto: ListerAnomaliesDto,
  ) {
    return this.anomalies.lister(structureId, req.user.userId, dto);
  }

  @Patch(':structureId/anomalies/:anomalieId')
  @RequirePermissions(PERMISSIONS.ANOMALIE_GERER)
  @ApiOperation({
    summary: 'Traiter une anomalie',
    description:
      'Commentaire obligatoire (3 à 500 caractères, 400 MOTIF_REQUIS). Une seule fois : 409 ANOMALIE_DEJA_TRAITEE.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'anomalieId', description: "Identifiant de l'anomalie" })
  traiter(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('anomalieId') anomalieId: string,
    @Body() dto: TraiterAnomalieDto,
    @Ip() ip: string,
  ) {
    return this.anomalies.traiter(
      structureId,
      req.user.userId,
      anomalieId,
      dto,
      ip,
    );
  }
}
