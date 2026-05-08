import {
    IsEmail,
    IsNotEmpty,
    Length,
    Matches,
    IsString,
    IsEnum,
    IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose, Type } from 'class-transformer';

// ... (reste du fichier existant)


// Rôles que l'admin peut créer (pas PATIENT, pas SUPER_ADMIN)
export enum AdminCreatableRole {
    MEDECIN = 'MEDECIN',
    PHARMACIEN = 'PHARMACIEN',
    STRUCTURE_ADMIN = 'STRUCTURE_ADMIN',
    ADMIN = 'ADMIN',
}

export class CreateUserByAdminDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsNotEmpty()
    @IsEmail()
    email: string;

    @ApiProperty({ example: 'SecurePass123!' })
    @IsNotEmpty()
    @Length(8, 50)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre',
    })
    password: string;

    @ApiProperty({ example: 'Diallo' })
    @IsNotEmpty()
    @IsString()
    @Length(2, 100)
    @Matches(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    nom: string;

    @ApiProperty({ example: 'Mamadou' })
    @IsNotEmpty()
    @IsString()
    @Length(2, 100)
    @Matches(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    prenom: string;

    @ApiPropertyOptional({ example: '+224622123456' })
    @IsOptional()
    @IsString()
    @Length(8, 20)
    telephone?: string;

    @ApiProperty({ enum: AdminCreatableRole })
    @IsNotEmpty()
    @IsEnum(AdminCreatableRole, {
        message: `Le rôle doit être l'un des suivants : ${Object.values(AdminCreatableRole).join(', ')}`,
    })
    role: AdminCreatableRole;

    @ApiPropertyOptional({ example: 'Cardiologie' })
    @IsOptional()
    @IsString()
    specialite?: string;
}

export class UpdateUserDto {
    @ApiPropertyOptional({ example: 'Diallo' })
    @IsOptional()
    @IsString()
    @Length(2, 100)
    @Matches(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    nom?: string;

    @ApiPropertyOptional({ example: 'Mamadou' })
    @IsOptional()
    @IsString()
    @Length(2, 100)
    @Matches(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    prenom?: string;

    @ApiPropertyOptional({ example: 'user@example.com' })
    @IsOptional()
    @IsEmail()
    email?: string;

    @ApiPropertyOptional({ enum: AdminCreatableRole })
    @IsOptional()
    @IsEnum(AdminCreatableRole)
    role?: AdminCreatableRole;

    @ApiPropertyOptional({ example: '+224622123456' })
    @IsOptional()
    @IsString()
    @Length(8, 20)
    telephone?: string;
}

export class ChangeUserPasswordDto {
    @ApiProperty({ example: 'NewSecurePass123!' })
    @IsNotEmpty()
    @Length(8, 50)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: 'Le mot de passe doit contenir une majuscule, une minuscule et un chiffre',
    })
    newPassword: string;
}

export class UserResponseDto {
    @Expose()
    id: string;

    @Expose()
    email: string;

    @Expose()
    nom: string;

    @Expose()
    prenom: string;

    @Expose()
    telephone: string;

    @Expose()
    dateNaissance?: string;

    @Expose()
    taille?: number;

    @Expose()
    poids?: number;

    @Expose()
    role: string;

    @Expose()
    isActive: boolean;

    @Expose()
    structureId: string;

    @Expose()
    specialite: string;

    @Expose()
    createdAt: Date;

    @Expose()
    updatedAt: Date;

    @Exclude()
    password?: string;

    @Exclude()
    refreshToken?: string;

    @Exclude()
    refreshTokenExpires?: Date;

    constructor(partial: Partial<UserResponseDto>) {
        Object.assign(this, partial);
    }
}