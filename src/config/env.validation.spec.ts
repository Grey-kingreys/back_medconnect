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
});
