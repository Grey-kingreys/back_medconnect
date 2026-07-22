import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { StructureService } from './structure.service';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { RequirePermissions } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import {
  SetupStructureDto,
  CreateMembreDto,
  UpdateStructureDto,
} from './dto/structure.dto';

@ApiTags('Structures')
@Controller('structures')
export class StructureController {
  constructor(private readonly structureService: StructureService) { }

  // ─── Routes publiques (invitation) ────────────────────────────

  @Get('setup/:token')
  @ApiParam({ name: 'token', description: "Token d'invitation reçu par email" })
  @ApiOperation({
    summary: "Vérifier un token d'invitation",
    description:
      "Vérifie la validité du lien d'invitation. Appelé par le frontend avant d'afficher le formulaire de configuration.",
  })
  @ApiResponse({ status: 200, description: 'Token valide, retourne les infos de la structure' })
  @ApiResponse({ status: 401, description: 'Token invalide ou expiré' })
  verifyInviteToken(@Param('token') token: string) {
    return this.structureService.verifyInviteToken(token);
  }

  @Get('all')
  @ApiOperation({ summary: 'Lister toutes les structures', description: 'Retourne la liste de toutes les structures actives pour la carte.' })
  getAllStructures() {
    return this.structureService.getAllStructures();
  }

  @Get('public/:id')
  @ApiOperation({ summary: 'Détails publics', description: 'Retourne les détails et les professionnels actifs d\'une structure.' })
  getPublicStructureDetails(@Param('id') id: string) {
    return this.structureService.getPublicStructureDetails(id);
  }

  @Post('setup/:token')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'token', description: "Token d'invitation reçu par email" })
  @ApiOperation({
    summary: 'Configurer la structure',
    description:
      "L'admin de la structure complète son compte et les infos de sa structure. Retourne un JWT pour connexion directe.",
  })
  @ApiResponse({ status: 201, description: 'Espace configuré, JWT retourné' })
  @ApiResponse({ status: 401, description: 'Token invalide ou expiré' })
  @ApiResponse({ status: 409, description: 'Compte déjà existant avec cet email' })
  setupStructure(
    @Param('token') token: string,
    @Body() dto: SetupStructureDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.structureService.setupStructure(token, dto, res);
  }

  // ─── Routes protégées (STRUCTURE_ADMIN) ───────────────────────

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.STRUCTURE_READ)
  @Get('my')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ma structure', description: 'Retourne les infos de la structure de l\'admin connecté' })
  getMyStructure(@Req() req: any) {
    return this.structureService.getMyStructure(req.user.structureId);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.STRUCTURE_WRITE)
  @Patch('my')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Modifier ma structure' })
  updateStructure(@Req() req: any, @Body() dto: UpdateStructureDto) {
    return this.structureService.updateStructure(
      req.user.structureId,
      req.user.userId,
      dto,
    );
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.MEMBRE_READ)
  @Get(':structureId/membres')
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiOperation({
    summary: 'Lister les membres',
    description: 'Liste les médecins/pharmaciens de la structure',
  })
  getMembres(@Param('structureId') structureId: string, @Req() req: any) {
    return this.structureService.getMembres(structureId, req.user.userId);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.MEMBRE_MANAGE)
  @Post(':structureId/membres')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiOperation({
    summary: 'Créer un membre',
    description:
      'Crée un médecin ou pharmacien dans la structure. Un email avec les identifiants temporaires est envoyé.',
  })
  @ApiResponse({ status: 201, description: 'Membre créé, email envoyé' })
  @ApiResponse({ status: 409, description: 'Email déjà utilisé' })
  @ApiResponse({ status: 400, description: 'Rôle incompatible avec le type de structure' })
  createMembre(
    @Param('structureId') structureId: string,
    @Req() req: any,
    @Body() dto: CreateMembreDto,
  ) {
    return this.structureService.createMembre(structureId, req.user.userId, dto);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.MEMBRE_MANAGE)
  @Patch(':structureId/membres/:membreId/toggle-active')
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiParam({ name: 'membreId' })
  @ApiOperation({ summary: 'Activer/Désactiver un membre' })
  toggleMembreActive(
    @Param('structureId') structureId: string,
    @Param('membreId') membreId: string,
    @Req() req: any,
  ) {
    return this.structureService.toggleMembreActive(
      structureId,
      membreId,
      req.user.userId,
    );
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.MEMBRE_MANAGE)
  @Post(':structureId/membres/:membreId/delete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiParam({ name: 'structureId' })
  @ApiParam({ name: 'membreId' })
  @ApiOperation({ summary: 'Supprimer un membre' })
  deleteMembre(
    @Param('structureId') structureId: string,
    @Param('membreId') membreId: string,
    @Req() req: any,
  ) {
    return this.structureService.deleteMembre(
      structureId,
      membreId,
      req.user.userId,
    );
  }
}