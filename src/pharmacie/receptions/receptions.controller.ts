import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
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
import { ReceptionsService } from './receptions.service';
import {
  CorrigerLotDto,
  CreerFournisseurDto,
  CreerReceptionDto,
  ListerReceptionsDto,
} from '../dto/receptions.dto';

@ApiTags('Pharmacie : réceptions')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class ReceptionsController {
  constructor(private readonly receptions: ReceptionsService) {}

  @Get(':structureId/fournisseurs')
  @RequirePermissions(PERMISSIONS.RECEPTION_WRITE)
  @ApiOperation({
    summary: 'Liste des fournisseurs de la pharmacie',
    description:
      'Permission : reception:write. Succès : 200. Fournisseurs de la pharmacie, par nom.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  listerFournisseurs(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
  ) {
    return this.receptions.listerFournisseurs(structureId, req.user.userId);
  }

  @Post(':structureId/fournisseurs')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.RECEPTION_WRITE)
  @ApiOperation({
    summary: 'Enregistrer un fournisseur',
    description:
      'Permission : reception:write. Succès : 200. Le nom est unique dans la pharmacie, sans tenir compte des majuscules (409 FOURNISSEUR_EXISTANT).',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  creerFournisseur(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Body() dto: CreerFournisseurDto,
    @Ip() ip: string,
  ) {
    return this.receptions.creerFournisseur(
      structureId,
      req.user.userId,
      dto,
      ip,
    );
  }

  @Post(':structureId/receptions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.RECEPTION_WRITE)
  @ApiOperation({
    summary: 'Enregistrer une réception de médicaments',
    description:
      "Permission : reception:write. Succès : 200. Une réception et un lot par ligne. Quantité : nombreBoites (multiplié par le nombre d'unités par boîte de la fiche) ou quantiteUnites. Coût par unité = coût d'achat de la boîte divisé par ce nombre, arrondi au GNF, figé sur le lot. Date de péremption obligatoire sauf sansPeremption (400 DATE_PEREMPTION_REQUISE), jamais passée (400 DATE_PEREMPTION_PASSEE). 400 VALIDATION (quantité manquante, double ou trop grande, date mal formée), 404 STOCK_INTROUVABLE, 404 fournisseur, 409 IDENTIFIANT_DEJA_UTILISE, 409 JOURNEE_CLOTUREE (réception datée d'un jour antérieur clôturé). Coûts retirés sans marge:read. Les ventes faites sans stock sur ces médicaments sont rattachées aux lots (FEFO, lots non périmés) : allocation provisoire remplacée, mouvements de pièce RESOLUTION, réponse resolutions.",
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  enregistrer(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Body() dto: CreerReceptionDto,
    @Ip() ip: string,
  ) {
    return this.receptions.enregistrer(structureId, req.user.userId, dto, ip);
  }

  @Get(':structureId/receptions')
  @RequirePermissions(PERMISSIONS.RECEPTION_WRITE)
  @ApiOperation({
    summary: 'Liste des réceptions, les plus récentes d’abord',
    description:
      'Permission : reception:write. Succès : 200. 20 par page ; coûts retirés sans marge:read.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  lister(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Query() dto: ListerReceptionsDto,
  ) {
    return this.receptions.lister(structureId, req.user.userId, dto);
  }

  @Get(':structureId/receptions/:receptionId')
  @RequirePermissions(PERMISSIONS.RECEPTION_WRITE)
  @ApiOperation({
    summary: 'Détail d’une réception et de ses lots',
    description:
      'Permission : reception:write. Succès : 200. 404 si la réception est introuvable ; coûts retirés sans marge:read.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'receptionId', description: 'Identifiant de la réception' })
  detail(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('receptionId') receptionId: string,
  ) {
    return this.receptions.detail(structureId, req.user.userId, receptionId);
  }

  @Get(':structureId/stock/:stockId/lots')
  @RequirePermissions(PERMISSIONS.STOCK_READ)
  @ApiOperation({
    summary: 'Lots en stock d’un médicament, dans l’ordre de sortie',
    description:
      'Permission : stock:read. Succès : 200. Lots à solde positif d’une fiche, dans l’ordre de sortie ; coûts retirés sans marge:read. 404 si la fiche est introuvable.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({
    name: 'stockId',
    description: 'Identifiant de la fiche (StockMedicament)',
  })
  listerLots(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('stockId') stockId: string,
  ) {
    return this.receptions.listerLots(structureId, req.user.userId, stockId);
  }

  @Patch(':structureId/lots/:lotId')
  @RequirePermissions(PERMISSIONS.RECEPTION_WRITE)
  @ApiOperation({
    summary: 'Corriger la date de péremption d’un lot',
    description:
      'Permission : reception:write. Succès : 200. Motif obligatoire (400 MOTIF_REQUIS), correction enregistrée dans le journal d’audit. 404 si le lot est introuvable.',
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({ name: 'lotId', description: 'Identifiant du lot' })
  corrigerDateLot(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('lotId') lotId: string,
    @Body() dto: CorrigerLotDto,
    @Ip() ip: string,
  ) {
    return this.receptions.corrigerDateLot(
      structureId,
      req.user.userId,
      lotId,
      dto,
      ip,
    );
  }
}
