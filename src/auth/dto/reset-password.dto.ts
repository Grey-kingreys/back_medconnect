import { IsNotEmpty, Length, Matches, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
    @ApiProperty({
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        description: 'Token de réinitialisation reçu par email',
        required: true,
    })
    @IsNotEmpty({ message: "Le token est obligatoire" })
    @IsString({ message: "Le token doit être une chaîne de caractères" })
    token: string;

    @ApiProperty({
        example: 'NewSecurePass123!',
        description: 'Nouveau mot de passe (min 8 caractères, avec majuscule, minuscule et chiffre)',
        required: true,
        minLength: 8,
        maxLength: 50,
    })
    @IsNotEmpty({ message: "Le nouveau mot de passe est obligatoire" })
    @Length(8, 50, {
        message: "Le mot de passe doit contenir entre 8 et 50 caractères",
    })
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: "Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre"
    })
    newPassword: string;
}