import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { SuperAdminService } from './super-admin.service';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateStructureDto } from './dto/super-admin.dto';

@ApiTags('Super Admin')
@Controller('super-admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@ApiBearerAuth()
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) { }

  // ─── Structures ───────────────────────────────────────────────

  @Post('structures')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Créer une structure',
    description:
      'Crée un hôpital/clinique/pharmacie et envoie automatiquement un email d\'invitation à l\'admin de la structure.',
  })
  @ApiResponse({ status: 201, description: 'Structure créée, email envoyé' })
  @ApiResponse({ status: 409, description: 'Email déjà utilisé par une structure' })
  createStructure(@Body() dto: CreateStructureDto) {
    return this.superAdminService.createStructure(dto);
  }

  @Get('structures')
  @ApiOperation({ summary: 'Lister toutes les structures' })
  getStructures() {
    return this.superAdminService.getStructures();
  }

  @Get('structures/:structureId')
  @ApiParam({ name: 'structureId' })
  @ApiOperation({ summary: "Détails d'une structure" })
  getStructure(@Param('structureId') structureId: string) {
    return this.superAdminService.getStructure(structureId);
  }

  @Post('structures/:structureId/resend-invitation')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'structureId' })
  @ApiOperation({
    summary: 'Renvoyer l\'invitation',
    description: 'Génère un nouveau token et renvoie l\'email d\'invitation à la structure.',
  })
  resendInvitation(@Param('structureId') structureId: string) {
    return this.superAdminService.resendInvitation(structureId);
  }

  @Patch('structures/:structureId/toggle-active')
  @ApiParam({ name: 'structureId' })
  @ApiOperation({ summary: 'Activer/Désactiver une structure' })
  toggleActive(@Param('structureId') structureId: string) {
    return this.superAdminService.toggleActive(structureId);
  }

  // ─── Stats globales ───────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Statistiques globales de la plateforme' })
  getStats() {
    return this.superAdminService.getStats();
  }
}