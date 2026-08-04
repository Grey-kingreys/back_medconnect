import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { createHash, randomInt } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from 'src/common/services/prisma.service';
import { SmsService } from 'src/common/services/sms.service';
import { REDIS_CLIENT } from 'src/common/redis/redis.module';

/**
 * Consentement d'accès assisté par l'accueil (rôle « Accueil »).
 *
 * Deux flux, un même effet : créer une `AutorisationStructure(patient, structure)`
 * APRÈS une preuve du consentement du patient — jamais accordée unilatéralement par
 * le personnel (enjeu RGPD / « le patient possède ses données »).
 *
 *  1. **Code court / QR** : le patient génère dans son app un code éphémère (usage
 *     unique, 2 min), affiché en clair + en QR ; l'accueil le saisit ou le scanne.
 *  2. **OTP par SMS** (patient sans smartphone) : l'accueil déclenche l'envoi d'un
 *     code au téléphone du patient ; le patient le dicte ; l'accueil le valide.
 *
 * Stockage éphémère dans Redis (TTL natif → auto-expiration). Le code/QR/OTP n'encode
 * qu'une valeur opaque : aucune donnée médicale n'y transite.
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  private readonly CODE_TTL_S = 120; // durée de vie d'un code de partage (QR)
  private readonly OTP_TTL_S = 300; // durée de vie d'un OTP SMS
  // Alphabet sans caractères ambigus (pas de 0/O, 1/I/L) — lisible et dictable.
  private readonly ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  private readonly CODE_LEN = 6;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
  ) {}

  private codeKey(code: string) {
    return `consent:code:${code}`;
  }
  private otpKey(patientId: string) {
    return `consent:otp:${patientId}`;
  }
  private hash(v: string) {
    return createHash('sha256').update(v).digest('hex');
  }

  private randomCode(): string {
    let out = '';
    for (let i = 0; i < this.CODE_LEN; i++) {
      out += this.ALPHABET[randomInt(this.ALPHABET.length)];
    }
    return out;
  }

  /** Variantes probables d'un même numéro (formats guinéens) pour le rapprochement. */
  private phoneCandidates(phone: string): string[] {
    const digits = phone.replace(/\D/g, '');
    const local9 = digits.slice(-9);
    return Array.from(
      new Set([phone.trim(), digits, local9, `224${local9}`, `+224${local9}`].filter(Boolean)),
    );
  }

  // ─── Flux 1 : code court / QR (généré par le patient) ─────────────

  async generateShareCode(patientId: string) {
    let code = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = this.randomCode();
      // SET NX EX : ne réutilise pas un code déjà actif.
      const ok = await this.redis.set(this.codeKey(candidate), patientId, 'EX', this.CODE_TTL_S, 'NX');
      if (ok) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new BadRequestException('Impossible de générer un code pour le moment, réessayez.');
    }
    const qrDataUrl = await QRCode.toDataURL(code, { width: 256, margin: 1 });
    return { code, qrDataUrl, expiresInSec: this.CODE_TTL_S };
  }

  async redeemShareCode(rawCode: string, structureId: string) {
    const code = rawCode.trim().toUpperCase();
    const key = this.codeKey(code);
    const patientId = await this.redis.get(key);
    if (!patientId) {
      throw new BadRequestException(
        'Code invalide ou expiré. Demandez au patient de régénérer un code.',
      );
    }
    // Usage unique : on consomme le code immédiatement.
    await this.redis.del(key);
    return this.grantAccess(patientId, structureId, 'code');
  }

  // ─── Flux 2 : OTP par SMS (déclenché par l'accueil) ───────────────

  async requestOtp(telephone: string, structureId: string) {
    const patient = await this.prisma.user.findFirst({
      where: { telephone: { in: this.phoneCandidates(telephone) }, role: 'PATIENT' },
      select: { id: true, nom: true, prenom: true, telephone: true },
    });
    if (!patient || !patient.telephone) {
      throw new NotFoundException(
        'Aucun patient avec ce numéro. Vérifiez le numéro ou proposez au patient de créer un compte.',
      );
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.redis.set(
      this.otpKey(patient.id),
      JSON.stringify({ h: this.hash(code), structureId }),
      'EX',
      this.OTP_TTL_S,
    );
    const structure = await this.prisma.structure.findUnique({
      where: { id: structureId },
      select: { nom: true },
    });
    const nomStruct = structure?.nom ?? 'la structure';
    await this.sms.sendSms(
      patient.telephone,
      `MedConnecte : code de partage de votre dossier = ${code} (valable 5 min). ` +
        `À ne communiquer qu'a l'accueil de ${nomStruct}.`,
    );
    // On renvoie le nom pour que l'accueil confirme l'identité du patient de vive voix.
    return {
      patientId: patient.id,
      nom: patient.nom,
      prenom: patient.prenom,
      expiresInSec: this.OTP_TTL_S,
      message: `Code envoyé au ${patient.prenom} ${patient.nom}. Demandez-lui de vous le lire.`,
    };
  }

  async verifyOtp(patientId: string, rawCode: string, structureId: string) {
    const raw = await this.redis.get(this.otpKey(patientId));
    if (!raw) {
      throw new BadRequestException('Code expiré ou inexistant. Renvoyez un nouveau code.');
    }
    const { h, structureId: sid } = JSON.parse(raw) as { h: string; structureId: string };
    if (sid !== structureId) {
      throw new ForbiddenException('Ce code a été émis pour une autre structure.');
    }
    if (this.hash(rawCode.trim()) !== h) {
      throw new BadRequestException('Code incorrect.');
    }
    await this.redis.del(this.otpKey(patientId));
    return this.grantAccess(patientId, structureId, 'otp');
  }

  // ─── Effet commun : accorder l'accès (idempotent) ─────────────────

  private async grantAccess(patientId: string, structureId: string, via: 'code' | 'otp') {
    const patient = await this.prisma.user.findUnique({
      where: { id: patientId },
      select: { id: true, nom: true, prenom: true, role: true },
    });
    if (!patient || patient.role !== 'PATIENT') {
      throw new BadRequestException('Patient introuvable.');
    }
    const existing = await this.prisma.autorisationStructure.findFirst({
      where: { patientId, structureId },
      select: { id: true },
    });
    const dejaAutorisee = !!existing;
    if (!existing) {
      await this.prisma.autorisationStructure.create({ data: { patientId, structureId } });
    }
    this.logger.log(
      `Consentement d'accès enregistré (via ${via}) : patient=${patientId} structure=${structureId}` +
        (dejaAutorisee ? ' [déjà autorisée]' : ''),
    );
    return {
      success: true,
      dejaAutorisee,
      message: dejaAutorisee
        ? 'Cette structure avait déjà accès au dossier.'
        : 'Accès au dossier autorisé par le patient.',
      patient: { id: patient.id, nom: patient.nom, prenom: patient.prenom },
    };
  }
}
