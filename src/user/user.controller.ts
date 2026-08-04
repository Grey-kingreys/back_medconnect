import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
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
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { RequirePermissions } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import {
  CreateUserByAdminDto,
  UpdateUserDto,
  ChangeUserPasswordDto,
  UserResponseDto,
} from './dto/user.dto';
import { LinkFileDto } from 'src/storage/dto/link-file.dto';
import { plainToInstance } from 'class-transformer';

@ApiTags('Utilisateurs (Admin)')
@Controller('users')
@UseGuards(AuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private readonly userService: UserService) { }

  // ─── Avatar (self-service : aucune permission requise, juste être authentifié) ──

  @Patch('me/avatar')
  @ApiOperation({ summary: 'Définir ma photo de profil depuis un fichier R2 confirmé' })
  setMyAvatar(@Req() req: any, @Body() dto: LinkFileDto) {
    return this.userService.setAvatar(req.user.userId, dto.fileId);
  }

  @Delete('me/avatar')
  @ApiOperation({ summary: 'Supprimer ma photo de profil' })
  removeMyAvatar(@Req() req: any) {
    return this.userService.removeAvatar(req.user.userId);
  }

  // ─── Routes statiques (DOIVENT être AVANT :userId) ──────────

  @Get('stats')
  @RequirePermissions(PERMISSIONS.USER_ADMIN)
  @ApiOperation({ summary: 'Statistiques utilisateurs' })
  getStats() {
    return this.userService.getStats();
  }

  @Get('patients/my')
  @RequirePermissions(PERMISSIONS.PATIENT_READ)
  @ApiOperation({ summary: 'Liste de mes patients', description: 'Retourne les patients ayant eu une consultation dans la structure du médecin' })
  getMyPatients(@Req() req: any) {
    return this.userService.getPatientsForDoctor(req.user.structureId);
  }

  @Get('patient/autorisations')
  // @RequirePermissions not needed for patient self-service operations
  @ApiOperation({ summary: 'Récupérer les autorisations du patient' })
  getAutorisations(@Req() req: any) {
    return this.userService.getAutorisations(req.user.userId);
  }

  @Post('patient/autoriser-structure/:structureId')
  // @RequirePermissions not needed for patient self-service operations
  @ApiOperation({ summary: 'Autoriser une structure à voir le dossier' })
  autoriserStructure(@Param('structureId') structureId: string, @Req() req: any) {
    return this.userService.autoriserStructure(req.user.userId, structureId);
  }

  @Delete('patient/revoquer-structure/:structureId')
  // @RequirePermissions not needed for patient self-service operations
  @ApiOperation({ summary: 'Révoquer l\'autorisation d\'une structure' })
  revoquerStructure(@Param('structureId') structureId: string, @Req() req: any) {
    return this.userService.revoquerStructure(req.user.userId, structureId);
  }

  @Post('patient/designer-medecin/:medecinId')
  // @RequirePermissions not needed for patient self-service operations
  @ApiOperation({ summary: 'Désigner un médecin traitant' })
  designerMedecin(@Param('medecinId') medecinId: string, @Req() req: any) {
    return this.userService.designerMedecin(req.user.userId, medecinId);
  }

  // ─── CRUD Utilisateurs (Admin) ────────────────────────────────

  @Post()
  @RequirePermissions(PERMISSIONS.USER_ADMIN)
  @ApiOperation({ summary: 'Créer un utilisateur (Admin)' })
  @ApiResponse({ status: 201, description: 'Utilisateur créé' })
  @ApiResponse({ status: 409, description: 'Email déjà utilisé' })
  async create(@Body() dto: CreateUserByAdminDto) {
    const res = await this.userService.createByAdmin(dto);
    return {
      ...res,
      data: plainToInstance(UserResponseDto, res.data, { excludeExtraneousValues: true }),
    };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.USER_ADMIN)
  @ApiOperation({ summary: 'Liste des utilisateurs' })
  async getUsers() {
    const res = await this.userService.getUsers();
    return {
      ...res,
      data: plainToInstance(UserResponseDto, res.data, { excludeExtraneousValues: true }),
    };
  }

  @Get(':userId')
  @RequirePermissions(PERMISSIONS.USER_ADMIN)
  @ApiParam({ name: 'userId', description: "ID de l'utilisateur" })
  @ApiOperation({ summary: "Détails d'un utilisateur" })
  async getUser(@Param('userId') userId: string) {
    const res = await this.userService.getUser(userId);
    return {
      ...res,
      data: plainToInstance(UserResponseDto, res.data, { excludeExtraneousValues: true }),
    };
  }

  @Patch(':userId')
  @RequirePermissions(PERMISSIONS.USER_ADMIN)
  @ApiParam({ name: 'userId' })
  @ApiOperation({ summary: 'Modifier un utilisateur' })
  update(@Param('userId') userId: string, @Body() dto: UpdateUserDto) {
    return this.userService.update(userId, dto);
  }

  @Patch(':userId/toggle-active')
  @RequirePermissions(PERMISSIONS.USER_ADMIN)
  @ApiParam({ name: 'userId' })
  @ApiOperation({ summary: 'Activer/Désactiver un utilisateur' })
  toggleActive(@Param('userId') userId: string) {
    return this.userService.toggleActive(userId);
  }

  @Delete(':userId')
  @RequirePermissions(PERMISSIONS.USER_ADMIN)
  @ApiParam({ name: 'userId' })
  @ApiOperation({ summary: 'Supprimer un utilisateur' })
  remove(@Param('userId') userId: string, @Req() req: any) {
    return this.userService.remove(userId, req.user);
  }

  @Post(':userId/change-password')
  @RequirePermissions(PERMISSIONS.USER_ADMIN)
  @ApiParam({ name: 'userId' })
  @ApiOperation({ summary: "Changer le mot de passe d'un utilisateur (Admin)" })
  changePassword(
    @Param('userId') userId: string,
    @Body() dto: ChangeUserPasswordDto,
  ) {
    return this.userService.changeUserPassword(userId, dto);
  }
}