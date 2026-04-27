import {
    IsEmail,
    IsNotEmpty,
    IsEnum,
    IsString,
    Length,
    IsOptional,
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
}