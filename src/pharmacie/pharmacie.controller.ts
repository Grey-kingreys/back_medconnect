import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { PharmacieService } from './pharmacie.service';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { RequirePermissions } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import {
  CreateMedicamentDto,
  UpdateMedicamentDto,
  UpsertStockDto,
  UpdateStockQuantiteDto,
} from './dto/pharmacie.dto';

@ApiTags('Pharmacie & Médicaments')
@Controller('pharmacie')
export class PharmacieController {
  constructor(private readonly pharmacieService: PharmacieService) { }

  // ─── Recherche publique ───────────────────────────────────────

  @Get('rechercher')
  @ApiOperation({
    summary: 'Rechercher un médicament (public)',
    description: 'Cherche la disponibilité d\'un médicament dans les pharmacies partenaires.',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Nom du médicament' })
  @ApiQuery({ name: 'ville', required: false })
  @ApiQuery({ name: 'lat', required: false, type: Number })
  @ApiQuery({ name: 'lng', required: false, type: Number })
  @ApiQuery({ name: 'pharmacieId', required: false })
  rechercherDisponibilite(
    @Query('q') search?: string,
    @Query('ville') ville?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('pharmacieId') pharmacieId?: string,
  ) {
    return this.pharmacieService.rechercherDisponibilite(
      search,
      ville,
      lat ? parseFloat(lat) : undefined,
      lng ? parseFloat(lng) : undefined,
      pharmacieId,
    );
  }

  @Get('catalogue')
  @ApiOperation({ summary: 'Catalogue des médicaments (public)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'categorie', required: false })
  getMedicaments(
    @Query('search') search?: string,
    @Query('categorie') categorie?: string,
  ) {
    return this.pharmacieService.getMedicaments(search, categorie);
  }

  @Get('catalogue/categories')
  @ApiOperation({ summary: 'Liste des catégories de médicaments (public)' })
  getCategories() {
    return this.pharmacieService.getCategories();
  }

  @Get('catalogue/:medicamentId')
  @ApiParam({ name: 'medicamentId' })
  @ApiOperation({
    summary: 'Détails d\'un médicament',
    description: 'Retourne les détails + les pharmacies où il est disponible.',
  })
  getMedicament(@Param('medicamentId') medicamentId: string) {
    return this.pharmacieService.getMedicament(medicamentId);
  }

  // ─── Catalogue Admin (ADMIN/SUPER_ADMIN) ─────────────────────

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.CATALOGUE_WRITE)
  @Post('catalogue')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ajouter un médicament au catalogue (Admin)' })
  createMedicament(@Body() dto: CreateMedicamentDto, @Req() req: any) {
    return this.pharmacieService.createMedicament(dto, req.user.userId);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.CATALOGUE_MANAGE)
  @Patch('catalogue/:medicamentId')
  @ApiBearerAuth()
  @ApiParam({ name: 'medicamentId' })
  @ApiOperation({ summary: 'Modifier un médicament (Admin)' })
  updateMedicament(
    @Param('medicamentId') medicamentId: string,
    @Body() dto: UpdateMedicamentDto,
    @Req() req: any
  ) {
    return this.pharmacieService.updateMedicament(medicamentId, dto, req.user.userId);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.CATALOGUE_MANAGE)
  @Delete('catalogue/:medicamentId')
  @ApiBearerAuth()
  @ApiParam({ name: 'medicamentId' })
  @ApiOperation({ summary: 'Supprimer un médicament du catalogue (Admin)' })
  deleteMedicament(@Param('medicamentId') medicamentId: string, @Req() req: any) {
    return this.pharmacieService.deleteMedicament(medicamentId, req.user.userId);
  }

  // ─── Gestion Stock (STRUCTURE_ADMIN de pharmacie) ─────────────

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_WRITE)
  @Get('stock/:structureId')
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiOperation({
    summary: 'Mon stock',
    description: 'Liste le stock de la pharmacie avec alertes stock bas / rupture.',
  })
  getStock(@Param('structureId') structureId: string, @Req() req: any) {
    return this.pharmacieService.getStockPharmacie(structureId, req.user.userId);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_WRITE)
  @Post('stock/:structureId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiOperation({
    summary: 'Ajouter/mettre à jour un médicament en stock',
    description: 'Upsert — crée ou met à jour le stock pour ce médicament.',
  })
  upsertStock(
    @Param('structureId') structureId: string,
    @Req() req: any,
    @Body() dto: UpsertStockDto,
  ) {
    return this.pharmacieService.upsertStock(structureId, req.user.userId, dto);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_WRITE)
  @Patch('stock/:structureId/:stockId/quantite')
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiParam({ name: 'stockId' })
  @ApiOperation({
    summary: 'Ajuster la quantité en stock',
    description: 'Passer une variation positive (réception) ou négative (dispensation).',
  })
  updateQuantite(
    @Param('structureId') structureId: string,
    @Param('stockId') stockId: string,
    @Req() req: any,
    @Body() dto: UpdateStockQuantiteDto,
  ) {
    return this.pharmacieService.updateStockQuantite(
      structureId,
      stockId,
      req.user.userId,
      dto,
    );
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_WRITE)
  @Delete('stock/:structureId/:stockId')
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiParam({ name: 'stockId' })
  @ApiOperation({ summary: 'Retirer un médicament du stock' })
  removeStock(
    @Param('structureId') structureId: string,
    @Param('stockId') stockId: string,
    @Req() req: any,
  ) {
    return this.pharmacieService.removeStockItem(structureId, stockId, req.user.userId);
  }
}