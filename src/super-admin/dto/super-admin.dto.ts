import {
    IsEmail,
    IsNotEmpty,
    Matches,
    IsEnum,
    IsString,
    Length,
    IsOptional,
    IsNumber,
    IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum StructureTypeEnum {
    HOPITAL = 'HOPITAL',
    CLINIQUE = 'CLINIQUE',
    PHARMACIE = 'PHARMACIE',
}

export class CreateStructureDto {
    @ApiProperty({ example: 'Hôpital Donka' })
    @IsNotEmpty({ message: 'Le nom de la structure est obligatoire' })
    @IsString()
    @Length(2, 150)
    nom: string;

    @ApiProperty({ enum: StructureTypeEnum, example: 'HOPITAL' })
    @IsNotEmpty({ message: 'Le type est obligatoire' })
    @IsEnum(StructureTypeEnum, {
        message: 'Le type doit être HOPITAL, CLINIQUE ou PHARMACIE',
    })
    type: StructureTypeEnum;

    @ApiProperty({ example: 'admin@hopitaldonka.gn' })
    @IsNotEmpty({ message: "L'email est obligatoire" })
    @IsEmail({}, { message: "L'email n'est pas valide" })
    email: string;

    @ApiPropertyOptional({ example: '+224622000000' })
    @IsOptional()
    @IsString()
    @Length(8, 20)
    telephone?: string;

    @ApiPropertyOptional({ example: 'Conakry, Kaloum' })
    @IsOptional()
    @IsString()
    @Length(3, 200)
    adresse?: string;

    @ApiPropertyOptional({ example: 'Conakry' })
    @IsOptional()
    @IsString()
    @Length(2, 100)
    ville?: string;

    @ApiPropertyOptional({ example: 9.537 })
    @IsOptional()
    @IsNumber()
    latitude?: number;

    @ApiPropertyOptional({ example: -13.678 })
    @IsOptional()
    @IsNumber()
    longitude?: number;

    @ApiPropertyOptional({ example: '08:00-18:00' })
    @IsOptional()
    @IsString()
    horaires?: string;

    @ApiPropertyOptional({ example: false })
    @IsOptional()
    @IsBoolean()
    estDeGarde?: boolean;
}

export class CreateSuperAdminDto {
    @ApiProperty({ example: 'Diallo' })
    @IsNotEmpty({ message: 'Le nom est obligatoire' })
    @IsString()
    @Length(2, 100)
    nom: string;

    @ApiProperty({ example: 'Mamadou' })
    @IsNotEmpty({ message: 'Le prénom est obligatoire' })
    @IsString()
    @Length(2, 100)
    prenom: string;

    @ApiProperty({ example: 'superadmin@medconnect.gn' })
    @IsNotEmpty({ message: "L'email est obligatoire" })
    @IsEmail({}, { message: "L'email n'est pas valide" })
    email: string;

    @ApiProperty({ example: 'SecurePass123!' })
    @IsNotEmpty({ message: 'Le mot de passe est obligatoire' })
    @Length(8, 50)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: 'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre',
    })
    password: string;

    @ApiPropertyOptional({ example: '+224622000000' })
    @IsOptional()
    @IsString()
    @Length(8, 20)
    telephone?: string;
}