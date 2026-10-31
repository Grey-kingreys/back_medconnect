import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
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
import { ClotureService } from './clotures.service';
import {
  CloturerJourneeDto,
  ListerCloturesQueryDto,
} from '../dto/clotures.dto';

@ApiTags('Pharmacie : clôture')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class ClotureController {
  constructor(private readonly clotures: ClotureService) {}

  @Get(':structureId/caisse/clotures/:jour/preparation')
  @RequirePermissions(PERMISSIONS.CLOTURE_GERER)
  @ApiOperation({
    summary: "Préparation de la clôture d'une journée",
    description:
      "Préparation de la clôture d'une journée : sessions, caisses encore ouvertes, postes attendus nommés (session ouverte, ventes à envoyer, synchro incomplète, D616), totaux par mode des caisses fermées, peutCloturer, peutForcer ; pour une journée clôturée, la clôture. 400 VALIDATION (dateValide, jourFutur), 400 JOUR_AVANT_DEBUT_CAISSE.",
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'jour', description: 'Jour métier, AAAA-MM-JJ' })
  preparer(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('jour') jour: string,
  ) {
    return this.clotures.preparer(structureId, req.user.userId, jour);
  }

  @Post(':structureId/caisse/clotures')
  @RequirePermissions(PERMISSIONS.CLOTURE_GERER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clôturer une journée',
    description:
      'Clôture la journée : caisses fermées incluses, totaux par mode figés. 409 CLOTURE_INCOMPLETE (details : postes attendus) sans forcer ; forcer avec motif (400 MOTIF_REQUIS) seulement si tous les postes attendus sont des postes desktop, sinon 409 CAISSES_A_FERMER ; 409 JOURNEE_DEJA_CLOTUREE.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  cloturer(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Body() dto: CloturerJourneeDto,
    @Ip() ip: string,
  ) {
    return this.clotures.cloturer(structureId, req.user.userId, dto, ip);
  }

  @Get(':structureId/caisse/clotures')
  @RequirePermissions(PERMISSIONS.CLOTURE_GERER)
  @ApiOperation({
    summary: 'Clôtures du mois',
    description: 'Clôtures du mois (AAAA-MM, défaut mois en cours).',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  lister(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Query() query: ListerCloturesQueryDto,
  ) {
    return this.clotures.lister(structureId, req.user.userId, query);
  }
}
