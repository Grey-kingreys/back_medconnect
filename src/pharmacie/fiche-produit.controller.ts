import {
  Body,
  Controller,
  Ip,
  Param,
  Patch,
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
import { FicheProduitService } from './fiche-produit.service';
import { ModifierFicheDto } from './dto/fiche-produit.dto';

@ApiTags('Pharmacie & Médicaments')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class FicheProduitController {
  constructor(private readonly fiches: FicheProduitService) {}

  @Patch(':structureId/stock/:stockId/fiche')
  @RequirePermissions(PERMISSIONS.STOCK_WRITE)
  @ApiOperation({
    summary: 'Modifier la fiche produit (prix, unité, coefficient)',
    description:
      "Prix de la boîte et prix à l'unité indépendants, jamais recalculés l'un depuis l'autre ; avertissement ECART_PRIX non bloquant au-delà du seuil de la pharmacie. 400 PRIX_UNITE_SANS_DECONDITIONNEMENT si un prix à l'unité reste sur une fiche non déconditionnable ; 400 CONVERSION_REQUISE si le coefficient change sur une fiche non qualifiée qui a du stock. Aucune conversion de stock.",
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({
    name: 'stockId',
    description: 'Identifiant de la fiche (StockMedicament)',
  })
  modifierFiche(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('stockId') stockId: string,
    @Body() dto: ModifierFicheDto,
    @Ip() ip: string,
  ) {
    return this.fiches.modifierFiche(
      structureId,
      req.user.userId,
      stockId,
      dto,
      ip,
    );
  }
}
