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
  ModeleImportStockDto,
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
      "Route publique, sans authentification. Succès : 200. Cherche la disponibilité d'un médicament dans les pharmacies partenaires : seuls les lots non périmés comptent, fiches archivées exclues, ni lots ni coûts dans la réponse.",
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
  @ApiOperation({
    summary: 'Catalogue des médicaments (public)',
    description:
      'Route publique, sans authentification. Succès : 200. Catalogue partagé, filtrable par nom (search) et par catégorie.',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'categorie', required: false })
  getMedicaments(
    @Query('search') search?: string,
    @Query('categorie') categorie?: string,
  ) {
    return this.pharmacieService.getMedicaments(search, categorie);
  }

  @Get('catalogue/categories')
  @ApiOperation({
    summary: 'Liste des catégories de médicaments (public)',
    description:
      'Route publique, sans authentification. Succès : 200. Catégories présentes dans le catalogue partagé.',
  })
  getCategories() {
    return this.pharmacieService.getCategories();
  }

  @Get('catalogue/:medicamentId')
  @ApiParam({ name: 'medicamentId' })
  @ApiOperation({
    summary: "Détails d'un médicament",
    description:
      'Route publique, sans authentification. Succès : 200. Retourne les détails et les pharmacies où il est disponible (lots non périmés seulement, ni lots ni coûts). 404 si le médicament est introuvable.',
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
  @ApiOperation({
    summary: 'Ajouter un médicament au catalogue (Admin)',
    description:
      'Permission : catalogue:write. Succès : 201. 409 si un médicament du même nom (sans tenir compte de la casse) existe déjà, sans code.',
  })
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
      "Permission : catalogue:write. Succès : 200. Classeur .xlsx : feuille « Catalogue » (Nom, Nom générique, Catégorie, Description, Ordonnance requise, Formes) avec une ligne d'exemple, et feuille « Mode d'emploi ».",
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
      'Permission : catalogue:write. Succès : 200. Analyse le classeur (champ multipart `fichier`, .xlsx, 2 Mo et 1000 lignes max, 400 sinon) sans rien écrire. Un médicament déjà au catalogue (nom comparé sans casse, accents ni espaces superflus) est rejeté. Renvoie { totalLignes, acceptees, rejetees, lignes[] }.',
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
      "Permission : catalogue:write. Succès : 200. Refait l'analyse de l'aperçu (mêmes limites, 400 sinon) puis crée les médicaments acceptés en une transaction. Un médicament existant n'est jamais modifié. Renvoie le rapport + importees.",
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
  @ApiOperation({
    summary: 'Modifier un médicament (Admin)',
    description:
      'Permission : catalogue:manage. Succès : 200. 404 si le médicament est introuvable.',
  })
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
      'Permission : catalogue:manage. Succès : 200. 404 si le médicament est introuvable. Refusé (409 MEDICAMENT_UTILISE) si une pharmacie a un lot, un mouvement ou une vente de ce médicament.',
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
      'Permissions : stock:read et stock:write. Succès : 200. Liste le stock de la pharmacie avec alertes stock bas / rupture ; quantités en unités minimales, lots avec coûts seulement si marge:read ; fiches archivées exclues.',
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
      'Permissions : stock:read et stock:write. Succès : 200. Crée ou met à jour la fiche (prix de la boîte, notes) et la désarchive. quantite est en unités minimales : sans lot en stock, une quantité positive crée un lot (date de péremption obligatoire sauf sansPeremption, 400 DATE_PEREMPTION_REQUISE) ; avec un seul lot, un mouvement INVENTAIRE amène le stock à la quantité saisie et dateExpiration corrige la date du lot ; avec plusieurs lots, une autre quantité ou une autre date est refusée (409 LOT_REQUIS). Réponse : fiche lue et avertissements.',
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
      "Permissions : stock:read et stock:write. Succès : 200. Variation signée non nulle en unités minimales sur un lot (lotId facultatif si le médicament n'a qu'un lot en stock), motif obligatoire de 3 à 300 caractères (400 MOTIF_REQUIS). Écrit un mouvement CORRECTION. 409 LOT_REQUIS, 409 STOCK_LOT_NEGATIF, 404 si la fiche ou le lot est introuvable.",
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
      'Permissions : stock:read et stock:write. Succès : 200 (répété sur une fiche déjà archivée : sans effet). 404 si la fiche est introuvable. Archivage, jamais de suppression : la fiche sort des listes, de la vente et de la recherche publique, son journal est conservé. Une nouvelle saisie de la fiche (POST) la désarchive.',
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
      "Permissions : stock:read et stock:write. Succès : 200. Classeur .xlsx. mode=livraison (défaut) : feuille « Stock » (Médicament, Quantité (boîtes), Prix de la boîte (GNF), Date d'expiration (AAAA-MM-JJ), Lot, Coût d'achat de la boîte (GNF), Notes). mode=inventaire : feuille « Stock » (Médicament, Quantité comptée (boîtes), Unités en plus (boîte entamée), Lot, Date d'expiration (AAAA-MM-JJ)). Une ligne d'exemple et une feuille « Mode d'emploi ».",
  })
  async getModeleImportStock(
    @Param('structureId') structureId: string,
    @Req() req: RequestWithUser,
    @Query() options: ModeleImportStockDto,
  ): Promise<StreamableFile> {
    const mode = options.mode ?? 'livraison';
    const contenu = await this.pharmacieService.getModeleImportStock(
      structureId,
      req.user.userId,
      mode,
    );
    return new StreamableFile(contenu, {
      type: MIME_XLSX,
      disposition: `attachment; filename="${
        mode === 'inventaire'
          ? 'modele-inventaire-stock.xlsx'
          : 'modele-import-stock.xlsx'
      }"`,
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
      'Permissions : stock:read et stock:write, plus inventaire:write (mode inventaire) ou reception:write (mode livraison), 403 sinon. Succès : 200. Analyse le classeur (champ multipart `fichier`, .xlsx, 2 Mo et 1000 lignes max, 400 sinon) sans rien écrire. Champ multipart `mode` : inventaire (défaut, inventaire:write) ou livraison (reception:write) ; autre valeur : 400 VALIDATION. Livraison : date obligatoire sauf « sans péremption », jamais passée, quantiteAvant, quantiteApres et unitesRecues en unités, coûts retirés sans marge:read. Inventaire : une ligne par lot (numéro ou date de péremption), quantiteComptee, quantiteTheorique, ecart, sousTolerance, nouveauLot ; plusieurs lots sans précision : ligne rejetée avec la liste des lots.',
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
      "Permissions : stock:read et stock:write, plus inventaire:write (mode inventaire, défaut) ou reception:write (mode livraison), 403 sinon. Succès : 200. Refait l'analyse (mêmes limites, 400 sinon) puis écrit dans une transaction. Livraison : une réception (un lot par ligne acceptée), ventes faites sans stock rattachées, receptionId. Inventaire : un inventaire (commentaire « Import Excel »), un mouvement INVENTAIRE par lot compté, anomalie ECART_INVENTAIRE au-delà de la tolérance, ventes faites sans stock rattachées aux lots comptés, inventaireId. Les lignes refusées sont rejetées une par une, les autres écrites.",
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
