import { ForbiddenException } from '@nestjs/common';
import { CarnetSanteController } from './carnet-sante.controller';

describe('CarnetSanteController : SOS réservé aux patients', () => {
  let service: { createUrgence: jest.Mock };
  let controller: CarnetSanteController;

  beforeEach(() => {
    service = { createUrgence: jest.fn().mockResolvedValue({ success: true }) };
    controller = new CarnetSanteController(service as never);
  });

  it.each([
    'MEDECIN',
    'ACCUEIL',
    'PHARMACIEN',
    'STRUCTURE_ADMIN',
    'ADMIN',
    'SUPER_ADMIN',
  ])('refuse le rôle %s avec SOS_ROLE_INTERDIT', (role) => {
    const appel = () =>
      controller.createUrgence(
        { user: { userId: 'u1', role } } as never,
        {} as never,
      );
    expect(appel).toThrow(ForbiddenException);
    let reponse: unknown;
    try {
      void appel();
    } catch (e) {
      reponse = (e as ForbiddenException).getResponse();
    }
    expect(reponse).toMatchObject({ code: 'SOS_ROLE_INTERDIT' });
    expect(service.createUrgence).not.toHaveBeenCalled();
  });

  it('laisse passer un patient', async () => {
    const dto = {};
    await controller.createUrgence(
      { user: { userId: 'u1', role: 'PATIENT' } } as never,
      dto as never,
    );
    expect(service.createUrgence).toHaveBeenCalledWith('u1', dto);
  });
});
