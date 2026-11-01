import { createHash } from 'node:crypto';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

export type Encodage = 'br' | 'gzip' | 'identity';

/** ETag faible : sha256 du JSON non compressé, valable quel que soit l'encodage (D634). */
export function etagFaible(texte: string): string {
  return `W/"${createHash('sha256').update(texte, 'utf8').digest('base64url')}"`;
}

function sansFaible(etag: string): string {
  return etag.startsWith('W/') ? etag.slice(2) : etag;
}

/** Comparaison faible d'un en-tête If-None-Match (liste ou `*`). */
export function correspondEtag(
  entete: string | undefined,
  etag: string,
): boolean {
  if (!entete) return false;
  return entete
    .split(',')
    .map((e) => e.trim())
    .some((e) => e === '*' || sansFaible(e) === sansFaible(etag));
}

/** Encodage accepté par le client : brotli, sinon gzip, sinon aucun. */
export function choisirEncodage(entete: string | undefined): Encodage {
  if (!entete) return 'identity';
  const acceptes = new Map<string, number>();
  for (const jeton of entete.split(',')) {
    const [nom, ...parametres] = jeton.trim().toLowerCase().split(';');
    if (!nom) continue;
    let q = 1;
    for (const parametre of parametres) {
      const [cle, valeur] = parametre.trim().split('=');
      if (cle === 'q') q = Number(valeur);
    }
    acceptes.set(nom, q);
  }
  const accepte = (nom: string): boolean => {
    const q = acceptes.get(nom) ?? acceptes.get('*');
    return q !== undefined && q > 0;
  };
  if (accepte('br')) return 'br';
  if (accepte('gzip')) return 'gzip';
  return 'identity';
}

export function compresserJson(
  texte: string,
  entete: string | undefined,
): { encodage: Encodage; contenu: Buffer } {
  const encodage = choisirEncodage(entete);
  const brut = Buffer.from(texte, 'utf8');
  if (encodage === 'br') {
    return {
      encodage,
      contenu: brotliCompressSync(brut, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 5,
          [constants.BROTLI_PARAM_SIZE_HINT]: brut.length,
        },
      }),
    };
  }
  if (encodage === 'gzip') {
    return { encodage, contenu: gzipSync(brut, { level: 6 }) };
  }
  return { encodage, contenu: brut };
}
