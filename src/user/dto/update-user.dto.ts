import { PartialType } from '@nestjs/swagger';
import { CreateUserByAdminDto } from './create-user-by-admin.dto';

export class UpdateUserDto extends PartialType(CreateUserByAdminDto) { }