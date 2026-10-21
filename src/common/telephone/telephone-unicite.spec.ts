import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { AllExceptionsFilter } from 'src/common/filters/all-exceptions.filter';
import {
  MESSAGE_TELEPHONE_DEJA_UTILISE,
  MESSAGE_TELEPHONE_INVALIDE,
} from './telephone';
import {
  avecTelephoneUnique,
  erreurTelephoneDejaUtilise,
  exigerTelephone,
  verifierTelephoneLibre,
} from './telephone-unicite';

const CHAMPS = [{ champ: 'telephone', contraintes: ['formatTelephone'] }];

function capturer(action: () => unknown): unknown {
  try {
    action();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('exigerTelephone', () => {
  it('renvoie le numéro normalisé', () => {
    expect(exigerTelephone('622 98 87 76')).toBe('+224622988776');
  });

  it('lève un 400 VALIDATION sur le champ telephone', () => {
    const erreur = capturer(() => exigerTelephone('12345'));

    expect(erreur).toBeInstanceOf(BadRequestException);
    expect((erreur as BadRequestException).getResponse()).toEqual({
      message: MESSAGE_TELEPHONE_INVALIDE,
      code: 'VALIDATION',
      champs: CHAMPS,
    });
  });
});

describe('verifierTelephoneLibre', () => {
  const findFirst = jest.fn();
  const client = { user: { findFirst } } as never;

  beforeEach(() => findFirst.mockReset());

  it('résout quand personne ne porte le numéro', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      verifierTelephoneLibre(client, '+224622988776'),
    ).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: { telephoneNormalise: '+224622988776' },
      select: { id: true },
    });
  });

  it('exclut le compte indiqué', async () => {
    findFirst.mockResolvedValue(null);

    await verifierTelephoneLibre(client, '+224622988776', 'u1');

    expect(findFirst).toHaveBeenCalledWith({
      where: { telephoneNormalise: '+224622988776', id: { not: 'u1' } },
      select: { id: true },
    });
  });

  it('lève un 409 quand un autre compte porte le numéro', async () => {
    findFirst.mockResolvedValue({ id: 'autre' });

    const erreur: unknown = await verifierTelephoneLibre(
      client,
      '+224622988776',
    ).catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ConflictException);
    expect((erreur as ConflictException).getResponse()).toEqual({
      message: 'Ce numéro est déjà utilisé par un autre compte.',
      code: 'TELEPHONE_DEJA_UTILISE',
    });
  });
});

describe('avecTelephoneUnique', () => {
  const p2002 = (message: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError(message, {
      code: 'P2002',
      clientVersion: '7.0.0',
      meta,
    });

  it("renvoie la valeur de l'écriture réussie", async () => {
    await expect(avecTelephoneUnique(Promise.resolve(42))).resolves.toBe(42);
  });

  it('traduit un P2002 citant la colonne dans le message en 409', async () => {
    const erreur: unknown = await avecTelephoneUnique(
      Promise.reject(
        p2002(
          'Unique constraint failed on the fields: (`"telephoneNormalise"`)',
        ),
      ),
    ).catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ConflictException);
    expect((erreur as ConflictException).getResponse()).toEqual({
      message: MESSAGE_TELEPHONE_DEJA_UTILISE,
      code: 'TELEPHONE_DEJA_UTILISE',
    });
  });

  it('traduit un P2002 citant la colonne dans meta en 409', async () => {
    const erreur: unknown = await avecTelephoneUnique(
      Promise.reject(
        p2002('Unique constraint failed', { target: ['telephoneNormalise'] }),
      ),
    ).catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ConflictException);
  });

  it('laisse passer un P2002 sur une autre colonne', async () => {
    const origine = p2002('Unique constraint failed on (`email`)', {
      target: ['email'],
    });

    const erreur: unknown = await avecTelephoneUnique(
      Promise.reject(origine),
    ).catch((e: unknown) => e);

    expect(erreur).toBe(origine);
  });

  it('laisse passer une erreur quelconque', async () => {
    const origine = new Error('panne');

    const erreur: unknown = await avecTelephoneUnique(
      Promise.reject(origine),
    ).catch((e: unknown) => e);

    expect(erreur).toBe(origine);
  });
});

describe('contrat HTTP via AllExceptionsFilter', () => {
  const reponse = (exception: unknown) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', path: '/auth/register' }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(exception, host);
    return (json.mock.calls[0] as [Record<string, unknown>])[0];
  };

  it('numéro déjà utilisé : 409 avec son code et son message', () => {
    expect(reponse(erreurTelephoneDejaUtilise())).toMatchObject({
      statusCode: 409,
      code: 'TELEPHONE_DEJA_UTILISE',
      message: 'Ce numéro est déjà utilisé par un autre compte.',
    });
  });

  it('numéro invalide : 400 VALIDATION avec le champ telephone', () => {
    const erreur = capturer(() => exigerTelephone('12345'));

    expect(reponse(erreur)).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION',
      champs: CHAMPS,
      message: MESSAGE_TELEPHONE_INVALIDE,
    });
  });
});
