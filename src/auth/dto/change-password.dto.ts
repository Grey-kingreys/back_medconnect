import { IsNotEmpty, Length, Matches, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
    @ApiProperty({
        example: 'CurrentPass123!',
        description: 'Mot de passe actuel',
        required: true,
    })
    @IsNotEmpty({ message: "Le mot de passe actuel est obligatoire" })
    @IsString()
    currentPassword: string;

    @ApiProperty({
        example: 'NewSecurePass123!',
        description: 'Nouveau mot de passe',
        required: true,
        minLength: 8,
    })
    @IsNotEmpty({ message: "Le nouveau mot de passe est obligatoire" })
    @Length(8, 50)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: "Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre"
    })
    newPassword: string;
}