import { IsNotEmpty, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangeUserPasswordDto {
    @ApiProperty({
        example: 'NewSecurePass123!',
        description: 'Nouveau mot de passe',
        required: true,
        minLength: 8,
    })
    @IsNotEmpty({ message: "Le nouveau mot de passe est obligatoire" })
    @Length(8, 50)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: "Le mot de passe doit contenir une majuscule, une minuscule et un chiffre"
    })
    newPassword: string;
}