import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
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
import { SortiesStockService } from './sorties.service';
import { CreerSortieStockDto } from '../dto/inventaires.dto';

@ApiTags('Pharmacie : inventaires et sorties')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class InventairesController {
  constructor(private readonly sorties: SortiesStockService) {}

  @Post(':structureId/stock/sorties')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.STOCK_WRITE)
  @ApiOperation({
    summary:
      "Sortie manuelle d'un lot (périmé, cassé, perdu, retour fournisseur)",
    description:
      'raison obligatoire (400 MOTIF_REQUIS) : PERIME (mouvement PEREMPTION), CASSE, PERDU, AUTRE (PERTE, AUTRE exige un commentaire), RETOUR_FOURNISSEUR (RETOUR). Quantité en BOITE (unités par boîte du lot) ou UNITE. 404 lot introuvable pour ce médicament, 409 STOCK_LOT_NEGATIF au-delà du stock du lot, id client pour rejouer sans doublon (409 IDENTIFIANT_DEJA_UTILISE). Pièce SORTIE_MANUELLE attribuée, sans coût.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  enregistrerSortie(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Body() dto: CreerSortieStockDto,
    @Ip() ip: string,
  ) {
    return this.sorties.enregistrer(structureId, req.user.userId, dto, ip);
  }
}
