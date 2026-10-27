import {
  Body,
  Controller,
  Get,
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
import { InventairesService } from './inventaires.service';
import {
  CreerInventaireDto,
  CreerSortieStockDto,
  ListerInventairesDto,
} from '../dto/inventaires.dto';

@ApiTags('Pharmacie : inventaires et sorties')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class InventairesController {
  constructor(
    private readonly sorties: SortiesStockService,
    private readonly inventaires: InventairesService,
  ) {}

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

  @Post(':structureId/inventaires')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INVENTAIRE_WRITE)
  @ApiOperation({
    summary: 'Enregistrer un inventaire (comptage par lot)',
    description:
      "Quantité comptée absolue par lot : quantiteComptee (unités) ou nombreBoites (unités par boîte du lot) et unitesEnPlus. Lot : lotId, sinon numéro de lot, sinon date de péremption, sinon lot unique en stock ; plusieurs lots possibles : 409 LOT_REQUIS (lots dans details) ; boîtes d'un lot inconnu : nouveau lot (date obligatoire, 400 DATE_PEREMPTION_REQUISE). Un mouvement INVENTAIRE par lot compté, même à écart nul. Écart de la fiche au-delà de sa tolérance : anomalie ECART_INVENTAIRE attribuée à l'auteur. Les ventes faites sans stock sont rattachées aux lots comptés, qui finissent à la quantité comptée. id client pour rejouer sans doublon.",
  })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  enregistrerInventaire(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Body() dto: CreerInventaireDto,
    @Ip() ip: string,
  ) {
    return this.inventaires.enregistrer(structureId, req.user.userId, dto, ip);
  }

  @Get(':structureId/inventaires')
  @RequirePermissions(PERMISSIONS.INVENTAIRE_WRITE)
  @ApiOperation({ summary: 'Lister les inventaires (20 par page)' })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  listerInventaires(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Query() dto: ListerInventairesDto,
  ) {
    return this.inventaires.lister(structureId, req.user.userId, dto);
  }

  @Get(':structureId/inventaires/:inventaireId')
  @RequirePermissions(PERMISSIONS.INVENTAIRE_WRITE)
  @ApiOperation({ summary: "Détail d'un inventaire" })
  @ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })
  @ApiParam({
    name: 'inventaireId',
    description: "Identifiant de l'inventaire",
  })
  detailInventaire(
    @Req() req: RequestWithUser,
    @Param('structureId') structureId: string,
    @Param('inventaireId') inventaireId: string,
  ) {
    return this.inventaires.detail(structureId, req.user.userId, inventaireId);
  }
}
