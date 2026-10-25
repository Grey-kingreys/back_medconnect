import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { RequestWithUser } from 'src/auth/jwt.strategy';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { RequirePermissions } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { SessionsCaisseService } from './sessions-caisse.service';
import {
  FermerSessionDto,
  ListerSessionsQueryDto,
  MouvementCaisseDto,
  OuvrirSessionDto,
  SaisirComptageDto,
  SessionCouranteQueryDto,
} from '../dto/sessions-caisse.dto';

@ApiTags('Pharmacie : caisse')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class SessionsCaisseController {
  constructor(private readonly sessions: SessionsCaisseService) {}

  @Post(':structureId/caisse/sessions')
  @RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ouvrir la caisse d’un poste (idempotent pour le même vendeur)',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiResponse({
    status: 409,
    description:
      'Poste inconnu (POSTE_INCONNU), caisse ouverte par un autre vendeur (SESSION_AUTRE_UTILISATEUR), identifiant déjà pris (IDENTIFIANT_DEJA_UTILISE) ou session fermée (SESSION_FERMEE).',
  })
  @ApiResponse({
    status: 400,
    description: 'Comptage invalide (VALIDATION, MODE_PAIEMENT_INCONNU).',
  })
  ouvrir(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Body() dto: OuvrirSessionDto,
  ) {
    return this.sessions.ouvrir(structureId, req.user.userId, dto);
  }

  @Get(':structureId/caisse/sessions/courante')
  @RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
  @ApiOperation({ summary: 'Caisse ouverte sur un poste, s’il y en a une' })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiResponse({
    status: 409,
    description: 'Poste inconnu ou technique (POSTE_INCONNU).',
  })
  courante(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Query() query: SessionCouranteQueryDto,
  ) {
    return this.sessions.courante(structureId, req.user.userId, query.posteId);
  }

  @Get(':structureId/caisse/sessions')
  @RequirePermissions(PERMISSIONS.CAISSE_SUPERVISER)
  @ApiOperation({ summary: 'Sessions de caisse d’un jour' })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiResponse({ status: 400, description: 'Date invalide (VALIDATION).' })
  listerDuJour(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Query() query: ListerSessionsQueryDto,
  ) {
    return this.sessions.listerDuJour(structureId, req.user.userId, query);
  }

  @Post(':structureId/caisse/sessions/:sessionId/comptages')
  @RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enregistrer le comptage d’ouverture ou de fermeture',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'sessionId', description: 'Identifiant de la session' })
  @ApiResponse({
    status: 409,
    description:
      'Session fermée (SESSION_FERMEE), comptage déjà saisi (COMPTAGE_DEJA_SAISI) ou identifiant déjà pris (IDENTIFIANT_DEJA_UTILISE).',
  })
  @ApiResponse({
    status: 400,
    description:
      'Coupures ou relevés invalides (VALIDATION, MODE_PAIEMENT_INCONNU).',
  })
  saisirComptage(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: SaisirComptageDto,
  ) {
    return this.sessions.saisirComptage(
      structureId,
      req.user.userId,
      sessionId,
      dto,
    );
  }

  @Post(':structureId/caisse/sessions/:sessionId/mouvements')
  @RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enregistrer un prélèvement, un apport ou un remboursement',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'sessionId', description: 'Identifiant de la session' })
  @ApiResponse({
    status: 409,
    description:
      'Session fermée (SESSION_FERMEE) ou identifiant déjà pris (IDENTIFIANT_DEJA_UTILISE).',
  })
  @ApiResponse({
    status: 400,
    description:
      'Motif absent (MOTIF_REQUIS) ou mode inconnu (MODE_PAIEMENT_INCONNU).',
  })
  enregistrerMouvement(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: MouvementCaisseDto,
  ) {
    return this.sessions.enregistrerMouvement(
      structureId,
      req.user.userId,
      sessionId,
      dto,
    );
  }

  @Get(':structureId/caisse/sessions/:sessionId/bilan')
  @RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
  @ApiOperation({ summary: 'Bilan d’une session de caisse' })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'sessionId', description: 'Identifiant de la session' })
  bilan(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.sessions.bilan(structureId, req.user.userId, sessionId);
  }

  @Post(':structureId/caisse/sessions/:sessionId/fermer')
  @RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fermer une session de caisse' })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'sessionId', description: 'Identifiant de la session' })
  @ApiResponse({
    status: 400,
    description:
      'Comptage de fermeture absent (COMPTAGE_FERMETURE_REQUIS) ou commentaire manquant au-delà du seuil (COMMENTAIRE_ECART_REQUIS).',
  })
  @ApiResponse({
    status: 409,
    description: 'Comptage déjà saisi (COMPTAGE_DEJA_SAISI).',
  })
  fermer(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: FermerSessionDto,
  ) {
    return this.sessions.fermer(structureId, req.user.userId, sessionId, dto);
  }
}
