import { NotFoundException } from '@nestjs/common';
import { CarnetSanteService } from './carnet-sante.service';

/**
 * Régression soft-delete (PLAN §2.1).
 *
 * Les données de santé ne doivent JAMAIS être supprimées physiquement : chaque
 * suppression est un `update({ data: { deletedAt } })` et chaque lecture exclut les
 * enregistrements déjà supprimés (`deletedAt: null`). Ce filtrage est applicatif —
 * il n'y a pas de middleware Prisma qui le garantisse (le `$use` global de Prisma <5
 * n'existe plus en Prisma 7). Ces tests verrouillent donc la règle méthode par
 * méthode : un retour à `delete()` les fait échouer.
 *
 * Seul `prisma` est exercé ; les sept autres dépendances du service sont inertes
 * (les méthodes testées ne les appellent pas).
 */
describe('CarnetSanteService — soft-delete des données de santé', () => {
  const modelMock = () => ({
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn(),
  });

  let prisma: {
    consultation: ReturnType<typeof modelMock>;
    ordonnance: ReturnType<typeof modelMock>;
    resultatAnalyse: ReturnType<typeof modelMock>;
    vaccination: ReturnType<typeof modelMock>;
  };
  let service: CarnetSanteService;

  beforeEach(() => {
    prisma = {
      consultation: modelMock(),
      ordonnance: modelMock(),
      resultatAnalyse: modelMock(),
      vaccination: modelMock(),
    };
    service = new CarnetSanteService(
      prisma as never,
      {} as never, // aiService
      {} as never, // emailService
      {} as never, // chatGateway
      {} as never, // notificationsService
      {} as never, // encryptionService
      {} as never, // smsService
      {} as never, // queueService
    );
  });

  const cas = [
    {
      nom: 'consultation',
      modele: 'consultation' as const,
      appel: (s: CarnetSanteService) => s.deleteConsultation('u1', 'x1'),
    },
    {
      nom: 'ordonnance',
      modele: 'ordonnance' as const,
      appel: (s: CarnetSanteService) => s.deleteOrdonnance('u1', 'x1'),
    },
    {
      nom: 'analyse',
      modele: 'resultatAnalyse' as const,
      appel: (s: CarnetSanteService) => s.deleteAnalyse('u1', 'x1'),
    },
    {
      nom: 'vaccination',
      modele: 'vaccination' as const,
      appel: (s: CarnetSanteService) => s.deleteVaccination('u1', 'x1'),
    },
  ];

  describe.each(cas)('$nom', ({ modele, appel }) => {
    it('marque deletedAt via update() et n’appelle jamais delete()', async () => {
      prisma[modele].findFirst.mockResolvedValue({ id: 'x1', patientId: 'u1' });

      await appel(service);

      expect(prisma[modele].update).toHaveBeenCalledTimes(1);
      const arg = prisma[modele].update.mock.calls[0][0];
      expect(arg.data.deletedAt).toBeInstanceOf(Date);
      expect(prisma[modele].delete).not.toHaveBeenCalled();
    });

    it('exclut les enregistrements déjà supprimés du contrôle d’accès', async () => {
      prisma[modele].findFirst.mockResolvedValue({ id: 'x1', patientId: 'u1' });

      await appel(service);

      const where = prisma[modele].findFirst.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
    });

    it('remonte NotFound si l’enregistrement est absent ou déjà supprimé', async () => {
      prisma[modele].findFirst.mockResolvedValue(null);

      await expect(appel(service)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma[modele].update).not.toHaveBeenCalled();
    });
  });
});
