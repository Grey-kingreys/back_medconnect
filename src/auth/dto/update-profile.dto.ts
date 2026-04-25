// update-profile.dto.ts
import { IsEmail, IsOptional, Length, Matches, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
    @ApiPropertyOptional({
        example: 'user@example.com',
        description: 'Nouvel email de l\'utilisateur',
    })
    @IsOptional()
    @IsEmail({}, { message: "L'email n'est pas valide" })
    @Matches(/^[^\s<>/:!§;,?~#{}\[\]|`^&'()=+_-]+@[^\s<>/:!§;,?~#{}\[\]|`^&'()=+_-]+\.[^\s<>/:!§;,?~#{}\[\]|`^&'()=+_-]+$/, {
        message: "L'email contient des caractères non autorisés"
    })
    email?: string;

    @ApiPropertyOptional({
        example: 'John Doe',
        description: 'Nouveau nom de l\'utilisateur',
    })
    @IsOptional()
    @IsString({ message: "Le nom doit être une chaîne de caractères" })
    @Length(3, 100, {
        message: "Le nom doit contenir entre 3 et 100 caractères",
    })
    @Matches(/^[a-zA-ZÀ-ÿ\s'-]+$/, {
        message: "Le nom ne doit contenir que des lettres, espaces, apostrophes et tirets"
    })
    name?: string;
}