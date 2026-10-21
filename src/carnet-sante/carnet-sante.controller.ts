// Dette de typage préexistante, backlog points 21 et 22

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
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { RequestWithUser } from 'src/auth/jwt.strategy';
import { CarnetSanteService } from './carnet-sante.service';
import { LimitePermissiveSiRedisIndisponible } from 'src/common/decorators/limite-permissive.decorator';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { RequirePermissions } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import {
  UpsertProfilMedicalDto,
  CreateConsultationDto,
  CreateOrdonnanceDto,
  CreateResultatAnalyseDto,
  CreateVaccinationDto,
  CreateAutoDiagnosticDto,
  AutoDiagnosticResponseDto,
  CreateRendezVousDto,
  CreateUrgenceDto,
  UpdateUrgenceStatusDto,
  TakeChargeUrgenceDto,
  AiEmergencyRequestDto,
  UpdateRendezVousStatusDto,
} from './dto/carnet-sante.dto';
import { plainToInstance } from 'class-transformer';

@ApiTags('Carnet de Santé')
@Controller('carnet-sante')
@UseGuards(AuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CarnetSanteController {
  constructor(private readonly carnetSanteService: CarnetSanteService) {}

  // ─── Résumé global ────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Résumé du carnet de santé',
    description: 'Retourne le profil médical + les statistiques du carnet.',
  })
  getResume(@Req() req: RequestWithUser) {
    return this.carnetSanteService.getResume(req.user.userId);
  }

  // ─── Vue Médecin : Carnet d'un patient ────────────────────────

  @Get('patient/:patientId')
  @RequirePermissions(PERMISSIONS.CARNET_READ)
  @ApiParam({ name: 'patientId', description: 'ID du patient' })
  @ApiOperation({
    summary: "Voir le carnet d'un patient (médecin traitant ou structure)",
  })
  async getPatientCarnet(
    @Req() req: RequestWithUser,
    @Param('patientId') patientId: string,
  ) {
    return this.carnetSanteService.getPatientCarnetForDoctor(
      req.user.userId,
      patientId,
      req.user.structureId ?? undefined,
    );
  }

  // ─── Profil Médical ───────────────────────────────────────────

  @Get('profil-medical')
  @ApiOperation({ summary: 'Mon profil médical' })
  getProfilMedical(@Req() req: RequestWithUser) {
    return this.carnetSanteService.getProfilMedical(req.user.userId);
  }

  @Post('profil-medical')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Créer/Mettre à jour le profil médical',
    description: 'Upsert — crée si inexistant, met à jour sinon.',
  })
  upsertProfilMedical(
    @Req() req: RequestWithUser,
    @Body() dto: UpsertProfilMedicalDto,
  ) {
    return this.carnetSanteService.upsertProfilMedical(req.user.userId, dto);
  }

  // ─── Consultations ────────────────────────────────────────────

  @Get('consultations')
  @ApiOperation({ summary: 'Mes consultations' })
  getConsultations(@Req() req: RequestWithUser) {
    return this.carnetSanteService.getConsultations(
      req.user.userId,
      req.user.role,
    );
  }

  @Get('consultations/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: "Détails d'une consultation" })
  getConsultation(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.carnetSanteService.getConsultation(req.user.userId, id);
  }

  @Post('consultations')
  @RequirePermissions(PERMISSIONS.CONSULTATION_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ajouter une consultation' })
  @ApiResponse({ status: 201, description: 'Consultation ajoutée' })
  createConsultation(
    @Req() req: RequestWithUser,
    @Body() dto: CreateConsultationDto,
  ) {
    return this.carnetSanteService.createConsultation(
      req.user.userId,
      dto,
      req.user.structureId ?? undefined,
    );
  }

  @Delete('consultations/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Supprimer une consultation' })
  deleteConsultation(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.carnetSanteService.deleteConsultation(req.user.userId, id);
  }

  // ─── Ordonnances ──────────────────────────────────────────────

  @Get('ordonnances')
  @ApiOperation({ summary: 'Mes ordonnances' })
  getOrdonnances(@Req() req: RequestWithUser) {
    return this.carnetSanteService.getOrdonnances(req.user.userId);
  }

  @Post('ordonnances')
  @RequirePermissions(PERMISSIONS.ORDONNANCE_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ajouter une ordonnance' })
  createOrdonnance(
    @Req() req: RequestWithUser,
    @Body() dto: CreateOrdonnanceDto,
  ) {
    return this.carnetSanteService.createOrdonnance(
      req.user.userId,
      dto,
      req.user.structureId ?? undefined,
    );
  }

  @Delete('ordonnances/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Supprimer une ordonnance' })
  deleteOrdonnance(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.carnetSanteService.deleteOrdonnance(req.user.userId, id);
  }

  // ─── Résultats d'analyses ─────────────────────────────────────

  @Get('analyses')
  @ApiOperation({ summary: "Mes résultats d'analyses" })
  getAnalyses(@Req() req: RequestWithUser) {
    return this.carnetSanteService.getAnalyses(req.user.userId);
  }

  @Post('analyses')
  @RequirePermissions(PERMISSIONS.ANALYSE_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Ajouter un résultat d'analyse" })
  createAnalyse(
    @Req() req: RequestWithUser,
    @Body() dto: CreateResultatAnalyseDto,
  ) {
    return this.carnetSanteService.createAnalyse(
      req.user.userId,
      dto,
      req.user.structureId ?? undefined,
    );
  }

  @Delete('analyses/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: "Supprimer un résultat d'analyse" })
  deleteAnalyse(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.carnetSanteService.deleteAnalyse(req.user.userId, id);
  }

  // ─── Vaccinations ─────────────────────────────────────────────

  @Get('vaccinations')
  @ApiOperation({ summary: 'Mon carnet vaccinal' })
  getVaccinations(@Req() req: RequestWithUser) {
    return this.carnetSanteService.getVaccinations(req.user.userId);
  }

  @Post('vaccinations')
  @RequirePermissions(PERMISSIONS.VACCINATION_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Ajouter une vaccination' })
  createVaccination(
    @Req() req: RequestWithUser,
    @Body() dto: CreateVaccinationDto,
  ) {
    return this.carnetSanteService.createVaccination(
      req.user.userId,
      dto,
      req.user.structureId ?? undefined,
    );
  }

  @Delete('vaccinations/:id')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Supprimer une vaccination' })
  deleteVaccination(@Req() req: RequestWithUser, @Param('id') id: string) {
    return this.carnetSanteService.deleteVaccination(req.user.userId, id);
  }

  // ─── Rendez-vous ──────────────────────────────────────────────

  @Get('rendez-vous')
  @ApiOperation({ summary: 'Mes rendez-vous' })
  getRendezVous(@Req() req: RequestWithUser) {
    return this.carnetSanteService.getRendezVous(
      req.user.userId,
      req.user.role,
      req.user.structureId ?? undefined,
    );
  }

  @Post('rendez-vous')
  @RequirePermissions(PERMISSIONS.RENDEZVOUS_WRITE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Programmer un rendez-vous (médecin ou accueil)' })
  createRendezVous(
    @Req() req: RequestWithUser,
    @Body() dto: CreateRendezVousDto,
  ) {
    return this.carnetSanteService.createRendezVous(
      req.user.userId,
      req.user.role,
      dto,
      req.user.structureId ?? undefined,
    );
  }

  @Post('rendez-vous/:id/valider')
  @RequirePermissions(PERMISSIONS.RENDEZVOUS_WRITE)
  @ApiOperation({ summary: 'Valider un rendez-vous en attente (médecin)' })
  validerRendezVous(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.carnetSanteService.respondToRendezVous(
      id,
      req.user.userId,
      req.user.role,
      req.user.structureId ?? undefined,
      'valider',
    );
  }

  @Post('rendez-vous/:id/refuser')
  @RequirePermissions(PERMISSIONS.RENDEZVOUS_WRITE)
  @ApiOperation({ summary: 'Refuser un rendez-vous en attente (médecin)' })
  refuserRendezVous(@Param('id') id: string, @Req() req: RequestWithUser) {
    return this.carnetSanteService.respondToRendezVous(
      id,
      req.user.userId,
      req.user.role,
      req.user.structureId ?? undefined,
      'refuser',
    );
  }

  @Post('rendez-vous/:id/status')
  @ApiOperation({ summary: "Mettre à jour le statut d'un rendez-vous" })
  @ApiResponse({
    status: 409,
    description:
      'Annulation impossible depuis le statut actuel (code TRANSITION_INTERDITE).',
  })
  updateRendezVousStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRendezVousStatusDto,
    @Req() req: RequestWithUser,
  ) {
    return this.carnetSanteService.updateRendezVousStatus(
      id,
      dto.status,
      req.user.userId,
      req.user.structureId ?? undefined,
    );
  }

  // ─── Auto-diagnostics ─────────────────────────────────────────

  @Get('auto-diagnostics')
  @ApiOperation({ summary: 'Historique des auto-diagnostics' })
  async getAutoDiagnostics(@Req() req: RequestWithUser) {
    const res = await this.carnetSanteService.getAutoDiagnostics(
      req.user.userId,
    );
    return {
      ...res,
      data: plainToInstance(AutoDiagnosticResponseDto, res.data, {
        excludeExtraneousValues: true,
      }),
    };
  }

  @Post('auto-diagnostics')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } }) // IA coûteuse : ~10/h/user.
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Lancer un auto-diagnostic IA',
    description:
      "Enregistre les symptômes et lance l'analyse IA. ⚠️ Non substitutable à une consultation médicale.",
  })
  async createAutoDiagnostic(
    @Req() req: RequestWithUser,
    @Body() dto: CreateAutoDiagnosticDto,
  ) {
    const res = await this.carnetSanteService.createAutoDiagnostic(
      req.user.userId,
      dto,
    );
    return {
      ...res,
      data: plainToInstance(AutoDiagnosticResponseDto, res.data, {
        excludeExtraneousValues: true,
      }),
    };
  }

  // ─── Urgences (SOS) ──────────────────────────────────────────

  @Post('sos')
  // Anti-spam SOS : 5 par heure et par utilisateur ; laissé passer si Redis est indisponible.
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @LimitePermissiveSiRedisIndisponible()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Lancer une alerte SOS' })
  @ApiResponse({
    status: 403,
    description: 'Compte non patient (code SOS_ROLE_INTERDIT).',
  })
  @ApiResponse({
    status: 409,
    description:
      'Alerte déjà en cours (code SOS_DEJA_ACTIF, donnees.peutRelancerA).',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Clé unique par alerte (8 à 128 caractères parmi lettres, chiffres, . _ : -), par exemple un UUID. Un renvoi avec la même clé dans les 24 h renvoie la même alerte sans nouvelle diffusion. Clé mal formée : ignorée.',
  })
  createUrgence(
    @Req() req: RequestWithUser,
    @Body() dto: CreateUrgenceDto,
    @Headers('idempotency-key') enTeteIdempotence?: string,
  ) {
    // Un soignant victime d'un malaise utilise son compte patient (plan mobile, B33).
    if (req.user.role !== 'PATIENT') {
      throw new ForbiddenException({
        message:
          "L'alerte SOS est réservée aux comptes patients. En cas d'urgence, appelez directement les secours ou connectez-vous avec votre compte patient.",
        code: 'SOS_ROLE_INTERDIT',
      });
    }
    return this.carnetSanteService.createUrgence(
      req.user.userId,
      dto,
      enTeteIdempotence,
    );
  }

  @Get('sos/en-cours')
  @ApiOperation({
    summary: 'Alerte SOS en cours du patient connecté',
    description:
      "Dernière alerte LANCE ou PRIS_EN_CHARGE du patient, avec la structure qui intervient, la fin du délai d'arrivée (finDelaiAt) et l'heure à partir de laquelle une nouvelle alerte est possible (peutRelancerA). data = null si aucune.",
  })
  getUrgenceEnCours(@Req() req: { user: { userId: string } }) {
    return this.carnetSanteService.getUrgenceEnCours(req.user.userId);
  }

  @Post('sos/:id/take-charge')
  @RequirePermissions(PERMISSIONS.SOS_RESPOND)
  @ApiOperation({
    summary: "Prendre en charge une alerte SOS en annonçant le délai d'arrivée",
  })
  takeCharge(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
    @Body() dto: TakeChargeUrgenceDto,
  ) {
    return this.carnetSanteService.takeCharge(id, req.user.userId, dto);
  }

  @Get('sos/actives')
  @RequirePermissions(PERMISSIONS.SOS_RESPOND)
  @ApiOperation({ summary: 'Voir les urgences actives (Hôpitaux/Admin)' })
  getActiveUrgences() {
    return this.carnetSanteService.getActiveUrgences();
  }

  @Post('sos/:id/status')
  @RequirePermissions(PERMISSIONS.SOS_RESPOND)
  @ApiOperation({ summary: "Mettre à jour le statut d'une urgence" })
  updateUrgenceStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUrgenceStatusDto,
  ) {
    return this.carnetSanteService.updateUrgenceStatus(id, dto.status);
  }

  @Post('sos/ai-instructions')
  @ApiOperation({
    summary: 'Obtenir des instructions de premiers secours via IA',
  })
  getAiEmergencyInstructions(@Body() dto: AiEmergencyRequestDto) {
    return this.carnetSanteService.getAiEmergencyInstructions(dto);
  }
}
