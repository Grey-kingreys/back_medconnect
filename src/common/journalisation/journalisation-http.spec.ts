import { createServer } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { Writable } from 'stream';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import {
  niveauJournalHttp,
  optionsPinoHttp,
  serialiserReponseHttp,
  serialiserRequeteHttp,
} from './journalisation-http';

describe('serialiserRequeteHttp', () => {
  it('ne garde que id, method et url sans query', () => {
    const entree: Record<string, unknown> = {
      id: 7,
      method: 'GET',
      url: '/structures?email=a%40b.gn&page=2',
      headers: { 'user-agent': 'x', 'x-forwarded-for': '41.223.1.2' },
      remoteAddress: '41.223.1.2',
      remotePort: 5555,
      query: { email: 'a@b.gn' },
      params: {},
    };
    const resultat = serialiserRequeteHttp(entree);
    expect(resultat).toEqual({ id: 7, method: 'GET', url: '/structures' });
    expect(Object.keys(resultat)).toEqual(['id', 'method', 'url']);
  });

  it('laisse une URL sans query inchangée', () => {
    const resultat = serialiserRequeteHttp({
      id: 1,
      method: 'GET',
      url: '/notifications',
    });
    expect(resultat.url).toBe('/notifications');
  });
});

describe('serialiserReponseHttp', () => {
  it('ne garde que le statut', () => {
    const entree: Record<string, unknown> = {
      statusCode: 201,
      headers: {
        'set-cookie': 'refresh=abc',
        'content-type': 'application/json',
      },
    };
    expect(serialiserReponseHttp(entree)).toEqual({ statusCode: 201 });
  });
});

describe('niveauJournalHttp', () => {
  const niveau = (
    method: string,
    statusCode: number,
    chemins: { url?: string; originalUrl?: string },
    err?: Error,
  ) =>
    niveauJournalHttp(
      { method, ...chemins } as unknown as IncomingMessage & {
        originalUrl?: string;
      },
      { statusCode } as unknown as ServerResponse,
      err,
    );

  it('erreur serveur : error', () => {
    expect(niveau('GET', 500, { url: '/structures' })).toBe('error');
  });

  it('erreur présente : error', () => {
    expect(niveau('GET', 200, { url: '/structures' }, new Error('x'))).toBe(
      'error',
    );
  });

  it('POST /auth/login 401 : warn', () => {
    expect(niveau('POST', 401, { url: '/auth/login' })).toBe('warn');
  });

  it('GET /notifications 404 : warn', () => {
    expect(niveau('GET', 404, { url: '/notifications' })).toBe('warn');
  });

  it('GET /notifications 200 : debug', () => {
    expect(niveau('GET', 200, { url: '/notifications' })).toBe('debug');
  });

  it('GET /notifications?page=2 200 : debug', () => {
    expect(niveau('GET', 200, { originalUrl: '/notifications?page=2' })).toBe(
      'debug',
    );
  });

  it('GET / 200 : debug', () => {
    expect(niveau('GET', 200, { url: '/' })).toBe('debug');
  });

  it('GET /notifications/abc 200 : info', () => {
    expect(niveau('GET', 200, { url: '/notifications/abc' })).toBe('info');
  });

  it('PATCH /notifications/read-all 200 : info', () => {
    expect(niveau('PATCH', 200, { url: '/notifications/read-all' })).toBe(
      'info',
    );
  });

  it('GET /structures 200 : info', () => {
    expect(niveau('GET', 200, { url: '/structures' })).toBe('info');
  });

  it('originalUrl absent, url /notifications : debug', () => {
    expect(niveau('GET', 200, { url: '/notifications' })).toBe('debug');
  });
});

describe('optionsPinoHttp, de bout en bout avec pino-http', () => {
  let lignes: string[];
  let serveur: ReturnType<typeof createServer>;

  beforeEach(() => {
    lignes = [];
    const flux = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lignes.push(chunk.toString());
        cb();
      },
    });
    const journal = pinoHttp(
      { ...optionsPinoHttp(), transport: undefined, level: 'trace' },
      flux,
    );
    serveur = createServer((req, res) => {
      journal(req, res);
      if (req.url?.startsWith('/structures')) {
        res.setHeader('set-cookie', 'refresh=secret');
        res.statusCode = 200;
      } else if (req.url === '/notifications') {
        res.statusCode = 200;
      } else if (req.url === '/erreur') {
        res.statusCode = 500;
      } else {
        res.statusCode = 404;
      }
      res.end('ok');
    });
  });

  afterEach(() => {
    serveur.close();
  });

  const lignesDeFin = async () => {
    await new Promise((r) => setImmediate(r));
    return lignes
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => 'res' in l);
  };

  it('ne laisse passer ni en-tête ni IP', async () => {
    await request(serveur)
      .get('/structures?email=a%40b.gn')
      .set('user-agent', 'test-agent')
      .set('x-forwarded-for', '41.223.1.2')
      .set('cf-connecting-ip', '41.223.1.3')
      .set('referer', 'https://exemple.gn/page')
      .set('authorization', 'Bearer jeton-secret')
      .set('cookie', 'refresh=secret');
    const finales = await lignesDeFin();
    expect(finales).toHaveLength(1);
    const ligne = finales[0];
    expect(ligne.level).toBe(30);
    expect(ligne.req).toEqual({
      id: expect.anything() as unknown,
      method: 'GET',
      url: '/structures',
    });
    expect(ligne.res).toEqual({ statusCode: 200 });
    expect(typeof ligne.responseTime).toBe('number');
    const brute = lignes.join('\n');
    for (const interdit of [
      '41.223.1.2',
      '41.223.1.3',
      'test-agent',
      'exemple.gn',
      'jeton-secret',
      'secret',
      'a%40b.gn',
      'remoteAddress',
      'headers',
    ]) {
      expect(brute).not.toContain(interdit);
    }
  });

  it('GET /notifications : debug', async () => {
    await request(serveur).get('/notifications');
    const finales = await lignesDeFin();
    expect(finales[0].level).toBe(20);
  });

  it('GET /absent : warn', async () => {
    await request(serveur).get('/absent');
    const finales = await lignesDeFin();
    expect(finales[0].level).toBe(40);
  });

  it('GET /erreur : error avec la clé err', async () => {
    await request(serveur).get('/erreur');
    const finales = await lignesDeFin();
    expect(finales[0].level).toBe(50);
    expect(finales[0]).toHaveProperty('err');
  });
});
