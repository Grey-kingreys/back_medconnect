import { SetMetadata } from '@nestjs/common';

/** Métadonnée posée par @LimitePermissiveSiRedisIndisponible(). */
export const LIMITE_PERMISSIVE = 'limitePermissiveSiRedisIndisponible';

/** Préfixe ajouté par UserThrottlerGuard à la clé d'une route permissive. */
export const PREFIXE_CLE_PERMISSIVE = 'permissif:';

/**
 * Route qui doit passer si le stockage Redis du limiteur est indisponible
 * (réservé au SOS : une urgence ne doit jamais être bloquée par une panne Redis).
 */
export const LimitePermissiveSiRedisIndisponible = () =>
  SetMetadata(LIMITE_PERMISSIVE, true);
