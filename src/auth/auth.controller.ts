// Dette de typage préexistante, backlog points 21 et 22
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { lireInfosClient, typeClient } from './client';
import { SessionClientType } from 'generated/prisma/enums';
import { MESSAGES_SESSION, NOM_COOKIE_REFRESH } from './sessions.constants';
import { SessionsService } from './sessions.service';
import { JetonRenouvellementDto } from './dto/jeton-renouvellement.dto';
import { suivreParIp } from 'src/common/guards/user-throttler.guard';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto';

/** Palier strict pour les endpoints sensibles d'auth : 10 req/min par IP, même avec un jeton. */
const AUTH_THROTTLE = {
  default: { limit: 10, ttl: 60_000, getTracker: suivreParIp },
};

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Inscription patient',
    description: 'Crée un compte patient (accès public)',
  })
  @ApiResponse({ status: 201, description: 'Compte créé' })
  @ApiResponse({ status: 409, description: 'Email déjà utilisé' })
  @ApiHeader({
    name: 'X-Client',
    required: false,
    description:
      "« mobile » pour l'application mobile : refresh renvoyé dans le JSON (refreshToken, expiresIn, sessionId), sans cookie ; deviceId et plateforme obligatoires. Absent : web, refresh dans le cookie httpOnly.",
  })
  @Throttle(AUTH_THROTTLE)
  register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    return this.authService.register(dto, res, lireInfosClient(req, dto));
  }

  @Post('login')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Connexion',
    description: 'Authentifie un utilisateur (tous rôles)',
  })
  @ApiResponse({ status: 200, description: 'Connexion réussie' })
  @ApiResponse({ status: 401, description: 'Email ou mot de passe incorrect' })
  @ApiHeader({
    name: 'X-Client',
    required: false,
    description:
      "« mobile » pour l'application mobile : refresh renvoyé dans le JSON (refreshToken, expiresIn, sessionId), sans cookie ; deviceId et plateforme obligatoires. Absent : web, refresh dans le cookie httpOnly.",
  })
  login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: any,
  ) {
    // req.ip fiable car `trust proxy` est configuré dans main.ts (derrière Caddy).
    return this.authService.login(dto, res, req.ip, lireInfosClient(req, dto));
  }

  @UseGuards(AuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mon profil',
    description: "Retourne le profil de l'utilisateur connecté",
  })
  getMe(@Req() req: any) {
    return this.authService.getMe(req.user.userId);
  }

  @UseGuards(AuthGuard)
  @Patch('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Modifier mon profil' })
  editProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.authService.editProfile(req.user.userId, dto);
  }

  @UseGuards(AuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Changer mon mot de passe' })
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.userId, dto, req.user.sid);
  }

  @UseGuards(AuthGuard)
  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mes appareils connectés' })
  async listerSessions(@Req() req: any) {
    const data = await this.sessions.lister(req.user.userId, req.user.sid);
    return { data, message: 'Appareils connectés récupérés', success: true };
  }

  @UseGuards(AuthGuard)
  @Post('sessions/revoquer-autres')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Déconnecter mes autres appareils' })
  async revoquerAutres(@Req() req: any) {
    const nombre = await this.sessions.revoquerAutres(
      req.user.userId,
      req.user.sid,
      'REVOCATION_UTILISATEUR',
    );
    return {
      data: { nombre },
      message:
        nombre > 0
          ? MESSAGES_SESSION.autresDeconnectes
          : MESSAGES_SESSION.aucunAutreAppareil,
      success: true,
    };
  }

  @UseGuards(AuthGuard)
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Déconnecter cet appareil' })
  @ApiResponse({
    status: 404,
    description:
      "Session inconnue, d'un autre utilisateur, déjà révoquée ou expirée",
  })
  async revoquerSession(
    @Param('id') id: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.sessions.revoquerUne(req.user.userId, id);
    if (id === req.user.sid && typeClient(req) === SessionClientType.WEB) {
      this.sessions.effacerCookie(res);
    }
    return {
      data: { id },
      message: MESSAGES_SESSION.appareilDeconnecte,
      success: true,
    };
  }

  @Post('forgot-password')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mot de passe oublié',
    description: 'Envoie un email de réinitialisation',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Réinitialiser le mot de passe' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Get('verify-reset-token/:token')
  @ApiOperation({ summary: 'Vérifier un token de réinitialisation' })
  verifyResetToken(@Param('token') token: string) {
    return this.authService.verifyResetToken(token);
  }

  @UseGuards(AuthGuard)
  @Get('verify')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Vérifier le token JWT' })
  verifyToken(@Req() req: any) {
    return {
      data: { valid: true, userId: req.user.userId, role: req.user.role },
      message: 'Token valide',
      success: true,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renouveler le access token via refresh token' })
  @ApiHeader({
    name: 'X-Client',
    required: false,
    description:
      '« mobile » : refresh lu dans le corps et renvoyé dans le JSON, sans cookie. Absent : web, refresh lu dans le cookie httpOnly uniquement.',
  })
  @ApiResponse({
    status: 401,
    description:
      'code SESSION_EXPIREE, SESSION_REVOQUEE, REFRESH_REUTILISE ou COMPTE_DESACTIVE',
  })
  refresh(
    @Req() req: any,
    @Body() dto: JetonRenouvellementDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Mobile : corps uniquement. Web : cookie uniquement.
    const type = typeClient(req);
    const refresh =
      type === SessionClientType.MOBILE
        ? dto.refreshToken
        : req.cookies?.[NOM_COOKIE_REFRESH];
    return this.authService.refreshAccessToken(refresh, res, type);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Déconnexion de cet appareil (jeton d'accès ou refresh seul)",
  })
  @ApiHeader({
    name: 'X-Client',
    required: false,
    description:
      '« mobile » : refresh lu dans le corps. Absent : web, refresh lu dans le cookie httpOnly et cookie effacé.',
  })
  logout(
    @Req() req: any,
    @Body() dto: JetonRenouvellementDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const type = typeClient(req);
    const refresh =
      type === SessionClientType.MOBILE
        ? dto.refreshToken
        : req.cookies?.[NOM_COOKIE_REFRESH];
    const [schema, jeton] = String(req.headers?.authorization ?? '').split(' ');
    const jetonAcces = schema === 'Bearer' && jeton ? jeton : undefined;
    return this.authService.logout({ refresh, jetonAcces }, res, type);
  }
}
