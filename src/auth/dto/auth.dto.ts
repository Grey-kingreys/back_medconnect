import {
    IsEmail,
    IsNotEmpty,
    Length,
    Matches,
    IsString,
    IsOptional,
    IsNumber,
    Min,
    Max,
    IsDateString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ForgotPasswordDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsNotEmpty({ message: "L'email est obligatoire" })
    @IsEmail({}, { message: "L'email n'est pas valide" })
    email: string;
}

export class ResetPasswordDto {
    @ApiProperty({ description: 'Token reçu par email' })
    @IsNotEmpty({ message: 'Le token est obligatoire' })
    @IsString()
    token: string;

    @ApiProperty({ example: 'NewSecurePass123!' })
    @IsNotEmpty({ message: 'Le nouveau mot de passe est obligatoire' })
    @Length(8, 50)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre',
    })
    newPassword: string;
}

export class ChangePasswordDto {
    @ApiProperty({ example: 'CurrentPass123!' })
    @IsNotEmpty({ message: 'Le mot de passe actuel est obligatoire' })
    @IsString()
    currentPassword: string;

    @ApiProperty({ example: 'NewSecurePass123!' })
    @IsNotEmpty({ message: 'Le nouveau mot de passe est obligatoire' })
    @Length(8, 50)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre',
    })
    newPassword: string;
}

export class UpdateProfileDto {
    @ApiPropertyOptional({ example: 'Diallo' })
    @IsOptional()
    @IsString()
    @Length(2, 100)
    @Matches(/^[a-zA-ZÀ-ÿ\s'-]+$/, {
        message: 'Le nom ne doit contenir que des lettres, espaces, apostrophes et tirets',
    })
    nom?: string;

    @ApiPropertyOptional({ example: 'Mamadou' })
    @IsOptional()
    @IsString()
    @Length(2, 100)
    @Matches(/^[a-zA-ZÀ-ÿ\s'-]+$/, {
        message: 'Le prénom ne doit contenir que des lettres, espaces, apostrophes et tirets',
    })
    prenom?: string;

    @ApiPropertyOptional({ example: 'user@example.com' })
    @IsOptional()
    @IsEmail({}, { message: "L'email n'est pas valide" })
    email?: string;

    @ApiPropertyOptional({ example: '+224622123456' })
    @IsOptional()
    @IsString()
    @Length(8, 20)
    telephone?: string;

    @ApiPropertyOptional({ example: '1990-05-15', description: 'Date de naissance (YYYY-MM-DD)' })
    @IsOptional()
    @IsDateString({}, { message: 'La date de naissance doit être une date valide (YYYY-MM-DD)' })
    dateNaissance?: string;

    @ApiPropertyOptional({ example: 175, description: 'Taille en cm' })
    @IsOptional()
    @IsNumber()
    @Min(50)
    @Max(250)
    taille?: number;

    @ApiPropertyOptional({ example: 70.5, description: 'Poids en kg' })
    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(500)
    poids?: number;
}