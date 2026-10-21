import type { RedisOptions } from 'ioredis';

/**
 * Construit les options de connexion BullMQ à partir d'une URL Redis.
 * Une URL en `rediss://` active le chiffrement TLS (BullMQ n'analyse pas
 * lui-même le protocole). Le mot de passe et l'identifiant sont décodés.
 */
export function optionsConnexionBullmq(url: string): RedisOptions {
  const adresse = new URL(url);
  const options: RedisOptions = {
    host: adresse.hostname,
    port: Number(adresse.port) || 6379,
    username: adresse.username
      ? decodeURIComponent(adresse.username)
      : undefined,
    password: adresse.password
      ? decodeURIComponent(adresse.password)
      : undefined,
  };
  const base = /^\/(\d+)$/.exec(adresse.pathname);
  if (base) options.db = Number(base[1]);
  if (adresse.protocol === 'rediss:') options.tls = {};
  return options;
}
