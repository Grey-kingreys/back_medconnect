import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Param,
  Patch
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { RequestWithUser } from './jwt.strategy';
import { UserService } from 'src/user/user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService
  ) { }

  /**
   * Connexion d'un utilisateur
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Connexion utilisateur',
    description: 'Authentifie un utilisateur et retourne un token JWT'
  })
  @ApiResponse({
    status: 200,
    description: 'Connexion réussie'
  })
  @ApiResponse({
    status: 401,
    description: 'Email ou mot de passe incorrect'
  })
  async login(@Body() authBody: LoginUserDto) {
    return this.authService.login({ authBody });
  }

  /**
   * Inscription d'un nouvel utilisateur
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Inscription utilisateur',
    description: 'Crée un nouveau compte utilisateur avec le rôle USER'
  })
  @ApiResponse({
    status: 201,
    description: 'Inscription réussie'
  })
  @ApiResponse({
    status: 400,
    description: 'Données invalides'
  })
  @ApiResponse({
    status: 409,
    description: 'Email déjà utilisé'
  })
  async register(@Body() registerBody: CreateUserDto) {
    return this.authService.register({ registerBody });
  }

  /**
   * Récupération de l'utilisateur authentifié
   */
  @UseGuards(AuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Profil utilisateur',
    description: 'Récupère les informations de l\'utilisateur connecté'
  })
  @ApiResponse({
    status: 200,
    description: 'Utilisateur trouvé'
  })
  @ApiResponse({
    status: 401,
    description: 'Non authentifié'
  })
  async getAuthenticatedUser(@Req() request: RequestWithUser) {
    return await this.userService.getUser({
      userId: request.user.userId
    });
  }

  /**
   * Édition du profil utilisateur
   */
  @UseGuards(AuthGuard)
  @Patch('profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Édition du profil',
    description: 'Met à jour les informations de l\'utilisateur connecté'
  })
  @ApiResponse({
    status: 200,
    description: 'Profil mis à jour'
  })
  @ApiResponse({
    status: 401,
    description: 'Non authentifié'
  })
  async editProfile(@Req() request: RequestWithUser, @Body() updateProfileDto: UpdateProfileDto) {
    return await this.authService.editProfile(request.user.userId, updateProfileDto);
  }

  /**
   * Vérification de la validité du token
   */
  @UseGuards(AuthGuard)
  @Get('verify')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Vérifier le token',
    description: 'Vérifie si le token JWT est valide'
  })
  @ApiResponse({
    status: 200,
    description: 'Token valide'
  })
  @ApiResponse({
    status: 401,
    description: 'Token invalide ou expiré'
  })
  async verifyToken(@Req() request: RequestWithUser) {
    return {
      data: { valid: true, userId: request.user.userId },
      message: "Token valide",
      success: true
    };
  }

  /**
 * Demande de réinitialisation de mot de passe
 */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Demande de réinitialisation de mot de passe',
    description: 'Envoie un email avec un lien de réinitialisation si l\'email existe'
  })
  @ApiResponse({
    status: 200,
    description: 'Email envoyé (ou message générique pour la sécurité)'
  })
  @ApiResponse({
    status: 400,
    description: 'Erreur lors de l\'envoi'
  })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword({
      email: forgotPasswordDto.email
    });
  }

  /**
   * Réinitialisation effective du mot de passe
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Réinitialiser le mot de passe',
    description: 'Réinitialise le mot de passe avec le token reçu par email'
  })
  @ApiResponse({
    status: 200,
    description: 'Mot de passe réinitialisé avec succès'
  })
  @ApiResponse({
    status: 401,
    description: 'Token invalide ou expiré'
  })
  @ApiResponse({
    status: 400,
    description: 'Données invalides'
  })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword({
      token: resetPasswordDto.token,
      newPassword: resetPasswordDto.newPassword
    });
  }

  /**
   * Vérifier la validité d'un token de réinitialisation
   */
  @Get('verify-reset-token/:token')
  @ApiOperation({
    summary: 'Vérifier un token de réinitialisation',
    description: 'Vérifie si un token de réinitialisation est valide avant d\'afficher le formulaire'
  })
  @ApiResponse({
    status: 200,
    description: 'Token valide'
  })
  @ApiResponse({
    status: 401,
    description: 'Token invalide ou expiré'
  })
  async verifyResetToken(@Param('token') token: string) {
    return this.authService.verifyResetToken(token);
  }

  /**
 * Changer son propre mot de passe
 */
  @UseGuards(AuthGuard)
  @Post('change-password')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Changer son mot de passe',
    description: 'Permet à un utilisateur de changer son propre mot de passe'
  })
  @ApiResponse({
    status: 200,
    description: 'Mot de passe changé avec succès'
  })
  @ApiResponse({
    status: 401,
    description: 'Mot de passe actuel incorrect'
  })
  async changeOwnPassword(
    @Req() request: RequestWithUser,
    @Body() changePasswordDto: ChangePasswordDto
  ) {
    return this.authService.changeOwnPassword(
      request.user.userId,
      changePasswordDto
    );
  }
}