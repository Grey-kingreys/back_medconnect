import {
  Controller,
  Get,
  Headers,
  Param,
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
import { CatalogueSynchroQueryDto } from '../dto/synchro.dto';
import { CatalogueSynchroService } from './catalogue-synchro.service';
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
  constructor(private readonly catalogue: CatalogueSynchroService) {}

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
