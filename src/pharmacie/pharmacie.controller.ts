// Dette de typage préexistante, backlog points 21 et 22
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
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
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiConsumes,
  ApiBody,
  ApiProduces,
} from '@nestjs/swagger';
import { PharmacieService } from './pharmacie.service';
import { CatalogueImportService } from './catalogue-import.service';
import { MIME_XLSX } from './import-excel';
import type { RequestWithUser } from 'src/auth/jwt.strategy';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { RequirePermissions } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import {
  CreateMedicamentDto,
  UpdateMedicamentDto,
  UpsertStockDto,
  UpdateStockQuantiteDto,
  FichierImport,
  OptionsImportStockDto,
} from './dto/pharmacie.dto';

// Schéma Swagger du formulaire d'envoi du classeur (stock et catalogue)
const CORPS_IMPORT_STOCK = {
  schema: {
    type: 'object',
    required: ['fichier'],
    properties: { fichier: { type: 'string', format: 'binary' } },
  },
};
// Formulaire d'import du stock : le classeur et la façon de compter (facultative)
const CORPS_IMPORT_STOCK_MODE = {
  schema: {
    type: 'object',
    required: ['fichier'],
    properties: {
      fichier: { type: 'string', format: 'binary' },
      mode: {
        type: 'string',
        enum: ['inventaire', 'livraison'],
        default: 'inventaire',
      },
    },
  },
};
// Plafond mémoire de réception ; la limite métier (2 Mo) est contrôlée par le service
const LIMITES_IMPORT_STOCK = { limits: { fileSize: 10 * 1024 * 1024 } };

@ApiTags('Pharmacie & Médicaments')
@Controller('pharmacie')
export class PharmacieController {
  constructor(
    private readonly pharmacieService: PharmacieService,
    private readonly catalogueImportService: CatalogueImportService,
  ) {}

  // ─── Recherche publique ───────────────────────────────────────

