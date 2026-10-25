import { Logger } from '@nestjs/common';
import { StructureService } from './structure.service';

/** Création de membre : un échec d'email ne défait pas la création. */
describe('StructureService : email de création de membre', () => {
  let envoyer: jest.Mock;
  let service: StructureService;

  const MESSAGE_ECHEC =
    "Membre créé, mais l'email contenant ses identifiants n'a pas pu être envoyé. Il pourra choisir son mot de passe avec « Mot de passe oublié » sur la page de connexion.";

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    envoyer = jest.fn();
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'a1', structureId: 'st1' })
          .mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue({
          id: 'm1',
          nom: 'Bah',
          prenom: 'Awa',
          email: 'awa@exemple.gn',
          telephone: null,
          role: 'MEDECIN',
          specialite: null,
          isActive: true,
          createdAt: new Date(),
        }),
      },
      structure: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'st1',
          nom: 'Clinique Test',
          type: 'CLINIQUE',
          isActive: true,
        }),
      },
    };
    const rolesService = {
      resolveAssignableRoleId: jest.fn().mockResolvedValue('r1'),
    };
    service = new StructureService(
      prisma as never,
      { sendMemberWelcomeEmail: envoyer } as never,
      {} as never,
      rolesService as never,
      {} as never,
      {} as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const creer = () =>
    service.createMembre('st1', 'a1', {
      nom: 'Bah',
      prenom: 'Awa',
      email: 'awa@exemple.gn',
      role: 'MEDECIN',
    } as never);

  it('email envoyé : message habituel et invitationEnvoyee vrai', async () => {
    envoyer.mockResolvedValue(true);
    const reponse = await creer();
    expect(reponse.success).toBe(true);
    expect(reponse.data.id).toBe('m1');
    expect(reponse.data.invitationEnvoyee).toBe(true);
    expect(reponse.message).toBe(
      'Membre créé. Un email avec les identifiants a été envoyé à awa@exemple.gn.',
    );
  });

  it('email non envoyé (false) : membre créé, message d échec', async () => {
    envoyer.mockResolvedValue(false);
    const reponse = await creer();
    expect(reponse.success).toBe(true);
    expect(reponse.data.invitationEnvoyee).toBe(false);
    expect(reponse.message).toBe(MESSAGE_ECHEC);
  });

  it('email rejeté : même résultat que false', async () => {
    envoyer.mockRejectedValue(new Error('x'));
    const reponse = await creer();
    expect(reponse.success).toBe(true);
    expect(reponse.data.invitationEnvoyee).toBe(false);
    expect(reponse.message).toBe(MESSAGE_ECHEC);
  });
});
