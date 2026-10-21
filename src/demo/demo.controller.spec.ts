import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { ConnexionDemoDto } from './dto/connexion-demo.dto';

/**
 * Routes du mode démo : 404 quand le mode est inactif, liste triée et connexion
 * déléguée à AuthService quand il est actif. Prisma et AuthService sont simulés.
 */
describe('DemoController et DemoService', () => {
  const ID_DEMO = '3f1c2a7e-8d4b-4c1e-9a55-2b7f0c9e6d10';
  const valeurInitiale = process.env.DEMO_MODE;

  let prisma: { user: { findMany: jest.Mock } };
  let authService: { connexionDemo: jest.Mock };
  let controller: DemoController;
  const res = { cookie: jest.fn() };
  const req = { headers: {} };

  beforeEach(() => {
    prisma = { user: { findMany: jest.fn().mockResolvedValue([]) } };
    authService = {
      connexionDemo: jest.fn().mockResolvedValue({
        success: true,
        data: {},
        message: 'Connexion réussie',
      }),
    };
    controller = new DemoController(
      new DemoService(prisma as never),
      authService as never,
    );
  });

  afterEach(() => {
    if (valeurInitiale === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = valeurInitiale;
  });

  describe('mode inactif', () => {
    it.each([undefined, 'false', 'FALSE'])(
      'DEMO_MODE=%s : les deux routes répondent 404',
      async (valeur) => {
        if (valeur === undefined) delete process.env.DEMO_MODE;
        else process.env.DEMO_MODE = valeur;

        await expect(controller.listerComptes()).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(() =>
          controller.connexion({ userId: ID_DEMO }, res as never, req as never),
        ).toThrow(NotFoundException);

        expect(prisma.user.findMany).not.toHaveBeenCalled();
        expect(authService.connexionDemo).not.toHaveBeenCalled();
      },
    );
  });

  describe('mode actif', () => {
    beforeEach(() => {
      process.env.DEMO_MODE = ' TRUE ';
    });

    it('liste un compte vitrine par rôle, trié par rôle, avec libellé et description', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: '1',
          email: 'superadmin@demo.medconnecte.gn',
          nom: 'Barry',
          prenom: 'Thierno',
          role: 'SUPER_ADMIN',
          structure: null,
        },
        {
          id: '2',
          email: 'dr.mamadou.diallo@demo.medconnecte.gn',
          nom: 'Diallo',
          prenom: 'Mamadou',
          role: 'MEDECIN',
          structure: { nom: 'Hôpital National Donka' },
        },
        {
          id: '3',
          email: 'saliou.sow@demo.medconnecte.gn',
          nom: 'Sow',
          prenom: 'Saliou',
          role: 'PATIENT',
          structure: null,
        },
        {
          id: '4',
          email: 'accueil.donka@demo.medconnecte.gn',
          nom: 'Sylla',
          prenom: 'Mariama',
          role: 'ACCUEIL',
          structure: { nom: 'Hôpital National Donka' },
        },
        {
          id: '5',
          email: 'aminata.diallo@demo.medconnecte.gn',
          nom: 'Diallo',
          prenom: 'Aminata',
          role: 'PATIENT',
          structure: null,
        },
        {
          id: '6',
          email: 'inconnu@demo.medconnecte.gn',
          nom: 'Bah',
          prenom: 'Alpha',
          role: 'MEDECIN',
          structure: null,
        },
      ]);

      const out = await controller.listerComptes();

      // Seuls les comptes du domaine démo sont demandés à la base
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            email: { endsWith: '@demo.medconnecte.gn' },
            isActive: true,
          },
        }),
      );
      expect(out.success).toBe(true);
      // Seuls les comptes vitrine sont proposés : Saliou Sow et le compte inconnu sont écartés
      expect(out.data.map((c) => c.id)).toEqual(['5', '2', '4', '1']);

      const medecin = out.data.find((c) => c.id === '2');
      expect(medecin).toMatchObject({
        role: 'MEDECIN',
        roleLibelle: 'Médecin',
        structureNom: 'Hôpital National Donka',
      });
      expect(medecin?.description).toMatch(/Donka/);
      expect(out.data.find((c) => c.id === '4')?.roleLibelle).toBe(
        "Agent d'accueil",
      );
      expect(out.data.find((c) => c.id === '1')).toMatchObject({
        roleLibelle: 'Super administrateur',
        structureNom: null,
      });
    });

    it('délègue la connexion à AuthService.connexionDemo', async () => {
      const out = await controller.connexion(
        { userId: ID_DEMO },
        res as never,
        req as never,
      );

      expect(authService.connexionDemo).toHaveBeenCalledWith(ID_DEMO, res, {
        type: 'WEB',
      });
      expect(out).toEqual({
        success: true,
        data: {},
        message: 'Connexion réussie',
      });
    });

    it('propage le refus (403) pour un compte non démo', async () => {
      authService.connexionDemo.mockRejectedValue(new ForbiddenException());

      await expect(
        controller.connexion({ userId: ID_DEMO }, res as never, req as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('ConnexionDemoDto', () => {
    it('accepte un identifiant UUID', async () => {
      const dto = plainToInstance(ConnexionDemoDto, { userId: ID_DEMO });
      expect(await validate(dto)).toHaveLength(0);
    });

    it.each([{}, { userId: '' }, { userId: 'admin' }, { userId: 42 }])(
      'refuse %p avec un message en français',
      async (corps) => {
        const erreurs = await validate(
          plainToInstance(ConnexionDemoDto, corps),
        );
        expect(erreurs).toHaveLength(1);
        const messages = Object.values(erreurs[0].constraints ?? {});
        expect(messages.join(' ')).toMatch(/démonstration/);
      },
    );
  });
});
