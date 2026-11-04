import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
  choisirEncodage,
  compresserJson,
  correspondEtag,
  etagFaible,
} from './reponse-compressee';

describe('réponse compressée du catalogue', () => {
  describe('etagFaible', () => {
    it('est déterministe, faible, et change avec le texte', () => {
      const etag = etagFaible('{"a":1}');
      expect(etag).toBe(etagFaible('{"a":1}'));
      expect(etag.startsWith('W/"')).toBe(true);
      expect(etagFaible('{"a":2}')).not.toBe(etag);
    });
  });

  describe('correspondEtag', () => {
    const etag = etagFaible('x');
    it('reconnaît un ETag égal, en liste, sans W/ ou par étoile', () => {
      expect(correspondEtag(etag, etag)).toBe(true);
      expect(correspondEtag(`"autre" ,  ${etag}`, etag)).toBe(true);
      expect(correspondEtag(etag.slice(2), etag)).toBe(true);
      expect(correspondEtag('*', etag)).toBe(true);
    });
    it('refuse un en-tête absent ou différent', () => {
      expect(correspondEtag(undefined, etag)).toBe(false);
      expect(correspondEtag('W/"autre"', etag)).toBe(false);
    });
  });

  describe('choisirEncodage', () => {
    it.each([
      ['br, gzip', 'br'],
      ['gzip, deflate', 'gzip'],
      ['br;q=0, gzip', 'gzip'],
      ['deflate', 'identity'],
      [undefined, 'identity'],
      ['*', 'br'],
    ] as const)('« %s » donne %s', (entete, attendu) => {
      expect(choisirEncodage(entete)).toBe(attendu);
    });
  });

  describe('compresserJson', () => {
    const texte = JSON.stringify({ liste: Array(200).fill('médicament') });
    it('brotli et gzip redonnent le texte', () => {
      const br = compresserJson(texte, 'br');
      expect(br.encodage).toBe('br');
      expect(brotliDecompressSync(br.contenu).toString('utf8')).toBe(texte);
      const gz = compresserJson(texte, 'gzip');
      expect(gz.encodage).toBe('gzip');
      expect(gunzipSync(gz.contenu).toString('utf8')).toBe(texte);
    });
    it('identity renvoie le texte tel quel', () => {
      const brut = compresserJson(texte, undefined);
      expect(brut.encodage).toBe('identity');
      expect(brut.contenu.toString('utf8')).toBe(texte);
    });
  });
});
