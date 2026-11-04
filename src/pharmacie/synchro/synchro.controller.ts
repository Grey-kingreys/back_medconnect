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
      'Permission : caisse:utiliser. Succès : 200 avec { resultats, sequenceAppliquee, enAttente }. ' +
      '0 à 200 événements par appel (lot vide : battement de cœur), traités un par un dans une transaction chacun, ' +
      'rejouables sans doublon (idempotent par evenementId et empreinte), dans l’ordre strict des séquences du poste. ' +
      "Chaque événement reçoit un statut : APPLIQUE, DEJA_APPLIQUE, EN_ATTENTE (un numéro d'ordre manque avant lui), " +
      "REJETE (mis de côté avec son corps, anomalie EVENEMENT_REJETE pour le titulaire) ou A_RENVOYER (rien d'écrit, à renvoyer plus tard ; au 3e échec imprévu, mise de côté REJETE EVENEMENT_INAPPLICABLE). " +
      'Types et corps : SESSION_OUVERTE, COMPTAGE_SAISI, MOUVEMENT_CAISSE, SESSION_FERMEE et VENTE ' +
      '(la vente est réallouée par le serveur ; une vente remontée après une clôture devient une pièce REGULARISATION). ' +
      "Corps JSON jusqu'à 2 Mo, compressé gzip accepté (Content-Encoding: gzip) : seule route ainsi, partout ailleurs 100 Ko et 415 sur un corps compressé. " +
      '400 VALIDATION (corps invalide, plus de 200 événements), 409 POSTE_INCONNU, 413 au-delà de 2 Mo.',
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
      'Permission : caisse:utiliser. Succès : 200 (photographie complète du catalogue pour un poste desktop actif, paramètre posteId), ou 304 si If-None-Match correspond à l’ETag faible. Sans coût, même pour le titulaire. Compression br ou gzip selon Accept-Encoding. 409 POSTE_INCONNU (poste inconnu, technique, inactif ou de type web).',
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
