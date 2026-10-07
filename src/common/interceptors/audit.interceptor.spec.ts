import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';

function contexte(request: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function requete(surcharge: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    originalUrl: '/carnet-sante/consultations',
    route: { path: '/carnet-sante/consultations' },
    user: { userId: 'u1' },
    ip: '1.2.3.4',
    ...surcharge,
  };
}

const contenant = (attendu: Record<string, unknown>): unknown =>
  expect.objectContaining(attendu) as unknown;

describe('AuditInterceptor', () => {
  let create: jest.Mock;
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
    interceptor = new AuditInterceptor({ auditLog: { create } } as never);
  });

  const vider = () => new Promise((resolve) => setImmediate(resolve));

  it('un POST de création écrit un AuditLog', async () => {
    const handler: CallHandler = {
      handle: () => of({ success: true, data: { id: 'c1' }, message: 'ok' }),
    };
    await lastValueFrom(interceptor.intercept(contexte(requete()), handler));
    await vider();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: contenant({
        userId: 'u1',
        action: 'create',
        entityType: 'Consultation',
        entityId: 'c1',
        ip: '1.2.3.4',
      }),
    });
  });

  it('une réponse plate { id } est journalisée (repli)', async () => {
    const handler: CallHandler = { handle: () => of({ id: 'c2' }) };
    await lastValueFrom(interceptor.intercept(contexte(requete()), handler));
    await vider();

    expect(create).toHaveBeenCalledWith({
      data: contenant({ entityId: 'c2' }),
    });
  });

  it("un GET de liste sans ID n'écrit rien", async () => {
    const handler: CallHandler = {
      handle: () => of({ success: true, data: [], message: 'ok' }),
    };
    await lastValueFrom(
      interceptor.intercept(contexte(requete({ method: 'GET' })), handler),
    );
    await vider();

    expect(create).not.toHaveBeenCalled();
  });

  it('une erreur 403 écrit une action denied', async () => {
    const handler: CallHandler = {
      handle: () => throwError(() => ({ status: 403 })),
    };
    const req = requete({
      method: 'GET',
      originalUrl: '/carnet-sante/consultations/c3',
      route: { path: '/carnet-sante/consultations/:id' },
    });
    await expect(
      lastValueFrom(interceptor.intercept(contexte(req), handler)),
    ).rejects.toBeDefined();
    await vider();

    expect(create).toHaveBeenCalledWith({
      data: contenant({
        action: 'denied',
        entityId: 'c3',
      }),
    });
  });
});
