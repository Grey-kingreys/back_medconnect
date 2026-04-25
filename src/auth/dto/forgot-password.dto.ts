import { IsEmail, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
    @ApiProperty({
        example: 'user@example.com',
        description: 'Email de l\'utilisateur qui a oublié son mot de passe',
        required: true,
    })
    @IsNotEmpty({ message: "L'email est obligatoire" })
    @IsEmail({}, { message: "L'email n'est pas valide" })
    @Matches(
        /^[^\s<>/:!§;,?~#{}\[\]|`^&'()=+_-]+@[^\s<>/:!§;,?~#{}\[\]|`^&'()=+_-]+\.[^\s<>/:!§;,?~#{}\[\]|`^&'()=+_-]+$/,
        { message: "L'email contient des caractères non autorisés" },
    )
    email: string;
}