import { validateEnv } from './env.validation';

// Valeurs factices, visiblement fausses, qui satisfont les variables obligatoires
function configMinimale(): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_SECRET: 'x'.repeat(40),
    ENCRYPTION_KEY: '0'.repeat(64),
    RESEND_API_KEY: 're_factice',
    SUPER_ADMIN_EMAIL: 'admin@exemple.test',
    SUPER_ADMIN_PASSWORD: 'motdepasse-factice-long',
    R2_ACCOUNT_ID: 'factice',
    R2_ACCESS_KEY_ID: 'factice',
    R2_SECRET_ACCESS_KEY: 'factice',
    R2_BUCKET_PUBLIC: 'factice',
    R2_BUCKET_PRIVATE: 'factice',
    R2_PUBLIC_URL: 'https://cdn.exemple.test',
  };
}

describe('validateEnv', () => {
  it('accepte une configuration minimale', () => {
    expect(() => validateEnv(configMinimale())).not.toThrow();
  });

  describe('AI_SHARED_SECRET', () => {
    it('accepte la variable absente', () => {
      expect(() => validateEnv(configMinimale())).not.toThrow();
    });

    it('rejette un secret de moins de 32 caractères', () => {
      expect(() =>
        validateEnv({ ...configMinimale(), AI_SHARED_SECRET: 'trop-court' }),
      ).toThrow(/AI_SHARED_SECRET/);
    });

    it('accepte un secret de 32 caractères ou plus', () => {
      expect(() =>
        validateEnv({ ...configMinimale(), AI_SHARED_SECRET: 'a'.repeat(32) }),
      ).not.toThrow();
    });
  });

  describe('SWAGGER_ENABLED', () => {
    it('accepte la variable absente', () => {
      expect(() => validateEnv(configMinimale())).not.toThrow();
    });

    it('accepte true', () => {
      expect(() =>
        validateEnv({ ...configMinimale(), SWAGGER_ENABLED: 'true' }),
      ).not.toThrow();
    });

    it('rejette une valeur autre que true ou false', () => {
      expect(() =>
        validateEnv({ ...configMinimale(), SWAGGER_ENABLED: 'oui' }),
      ).toThrow(/SWAGGER_ENABLED/);
    });
  });

  describe('DEMO_MODE', () => {
    const valeurInitiale = process.env.DEMO_MODE;
    afterEach(() => {
      if (valeurInitiale === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = valeurInitiale;
    });

    it('variable absente : défaut false', () => {
      const config = validateEnv(configMinimale());
      expect(config.DEMO_MODE).toBe('false');
    });

    it.each(['true', 'TRUE', ' true ', 'false', 'False'])(
      'accepte « %s »',
      (valeur) => {
        expect(() =>
          validateEnv({ ...configMinimale(), DEMO_MODE: valeur }),
        ).not.toThrow();
      },
    );

    it.each(['oui', '1', 'yes', 'actif'])(
      'refuse au démarrage la valeur « %s »',
      (valeur) => {
        expect(() =>
          validateEnv({ ...configMinimale(), DEMO_MODE: valeur }),
        ).toThrow(/DEMO_MODE/);
      },
    );
  });

  describe('DEMO_RESET', () => {
    const valeurInitiale = process.env.DEMO_RESET;
    afterEach(() => {
      if (valeurInitiale === undefined) delete process.env.DEMO_RESET;
      else process.env.DEMO_RESET = valeurInitiale;
    });

    it('variable absente : défaut false', () => {
      const config = validateEnv(configMinimale());
      expect(config.DEMO_RESET).toBe('false');
    });

    it.each(['true', 'TRUE', ' true ', 'false', 'False'])(
      'accepte « %s »',
      (valeur) => {
        expect(() =>
          validateEnv({ ...configMinimale(), DEMO_RESET: valeur }),
        ).not.toThrow();
      },
    );

    it.each(['oui', '1', 'yes', 'reset'])(
      'refuse au démarrage la valeur « %s »',
      (valeur) => {
        expect(() =>
          validateEnv({ ...configMinimale(), DEMO_RESET: valeur }),
        ).toThrow(/DEMO_RESET/);
      },
    );
  });

  describe('SESSIONS_MULTI_APPAREILS', () => {
    const valeurInitiale = process.env.SESSIONS_MULTI_APPAREILS;
    afterEach(() => {
      if (valeurInitiale === undefined)
        delete process.env.SESSIONS_MULTI_APPAREILS;
      else process.env.SESSIONS_MULTI_APPAREILS = valeurInitiale;
    });

    it('variable absente : défaut true', () => {
      const config = validateEnv(configMinimale());
      expect(config.SESSIONS_MULTI_APPAREILS).toBe('true');
    });

    it('refuse au démarrage la valeur « peut-etre »', () => {
      expect(() =>
        validateEnv({
          ...configMinimale(),
          SESSIONS_MULTI_APPAREILS: 'peut-etre',
        }),
      ).toThrow(/SESSIONS_MULTI_APPAREILS/);
    });

    it('accepte « FALSE »', () => {
      expect(() =>
        validateEnv({ ...configMinimale(), SESSIONS_MULTI_APPAREILS: 'FALSE' }),
      ).not.toThrow();
    });
  });

  describe('Application mobile et configuration publique (TB5)', () => {
    const cles = [
      'APP_VERSION_MINIMALE_ANDROID',
      'APP_VERSION_RECOMMANDEE_ANDROID',
      'APP_URL_TELECHARGEMENT_ANDROID',
      'APP_VERSION_MINIMALE_IOS',
      'APP_VERSION_RECOMMANDEE_IOS',
      'APP_URL_TELECHARGEMENT_IOS',
      'NUMERO_URGENCE_MEDICALE',
      'VERSION_CGU',
      'VERSION_POLITIQUE_CONFIDENTIALITE',
      'FONCTION_ESPACE_SOIGNANT',
      'FONCTION_ANNULATION_SOS',
      'FONCTION_BOUTON_DEMO',
    ];
    const initiales = Object.fromEntries(
      cles.map((cle) => [cle, process.env[cle]]),
    );
    afterEach(() => {
      for (const cle of cles) {
        if (initiales[cle] === undefined) delete process.env[cle];
        else process.env[cle] = initiales[cle];
      }
    });

    it('variables absentes : défauts appliqués, URL sans défaut', () => {
      const config = validateEnv(configMinimale());
      expect(config.APP_VERSION_MINIMALE_ANDROID).toBe('0.0.0');
      expect(config.NUMERO_URGENCE_MEDICALE).toBe('15');
      expect(config.VERSION_CGU).toBe('1.0');
      expect(config.FONCTION_ANNULATION_SOS).toBe('false');
      expect(config.APP_URL_TELECHARGEMENT_IOS).toBeUndefined();
    });

    it.each([
      ['APP_VERSION_MINIMALE_IOS', '1.2'],
      ['APP_URL_TELECHARGEMENT_ANDROID', 'play.google.com/x'],
      ['NUMERO_URGENCE_MEDICALE', '15 ou 18'],
      ['VERSION_CGU', 'version une'],
      ['FONCTION_BOUTON_DEMO', 'oui'],
    ])('refuse au démarrage %s = « %s »', (nom, valeur) => {
      expect(() => validateEnv({ ...configMinimale(), [nom]: valeur })).toThrow(
        new RegExp(nom),
      );
    });

    it.each([
      ['APP_VERSION_RECOMMANDEE_ANDROID', '1.4.0'],
      ['NUMERO_URGENCE_MEDICALE', '+224117'],
      ['FONCTION_ESPACE_SOIGNANT', 'TRUE'],
    ])('accepte %s = « %s »', (nom, valeur) => {
      expect(() =>
        validateEnv({ ...configMinimale(), [nom]: valeur }),
      ).not.toThrow();
    });
  });
});
