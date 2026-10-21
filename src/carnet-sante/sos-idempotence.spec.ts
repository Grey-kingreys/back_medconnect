import { Prisma } from 'generated/prisma/client';
import {
  lireCleIdempotence,
  estBilanSos,
  estConflitCleIdempotence,
  donneesUrgencePubliques,
} from './sos-idempotence';

describe('lireCleIdempotence', () => {
  it('accepte un UUID et retire les espaces autour', () => {
    const uuid = '3f6c2a1e-8b4d-4c7a-9e21-5d0b7f3a6c11';
    expect(lireCleIdempotence(uuid)).toBe(uuid);
    expect(lireCleIdempotence(`  ${uuid}  `)).toBe(uuid);
  });

  it.each([
    undefined,
    '',
    'abcdefg',
    'a'.repeat(129),
    'cle avec espace',
    'clé-accentuée',
  ])('ignore la clé %p', (valeur) => {
    expect(lireCleIdempotence(valeur)).toBeNull();
  });
});

describe('estBilanSos', () => {
  const bilan = {
    structuresAlertees: 1,
    soignantsAlertes: 2,
    procheAlerte: false,
    positionTransmise: true,
    positionUtilisee: true,
    qualitePosition: 'precise',
    precisionMetres: 12,
    message: 'Alerte envoyée.',
  };

  it('reconnaît un bilan complet', () => {
    expect(estBilanSos(bilan)).toBe(true);
    expect(estBilanSos({ ...bilan, precisionMetres: null })).toBe(true);
  });

  it('refuse un bilan incomplet ou mal typé', () => {
    const sansMessage = { ...bilan, message: undefined };
    expect(estBilanSos(null)).toBe(false);
    expect(estBilanSos({})).toBe(false);
    expect(estBilanSos(sansMessage)).toBe(false);
    expect(estBilanSos({ ...bilan, precisionMetres: '12' })).toBe(false);
  });
});

describe('estConflitCleIdempotence', () => {
  const erreur = (code: string, message: string) =>
    new Prisma.PrismaClientKnownRequestError(message, {
      code,
      clientVersion: '7.0.0',
    });

  it('reconnaît un P2002 sur la clé d’idempotence', () => {
    expect(
      estConflitCleIdempotence(
        erreur(
          'P2002',
          'Unique constraint failed on (patientId,cleIdempotence)',
        ),
      ),
    ).toBe(true);
  });

  it('refuse les autres erreurs', () => {
    expect(
      estConflitCleIdempotence(
        erreur('P2002', 'Unique constraint failed on telephoneNormalise'),
      ),
    ).toBe(false);
    expect(estConflitCleIdempotence(erreur('P2025', 'cleIdempotence'))).toBe(
      false,
    );
    expect(estConflitCleIdempotence(new Error('x'))).toBe(false);
  });
});

describe('donneesUrgencePubliques', () => {
  it('retire patient, clé et bilan, garde le reste', () => {
    expect(
      donneesUrgencePubliques({
        id: 'u1',
        status: 'LANCE',
        patient: { nom: 'Diallo' },
        cleIdempotence: 'cle-essai-0001',
        bilanDiffusion: { message: 'x' },
      }),
    ).toEqual({ id: 'u1', status: 'LANCE' });
  });
});
