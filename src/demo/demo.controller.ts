import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from 'src/auth/auth.service';
import { lireInfosClient } from 'src/auth/client';
import { DemoService } from './demo.service';
import { ConnexionDemoDto } from './dto/connexion-demo.dto';

/** Même palier que l'inscription et la connexion : 10 requêtes par minute et par IP. */
const DEMO_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/**
 * Routes du mode démo, publiques. Mode inactif (`DEMO_MODE` différent de `true`) :
 * 404 sur les deux routes, comme si elles n'existaient pas.
 */
@ApiTags('Authentification')
@Controller('auth/demo')
export class DemoController {
  constructor(
    private readonly demoService: DemoService,
    private readonly authService: AuthService,
  ) {}

  @Get('comptes')
  @ApiOperation({
    summary: 'Comptes de démonstration',
    description:
      'Liste des comptes démo, triée par rôle puis par nom (mode démo uniquement)',
  })
  @ApiResponse({ status: 200, description: 'Liste des comptes démo' })
  @ApiResponse({ status: 404, description: 'Mode démo inactif' })
  listerComptes() {
    return this.demoService.listerComptes();
  }

  @Post('connexion')
  @Throttle(DEMO_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Connexion à un compte de démonstration',
    description:
      'Même réponse et même cookie de refresh que POST /auth/login (mode démo uniquement)',
  })
  @ApiResponse({ status: 200, description: 'Connexion réussie' })
  @ApiResponse({ status: 403, description: 'Compte absent ou non démo' })
  @ApiResponse({ status: 404, description: 'Mode démo inactif' })
  @ApiHeader({
    name: 'X-Client',
    required: false,
    description:
      "« mobile » pour l'application mobile : refresh renvoyé dans le JSON (refreshToken, expiresIn, sessionId), sans cookie ; deviceId et plateforme obligatoires. Absent : web, refresh dans le cookie httpOnly.",
  })
  connexion(
    @Body() dto: ConnexionDemoDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    this.demoService.assurerModeActif();
    return this.authService.connexionDemo(
      dto.userId,
      res,
      lireInfosClient(req, dto),
    );
  }
}
