// Configuration des journaux HTTP (pino-http) avec minimisation des données personnelles :
// ni en-têtes ni adresse IP dans les journaux de requête, URL gardée sans sa query.
// Toute nouvelle donnée de santé ou de localisation exposée dans un journal doit être
// ajoutée à `redact`.
import type { IncomingMessage, ServerResponse } from 'http';
import type { Options } from 'pino-http';

// Routes appelées en boucle (sonde de santé, rafraîchissement des notifications) :
// journalisées en debug quand elles réussissent.
const ROUTES_DE_SONDAGE = ['/', '/notifications'];

export function serialiserRequeteHttp(req: {
  id?: unknown;
  method?: string;
  url?: string;
}): { id: unknown; method: string | undefined; url: string | undefined } {
  return { id: req.id, method: req.method, url: req.url?.split('?')[0] };
}

export function serialiserReponseHttp(res: { statusCode?: number }): {
  statusCode: number | undefined;
} {
  return { statusCode: res.statusCode };
}

export function niveauJournalHttp(
  req: IncomingMessage & { originalUrl?: string },
  res: ServerResponse,
  err?: Error,
): 'error' | 'warn' | 'info' | 'debug' {
  if (err || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  const chemin = (req.originalUrl ?? req.url ?? '').split('?')[0];
  if (req.method === 'GET' && ROUTES_DE_SONDAGE.includes(chemin))
    return 'debug';
  return 'info';
}

export function optionsPinoHttp(): Options {
  return {
    // `||` et non `??` : une variable déclarée mais vide (fréquent quand on colle
    // un bloc d'env dans une UI) doit retomber sur le défaut. Avec `??`, Pino
    // recevait level:'' et refusait de démarrer.
    level:
      process.env.LOG_LEVEL ||
      (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    transport:
      process.env.NODE_ENV === 'production'
        ? undefined
        : {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
          },
    // Attention : `redact` masque les données sensibles. Toute nouvelle donnée de santé ou de localisation exposée dans un log doit être ajoutée à cette liste.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'req.body.password',
        'req.body.motDePasse',
        'req.body.symptomes',
        'req.body.latitude',
        'req.body.longitude',
      ],
      censor: '[masqué]',
    },
    // Minimisation (données personnelles) : ni en-têtes ni adresse IP dans les journaux de requête ; l'URL est gardée sans sa query.
    serializers: {
      req: serialiserRequeteHttp,
      res: serialiserReponseHttp,
    },
    customLogLevel: niveauJournalHttp,
    // Rattache l'auteur de la requête à chaque ligne de log (traçabilité).
    customProps: (req: IncomingMessage & { user?: { userId?: string } }) => ({
      userId: req.user?.userId,
    }),
    // Le health check (GET /) est appelé en boucle par Docker : ne pas le journaliser.
    autoLogging: { ignore: (req: IncomingMessage) => req.url === '/' },
  };
}
