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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
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
import { VenteService } from './vente.service';
import {
  AnnulerVenteDto,
  CreerVenteDto,
  ListerVentesQueryDto,
} from './dto/vente.dto';

@ApiTags('Pharmacie : ventes')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class VenteController {
  constructor(private readonly venteService: VenteService) {}

  @Post(':structureId/ventes')
  @RequirePermissions(PERMISSIONS.VENTE_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Enregistrer une vente au comptoir',
    description:
      'Le serveur vérifie chaque ligne, retire les quantités du stock et enregistre la vente en une seule opération. Le prix vient du stock.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Clé unique par panier (8 à 128 caractères parmi lettres, chiffres, . _ : -), par exemple un UUID. Un renvoi avec la même clé dans les 24 h renvoie la même vente sans second retrait du stock. Clé mal formée : ignorée.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Corps invalide (VALIDATION), médicament périmé (MEDICAMENT_EXPIRE), sans prix (PRIX_MANQUANT) ou sur ordonnance non confirmée (ORDONNANCE_NON_CONFIRMEE). Lignes concernées dans details.',
  })
  @ApiResponse({
    status: 404,
    description:
      'Ligne de stock absente de la pharmacie (STOCK_INTROUVABLE, lignes dans details).',
  })
  @ApiResponse({
    status: 409,
    description:
      'Stock insuffisant (STOCK_INSUFFISANT, details : stockId, nom, disponible, demande).',
  })
  creerVente(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Body() dto: CreerVenteDto,
    @Ip() ip: string,
    @Headers('idempotency-key') enTeteIdempotence?: string,
  ) {
    return this.venteService.creerVente(
      structureId,
      req.user.userId,
      dto,
      enTeteIdempotence,
      ip,
    );
  }

  @Get(':structureId/ventes')
  @RequirePermissions(PERMISSIONS.VENTE_READ)
  @ApiOperation({
    summary: 'Lister les ventes d’un jour',
    description:
      'Ventes du jour (défaut : aujourd’hui), avec le total des ventes validées et le nombre de ventes.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiResponse({ status: 400, description: 'Date invalide (VALIDATION).' })
  listerVentes(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Query() query: ListerVentesQueryDto,
  ) {
    return this.venteService.listerVentes(structureId, req.user.userId, query);
  }

  @Get(':structureId/ventes/:venteId')
  @RequirePermissions(PERMISSIONS.VENTE_READ)
  @ApiOperation({
    summary: 'Détail d’une vente (reçu)',
    description: 'Même forme que la réponse de création.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'venteId', description: 'Identifiant de la vente' })
  @ApiResponse({ status: 404, description: 'Vente introuvable.' })
  detailVente(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('venteId') venteId: string,
  ) {
    return this.venteService.detailVente(structureId, venteId, req.user.userId);
  }

  @Post(':structureId/ventes/:venteId/annuler')
  @RequirePermissions(PERMISSIONS.VENTE_ANNULER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Annuler une vente du jour',
    description:
      'Remet les quantités en stock. Réservé à la permission vente:annuler, le jour même de la vente.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'venteId', description: 'Identifiant de la vente' })
  @ApiResponse({ status: 404, description: 'Vente introuvable.' })
  @ApiResponse({
    status: 409,
    description:
      'Vente déjà annulée (VENTE_DEJA_ANNULEE) ou d’un autre jour (ANNULATION_HORS_DELAI).',
  })
  annulerVente(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('venteId') venteId: string,
    @Body() dto: AnnulerVenteDto,
    @Ip() ip: string,
  ) {
    return this.venteService.annulerVente(
      structureId,
      venteId,
      req.user.userId,
      dto,
      ip,
    );
  }
}
