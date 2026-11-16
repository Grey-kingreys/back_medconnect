import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  ComptageOuvertureDto,
  MOMENTS_COMPTAGE,
  MOTIF_CODE_MODE,
  ReleveModeDto,
  TYPES_MOUVEMENT_CAISSE,
} from './sessions-caisse.dto';
import { RAISONS_SORTIE, type RaisonSortie } from '../domaine/sortie';
import { CreerReceptionDto, LigneReceptionDto } from './receptions.dto';
import {
  FORMAT_TELEPHONE_PRESCRIPTEUR,
  nettoyerTelephonePrescripteur,
} from './vente.dto';

const rognerTexte = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// PostgreSQL refuse le caractère NUL : une enveloppe qui en contient est refusée en 400
// plutôt que d'échouer en base à chaque envoi (D664).
// eslint-disable-next-line no-control-regex
const SANS_NUL = /^[^\u0000]*$/;

export class CatalogueSynchroQueryDto {
  @ApiProperty({ description: 'Identifiant du poste desktop' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(SANS_NUL)
  posteId: string;
}

export const TYPES_EVENEMENT = [
  'SESSION_OUVERTE',
  'COMPTAGE_SAISI',
  'MOUVEMENT_CAISSE',
  'SESSION_FERMEE',
  'VENTE',
  'SORTIE_STOCK',
  'CORRECTION_QUANTITE',
  'ANOMALIE_TRAITEE',
  'FOURNISSEUR_CREE',
  'RECEPTION_ENREGISTREE',
  'FICHE_MODIFIEE',
  'FICHE_CREEE',
] as const;

export class EtatPosteDto {
  @ApiProperty({ description: "Le poste déclare n'avoir plus rien à envoyer" })
  @IsBoolean()
  fileVide: boolean;

  @ApiProperty({ description: 'Une caisse est ouverte sur le poste' })
  @IsBoolean()
  sessionOuverte: boolean;

  @ApiProperty({ example: '0.1.0' })
  @IsString()
  @Length(1, 32)
  @Matches(SANS_NUL)
  versionApp: string;
}

export class EvenementRecuDto {
  @ApiProperty({ description: "UUID de l'opération, généré par le poste" })
  @IsUUID('all')
  evenementId: string;

  @ApiProperty({ description: "Numéro d'ordre de l'opération sur ce poste" })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  sequence: number;

  @ApiPropertyOptional({ description: 'Un des types de TYPES_EVENEMENT' })
  @Allow()
  type?: unknown;

  @ApiPropertyOptional({ description: 'Date ISO 8601 locale du poste' })
  @Allow()
  horodatageLocal?: unknown;

  @ApiPropertyOptional({ description: "Vendeur de l'opération" })
  @Allow()
  utilisateurId?: unknown;

  @ApiPropertyOptional({ description: "Corps de l'opération, selon le type" })
  @Allow()
  corps?: unknown;
}

export class RecevoirEvenementsDto {
  @ApiProperty({ description: 'Identifiant du poste desktop' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(SANS_NUL)
  posteId: string;

  @ApiProperty({ type: EtatPosteDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => EtatPosteDto)
  etat: EtatPosteDto;

  @ApiProperty({ type: [EvenementRecuDto], description: '0 à 200 opérations' })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => EvenementRecuDto)
  evenements: EvenementRecuDto[];
}

// Corps validés par le service (jamais par le ValidationPipe).
export class CorpsSessionOuverteDto {
  @IsUUID('all')
  sessionId: string;
}

export class CorpsComptageSaisiDto extends ComptageOuvertureDto {
  @IsUUID('all')
  comptageId: string;

  @IsUUID('all')
  sessionId: string;

  @IsIn(MOMENTS_COMPTAGE)
  moment: 'OUVERTURE' | 'FERMETURE';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReleveModeDto)
  releves?: ReleveModeDto[];
}

export class CorpsMouvementCaisseDto {
  @IsUUID('all')
  mouvementId: string;

  @IsUUID('all')
  sessionId: string;

  @IsIn(TYPES_MOUVEMENT_CAISSE)
  type: 'PRELEVEMENT' | 'APPORT' | 'REMBOURSEMENT';

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  montant: number;

  @IsString()
  @Transform(rognerTexte)
  @Length(3, 300)
  motif: string;

  @IsOptional()
  @IsString()
  @Matches(MOTIF_CODE_MODE)
  mode?: string;
}

export class ComptageFermetureRejeuDto extends ComptageOuvertureDto {
  @IsUUID('all')
  comptageId: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReleveModeDto)
  releves?: ReleveModeDto[];
}

export class CorpsSessionFermeeDto {
  @IsUUID('all')
  sessionId: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ComptageFermetureRejeuDto)
  comptageFermeture?: ComptageFermetureRejeuDto;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(500)
  commentaire?: string;
}

/** Sortie de stock faite hors ligne (la raison et le commentaire absents donnent le rejet MOTIF_REQUIS). */
export class CorpsSortieStockDto {
  @IsUUID('all')
  id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  stockId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  lotId: string;

  @IsIn(['BOITE', 'UNITE'])
  unite: 'BOITE' | 'UNITE';

  @IsInt()
  @Min(1)
  @Max(1000000000)
  quantite: number;

