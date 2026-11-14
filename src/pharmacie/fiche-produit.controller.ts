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
      "Permission : stock:write. Succès : 200. Prix de la boîte et prix à l'unité indépendants, jamais recalculés l'un depuis l'autre ; avertissement ECART_PRIX non bloquant au-delà du seuil de la pharmacie. Changer le nombre d'unités par boîte d'une fiche non qualifiée qui a du stock exige conversionStock : MULTIPLIER (le stock repris compté en boîtes est converti en unités par un mouvement CORRECTION, pièce QUALIFICATION) ou CONSERVER (quantités gardées) ; la fiche est alors qualifiée. 400 PRIX_UNITE_SANS_DECONDITIONNEMENT, 400 CONVERSION_REQUISE, 409 FICHE_DEJA_QUALIFIEE, 409 CONVERSION_IMPOSSIBLE, 404 si la fiche est introuvable ou archivée. Réponse : fiche, avertissements, conversion.",
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
