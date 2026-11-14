import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { SuperAdminService } from './super-admin.service';

/** Création et renvoi d'invitation : un échec d'email ne produit ni 500 ni état à moitié créé. */
describe("SuperAdminService : email d'invitation", () => {
  let envoyer: jest.Mock;
  let prisma: {
    structure: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let logError: jest.SpyInstance;
  let service: SuperAdminService;

  const tx = {
    pointDeVente: { upsert: jest.fn().mockResolvedValue({ id: 'pv1' }) },
    poste: { upsert: jest.fn().mockResolvedValue({}) },
    compteurTicket: { upsert: jest.fn().mockResolvedValue({}) },
    parametresPharmacie: { upsert: jest.fn().mockResolvedValue({}) },
  };

  const DATE_ANCIENNE = new Date('2026-10-20T10:00:00.000Z');
  const MESSAGE_CREATION_ECHEC =
    "Structure créée, mais l'email d'invitation n'a pas pu être envoyé. Utilisez « Renvoyer l'invitation ».";
  const MESSAGE_RENVOI_ECHEC =
    "L'email d'invitation n'a pas pu être envoyé. Le service d'envoi d'emails est momentanément indisponible, réessayez dans quelques instants.";

  const dto = {
    nom: 'Clinique Test',
    type: 'CLINIQUE',
    email: 'clinique@exemple.gn',
  } as never;

  beforeEach(() => {
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    envoyer = jest.fn();
    prisma = {
      structure: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 's1',
          nom: 'Clinique Test',
          type: 'CLINIQUE',
          email: 'clinique@exemple.gn',
          isConfigured: false,
          createdAt: new Date(),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    };
    tx.pointDeVente.upsert.mockClear();
    tx.poste.upsert.mockClear();
    const rolesService = {
      seedStructureDefaultRoles: jest.fn().mockResolvedValue(undefined),
    };
    service = new SuperAdminService(
      prisma as never,
      { sendStructureInviteEmail: envoyer } as never,
      rolesService as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('createStructure', () => {
    it('email envoyé : message habituel et invitationEnvoyee vrai', async () => {
      envoyer.mockResolvedValue(undefined);
      const reponse = await service.createStructure(dto);
      expect(reponse.success).toBe(true);
      expect(reponse.data.invitationEnvoyee).toBe(true);
      expect(reponse.message).toBe(
        "Structure créée. Un email d'invitation a été envoyé à clinique@exemple.gn.",
      );
    });

    it('email rejeté : la structure reste créée, sans adresse dans les journaux', async () => {
      envoyer.mockRejectedValue(new Error('x'));
      const reponse = await service.createStructure(dto);
      expect(reponse.success).toBe(true);
      expect(reponse.data.invitationEnvoyee).toBe(false);
      expect(reponse.data.id).toBe('s1');
      expect(reponse.message).toBe(MESSAGE_CREATION_ECHEC);
      expect(logError).toHaveBeenCalled();
      for (const appel of logError.mock.calls as unknown[][]) {
        for (const argument of appel) {
          expect(String(argument)).not.toContain('clinique@exemple.gn');
        }
      }
    });
  });

  describe('createStructure : pharmacie', () => {
    const dtoPharmacie = {
      nom: 'Pharmacie Test',
      type: 'PHARMACIE',
      email: 'pharmacie@exemple.gn',
    } as never;
    const structurePharmacie = () => ({
      id: 's1',
      nom: 'Pharmacie Test',
      type: 'PHARMACIE',
      email: 'pharmacie@exemple.gn',
      isConfigured: false,
      createdAt: new Date(),
    });

    it('pharmacie : point de vente, poste de reprise, compteur et paramètres créés dans une transaction', async () => {
      prisma.structure.create.mockResolvedValueOnce(structurePharmacie());
      envoyer.mockResolvedValue(undefined);
      const reponse = await service.createStructure(dtoPharmacie);
      expect(reponse.success).toBe(true);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.pointDeVente.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { structureId_ordre: { structureId: 's1', ordre: 1 } },
          create: { structureId: 's1', ordre: 1, nom: 'Pharmacie Test' },
        }),
      );
      const appelPoste = (
        tx.poste.upsert.mock.calls as [
          { create: { code: string; type: string; actif: boolean } },
        ][]
      )[0][0];
      expect(appelPoste.create).toMatchObject({
        code: 'REPRISE',
        type: 'TECHNIQUE',
        actif: false,
      });
    });

    it("pharmacie : échec du point de vente, la structure reste créée et l'échec est journalisé", async () => {
      prisma.structure.create.mockResolvedValueOnce(structurePharmacie());
      prisma.$transaction.mockRejectedValueOnce(new Error('base'));
      envoyer.mockResolvedValue(undefined);
      const reponse = await service.createStructure(dtoPharmacie);
      expect(reponse.success).toBe(true);
      expect(reponse.data.id).toBe('s1');
      expect(logError).toHaveBeenCalledWith(
        'superadmin.point_de_vente_echec structureId=s1',
      );
    });

    it('clinique : aucun point de vente', async () => {
      envoyer.mockResolvedValue(undefined);
      await service.createStructure(dto);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('resendInvitation', () => {
    const structureExistante = () => ({
      id: 's1',
      nom: 'Clinique Test',
      type: 'CLINIQUE',
      email: 'clinique@exemple.gn',
      isConfigured: false,
      inviteToken: 'ancien-hash',
      inviteExpires: DATE_ANCIENNE,
    });

    beforeEach(() => {
      prisma.structure.findUnique.mockResolvedValue(structureExistante());
    });

    const verifier503 = async () => {
      const erreur: unknown = await service
        .resendInvitation('s1')
        .catch((e: unknown) => e);
      expect(erreur).toBeInstanceOf(ServiceUnavailableException);
      const e = erreur as ServiceUnavailableException;
      expect(e.getStatus()).toBe(503);
      expect(e.getResponse()).toMatchObject({
        code: 'EMAIL_INDISPONIBLE',
        message: MESSAGE_RENVOI_ECHEC,
      });
    };

    it('email rejeté : 503 et ancien jeton remis en base', async () => {
      envoyer.mockRejectedValue(new Error('x'));
      await verifier503();
      expect(prisma.structure.update).toHaveBeenCalledTimes(2);
      expect(prisma.structure.update).toHaveBeenNthCalledWith(2, {
        where: { id: 's1' },
        data: { inviteToken: 'ancien-hash', inviteExpires: DATE_ANCIENNE },
      });
    });

    it('email rejeté et remise du jeton rejetée : toujours la 503', async () => {
      envoyer.mockRejectedValue(new Error('x'));
      prisma.structure.update
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('base'));
      await verifier503();
    });

    it('email envoyé : réponse habituelle, une seule écriture', async () => {
      envoyer.mockResolvedValue(undefined);
      const reponse = await service.resendInvitation('s1');
      expect(reponse.message).toBe('Invitation renvoyée à clinique@exemple.gn');
      expect(prisma.structure.update).toHaveBeenCalledTimes(1);
    });
  });
});
