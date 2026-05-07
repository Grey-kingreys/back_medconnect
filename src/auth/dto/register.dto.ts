// ─── create-user.dto.ts (register patient) ───────────────────────────────────
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

export class RegisterDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsNotEmpty({ message: "L'email est obligatoire" })
    @IsEmail({}, { message: "L'email n'est pas valide" })
    email: string;

    @ApiProperty({ example: 'SecurePass123!' })
    @IsNotEmpty({ message: 'Le mot de passe est obligatoire' })
    @Length(8, 50, { message: 'Le mot de passe doit contenir entre 8 et 50 caractères' })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre',
    })
    password: string;

    @ApiProperty({ example: 'Diallo' })
    @IsNotEmpty({ message: 'Le nom est obligatoire' })
    @IsString()
    @Length(2, 100)
    @Matches(/^[a-zA-ZÀ-ÿ\s'-]+$/, {
        message: 'Le nom ne doit contenir que des lettres, espaces, apostrophes et tirets',
    })
    nom: string;

    @ApiProperty({ example: 'Mamadou' })
    @IsNotEmpty({ message: 'Le prénom est obligatoire' })
    @IsString()
    @Length(2, 100)
    @Matches(/^[a-zA-ZÀ-ÿ\s'-]+$/, {
        message: 'Le prénom ne doit contenir que des lettres, espaces, apostrophes et tirets',
    })
    prenom: string;

    @ApiPropertyOptional({ example: '+224622123456' })
    @IsOptional()
    @IsString()
    @Length(8, 20)
    telephone?: string;

    @ApiPropertyOptional({ example: '1990-05-15' })
    @IsOptional()
    @IsDateString({}, { message: 'La date de naissance doit être une date valide (YYYY-MM-DD)' })
    dateNaissance?: string;

    @ApiPropertyOptional({ example: 175 })
    @IsOptional()
    @IsNumber()
    @Min(50, { message: 'La taille doit être supérieure à 50 cm' })
    @Max(250, { message: 'La taille doit être inférieure à 250 cm' })
    taille?: number;

    @ApiPropertyOptional({ example: 70.5 })
    @IsOptional()
    @IsNumber()
    @Min(1, { message: 'Le poids doit être supérieur à 1 kg' })
    @Max(500, { message: 'Le poids doit être inférieur à 500 kg' })
    poids?: number;
}