import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateUserByAdminDto } from './dto/create-user-by-admin.dto';
import { ChangeUserPasswordDto } from './dto/change-user-password.dto';

@ApiTags('Utilisateurs')
@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private readonly userService: UserService) { }

  /**
   * Créer un utilisateur (Admin uniquement)
   */
  @Post()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Créer un utilisateur (Admin)',
    description:
      "Crée un nouvel utilisateur avec le rôle spécifié. Réservé aux administrateurs uniquement.",
  })
  @ApiResponse({
    status: 201,
    description: 'Utilisateur créé avec succès',
  })
  @ApiResponse({
    status: 400,
    description: 'Données invalides ou magasin inexistant',
  })
  @ApiResponse({
    status: 401,
    description: 'Non authentifié',
  })
  @ApiResponse({
    status: 403,
    description: 'Accès refusé - Rôle ADMIN requis',
  })
  @ApiResponse({
    status: 409,
    description: 'Un utilisateur avec cet email existe déjà',
  })
  create(@Body() createUserByAdminDto: CreateUserByAdminDto) {
    console.log("cote controller",createUserByAdminDto);
    return this.userService.createByAdmin(createUserByAdminDto);
  }

  /**
   * Récupérer tous les utilisateurs
   */
  @Get()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Liste des utilisateurs',
    description: 'Récupère la liste de tous les utilisateurs',
  })
  @ApiResponse({
    status: 200,
    description: 'Liste des utilisateurs récupérée',
  })
  @ApiResponse({
    status: 401,
    description: 'Non authentifié',
  })
  @ApiResponse({
    status: 403,
    description: 'Accès refusé - Rôle ADMIN ou MANAGER requis',
  })
  getUsers() {
    return this.userService.getUsers();
  }

  /**
   * Récupérer les statistiques des utilisateurs
   */
  @Get('stats')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Statistiques des utilisateurs',
    description:
      'Récupère des statistiques globales sur les utilisateurs (Admin/Manager)',
  })
  @ApiResponse({
    status: 200,
    description: 'Statistiques récupérées',
  })
  @ApiResponse({
    status: 401,
    description: 'Non authentifié',
  })
  @ApiResponse({
    status: 403,
    description: 'Accès refusé - Rôle ADMIN ou MANAGER requis',
  })
  getStats() {
    return this.userService.getStats();
  }

  /**
   * Récupérer un utilisateur par ID
   */
  @Get(':userId')
  @Roles('ADMIN')
  @ApiOperation({
    summary: "Détails d'un utilisateur",
    description: "Récupère les détails d'un utilisateur spécifique",
  })
  @ApiParam({
    name: 'userId',
    description: "ID de l'utilisateur",
    example: 'clx7b8k9l0000xtqp1234abcd',
  })
  @ApiResponse({
    status: 200,
    description: 'Utilisateur trouvé',
  })
  @ApiResponse({
    status: 401,
    description: 'Non authentifié',
  })
  @ApiResponse({
    status: 403,
    description: 'Accès refusé - Rôle ADMIN requis',
  })
  @ApiResponse({
    status: 404,
    description: 'Utilisateur non trouvé',
  })
  getUser(@Param('userId') userId: string) {
    return this.userService.getUser({ userId });
  }

  /**
   * Mettre à jour un utilisateur
   */
  @Patch(':userId')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Modifier un utilisateur (Admin)',
    description: "Met à jour les informations d'un utilisateur",
  })
  @ApiParam({
    name: 'userId',
    description: "ID de l'utilisateur",
    example: 'clx7b8k9l0000xtqp1234abcd',
  })
  @ApiResponse({
    status: 200,
    description: 'Utilisateur mis à jour avec succès',
  })
  @ApiResponse({
    status: 401,
    description: 'Non authentifié',
  })
  @ApiResponse({
    status: 403,
    description: 'Accès refusé - Rôle ADMIN requis',
  })
  @ApiResponse({
    status: 404,
    description: 'Utilisateur non trouvé',
  })
  update(
    @Param('userId') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.update({ userId }, updateUserDto);
  }

  /**
   * Activer/Désactiver un utilisateur
   */
  @Patch(':userId/toggle-active')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Activer/Désactiver un utilisateur (Admin)',
    description: "Change le statut actif/inactif d'un utilisateur",
  })
  @ApiParam({
    name: 'userId',
    description: "ID de l'utilisateur",
    example: 'clx7b8k9l0000xtqp1234abcd',
  })
  @ApiResponse({
    status: 200,
    description: "Statut de l'utilisateur changé avec succès",
  })
  @ApiResponse({
    status: 401,
    description: 'Non authentifié',
  })
  @ApiResponse({
    status: 403,
    description: 'Accès refusé - Rôle ADMIN requis',
  })
  @ApiResponse({
    status: 404,
    description: 'Utilisateur non trouvé',
  })
  toggleActive(@Param('userId') userId: string) {
    return this.userService.toggleActive(userId);
  }

  /**
   * Supprimer un utilisateur
   */
  @Delete(':userId')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Supprimer un utilisateur (Admin)',
    description:
      "Supprime un utilisateur (uniquement si aucune activité associée)",
  })
  @ApiParam({
    name: 'userId',
    description: "ID de l'utilisateur",
    example: 'clx7b8k9l0000xtqp1234abcd',
  })
  @ApiResponse({
    status: 200,
    description: 'Utilisateur supprimé avec succès',
  })
  @ApiResponse({
    status: 401,
    description: 'Non authentifié',
  })
  @ApiResponse({
    status: 403,
    description: 'Accès refusé - Rôle ADMIN requis',
  })
  @ApiResponse({
    status: 404,
    description: 'Utilisateur non trouvé',
  })
  @ApiResponse({
    status: 409,
    description: 'Impossible de supprimer un utilisateur avec des activités',
  })
  remove(@Param('userId') userId: string) {
    return this.userService.remove({ userId });
  }


  /**
   * Changer le mot de passe d'un utilisateur (Admin)
   */
  @Post(':userId/change-password')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Changer le mot de passe d\'un utilisateur (Admin)',
    description: 'Permet à un admin de changer le mot de passe de n\'importe quel utilisateur'
  })
  @ApiParam({
    name: 'userId',
    description: "ID de l'utilisateur",
    example: 'clx7b8k9l0000xtqp1234abcd',
  })
  @ApiResponse({
    status: 200,
    description: 'Mot de passe modifié avec succès'
  })
  @ApiResponse({
    status: 403,
    description: 'Accès refusé - Rôle ADMIN requis'
  })
  changeUserPassword(
    @Param('userId') userId: string,
    @Body() changePasswordDto: ChangeUserPasswordDto
  ) {
    return this.userService.changeUserPassword(userId, changePasswordDto);
  }
}