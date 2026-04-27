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
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
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
  @ApiQuery({ name: 'q', required: true, description: 'Nom du médicament' })
  @ApiQuery({ name: 'ville', required: false })
  @ApiQuery({ name: 'lat', required: false, type: Number })
  @ApiQuery({ name: 'lng', required: false, type: Number })
  rechercherDisponibilite(
    @Query('q') search: string,
    @Query('ville') ville?: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    return this.pharmacieService.rechercherDisponibilite(
      search,
      ville,
      lat ? parseFloat(lat) : undefined,
      lng ? parseFloat(lng) : undefined,
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

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('catalogue')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ajouter un médicament au catalogue (Admin)' })
  createMedicament(@Body() dto: CreateMedicamentDto) {
    return this.pharmacieService.createMedicament(dto);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch('catalogue/:medicamentId')
  @ApiBearerAuth()
  @ApiParam({ name: 'medicamentId' })
  @ApiOperation({ summary: 'Modifier un médicament (Admin)' })
  updateMedicament(
    @Param('medicamentId') medicamentId: string,
    @Body() dto: UpdateMedicamentDto,
  ) {
    return this.pharmacieService.updateMedicament(medicamentId, dto);
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Delete('catalogue/:medicamentId')
  @ApiBearerAuth()
  @ApiParam({ name: 'medicamentId' })
  @ApiOperation({ summary: 'Supprimer un médicament du catalogue (Admin)' })
  deleteMedicament(@Param('medicamentId') medicamentId: string) {
    return this.pharmacieService.deleteMedicament(medicamentId);
  }

  // ─── Gestion Stock (STRUCTURE_ADMIN de pharmacie) ─────────────

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('STRUCTURE_ADMIN')
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

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('STRUCTURE_ADMIN')
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

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('STRUCTURE_ADMIN')
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

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('STRUCTURE_ADMIN')
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