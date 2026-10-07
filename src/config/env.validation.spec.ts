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
});
