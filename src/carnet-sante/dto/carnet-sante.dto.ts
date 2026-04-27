import {
    IsOptional,
    IsString,
    IsEnum,
    IsArray,
    IsNumber,
    IsDateString,
    IsNotEmpty,
    IsBoolean,
    IsUrl,
    Min,
    Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// ─── Profil Médical ───────────────────────────────────────────────────────────

export enum GroupeSanguinEnum {
    A_POSITIF = 'A_POSITIF',
    A_NEGATIF = 'A_NEGATIF',
    B_POSITIF = 'B_POSITIF',
    B_NEGATIF = 'B_NEGATIF',
    AB_POSITIF = 'AB_POSITIF',
    AB_NEGATIF = 'AB_NEGATIF',
    O_POSITIF = 'O_POSITIF',
    O_NEGATIF = 'O_NEGATIF',
    INCONNU = 'INCONNU',
}

export class UpsertProfilMedicalDto {
    @ApiPropertyOptional({ enum: GroupeSanguinEnum })
    @IsOptional()
    @IsEnum(GroupeSanguinEnum)
    groupeSanguin?: GroupeSanguinEnum;

    @ApiPropertyOptional({ example: ['Pénicilline', 'Arachides'] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    allergies?: string[];

    @ApiPropertyOptional({ example: ['Diabète type 2', 'Hypertension'] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    pathologies?: string[];

    @ApiPropertyOptional({ example: ['Metformine 500mg', 'Amlodipine 5mg'] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    traitements?: string[];

    @ApiPropertyOptional({ example: 175 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    taille?: number;

    @ApiPropertyOptional({ example: 70 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    poids?: number;

    @ApiPropertyOptional({ example: '1990-05-15' })
    @IsOptional()
    @IsDateString()
    dateNaissance?: string;

    @ApiPropertyOptional({ example: 'M', description: 'M | F | Autre' })
    @IsOptional()
    @IsString()
    genre?: string;

    @ApiPropertyOptional({ example: 'Mamadou Diallo — +224622000000' })
    @IsOptional()
    @IsString()
    @Length(0, 200)
    contactUrgence?: string;
}

// ─── Consultation ─────────────────────────────────────────────────────────────

export class CreateConsultationDto {
    @ApiProperty({ example: 'Fièvre et maux de tête depuis 3 jours' })
    @IsNotEmpty()
    @IsString()
    @Length(3, 500)
    motif: string;

    @ApiPropertyOptional({ example: 'Dr. Kouyaté Mamadou' })
    @IsOptional()
    @IsString()
    @Length(0, 150)
    medecinNom?: string;

    @ApiPropertyOptional({ example: 'Paludisme simple' })
    @IsOptional()
    @IsString()
    @Length(0, 500)
    diagnostic?: string;

    @ApiPropertyOptional({ example: 'Patient à revoir dans 5 jours' })
    @IsOptional()
    @IsString()
    @Length(0, 2000)
    notes?: string;

    @ApiPropertyOptional({ example: '2026-04-20T10:00:00Z' })
    @IsOptional()
    @IsDateString()
    dateConsultation?: string;

    @ApiPropertyOptional({ description: 'ID de la structure (si applicable)' })
    @IsOptional()
    @IsString()
    structureId?: string;
}

// ─── Ordonnance ───────────────────────────────────────────────────────────────

export class MedicamentOrdonnanceDto {
    @ApiProperty({ example: 'Coartem 20/120mg' })
    @IsNotEmpty()
    @IsString()
    nom: string;

    @ApiProperty({ example: '2 comprimés matin et soir' })
    @IsNotEmpty()
    @IsString()
    dosage: string;

    @ApiProperty({ example: '3 jours' })
    @IsNotEmpty()
    @IsString()
    duree: string;

    @ApiPropertyOptional({ example: 'Prendre pendant les repas' })
    @IsOptional()
    @IsString()
    instructions?: string;
}

export class CreateOrdonnanceDto {
    @ApiPropertyOptional({ description: 'ID de la consultation liée' })
    @IsOptional()
    @IsString()
    consultationId?: string;

    @ApiPropertyOptional({ example: 'Dr. Kouyaté' })
    @IsOptional()
    @IsString()
    medecinNom?: string;

    @ApiProperty({ type: [MedicamentOrdonnanceDto] })
    @IsArray()
    @Type(() => MedicamentOrdonnanceDto)
    medicaments: MedicamentOrdonnanceDto[];

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    notes?: string;

    @ApiPropertyOptional({ example: '2026-07-01' })
    @IsOptional()
    @IsDateString()
    dateExpiration?: string;
}

// ─── Résultat d'analyse ───────────────────────────────────────────────────────

export class CreateResultatAnalyseDto {
    @ApiProperty({ example: 'Bilan sanguin complet' })
    @IsNotEmpty()
    @IsString()
    @Length(2, 200)
    typeAnalyse: string;

    @ApiPropertyOptional({ example: 'Laboratoire National de Conakry' })
    @IsOptional()
    @IsString()
    @Length(0, 200)
    laboratoire?: string;

    @ApiProperty({ example: 'Hémoglobine: 12.5 g/dL — Glycémie: 5.2 mmol/L' })
    @IsNotEmpty()
    @IsString()
    resultats: string;

    @ApiPropertyOptional({ example: 'https://storage.medconnect.gn/analyses/abc.pdf' })
    @IsOptional()
    @IsString()
    fichierUrl?: string;

    @ApiProperty({ example: '2026-04-15' })
    @IsNotEmpty()
    @IsDateString()
    dateAnalyse: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    notes?: string;
}

// ─── Vaccination ──────────────────────────────────────────────────────────────

export class CreateVaccinationDto {
    @ApiProperty({ example: 'Vaccin contre la fièvre jaune' })
    @IsNotEmpty()
    @IsString()
    @Length(2, 200)
    vaccin: string;

    @ApiProperty({ example: '2026-03-01' })
    @IsNotEmpty()
    @IsDateString()
    dateVaccin: string;

    @ApiPropertyOptional({ example: '2036-03-01' })
    @IsOptional()
    @IsDateString()
    prochainRappel?: string;

    @ApiPropertyOptional({ example: 'LOT-2024-GN-01' })
    @IsOptional()
    @IsString()
    lotNumero?: string;

    @ApiPropertyOptional({ example: 'Centre de Santé Ratoma' })
    @IsOptional()
    @IsString()
    administrePar?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    notes?: string;
}

// ─── Auto-diagnostic ──────────────────────────────────────────────────────────

export class CreateAutoDiagnosticDto {
    @ApiProperty({
        example: 'Fièvre à 39°C depuis 2 jours, maux de tête, courbatures',
    })
    @IsNotEmpty()
    @IsString()
    @Length(10, 2000)
    symptomes: string;
}