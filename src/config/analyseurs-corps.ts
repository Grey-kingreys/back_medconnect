import { json } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { LIMITE_CORPS_JSON } from './origines-cors';

/** Seule route qui accepte un corps JSON de 2 Mo et compressé gzip (D636, révisé par D663). */
export const ROUTE_SYNCHRO_EVENEMENTS =
  '/pharmacie/:structureId/synchro/evenements';

/** Limite par défaut d'Express, gardée sur toutes les autres routes (D663). */
export const LIMITE_CORPS_JSON_DEFAUT = '100kb';

/**
 * Analyseurs JSON, à monter avant `init` (sinon Nest monte le sien, 100 ko et gzip
 * accepté partout). Le corps n'est lu qu'une fois : le premier analyseur qui le lit
 * termine la requête et body-parser passe son tour sur une requête terminée.
 * L'analyse précède les gardes et le limiteur de débit : une route publique comme
 * `/auth/login` ne doit jamais faire analyser 2 Mo ni décompresser un corps.
 */
export function monterAnalyseursJson(app: NestExpressApplication): void {
  // Lots de synchronisation du desktop : jusqu'à 2 Mo (taille décompressée), gzip accepté.
  app.use(ROUTE_SYNCHRO_EVENEMENTS, json({ limit: LIMITE_CORPS_JSON }));
  // Partout ailleurs : 100 ko, corps compressé refusé (415).
  app.useBodyParser('json', {
    limit: LIMITE_CORPS_JSON_DEFAUT,
    inflate: false,
  });
}
