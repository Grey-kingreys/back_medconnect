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
    description:
      'Permission : caisse:utiliser. Succès : 200 (cree: false et ouverteMaintenant: false quand la caisse existait déjà ou que l’identifiant client est rejoué). Une seule caisse ouverte par poste ; le comptage d’ouverture est facultatif. 409 POSTE_INCONNU, SESSION_AUTRE_UTILISATEUR, IDENTIFIANT_DEJA_UTILISE, SESSION_FERMEE, JOURNEE_CLOTUREE ; 400 VALIDATION, MODE_PAIEMENT_INCONNU.',
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
  @ApiOperation({
    summary: 'Caisse ouverte sur un poste, s’il y en a une',
    description:
      'Permission : caisse:utiliser. Succès : 200 (data nul s’il n’y a pas de caisse ouverte sur ce poste). Volontairement sans contrôle du vendeur (D528) : renvoie la caisse ouverte du poste quel qu’en soit le titulaire (nom, fond et comptage d’ouverture compris, sans bilan ni montant d’activité), pour savoir qui occupe un poste. 409 POSTE_INCONNU (poste inconnu ou technique).',
  })
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
  @ApiOperation({
    summary: 'Sessions de caisse d’un jour',
    description:
      'Permission : caisse:superviser. Succès : 200. Sessions du jour métier (paramètre jour, défaut aujourd’hui) de tous les vendeurs, hors session technique. 400 VALIDATION si la date est mal formée.',
  })
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
    description:
      'Permission : caisse:utiliser. Succès : 200 (cree: false au rejeu du même identifiant). Coupures du référentiel actif seulement ; relevés Orange Money et MTN MoMo à la fermeture seulement. 409 SESSION_FERMEE, COMPTAGE_DEJA_SAISI, IDENTIFIANT_DEJA_UTILISE ; 400 VALIDATION, MODE_PAIEMENT_INCONNU ; 409 JOURNEE_CLOTUREE si le jour de la caisse est clôturé.',
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
    description:
      'Permission : caisse:utiliser. Succès : 200 (cree: false au rejeu du même identifiant). Motif obligatoire. 409 SESSION_FERMEE, IDENTIFIANT_DEJA_UTILISE ; 400 MOTIF_REQUIS, MODE_PAIEMENT_INCONNU ; 409 JOURNEE_CLOTUREE si le jour de la caisse est clôturé.',
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
  @ApiOperation({
    summary: 'Bilan d’une session de caisse',
    description:
      'Permission : caisse:utiliser. Succès : 200. Activité, théorique par mode (fond, paiements, apports, prélèvements, remboursements), compté et écart signé ; une session fermée rejoue son bilan figé. Un vendeur ne lit que sa propre caisse (403 sinon, sauf caisse:superviser).',
  })
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
  @ApiOperation({
    summary: 'Fermer une session de caisse',
    description:
      'Permission : caisse:utiliser. Succès : 200. Fige le bilan par mode et crée les anomalies FOND_NON_COMPTE et ECART_CAISSE attribuées à l’administrateur de la pharmacie. 400 COMPTAGE_FERMETURE_REQUIS, COMMENTAIRE_ECART_REQUIS (écart au-delà de seuilEcartCaisse) ; 409 COMPTAGE_DEJA_SAISI, JOURNEE_CLOTUREE.',
  })
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
