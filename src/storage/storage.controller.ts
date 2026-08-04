import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { StorageService } from './storage.service';
import { FileAccessService, RequestUser } from './file-access.service';
import { StorageVisibility, PRESIGNED_READ_TTL } from './storage.constants';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';

/**
 * Endpoints de stockage objets (Cloudflare R2), upload direct par URL présignée :
 * le fichier ne transite jamais par l'API.
 *
 * Flux : POST /storage/presign (crée un StoredFile `pending` + URL PUT) → le client
 * téléverse sur R2 → POST /storage/confirm (vérifie + passe en `confirmed`).
 * Lecture d'un document privé : GET /storage/:id/read-url (contrôle d'accès + audit).
 */
@ApiTags('Stockage (R2)')
@Controller('storage')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class StorageController {
  constructor(
    private readonly storage: StorageService,
    private readonly fileAccess: FileAccessService,
  ) {}

  @Post('presign')
  @Throttle({ default: { limit: 30, ttl: 60_000 } }) // Palier lourd : ~30 uploads/min/utilisateur.
  @ApiOperation({ summary: 'Obtenir une URL présignée pour téléverser un fichier' })
  async presign(@Req() req: any, @Body() dto: PresignUploadDto) {
    const ticket = await this.storage.createUploadTicket({
      ownerId: req.user.userId,
      prefix: dto.prefix,
      filename: dto.filename,
      contentType: dto.contentType,
      visibility: dto.visibility as StorageVisibility,
      size: dto.size,
    });
    return { success: true, data: ticket };
  }

  @Post('confirm')
  @ApiOperation({ summary: 'Confirmer un upload présigné (passe le fichier en « confirmed »)' })
  async confirm(@Req() req: any, @Body() dto: ConfirmUploadDto) {
    const file = await this.storage.confirmUpload({ id: dto.id, ownerId: req.user.userId });
    return { success: true, data: file };
  }

  @Get(':id/read-url')
  @ApiOperation({ summary: "Obtenir une URL de lecture (présignée si document privé)" })
  async readUrl(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const file = await this.storage.getStoredFileOrThrow(id);
    const user: RequestUser = req.user;

    // Fichier public : URL CDN pérenne, aucun secret, pas de contrôle d'accès.
    if (file.url) {
      return { success: true, data: { url: file.url, expiresIn: null } };
    }

    // Fichier privé (document médical) : autorisation OBLIGATOIRE avant toute URL.
    await this.fileAccess.assertCanReadPrivate(user, file, req.ip);
    const url = await this.storage.getSignedReadUrl(file.key);
    await this.fileAccess.auditPrivateRead(user.userId, file, req.ip);
    return { success: true, data: { url, expiresIn: PRESIGNED_READ_TTL } };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer un fichier (propriétaire ou administration)' })
  async remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    await this.storage.deleteStoredFile({ id, requester: req.user });
    return { success: true };
  }
}
