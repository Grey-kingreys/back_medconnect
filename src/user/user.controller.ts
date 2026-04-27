import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
} from './dto/user.dto';

@ApiTags('Utilisateurs (Admin)')
@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private readonly userService: UserService) { }

  @Post()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Créer un utilisateur (Admin)' })
  @ApiResponse({ status: 201, description: 'Utilisateur créé' })
  @ApiResponse({ status: 409, description: 'Email déjà utilisé' })
  create(@Body() dto: CreateUserByAdminDto) {
    return this.userService.createByAdmin(dto);
  }

  @Get()
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Liste des utilisateurs' })
  getUsers() {
    return this.userService.getUsers();
  }

  @Get('stats')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Statistiques utilisateurs' })
  getStats() {
    return this.userService.getStats();
  }

  @Get(':userId')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiParam({ name: 'userId', description: "ID de l'utilisateur" })
  @ApiOperation({ summary: "Détails d'un utilisateur" })
  getUser(@Param('userId') userId: string) {
    return this.userService.getUser(userId);
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
  remove(@Param('userId') userId: string) {
    return this.userService.remove(userId);
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