  @IsOptional()
  @IsIn(RAISONS_SORTIE)
  raison?: RaisonSortie;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(300)
  commentaire?: string;
}

/** Correction de quantité faite hors ligne : variation signée en unités minimales sur un lot. */
export class CorpsCorrectionQuantiteDto {
  @IsUUID('all')
  id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  stockId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  lotId: string;

  @IsInt()
  @Min(-1000000000)
  @Max(1000000000)
  @NotEquals(0)
  variation: number;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(300)
  motif?: string;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(500)
  notes?: string;
}

export class SortieManuelleRejeuDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  lotId: string;

  @IsString()
  @Transform(rognerTexte)
  @Length(3, 300)
  motif: string;
}

export class LigneVenteRejeuDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  stockId: string;

  @IsIn(['BOITE', 'UNITE'])
  unite: 'BOITE' | 'UNITE';

  @IsInt()
  @Min(1)
  @Max(10_000)
  nombre: number;

  /** Prix du ticket pour une boîte (BOITE) ou une unité (UNITE). */
  @IsInt()
  @Min(0)
  @Max(2147483647)
  prixUnitaire: number;

  /** Unités non couvertes par un lot sur le poste. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  quantiteProvisoireLocale?: number;

  /** Le poste a entamé une boîte pour cette ligne. */
  @IsOptional()
  @IsBoolean()
  ouvertureConditionnement?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => SortieManuelleRejeuDto)
  sortieManuelle?: SortieManuelleRejeuDto;
}

export class PaiementRejeuDto {
  @IsString()
  @Matches(MOTIF_CODE_MODE)
  mode: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  montant: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  montantRecu?: number;
}

export class CorpsVenteDto {
  @IsUUID('all')
  venteId: string;

  @IsUUID('all')
  sessionId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  numeroTicket?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  numeroSecours?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LigneVenteRejeuDto)
  lignes: LigneVenteRejeuDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PaiementRejeuDto)
  paiements: PaiementRejeuDto[];

  @IsInt()
  @Min(0)
  @Max(2147483647)
  total: number;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(100)
  clientNom?: string;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(30)
  clientTelephone?: string;

  @IsBoolean()
  ordonnanceVerifiee: boolean;

  /** Facultatif : un ancien poste ne l'envoie pas. */
  @IsOptional()
  @Transform(nettoyerTelephonePrescripteur)
  @IsString()
  @MaxLength(30)
  @Matches(FORMAT_TELEPHONE_PRESCRIPTEUR)
  telephonePrescripteur?: string | null;
}

/** Traitement d'une anomalie fait hors ligne (le commentaire trop court donne le rejet MOTIF_REQUIS). */
export class CorpsAnomalieTraiteeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  anomalieId: string;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(500)
  commentaire?: string;
}

/** Fournisseur créé hors ligne : l'identifiant vient du poste ; un fournisseur de même nom déjà là est réutilisé. */
export class CorpsFournisseurCreeDto {
  @IsUUID('all')
  id: string;

  @IsString()
  @Transform(rognerTexte)
  @Length(2, 100)
  nom: string;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @Matches(/^[0-9 +().-]{6,30}$/)
  telephone?: string;
}

/** Ligne d'une réception faite hors ligne : le poste fournit l'identifiant du lot et le coefficient qu'il a utilisé. */
export class LigneReceptionRejeuDto extends LigneReceptionDto {
  @IsUUID('all')
  lotId: string;

  /** Unités par boîte de la fiche telle que le poste la voyait : la quantité en unités minimales en dépend. */
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  coefficientLocal: number;
}

/** Réception faite hors ligne : le corps de CreerReceptionDto, avec identifiant obligatoire et lignes à lot stable. */
export class CorpsReceptionEnregistreeDto extends OmitType(CreerReceptionDto, [
  'id',
  'lignes',
] as const) {
  @IsUUID('all')
  id: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LigneReceptionRejeuDto)
  lignes: LigneReceptionRejeuDto[];
}

/** Plus grand entier enregistrable (colonne Int de PostgreSQL). */
const ENTIER_MAX_FICHE = 2147483647;

/** Champs « sûrs » d'une fiche modifiables hors ligne ; null efface la valeur. Les mêmes bornes que ModifierFicheDto. */
export class ValeursFicheSuresDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(ENTIER_MAX_FICHE)
  prixUnitaire?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ENTIER_MAX_FICHE)
  prixUnite?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  toleranceInventaire?: number | null;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(2000)
  @Matches(SANS_NUL)
  notes?: string | null;
}

/** Fiche modifiée hors ligne : les valeurs vues par le poste (avant) et voulues (apres), champ par champ. */
export class CorpsFicheModifieeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  stockId: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => ValeursFicheSuresDto)
  avant: ValeursFicheSuresDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => ValeursFicheSuresDto)
  apres: ValeursFicheSuresDto;
}

/** Fiche de stock créée hors ligne depuis le catalogue global : l'identifiant vient du poste, sans quantité. */
export class CorpsFicheCreeeDto {
  @IsUUID('all')
  id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  medicamentId: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(ENTIER_MAX_FICHE)
  prixUnitaire?: number | null;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(2000)
  @Matches(SANS_NUL)
  notes?: string | null;
}
