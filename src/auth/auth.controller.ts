import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';

/** Palier strict pour les endpoints sensibles d'auth : 10 req/min/IP. */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto';

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Inscription patient', description: 'Crée un compte patient (accès public)' })
  @ApiResponse({ status: 201, description: 'Compte créé' })
  @ApiResponse({ status: 409, description: 'Email déjà utilisé' })
  register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.authService.register(dto, res);
  }

  @Post('login')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion', description: 'Authentifie un utilisateur (tous rôles)' })
  @ApiResponse({ status: 200, description: 'Connexion réussie' })
  @ApiResponse({ status: 401, description: 'Email ou mot de passe incorrect' })
  login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: any,
  ) {
    // req.ip fiable car `trust proxy` est configuré dans main.ts (derrière Caddy).
    return this.authService.login(dto, res, req.ip);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mon profil', description: 'Retourne le profil de l\'utilisateur connecté' })
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
    return this.authService.changePassword(req.user.userId, dto);
  }

  @Post('forgot-password')
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mot de passe oublié', description: 'Envoie un email de réinitialisation' })
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
  refresh(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Le refresh token vit UNIQUEMENT dans le cookie httpOnly (plus de fallback body).
    const token = req.cookies?.['refresh_token'];

    if (!token) throw new BadRequestException('refresh_token requis');
    return this.authService.refreshAccessToken(token, res);
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Déconnexion (invalide le refresh token)' })
  logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    return this.authService.logout(req.user.userId, res);
  }
}