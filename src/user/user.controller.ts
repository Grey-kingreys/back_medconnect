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
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import {
  CreateUserByAdminDto,
  UpdateUserDto,
  ChangeUserPasswordDto,
  UserResponseDto,
} from './dto/user.dto';
import { plainToInstance } from 'class-transformer';

@ApiTags('Utilisateurs (Admin)')
@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private readonly userService: UserService) { }

  // ─── Routes statiques (DOIVENT être AVANT :userId) ──────────

  @Get('stats')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Statistiques utilisateurs' })
  getStats() {
    return this.userService.getStats();
  }

  @Get('patients/my')
  @Roles('MEDECIN', 'STRUCTURE_ADMIN')
  @ApiOperation({ summary: 'Liste de mes patients', description: 'Retourne les patients ayant eu une consultation dans la structure du médecin' })
  getMyPatients(@Req() req: any) {
    return this.userService.getPatientsForDoctor(req.user.structureId);
  }

  @Get('patient/autorisations')
  @Roles('PATIENT')
  @ApiOperation({ summary: 'Récupérer les autorisations du patient' })
  getAutorisations(@Req() req: any) {
    return this.userService.getAutorisations(req.user.userId);
  }

  @Post('patient/autoriser-structure/:structureId')
  @Roles('PATIENT')
  @ApiOperation({ summary: 'Autoriser une structure à voir le dossier' })
  autoriserStructure(@Param('structureId') structureId: string, @Req() req: any) {
    return this.userService.autoriserStructure(req.user.userId, structureId);
  }

  @Delete('patient/revoquer-structure/:structureId')
  @Roles('PATIENT')
  @ApiOperation({ summary: 'Révoquer l\'autorisation d\'une structure' })
  revoquerStructure(@Param('structureId') structureId: string, @Req() req: any) {
    return this.userService.revoquerStructure(req.user.userId, structureId);
  }

  @Post('patient/designer-medecin/:medecinId')
  @Roles('PATIENT')
  @ApiOperation({ summary: 'Désigner un médecin traitant' })
  designerMedecin(@Param('medecinId') medecinId: string, @Req() req: any) {
    return this.userService.designerMedecin(req.user.userId, medecinId);
  }

  // ─── CRUD Utilisateurs (Admin) ────────────────────────────────

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
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
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Liste des utilisateurs' })
  async getUsers() {
    const res = await this.userService.getUsers();
    return {
      ...res,
      data: plainToInstance(UserResponseDto, res.data, { excludeExtraneousValues: true }),
    };
  }

  @Get(':userId')
  @Roles('ADMIN', 'SUPER_ADMIN')
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
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiParam({ name: 'userId' })
  @ApiOperation({ summary: 'Modifier un utilisateur' })
  update(@Param('userId') userId: string, @Body() dto: UpdateUserDto) {
    return this.userService.update(userId, dto);
  }

  @Patch(':userId/toggle-active')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiParam({ name: 'userId' })
  @ApiOperation({ summary: 'Activer/Désactiver un utilisateur' })
  toggleActive(@Param('userId') userId: string) {
    return this.userService.toggleActive(userId);
  }

  @Delete(':userId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiParam({ name: 'userId' })
  @ApiOperation({ summary: 'Supprimer un utilisateur' })
  remove(@Param('userId') userId: string, @Req() req: any) {
    return this.userService.remove(userId, req.user);
  }

  @Post(':userId/change-password')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiParam({ name: 'userId' })
  @ApiOperation({ summary: "Changer le mot de passe d'un utilisateur (Admin)" })
  changePassword(
    @Param('userId') userId: string,
    @Body() dto: ChangeUserPasswordDto,
  ) {
    return this.userService.changeUserPassword(userId, dto);
  }
}