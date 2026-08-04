import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { RequirePermissions } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { ConsentService } from './consent.service';
import { RedeemCodeDto, RequestOtpDto, VerifyOtpDto } from './dto/consent.dto';

/**
 * Consentement d'accès au dossier, assisté par l'accueil d'une structure.
 *
 * - Côté **patient** : génération d'un code/QR de partage (self-service).
 * - Côté **accueil** (personnel avec `patient:read` + rattaché à une structure) :
 *   validation du code présenté / envoi+validation d'un OTP SMS.
 *
 * On réutilise `patient:read` comme droit « poste d'accueil / orientation » : la
 * vraie garantie de sécurité est la **preuve de consentement du patient** (code/OTP),
 * pas la permission du personnel.
 */
@ApiTags("Consentement d'accès")
@Controller('consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  private structureIdOf(req: any): string {
    const structureId = req.user?.structureId;
    if (!structureId) {
      throw new ForbiddenException("Action réservée au personnel d'une structure.");
    }
    return structureId;
  }

  // ─── Patient ──────────────────────────────────────────────────────

  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Post('code')
  @ApiOperation({ summary: 'Générer un code/QR de partage de mon dossier (patient)' })
  generateCode(@Req() req: any) {
    return this.consentService.generateShareCode(req.user.userId);
  }

  // ─── Accueil ──────────────────────────────────────────────────────

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PATIENT_READ)
  @ApiBearerAuth()
  @Post('redeem')
  @ApiOperation({ summary: 'Enregistrer le consentement via un code présenté par le patient (accueil)' })
  redeem(@Req() req: any, @Body() dto: RedeemCodeDto) {
    return this.consentService.redeemShareCode(dto.code, this.structureIdOf(req));
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PATIENT_READ)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // anti-spam SMS : 5 envois/min/accueil
  @Post('otp/request')
  @ApiOperation({ summary: 'Envoyer un code de partage par SMS au patient (accueil)' })
  requestOtp(@Req() req: any, @Body() dto: RequestOtpDto) {
    return this.consentService.requestOtp(dto.telephone, this.structureIdOf(req));
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PATIENT_READ)
  @ApiBearerAuth()
  @Post('otp/verify')
  @ApiOperation({ summary: 'Valider le code SMS dicté par le patient (accueil)' })
  verifyOtp(@Req() req: any, @Body() dto: VerifyOtpDto) {
    return this.consentService.verifyOtp(dto.patientId, dto.code, this.structureIdOf(req));
  }
}
