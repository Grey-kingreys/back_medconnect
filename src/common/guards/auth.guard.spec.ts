import { UnauthorizedException } from '@nestjs/common';
import { TokenExpiredError } from '@nestjs/jwt';
import { MESSAGES_SESSION } from 'src/auth/sessions.constants';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  let jwt: { verifyAsync: jest.Mock };
  let revocation: { verifier: jest.Mock };
  let garde: AuthGuard;
  const charge = { userId: 'u1', role: 'MEDECIN', sid: 's1' };

  const contexte = (authorization?: string) => {
    const req: Record<string, unknown> = { headers: { authorization } };
    return {
      req,
      ctx: { switchToHttp: () => ({ getRequest: () => req }) } as never,
    };
  };

  const attraper = async (promesse: Promise<unknown>) => {
    try {
      await promesse;
    } catch (e) {
      return e as UnauthorizedException;
    }
    throw new Error('Une exception était attendue');
  };

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn().mockResolvedValue(charge) };
    revocation = { verifier: jest.fn().mockResolvedValue(null) };
    garde = new AuthGuard(jwt as never, revocation as never);
  });

  it('jeton valide et non révoqué : accès accordé, utilisateur posé', async () => {
    const { req, ctx } = contexte('Bearer jeton');
    await expect(garde.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual(charge);
    expect(revocation.verifier).toHaveBeenCalledWith({
      userId: 'u1',
      sid: 's1',
    });
  });

  it('SESSION_REVOQUEE : 401 avec le code et le message', async () => {
    revocation.verifier.mockResolvedValue('SESSION_REVOQUEE');
    const e = await attraper(garde.canActivate(contexte('Bearer jeton').ctx));
    expect(e).toBeInstanceOf(UnauthorizedException);
    expect(e.getResponse()).toMatchObject({
      code: 'SESSION_REVOQUEE',
      message: MESSAGES_SESSION.revoquee,
    });
  });

  it('COMPTE_DESACTIVE : message du compte désactivé', async () => {
    revocation.verifier.mockResolvedValue('COMPTE_DESACTIVE');
    const e = await attraper(garde.canActivate(contexte('Bearer jeton').ctx));
    expect(e.getResponse()).toMatchObject({
      code: 'COMPTE_DESACTIVE',
      message: MESSAGES_SESSION.compteDesactive,
    });
  });

  it('jeton invalide : message inchangé, sans contrôle de révocation', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('signature'));
    const e = await attraper(garde.canActivate(contexte('Bearer jeton').ctx));
    expect(e.message).toBe('Token invalide ou expiré.');
    expect(e.getResponse()).toMatchObject({ code: 'JETON_INVALIDE' });
    expect(revocation.verifier).not.toHaveBeenCalled();
  });

  it('jeton expiré : code JETON_EXPIRE, sans contrôle de révocation', async () => {
    jwt.verifyAsync.mockRejectedValue(
      new TokenExpiredError('jwt expired', new Date()),
    );
    const e = await attraper(garde.canActivate(contexte('Bearer jeton').ctx));
    expect(e).toBeInstanceOf(UnauthorizedException);
    expect(e.getStatus()).toBe(401);
    expect(e.getResponse()).toMatchObject({
      code: 'JETON_EXPIRE',
      message: 'Token invalide ou expiré.',
    });
    expect(revocation.verifier).not.toHaveBeenCalled();
  });

  it('jeton absent : message inchangé et code JETON_ABSENT', async () => {
    const e = await attraper(garde.canActivate(contexte().ctx));
    expect(e.message).toBe('Token manquant. Veuillez vous connecter.');
    expect(e.getResponse()).toMatchObject({ code: 'JETON_ABSENT' });
  });
});
