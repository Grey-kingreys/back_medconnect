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

/** Nom d'appareil lisible pour une session web, déduit du User-Agent (« Chrome sur Windows »). */
export function libelleNavigateur(
  userAgent: string | undefined,
): string | undefined {
  if (!userAgent) return undefined;
  const navigateurs: Array<[RegExp, string]> = [
    [/Edg\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/SamsungBrowser/, 'Samsung Internet'],
    [/Firefox\//, 'Firefox'],
    [/Chrome\//, 'Chrome'],
    [/Safari\//, 'Safari'],
  ];
  const systemes: Array<[RegExp, string]> = [
    [/Windows/, 'Windows'],
    [/Android/, 'Android'],
    [/iPhone|iPad|iPod/, 'iOS'],
    [/Mac OS X|Macintosh/, 'macOS'],
    [/Linux/, 'Linux'],
  ];
  const navigateur =
    navigateurs.find(([re]) => re.test(userAgent))?.[1] ?? 'Navigateur';
  const systeme = systemes.find(([re]) => re.test(userAgent))?.[1];
  const nom = systeme ? `${navigateur} sur ${systeme}` : navigateur;
  return nom.slice(0, 100);
}

/** Infos de session à partir de la requête et du DTO ; en mobile, deviceId et plateforme sont obligatoires. */
export function lireInfosClient(
  req: Request,
  dto?: InfosAppareilDto,
): InfosClient {
  if (typeClient(req) === SessionClientType.WEB) {
    const brut = req.headers['user-agent'];
    const nom = libelleNavigateur(Array.isArray(brut) ? brut[0] : brut);
    return nom
      ? { type: SessionClientType.WEB, nomAppareil: nom }
      : { type: SessionClientType.WEB };
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
