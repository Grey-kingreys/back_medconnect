// ─── create-user.dto.ts (register patient) ───────────────────────────────────
import {
    IsEmail,
    IsNotEmpty,
    Length,
    Matches,
    IsString,
    IsOptional,
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
}