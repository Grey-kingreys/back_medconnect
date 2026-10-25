import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { MESSAGE_VERSION_OBSOLETE } from './configuration-publique.constants';
import {
  PLATEFORMES,
  ConfigurationPubliqueService,
  type Plateforme,
} from './configuration-publique.service';
import { comparerVersions, lireVersion } from './versions';

function entete(req: Request, nom: string): string | undefined {
  const brut = req.headers[nom];
  const valeur = Array.isArray(brut) ? brut[0] : brut;
  const texte = valeur?.trim();
  return texte ? texte : undefined;
}

/**
 * Refuse en 426 VERSION_OBSOLETE un client mobile sous la version minimale de sa
 * plateforme, sur toute route sauf `/app/*`. Un en-tête absent ou illisible laisse
 * passer (défaut tolérant). Le web n'envoie pas `X-Client: mobile` et n'est jamais affecté.
 */
@Injectable()
export class VersionMinimaleGuard implements CanActivate {
  constructor(private readonly service: ConfigurationPubliqueService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const chemin = req.path ?? '';
    if (chemin === '/app' || chemin.startsWith('/app/')) return true;

    if (entete(req, 'x-client')?.toLowerCase() !== 'mobile') return true;

    const plateforme = entete(req, 'x-plateforme')?.toLowerCase();
    if (
      !plateforme ||
      !(PLATEFORMES as readonly string[]).includes(plateforme)
    ) {
      return true;
    }

    const version = lireVersion(entete(req, 'x-app-version'));
    if (!version) return true;

    const minimale = lireVersion(
      this.service.versionMinimale(plateforme as Plateforme),
    );
    if (!minimale || comparerVersions(version, minimale) >= 0) return true;

    throw new HttpException(
      { message: MESSAGE_VERSION_OBSOLETE, code: 'VERSION_OBSOLETE' },
      426,
    );
  }
}
