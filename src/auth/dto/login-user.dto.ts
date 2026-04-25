import { IsEmail, IsNotEmpty, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginUserDto {
    @ApiProperty({
        example: 'user@example.com',
        description: 'Email de l\'utilisateur',
        required: true,
    })
    @IsNotEmpty({ message: "L'email est obligatoire" })
    @IsEmail({}, { message: "L'email n'est pas valide" })
    @Matches(
        /^[^\s<>/:!§;,?~#{}\[\]|`^&'()=+_-]+@[^\s<>/:!§;,?~#{}\[\]|`^&'()=+_-]+\.[^\s<>/:!§;,?~#{}\[\]|`^&'()=+_-]+$/,
        { message: "L'email contient des caractères non autorisés" },
    )
    email: string;

    @ApiProperty({
        example: 'SecurePass123!',
        description: 'Mot de passe de l\'utilisateur',
        required: true,
        minLength: 8,
    })
    @IsNotEmpty({ message: "Le mot de passe est obligatoire" })
    @MinLength(8, {
        message: "Le mot de passe doit contenir au moins 8 caractères",
    })
    password: string;
}