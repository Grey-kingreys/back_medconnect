import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from 'generated/prisma/client';

// Messages affichés tels quels par le front (audience non-dev).
export const MESSAGES = {
  validation:
    'Certaines informations saisies sont manquantes ou invalides. Vérifiez le formulaire puis réessayez.',
  connexion: 'Votre connexion a expiré, reconnectez-vous.',
  acces: "Vous n'avez pas accès à cette information.",
  introuvableRoute: 'Cette page ou cette information est introuvable.',
  introuvable: 'Cette information est introuvable.',
  existeDeja: 'Cette information existe déjà.',
  referenceAbsente:
    "Cette opération fait référence à une information qui n'existe pas.",
  tropVolumineux: 'Le document envoyé est trop volumineux.',
  tropDeTentatives:
    'Trop de tentatives en peu de temps. Patientez une minute puis réessayez.',
  indisponible:
    'Le service est momentanément indisponible, réessayez dans quelques instants.',
  autre:
    "La demande n'a pas pu aboutir. Vérifiez les informations puis réessayez.",
} as const;

// Libellés courts du champ `error`.
const LIBELLES: Record<number, string> = {
  400: 'Saisie invalide',
  401: 'Connexion expirée',
  403: 'Accès refusé',
  404: 'Introuvable',
  409: 'Déjà existant',
  413: 'Document trop volumineux',
  429: 'Trop de tentatives',
  500: 'Erreur interne',
};

// Messages anglais par défaut de Nest et d'Express (libellés HTTP standard).
const MESSAGES_PAR_DEFAUT = new Set(
  [
    'Bad Request',
    'Unauthorized',
    'Forbidden',
    'Forbidden resource',
    'Not Found',
    'Method Not Allowed',
    'Not Acceptable',
    'Request Timeout',
    'Conflict',
    'Gone',
    'Payload Too Large',
    'Request Entity Too Large',
    'Unsupported Media Type',
    'Unprocessable Entity',
    'Too Many Requests',
    'Internal Server Error',
    'Http Exception',
  ].map((m) => m.toLowerCase()),
);

interface CorpsErreur {
  statusCode: number;
  message: string;
  error: string;
  details?: unknown;
}

/**
 * Filtre global : toute erreur HTTP est renvoyée au format
 * `{ statusCode, message, error }` avec un message en français, sans détail
 * technique (nom de classe, code Prisma, pile). Les erreurs inattendues sont
 * journalisées (niveau error) et renvoyées en 500 générique.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // Seul le contexte HTTP est traité ; les autres (socket, file) gardent
    // leur propre gestion.
    if (host.getType() !== 'http') return;

    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const corps = this.construireCorps(exception, request);
    response.status(corps.statusCode).json(corps);
  }

  private construireCorps(exception: unknown, request: Request): CorpsErreur {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return corps(HttpStatus.CONFLICT, MESSAGES.existeDeja);
        case 'P2025':
          return corps(HttpStatus.NOT_FOUND, MESSAGES.introuvable);
        case 'P2003':
          return corps(HttpStatus.BAD_REQUEST, MESSAGES.referenceAbsente);
        default:
          return this.erreurInterne(exception, request);
      }
    }

    if (exception instanceof HttpException) {
      const statut = exception.getStatus();
      if (statut >= 500) return this.erreurInterne(exception, request);

      const reponse = exception.getResponse();
      const message =
        typeof reponse === 'string'
          ? reponse
          : (reponse as { message?: unknown }).message;
      const libelle =
        typeof reponse === 'object'
          ? (reponse as { error?: unknown }).error
          : undefined;

      // Erreurs de validation du ValidationPipe (message en tableau).
      if (statut === 400 && Array.isArray(message)) {
        const resultat = corps(statut, MESSAGES.validation);
        if (process.env.NODE_ENV !== 'production') resultat.details = message;
        return resultat;
      }
      if (statut === 429) return corps(statut, MESSAGES.tropDeTentatives);
      // Route inconnue : « Cannot GET /x » produit par Nest.
      if (
        statut === 404 &&
        typeof message === 'string' &&
        message.startsWith('Cannot ')
      ) {
        return corps(statut, MESSAGES.introuvableRoute);
      }
      // Message rédigé par le projet : conservé tel quel.
      if (
        typeof message === 'string' &&
        message !== libelle &&
        !MESSAGES_PAR_DEFAUT.has(message.toLowerCase())
      ) {
        return corps(statut, message);
      }
      return corps(statut, messageParStatut(statut));
    }

    // Corps trop gros rejeté par body-parser (erreur Express, pas HttpException).
    if ((exception as { status?: unknown } | null)?.status === 413) {
      return corps(HttpStatus.PAYLOAD_TOO_LARGE, MESSAGES.tropVolumineux);
    }

    return this.erreurInterne(exception, request);
  }

  private erreurInterne(exception: unknown, request: Request): CorpsErreur {
    const erreur =
      exception instanceof Error ? exception : new Error(String(exception));
    // Ni corps ni en-têtes de l'appel dans le log (données de santé).
    const route = (request.route as { path?: string } | undefined)?.path;
    this.logger.error(
      `Erreur non gérée ${erreur.name} : ${erreur.message} (${request.method} ${route ?? request.path})`,
      erreur.stack,
    );
    return corps(HttpStatus.INTERNAL_SERVER_ERROR, MESSAGES.indisponible);
  }
}

function corps(statusCode: number, message: string): CorpsErreur {
  return {
    statusCode,
    message,
    error:
      LIBELLES[statusCode] ??
      (statusCode >= 500 ? LIBELLES[500] : 'Demande refusée'),
  };
}

function messageParStatut(statut: number): string {
  switch (statut) {
    case 400:
      return MESSAGES.validation;
    case 401:
      return MESSAGES.connexion;
    case 403:
      return MESSAGES.acces;
    case 404:
      return MESSAGES.introuvableRoute;
    case 409:
      return MESSAGES.existeDeja;
    case 413:
      return MESSAGES.tropVolumineux;
    default:
      return MESSAGES.autre;
  }
}
