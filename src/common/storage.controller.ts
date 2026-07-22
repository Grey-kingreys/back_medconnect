import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { AuthGuard } from './guards/auth.guard';
import { StorageService } from './services/storage.service';
import { PresignUploadDto } from './dto/storage.dto';

/**
 * Endpoints d'upload direct vers S3/MinIO via URLs présignées :
 * le fichier ne transite jamais par l'API (économie de bande passante/CPU).
 * Flux : client → POST /storage/upload-url → PUT direct sur S3 → enregistrer la `key`.
 */
@ApiTags('Stockage')
@Controller('storage')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post('upload-url')
  @Throttle({ default: { limit: 30, ttl: 60_000 } }) // Palier lourd : ~30 uploads/min/user.
  @ApiOperation({ summary: 'Obtenir une URL présignée pour téléverser un fichier' })
  async getUploadUrl(@Req() req: any, @Body() dto: PresignUploadDto) {
    const category = dto.category || 'documents';
    const safeName = dto.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    // Clé namespacée par utilisateur, non devinable (UUID).
    const key = `${category}/${req.user.userId}/${randomUUID()}-${safeName}`;
    const { url } = await this.storage.getPresignedUploadUrl(key, dto.contentType);
    return { success: true, data: { key, uploadUrl: url } };
  }

  @Get('download-url')
  @ApiOperation({ summary: 'Obtenir une URL présignée de téléchargement pour une clé' })
  async getDownloadUrl(@Query('key') key: string) {
    const url = await this.storage.getPresignedDownloadUrl(key);
    return { success: true, data: { url } };
  }
}
