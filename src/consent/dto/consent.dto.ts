import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

/** Code de partage présenté par le patient (QR ou saisie manuelle). */
export class RedeemCodeDto {
  @ApiProperty({ example: 'A7K3QM', description: 'Code de partage affiché par le patient' })
  @IsNotEmpty()
  @IsString()
  @Length(4, 12)
  code: string;
}

/** Demande d'envoi d'un code par SMS (patient sans smartphone). */
export class RequestOtpDto {
  @ApiProperty({ example: '+224622000000', description: 'Téléphone du patient' })
  @IsNotEmpty()
  @IsString()
  @Length(6, 20)
  telephone: string;
}

/** Validation du code SMS dicté par le patient. */
export class VerifyOtpDto {
  @ApiProperty({ description: 'ID du patient (retourné par /consent/otp/request)' })
  @IsNotEmpty()
  @IsString()
  patientId: string;

  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @IsString()
  @Length(4, 8)
  code: string;
}
