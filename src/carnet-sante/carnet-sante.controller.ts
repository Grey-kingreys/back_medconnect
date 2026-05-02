import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { CarnetSanteService } from './carnet-sante.service';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import {
  UpsertProfilMedicalDto,
  CreateConsultationDto,
  CreateOrdonnanceDto,
  CreateResultatAnalyseDto,
  CreateVaccinationDto,
  CreateAutoDiagnosticDto,
  AutoDiagnosticResponseDto,
  CreateRendezVousDto,
} from './dto/carnet-sante.dto';
import { plainToInstance } from 'class-transformer';

@ApiTags('Carnet de Santé')
@Controller('carnet-sante')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class CarnetSanteController {
  constructor(private readonly carnetSanteService: CarnetSanteService) { }

  // ─── Résumé global ────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Résumé du carnet de santé',
    description: 'Retourne le profil médical + les statistiques du carnet.',
  })
  getResume(@Req() req: any) {
    return this.carnetSanteService.getResume(req.user.userId);
  }

  // ─── Vue Médecin : Carnet d'un patient ────────────────────────

  @Get('patient/:patientId')
  @Roles('MEDECIN', 'STRUCTURE_ADMIN')
  @ApiParam({ name: 'patientId', description: 'ID du patient' })
  @ApiOperation({ summary: 'Voir le carnet d\'un patient (médecin traitant ou structure)' })
  async getPatientCarnet(@Req() req: any, @Param('patientId') patientId: string) {
    return this.carnetSanteService.getPatientCarnetForDoctor(req.user.userId, patientId, req.user.structureId);
  }

  // ─── Profil Médical ───────────────────────────────────────────

  @Get('profil-medical')
  @ApiOperation({ summary: 'Mon profil médical' })
  getProfilMedical(@Req() req: any) {
    return this.carnetSanteService.getProfilMedical(req.user.userId);
  }

  @Post('profil-medical')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Créer/Mettre à jour le profil médical',
    description: 'Upsert — crée si inexistant, met à jour sinon.',
  })
  upsertProfilMedical(@Req() req: any, @Body() dto: UpsertProfilMedicalDto) {
    return this.carnetSanteService.upsertProfilMedical(req.user.userId, dto);
  }

  // ─── Consultations ────────────────────────────────────────────

  @Get('consultations')
  @ApiOperation({ summary: 'Mes consultations' })
  getConsultations(@Req() req: any) {
    return this.carnetSanteService.getConsultations(req.user.userId);
  }

  @Get('consultations/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: "Détails d'une consultation" })
  getConsultation(@Req() req: any, @Param('id') id: string) {
    return this.carnetSanteService.getConsultation(req.user.userId, id);
  }

  @Post('consultations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ajouter une consultation' })
  @ApiResponse({ status: 201, description: 'Consultation ajoutée' })
  createConsultation(@Req() req: any, @Body() dto: CreateConsultationDto) {
    return this.carnetSanteService.createConsultation(req.user.userId, dto, req.user.structureId);
  }

  @Delete('consultations/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Supprimer une consultation' })
  deleteConsultation(@Req() req: any, @Param('id') id: string) {
    return this.carnetSanteService.deleteConsultation(req.user.userId, id);
  }

  // ─── Ordonnances ──────────────────────────────────────────────

  @Get('ordonnances')
  @ApiOperation({ summary: 'Mes ordonnances' })
  getOrdonnances(@Req() req: any) {
    return this.carnetSanteService.getOrdonnances(req.user.userId);
  }

  @Post('ordonnances')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ajouter une ordonnance' })
  createOrdonnance(@Req() req: any, @Body() dto: CreateOrdonnanceDto) {
    return this.carnetSanteService.createOrdonnance(req.user.userId, dto, req.user.structureId);
  }

  @Delete('ordonnances/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Supprimer une ordonnance' })
  deleteOrdonnance(@Req() req: any, @Param('id') id: string) {
    return this.carnetSanteService.deleteOrdonnance(req.user.userId, id);
  }

  // ─── Résultats d'analyses ─────────────────────────────────────

  @Get('analyses')
  @ApiOperation({ summary: "Mes résultats d'analyses" })
  getAnalyses(@Req() req: any) {
    return this.carnetSanteService.getAnalyses(req.user.userId);
  }

  @Post('analyses')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Ajouter un résultat d'analyse" })
  createAnalyse(@Req() req: any, @Body() dto: CreateResultatAnalyseDto) {
    return this.carnetSanteService.createAnalyse(req.user.userId, dto, req.user.structureId);
  }

  @Delete('analyses/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: "Supprimer un résultat d'analyse" })
  deleteAnalyse(@Req() req: any, @Param('id') id: string) {
    return this.carnetSanteService.deleteAnalyse(req.user.userId, id);
  }

  // ─── Vaccinations ─────────────────────────────────────────────

  @Get('vaccinations')
  @ApiOperation({ summary: 'Mon carnet vaccinal' })
  getVaccinations(@Req() req: any) {
    return this.carnetSanteService.getVaccinations(req.user.userId);
  }

  @Post('vaccinations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ajouter une vaccination' })
  createVaccination(@Req() req: any, @Body() dto: CreateVaccinationDto) {
    return this.carnetSanteService.createVaccination(req.user.userId, dto, req.user.structureId);
  }

  @Delete('vaccinations/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Supprimer une vaccination' })
  deleteVaccination(@Req() req: any, @Param('id') id: string) {
    return this.carnetSanteService.deleteVaccination(req.user.userId, id);
  }

  // ─── Rendez-vous ──────────────────────────────────────────────

  @Get('rendez-vous')
  @ApiOperation({ summary: 'Mes rendez-vous' })
  getRendezVous(@Req() req: any) {
    return this.carnetSanteService.getRendezVous(req.user.userId, req.user.role);
  }

  @Post('rendez-vous')
  @HttpCode(HttpStatus.CREATED)
  @Roles('MEDECIN', 'STRUCTURE_ADMIN')
  @ApiOperation({ summary: 'Programmer un rendez-vous (Médecin)' })
  createRendezVous(@Req() req: any, @Body() dto: CreateRendezVousDto) {
    return this.carnetSanteService.createRendezVous(req.user.userId, dto, req.user.structureId);
  }

  @Post('rendez-vous/:id/status')
  @ApiOperation({ summary: 'Mettre à jour le statut d\'un rendez-vous' })
  updateRendezVousStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.carnetSanteService.updateRendezVousStatus(id, status);
  }

  // ─── Auto-diagnostics ─────────────────────────────────────────

  @Get('auto-diagnostics')
  @ApiOperation({ summary: 'Historique des auto-diagnostics' })
  async getAutoDiagnostics(@Req() req: any) {
    const res = await this.carnetSanteService.getAutoDiagnostics(req.user.userId);
    return {
      ...res,
      data: plainToInstance(AutoDiagnosticResponseDto, res.data, { excludeExtraneousValues: true }),
    };
  }

  @Post('auto-diagnostics')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Lancer un auto-diagnostic IA',
    description:
      'Enregistre les symptômes et lance l\'analyse IA. ⚠️ Non substitutable à une consultation médicale.',
  })
  async createAutoDiagnostic(@Req() req: any, @Body() dto: CreateAutoDiagnosticDto) {
    const res = await this.carnetSanteService.createAutoDiagnostic(req.user.userId, dto);
    return {
      ...res,
      data: plainToInstance(AutoDiagnosticResponseDto, res.data, { excludeExtraneousValues: true }),
    };
  }
}