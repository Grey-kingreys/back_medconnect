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
import { Expose, Exclude, Type, Transform } from 'class-transformer';


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

    @ApiPropertyOptional({ example: 'Mamadou Diallo' })
    @IsOptional()
    @IsString()
    contactNom?: string;

    @ApiPropertyOptional({ example: '+224622000000' })
    @IsOptional()
    @IsString()
    contactTelephone?: string;

    @ApiPropertyOptional({ example: 'proche@email.com' })
    @IsOptional()
    @IsString()
    contactEmail?: string;
}

// ─── Consultation ─────────────────────────────────────────────────────────────

export class CreateConsultationDto {
    @ApiProperty({ example: 'Fièvre et maux de tête depuis 3 jours' })
    @IsNotEmpty()
    @IsString()
    @Length(3, 500)
    motif: string;

    @ApiPropertyOptional({ description: 'ID du patient (pour les médecins)' })
    @IsOptional()
    @IsString()
    patientId?: string;

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

    @ApiPropertyOptional({ description: 'ID du patient (pour les médecins)' })
    @IsOptional()
    @IsString()
    patientId?: string;

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

    @ApiPropertyOptional({ description: 'ID du patient (pour les médecins)' })
    @IsOptional()
    @IsString()
    patientId?: string;

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

    @ApiPropertyOptional({ description: 'ID du patient (pour les médecins)' })
    @IsOptional()
    @IsString()
    patientId?: string;

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

// ─── Rendez-vous ──────────────────────────────────────────────────────────────

export enum AppointmentStatusEnum {
    PROGRAMME = 'PROGRAMME',
    CONFIRME = 'CONFIRME',
    ANNULE = 'ANNULE',
    TERMINE = 'TERMINE',
}

export class CreateRendezVousDto {
    @ApiProperty({ example: '2026-04-20T10:00:00Z' })
    @IsNotEmpty()
    @IsDateString()
    date: string;

    @ApiProperty({ example: 'Consultation de suivi' })
    @IsNotEmpty()
    @IsString()
    @Length(3, 500)
    motif: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    notes?: string;

    @ApiProperty({ description: 'ID du patient' })
    @IsNotEmpty()
    @IsString()
    patientId: string;

    @ApiPropertyOptional({ description: 'ID de la structure' })
    @IsOptional()
    @IsString()
    structureId?: string;

    @ApiPropertyOptional({ enum: AppointmentStatusEnum })
    @IsOptional()
    @IsEnum(AppointmentStatusEnum)
    status?: AppointmentStatusEnum;
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

export class AutoDiagnosticResponseDto {
    @Expose()
    id: string;

    @Expose()
    patientId: string;

    @Expose()
    symptomes: string;

    @Expose()
    @Transform(({ value }) => {
        if (typeof value === 'string') {
            try { return JSON.parse(value); } catch { return value; }
        }
        return value;
    })
    analyseia: any;

    @Expose()
    recommendation: string;

    @Expose()
    createdAt: Date;

    constructor(partial: Partial<AutoDiagnosticResponseDto>) {
        Object.assign(this, partial);
    }
}

// ─── Urgences ───────────────────────────────────────────────────────────────

export enum UrgenceStatusEnum {
    LANCE = 'LANCE',
    PRIS_EN_CHARGE = 'PRIS_EN_CHARGE',
    TERMINE = 'TERMINE',
    ANNULE = 'ANNULE',
}

export class CreateUrgenceDto {
    @ApiPropertyOptional({ example: 9.5370 })
    @IsOptional()
    @IsNumber()
    latitude?: number;

    @ApiPropertyOptional({ example: -13.6773 })
    @IsOptional()
    @IsNumber()
    longitude?: number;

    @ApiPropertyOptional({ example: 'Accident domestique, besoin de secours' })
    @IsOptional()
    @IsString()
    message?: string;
}