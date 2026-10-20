import { BadRequestException } from '@nestjs/common';
import { lireInfosClient, typeClient } from './client';

/** Détection du client (web ou mobile) et lecture des infos d'appareil. */
describe('client', () => {
  const valeurInitiale = process.env.SESSIONS_MULTI_APPAREILS;
  const requete = (entetes: Record<string, string | string[]> = {}) =>
    ({ headers: entetes }) as never;
  const appareil = {
    deviceId: 'appareil-test-1',
    plateforme: 'android',
    nomAppareil: 'Tecno Spark',
    versionApp: '1.0.0',
  };

  afterEach(() => {
    if (valeurInitiale === undefined)
      delete process.env.SESSIONS_MULTI_APPAREILS;
    else process.env.SESSIONS_MULTI_APPAREILS = valeurInitiale;
  });

  it('sans en-tête : client web', () => {
    expect(typeClient(requete())).toBe('WEB');
    expect(lireInfosClient(requete())).toEqual({ type: 'WEB' });
  });

  it('en-tête « Mobile  » (casse et espaces ignorés) : client mobile', () => {
    const req = requete({ 'x-client': 'Mobile ' });
    expect(typeClient(req)).toBe('MOBILE');
    expect(lireInfosClient(req, appareil)).toEqual({
      type: 'MOBILE',
      ...appareil,
    });
  });

  it('en-tête en tableau : le premier élément est lu', () => {
    expect(typeClient(requete({ 'x-client': ['mobile', 'web'] }))).toBe(
      'MOBILE',
    );
  });

  it.each([{}, { deviceId: 'appareil-test-1' }, { plateforme: 'ios' }])(
    'mobile sans deviceId ou plateforme (%p) : 400 avec le code VALIDATION',
    (dto) => {
      const req = requete({ 'x-client': 'mobile' });
      let erreur: unknown;
      try {
        lireInfosClient(req, dto);
      } catch (e) {
        erreur = e;
      }
      expect(erreur).toBeInstanceOf(BadRequestException);
      expect((erreur as BadRequestException).getResponse()).toMatchObject({
        code: 'VALIDATION',
      });
    },
  );

  it('mobile sans aucun DTO : 400', () => {
    const req = requete({ 'x-client': 'mobile' });
    expect(() => lireInfosClient(req)).toThrow(BadRequestException);
    let erreur: unknown;
    try {
      lireInfosClient(req);
    } catch (e) {
      erreur = e;
    }
    expect((erreur as BadRequestException).getResponse()).toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('drapeau SESSIONS_MULTI_APPAREILS=false : web même avec l en-tête', () => {
    process.env.SESSIONS_MULTI_APPAREILS = 'false';
    const req = requete({ 'x-client': 'mobile' });
    expect(typeClient(req)).toBe('WEB');
    expect(lireInfosClient(req)).toEqual({ type: 'WEB' });
  });

  it('web : les champs appareil du DTO sont ignorés', () => {
    expect(lireInfosClient(requete(), appareil)).toEqual({ type: 'WEB' });
  });
});