  @Get('rechercher')
  @ApiOperation({
    summary: 'Rechercher un médicament (public)',
    description:
      "Cherche la disponibilité d'un médicament dans les pharmacies partenaires.",
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
    summary: "Détails d'un médicament",
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

  // Import Excel du catalogue

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.CATALOGUE_WRITE)
  @Get('catalogue/import/modele')
  @ApiBearerAuth()
  @ApiProduces(MIME_XLSX)
  @ApiOperation({
    summary: "Télécharger le modèle Excel d'import du catalogue",
    description:
      "Classeur .xlsx : feuille « Catalogue » (Nom, Nom générique, Catégorie, Description, Ordonnance requise, Formes) avec une ligne d'exemple, et feuille « Mode d'emploi ».",
  })
  async getModeleImportCatalogue(): Promise<StreamableFile> {
    const contenu =
      await this.catalogueImportService.getModeleImportCatalogue();
    return new StreamableFile(contenu, {
      type: MIME_XLSX,
      disposition: 'attachment; filename="modele-import-catalogue.xlsx"',
    });
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.CATALOGUE_WRITE)
  @Post('catalogue/import/apercu')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('fichier', LIMITES_IMPORT_STOCK))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody(CORPS_IMPORT_STOCK)
  @ApiOperation({
    summary: "Aperçu de l'import Excel du catalogue",
    description:
      'Analyse le classeur (champ multipart `fichier`, .xlsx, 2 Mo et 1000 lignes max) sans rien écrire. Un médicament déjà au catalogue (nom comparé sans casse, accents ni espaces superflus) est rejeté. Renvoie { totalLignes, acceptees, rejetees, lignes[] }.',
  })
  apercuImportCatalogue(@UploadedFile() fichier?: FichierImport) {
    return this.catalogueImportService.apercuImportCatalogue(fichier);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.CATALOGUE_WRITE)
  @Post('catalogue/import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('fichier', LIMITES_IMPORT_STOCK))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody(CORPS_IMPORT_STOCK)
  @ApiOperation({
    summary: 'Importer des médicaments au catalogue depuis un fichier Excel',
    description:
      "Refait l'analyse de l'aperçu puis crée les médicaments acceptés en une transaction. Un médicament existant n'est jamais modifié. Renvoie le rapport + importees.",
  })
  importerCatalogue(
    @Req() req: RequestWithUser,
    @UploadedFile() fichier?: FichierImport,
  ) {
    return this.catalogueImportService.importerCatalogue(
      fichier,
      req.user.userId,
    );
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
    @Req() req: any,
  ) {
    return this.pharmacieService.updateMedicament(
      medicamentId,
      dto,
      req.user.userId,
    );
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.CATALOGUE_MANAGE)
  @Delete('catalogue/:medicamentId')
  @ApiBearerAuth()
  @ApiParam({ name: 'medicamentId' })
  @ApiOperation({
    summary: 'Supprimer un médicament du catalogue (Admin)',
    description:
      'Refusé (409 MEDICAMENT_UTILISE) si une pharmacie a un lot, un mouvement ou une vente de ce médicament.',
  })
  deleteMedicament(
    @Param('medicamentId') medicamentId: string,
    @Req() req: any,
  ) {
    return this.pharmacieService.deleteMedicament(
      medicamentId,
      req.user.userId,
    );
  }

  // ─── Gestion Stock (STRUCTURE_ADMIN de pharmacie) ─────────────

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_WRITE)
  @Get('stock/:structureId')
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiOperation({
    summary: 'Mon stock',
    description:
      'Liste le stock de la pharmacie avec alertes stock bas / rupture.',
  })
  getStock(@Param('structureId') structureId: string, @Req() req: any) {
    return this.pharmacieService.getStockPharmacie(
      structureId,
      req.user.userId,
    );
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_WRITE)
  @Post('stock/:structureId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiOperation({
    summary: 'Ajouter/mettre à jour un médicament en stock',
    description:
      'Crée ou met à jour la fiche (prix de la boîte, notes) et la désarchive. quantite est en unités minimales : sans lot en stock, une quantité positive crée un lot (date de péremption obligatoire sauf sansPeremption, 400 DATE_PEREMPTION_REQUISE) ; avec un seul lot, un mouvement INVENTAIRE amène le stock à la quantité saisie et dateExpiration corrige la date du lot ; avec plusieurs lots, une autre quantité ou une autre date est refusée (409 LOT_REQUIS). Réponse : fiche lue et avertissements.',
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
    summary: "Corriger la quantité d'un lot",
    description:
      "Variation signée non nulle en unités minimales sur un lot (lotId facultatif si le médicament n'a qu'un lot en stock), motif obligatoire de 3 à 300 caractères (400 MOTIF_REQUIS). Écrit un mouvement CORRECTION. 409 LOT_REQUIS, 409 STOCK_LOT_NEGATIF, 404 si la fiche ou le lot est introuvable.",
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
  @ApiOperation({
    summary: 'Archiver un médicament du stock',
    description:
      'Archivage, jamais de suppression : la fiche sort des listes, de la vente et de la recherche publique, son journal est conservé. Une nouvelle saisie de la fiche (POST) la désarchive.',
  })
  removeStock(
    @Param('structureId') structureId: string,
    @Param('stockId') stockId: string,
    @Req() req: any,
  ) {
    return this.pharmacieService.removeStockItem(
      structureId,
      stockId,
      req.user.userId,
    );
  }

  // Import Excel du stock

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_WRITE)
  @Get('stock/:structureId/import/modele')
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiProduces(MIME_XLSX)
  @ApiOperation({
    summary: "Télécharger le modèle Excel d'import du stock",
    description:
      "Classeur .xlsx : feuille « Stock » (Médicament, Quantité (boîtes), Prix de la boîte (GNF), Date d'expiration (AAAA-MM-JJ), Lot, Coût d'achat de la boîte (GNF), Notes) avec une ligne d'exemple, et feuille « Mode d'emploi ».",
  })
  async getModeleImportStock(
    @Param('structureId') structureId: string,
    @Req() req: RequestWithUser,
  ): Promise<StreamableFile> {
    const contenu = await this.pharmacieService.getModeleImportStock(
      structureId,
      req.user.userId,
    );
    return new StreamableFile(contenu, {
      type: MIME_XLSX,
      disposition: 'attachment; filename="modele-import-stock.xlsx"',
    });
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_WRITE)
  @Post('stock/:structureId/import/apercu')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('fichier', LIMITES_IMPORT_STOCK))
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(CORPS_IMPORT_STOCK_MODE)
  @ApiOperation({
    summary: "Aperçu de l'import Excel du stock",
    description:
      "Analyse le classeur (champ multipart `fichier`, .xlsx, 2 Mo et 1000 lignes max) sans rien écrire. Champ multipart `mode` : livraison seulement (reception:write) ; inventaire (défaut) : 409 IMPORT_INVENTAIRE_INDISPONIBLE ; autre valeur : 400 VALIDATION sur mode. Date de péremption obligatoire sauf « sans péremption », jamais passée ; colonnes facultatives Lot et Coût d'achat (par boîte). Chaque ligne acceptée porte quantiteAvant, quantiteApres et unitesRecues (unités, stock calculé). Coûts retirés sans marge:read.",
  })
  apercuImportStock(
    @Param('structureId') structureId: string,
    @Req() req: RequestWithUser,
    @Body() options: OptionsImportStockDto,
    @UploadedFile() fichier?: FichierImport,
  ) {
    return this.pharmacieService.apercuImportStock(
      structureId,
      req.user.userId,
      fichier,
      options.mode ?? 'inventaire',
    );
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_WRITE)
  @Post('stock/:structureId/import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('fichier', LIMITES_IMPORT_STOCK))
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(CORPS_IMPORT_STOCK_MODE)
  @ApiOperation({
    summary: 'Importer le stock depuis un fichier Excel',
    description:
      "Refait l'analyse de l'aperçu puis, dans une transaction, enregistre une réception (un lot par ligne acceptée, coût par unité figé) et rattache les ventes faites sans stock. Un médicament absent du stock y est ajouté ; prix de la boîte et notes mis à jour si la case est remplie. Mode inventaire : 409 IMPORT_INVENTAIRE_INDISPONIBLE. Renvoie le rapport, mode, importees et receptionId.",
  })
  importerStock(
    @Param('structureId') structureId: string,
    @Req() req: RequestWithUser,
    @Body() options: OptionsImportStockDto,
    @UploadedFile() fichier?: FichierImport,
  ) {
    return this.pharmacieService.importerStock(
      structureId,
      req.user.userId,
      fichier,
      options.mode ?? 'inventaire',
    );
  }
}
