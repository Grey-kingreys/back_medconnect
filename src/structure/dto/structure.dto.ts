import {
    IsNotEmpty,
    IsString,
    Length,
    IsOptional,
    IsEmail,
    IsEnum,
    Matches,
    IsNumber,
    IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Setup initial de la structure (via token invitation) ─────────────────────

export class SetupStructureDto {
    // Infos du compte administrateur
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

    @ApiProperty({ example: '+224622000000' })
    @IsNotEmpty()
    @IsString()
    @Length(8, 20)
    telephone: string;

    @ApiProperty({ example: 'SecurePass123!' })
    @IsNotEmpty()
    @Length(8, 50)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre',
    })
    password: string;

    // Infos de la structure
    @ApiProperty({ example: 'Clinique Moderne Kaloum' })
    @IsNotEmpty()
    @IsString()
    @Length(2, 150)
    structureNom: string;

    @ApiProperty({ example: 'Kaloum, Conakry' })
    @IsNotEmpty()
    @IsString()
    @Length(3, 200)
    adresse: string;

    @ApiProperty({ example: 'Conakry' })
    @IsNotEmpty()
    @IsString()
    @Length(2, 100)
    ville: string;

    @ApiPropertyOptional({ example: '+224622111222' })
    @IsOptional()
    @IsString()
    @Length(8, 20)
    structureTelephone?: string;

    @ApiPropertyOptional({ example: 'Clinique spécialisée en médecine générale et urgences' })
    @IsOptional()
    @IsString()
    @Length(0, 500)
    description?: string;

    @ApiPropertyOptional({ example: 9.537 })
    @IsOptional()
    @IsNumber()
    latitude?: number;

    @ApiPropertyOptional({ example: -13.678 })
    @IsOptional()
    @IsNumber()
    longitude?: number;

    @ApiPropertyOptional({ example: '{"lun":"08:00-18:00","mar":"08:00-18:00"}' })
    @IsOptional()
    @IsString()
    horaires?: string;

    @ApiPropertyOptional({ example: false })
    @IsOptional()
    @IsBoolean()
    estDeGarde?: boolean;

    @ApiPropertyOptional({ example: true })
    @IsOptional()
    @IsBoolean()
    estOuvertManuel?: boolean;
}

// ─── Créer un membre dans la structure ───────────────────────────────────────

export enum MembreRoleEnum {
    MEDECIN = 'MEDECIN',
    PHARMACIEN = 'PHARMACIEN',
    STRUCTURE_ADMIN = 'STRUCTURE_ADMIN',
}

export class CreateMembreDto {
    @ApiProperty({ example: 'Barry' })
    @IsNotEmpty()
    @IsString()
    @Length(2, 100)
    @Matches(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    nom: string;

    @ApiProperty({ example: 'Fatoumata' })
    @IsNotEmpty()
    @IsString()
    @Length(2, 100)
    @Matches(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    prenom: string;

    @ApiProperty({ example: 'docteur.barry@clinique.gn' })
    @IsNotEmpty()
    @IsEmail()
    email: string;

    @ApiPropertyOptional({ example: '+224611000000' })
    @IsOptional()
    @IsString()
    @Length(8, 20)
    telephone?: string;

    @ApiProperty({ enum: MembreRoleEnum, example: 'MEDECIN' })
    @IsNotEmpty()
    @IsEnum(MembreRoleEnum, {
        message: 'Le rôle doit être MEDECIN, PHARMACIEN ou STRUCTURE_ADMIN',
    })
    role: MembreRoleEnum;

    @ApiPropertyOptional({ example: 'Cardiologie' })
    @IsOptional()
    @IsString()
    specialite?: string;

    @ApiPropertyOptional({
        description:
            "Rôle (RBAC) à attribuer, choisi parmi les rôles de la structure. À défaut, le rôle par défaut correspondant à `role` est utilisé.",
    })
    @IsOptional()
    @IsString()
    appRoleId?: string;
}

// ─── Update structure ─────────────────────────────────────────────────────────

export class UpdateStructureDto {
    @ApiPropertyOptional({ example: 'Clinique Moderne Kaloum' })
    @IsOptional()
    @IsString()
    @Length(2, 150)
    nom?: string;

    @ApiPropertyOptional({ example: 'Kaloum, Conakry' })
    @IsOptional()
    @IsString()
    @Length(3, 200)
    adresse?: string;

    @ApiPropertyOptional({ example: 'Conakry' })
    @IsOptional()
    @IsString()
    @Length(2, 100)
    ville?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(8, 20)
    telephone?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(0, 500)
    description?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    latitude?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    longitude?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    horaires?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    estDeGarde?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    estOuvertManuel?: boolean;
}