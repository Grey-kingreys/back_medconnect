import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { RequestWithUser } from 'src/auth/jwt.strategy';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { RequirePermissions } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import {
  CatalogueSynchroQueryDto,
  RecevoirEvenementsDto,
} from '../dto/synchro.dto';
import { CatalogueSynchroService } from './catalogue-synchro.service';
import { SynchroService } from './synchro.service';
import {
  compresserJson,
  correspondEtag,
  etagFaible,
} from './reponse-compressee';

@ApiTags('Pharmacie : synchronisation')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class SynchroController {
  constructor(
    private readonly catalogue: CatalogueSynchroService,
    private readonly synchro: SynchroService,
  ) {}

  @Post(':structureId/synchro/evenements')
  @RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Recevoir les opérations de caisse d'un poste desktop",
    description:
      '200 opérations au plus par appel, triées par séquence, rejouables sans doublon (idempotent par evenementId). ' +
      "Chaque opération reçoit un statut : APPLIQUE, DEJA_APPLIQUE, EN_ATTENTE (un numéro d'ordre manque avant elle), " +
      "REJETE (mise de côté pour le responsable) ou A_RENVOYER (rien d'écrit, à renvoyer plus tard). " +
      'Types et corps : SESSION_OUVERTE { sessionId } ; COMPTAGE_SAISI { comptageId, sessionId, moment, coupures, releves? } ; ' +
      'MOUVEMENT_CAISSE { mouvementId, sessionId, type, montant, motif, mode? } ; ' +
      "SESSION_FERMEE { sessionId, comptageFermeture?, commentaire? } ; VENTE (renvoyée A_RENVOYER pour l'instant). " +
      "Corps JSON jusqu'à 2 Mo, compressé gzip accepté (Content-Encoding: gzip). Lot vide : battement de cœur. 409 POSTE_INCONNU.",
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  recevoir(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Body() dto: RecevoirEvenementsDto,
    @Ip() ip: string,
  ) {
    return this.synchro.recevoir(structureId, req.user.userId, dto, ip);
  }

  @Get(':structureId/synchro/catalogue')
  @RequirePermissions(PERMISSIONS.CAISSE_UTILISER)
  @ApiOperation({
    summary: 'Photographie du catalogue pour un poste desktop',
    description:
      'Sans coût. ETag faible et 304 si If-None-Match correspond, compression br ou gzip selon Accept-Encoding. 409 POSTE_INCONNU.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  async photographie(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Query() query: CatalogueSynchroQueryDto,
    @Headers('if-none-match') siAucun: string | undefined,
    @Headers('accept-encoding') encodages: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.catalogue.photographier(
      structureId,
      req.user.userId,
      query.posteId,
    );
    const texte = JSON.stringify({
      data,
      message: 'Catalogue du poste.',
      success: true,
    });
    const etag = etagFaible(texte);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('Vary', 'Accept-Encoding');
    if (correspondEtag(siAucun, etag)) {
      res.status(304).end();
      return;
    }
    const { encodage, contenu } = compresserJson(texte, encodages);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (encodage !== 'identity') res.setHeader('Content-Encoding', encodage);
    res.setHeader('Content-Length', contenu.length);
    res.status(200).end(contenu);
  }
}
