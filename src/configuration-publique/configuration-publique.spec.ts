import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import {
  CACHE_CONFIG,
  CACHE_VERSION,
  MESSAGE_VERSION_OBSOLETE,
} from './configuration-publique.constants';
import { ConfigurationPubliqueController } from './configuration-publique.controller';
import { ConfigurationPubliqueService } from './configuration-publique.service';
import { VersionMinimaleGuard } from './version-minimale.guard';

@Controller('essai')
class ControleurEssai {
  @Get()
  lire() {
    return { ok: true };
  }
}

describe('Configuration publique et version minimale (TB5)', () => {
  let app: INestApplication;

  async function creerApp(variables: Record<string, string | undefined>) {
    const module = await Test.createTestingModule({
      controllers: [ConfigurationPubliqueController, ControleurEssai],
      providers: [
        ConfigurationPubliqueService,
        {
          provide: ConfigService,
          useValue: { get: (cle: string) => variables[cle] },
        },
        { provide: APP_GUARD, useClass: VersionMinimaleGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    return app.getHttpServer() as Parameters<typeof request>[0];
  }

  afterEach(async () => {
    await app.close();
  });

  const obsolete = {
    'X-Client': 'mobile',
    'X-Plateforme': 'android',
    'X-App-Version': '1.0.0',
  };
  const minimaleAndroid = { APP_VERSION_MINIMALE_ANDROID: '1.2.0' };

  it('refuse en 426 un client mobile obsolète', async () => {
    const serveur = await creerApp(minimaleAndroid);
    const res = await request(serveur).get('/essai').set(obsolete);
    expect(res.status).toBe(426);
    expect(res.body).toMatchObject({
      code: 'VERSION_OBSOLETE',
      message: MESSAGE_VERSION_OBSOLETE,
      error: 'Mise à jour requise',
      statusCode: 426,
    });
  });

  it('laisse /app/version et /app/config accessibles au client obsolète', async () => {
    const serveur = await creerApp(minimaleAndroid);
    expect(
      (await request(serveur).get('/app/version').set(obsolete)).status,
    ).toBe(200);
    expect(
      (await request(serveur).get('/app/config').set(obsolete)).status,
    ).toBe(200);
  });

  it("n'affecte jamais le web", async () => {
    const serveur = await creerApp(minimaleAndroid);
    const sansClient = { 'X-Plateforme': 'android', 'X-App-Version': '1.0.0' };
    expect((await request(serveur).get('/essai').set(sansClient)).status).toBe(
      200,
    );
    expect(
      (
        await request(serveur)
          .get('/essai')
          .set({ ...sansClient, 'X-Client': 'web' })
      ).status,
    ).toBe(200);
  });

  it('compare la version à la minimale, casse et espaces ignorés', async () => {
    const serveur = await creerApp(minimaleAndroid);
    const avec = (version: string) =>
      request(serveur)
        .get('/essai')
        .set({ ...obsolete, 'X-App-Version': version });
    expect((await avec('1.2.0')).status).toBe(200);
    expect((await avec('1.10.0')).status).toBe(200);
    const res = await request(serveur)
      .get('/essai')
      .set({ ...obsolete, 'X-Client': ' Mobile ' });
    expect(res.status).toBe(426);
  });

  it('applique la minimale de chaque plateforme séparément', async () => {
    const serveur = await creerApp(minimaleAndroid);
    const res = await request(serveur)
      .get('/essai')
      .set({ ...obsolete, 'X-Plateforme': 'ios' });
    expect(res.status).toBe(200);
  });

  it('ne bloque personne quand aucune variable n’est réglée', async () => {
    const serveur = await creerApp({});
    const res = await request(serveur)
      .get('/essai')
      .set({ ...obsolete, 'X-App-Version': '0.0.1' });
    expect(res.status).toBe(200);
  });

  it('laisse passer quand un en-tête est absent ou illisible', async () => {
    const serveur = await creerApp(minimaleAndroid);
    const sansVersion = { 'X-Client': 'mobile', 'X-Plateforme': 'android' };
    const sansPlateforme = { 'X-Client': 'mobile', 'X-App-Version': '1.0.0' };
    const requetes = [
      sansVersion,
      { ...obsolete, 'X-App-Version': 'abc' },
      sansPlateforme,
      { ...obsolete, 'X-Plateforme': 'windows' },
    ];
    for (const entetes of requetes) {
      expect((await request(serveur).get('/essai').set(entetes)).status).toBe(
        200,
      );
    }
  });

  it('GET /app/version sans variable : défauts 0.0.0 et cache court', async () => {
    const serveur = await creerApp({});
    const res = await request(serveur).get('/app/version');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(CACHE_VERSION);
    const vide = {
      versionMinimale: '0.0.0',
      versionRecommandee: '0.0.0',
      urlTelechargement: null,
    };
    expect(res.body).toEqual({
      success: true,
      data: { android: vide, ios: vide },
    });
  });

  it('GET /app/version : recommandée relevée à la minimale, URL servie', async () => {
    const url = 'https://play.google.com/store/apps/details?id=com.medconnecte';
    const serveur = await creerApp({
      APP_VERSION_MINIMALE_ANDROID: '1.2.0',
      APP_VERSION_RECOMMANDEE_ANDROID: '1.5.0',
      APP_URL_TELECHARGEMENT_ANDROID: url,
      APP_VERSION_MINIMALE_IOS: '2.0.0',
      APP_VERSION_RECOMMANDEE_IOS: '1.0.0',
    });
    const res = await request(serveur).get('/app/version');
    const donnees = (res.body as { data: Record<string, unknown> }).data;
    expect(donnees.android).toEqual({
      versionMinimale: '1.2.0',
      versionRecommandee: '1.5.0',
      urlTelechargement: url,
    });
    expect(donnees.ios).toEqual({
      versionMinimale: '2.0.0',
      versionRecommandee: '2.0.0',
      urlTelechargement: null,
    });
  });

  it('GET /app/config sans variable : valeurs par défaut, aucune autre clé', async () => {
    const serveur = await creerApp({});
    const res = await request(serveur).get('/app/config');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe(CACHE_CONFIG);
    expect(res.body).toEqual({
      success: true,
      data: {
        numerosUrgence: [
          {
            code: 'URGENCE_MEDICALE',
            libelle: 'Urgences médicales',
            numero: '15',
          },
        ],
        versionsDocuments: { cgu: '1.0', politiqueConfidentialite: '1.0' },
        fonctions: {
          espaceSoignant: false,
          annulationSos: false,
          boutonDemo: false,
        },
      },
    });
  });

  it('GET /app/config avec variables réglées', async () => {
    const serveur = await creerApp({
      NUMERO_URGENCE_MEDICALE: '117',
      VERSION_CGU: '2026-10',
      VERSION_POLITIQUE_CONFIDENTIALITE: '2',
      FONCTION_ESPACE_SOIGNANT: 'TRUE',
      FONCTION_ANNULATION_SOS: 'false',
      FONCTION_BOUTON_DEMO: 'true',
    });
    const res = await request(serveur).get('/app/config');
    expect(res.body).toMatchObject({
      data: {
        numerosUrgence: [{ numero: '117' }],
        versionsDocuments: { cgu: '2026-10', politiqueConfidentialite: '2' },
        fonctions: {
          espaceSoignant: true,
          annulationSos: false,
          boutonDemo: true,
        },
      },
    });
  });

  it('le contrôleur échappe au limiteur de débit', () => {
    expect(
      Reflect.getMetadata(
        'THROTTLER:SKIPdefault',
        ConfigurationPubliqueController,
      ),
    ).toBe(true);
  });
});
