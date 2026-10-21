import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  CACHE_CONFIG,
  CACHE_VERSION,
} from './configuration-publique.constants';
import { ConfigurationPubliqueService } from './configuration-publique.service';

/**
 * Routes publiques sans jeton, jamais bloquées par la garde de version (`/app/*`)
 * ni comptées par le limiteur (D28). Les réponses ne portent aucune donnée sensible.
 */
@ApiTags('Application mobile')
@SkipThrottle()
@Controller('app')
export class ConfigurationPubliqueController {
  constructor(private readonly service: ConfigurationPubliqueService) {}

  @Get('version')
  @Header('Cache-Control', CACHE_VERSION)
  @ApiOperation({
    summary:
      "Versions minimale et recommandée de l'application mobile, URL de téléchargement par plateforme (public)",
  })
  version() {
    return { success: true, data: this.service.versions() };
  }

  @Get('config')
  @Header('Cache-Control', CACHE_CONFIG)
  @ApiOperation({
    summary:
      "Configuration publique : numéros d'urgence, versions des CGU et de la politique de confidentialité, fonctions activées (public)",
  })
  config() {
    return { success: true, data: this.service.configuration() };
  }
}
