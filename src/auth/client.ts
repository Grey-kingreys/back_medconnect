import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { SessionClientType } from 'generated/prisma/enums';
import type { InfosAppareilDto } from './dto/infos-appareil.dto';
import {
  MESSAGES_SESSION,
  estSessionsMultiAppareilsActif,
} from './sessions.constants';
import type { InfosClient } from './sessions.service';

/** Type de client : MOBILE si l'en-tête X-Client vaut « mobile » et que les sessions par appareil sont actives, sinon WEB. */
export function typeClient(req: Request): SessionClientType {
  const brut = req.headers['x-client'];
  const valeur = Array.isArray(brut) ? brut[0] : brut;
  const mobile =
    typeof valeur === 'string' && valeur.trim().toLowerCase() === 'mobile';
  return mobile && estSessionsMultiAppareilsActif()
    ? SessionClientType.MOBILE
    : SessionClientType.WEB;
}

/** Infos de session à partir de la requête et du DTO ; en mobile, deviceId et plateforme sont obligatoires. */
export function lireInfosClient(
  req: Request,
  dto?: InfosAppareilDto,
): InfosClient {
  if (typeClient(req) === SessionClientType.WEB) {
    return { type: SessionClientType.WEB };
  }
  if (!dto?.deviceId || !dto?.plateforme) {
    throw new BadRequestException({
      message: MESSAGES_SESSION.appareilManquant,
      code: 'VALIDATION',
    });
  }
  return {
    type: SessionClientType.MOBILE,
    deviceId: dto.deviceId,
    plateforme: dto.plateforme,
    nomAppareil: dto.nomAppareil,
    versionApp: dto.versionApp,
  };
}
