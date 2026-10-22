import { NotFoundException } from '@nestjs/common';
import { PharmacieService } from './pharmacie.service';
import { PrismaService } from 'src/common/services/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';

/**
 * Ajustement manuel de la quantité : la quantité vient de la ligne verrouillée
 * (SELECT ... FOR UPDATE), jamais d'une lecture antérieure (D123). Prisma simulé.
 */
describe('PharmacieService, ajustement de quantité', () => {
  const STRUCTURE_ID = 'structure-1';
  const USER_ID = 'pharmacien-1';
  const STOCK_ID = 'stock-1';

  let queryRaw: jest.Mock;
  let update: jest.Mock;
  let notifications: { createManyNotifications: jest.Mock };
  let service: PharmacieService;

  beforeEach(() => {
    queryRaw = jest.fn();
    update = jest.fn(({ data }: { data: { quantite: number } }) =>
      Promise.resolve({
        id: STOCK_ID,
        quantite: data.quantite,
        medicament: { id: 'med-1', nom: 'Doliprane 500 mg', categorie: 'X' },
      }),
    );
    const tx = { $queryRaw: queryRaw, stockMedicament: { update } };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: USER_ID,
          role: 'PHARMACIEN',
          structureId: STRUCTURE_ID,
        }),
        findMany: jest.fn().mockResolvedValue([{ id: USER_ID }]),
      },
      structure: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: STRUCTURE_ID, type: 'PHARMACIE' }),
      },
      $transaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    };
    notifications = { createManyNotifications: jest.fn() };
    service = new PharmacieService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
  });

  it('1. la quantité vient de la ligne verrouillée', async () => {
    queryRaw.mockResolvedValue([{ quantite: 30, notes: null }]);

    const res = await service.updateStockQuantite(
      STRUCTURE_ID,
      STOCK_ID,
      USER_ID,
      { variation: 5 },
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: STOCK_ID },
        data: expect.objectContaining({
          quantite: 35,
          disponible: true,
        }) as unknown,
      }),
    );
    expect(res.message).toBe('Stock augmenté (nouvelle quantité : 35)');
  });

  it('2. plancher à 0 : une variation trop négative ne descend pas sous 0', async () => {
    queryRaw.mockResolvedValue([{ quantite: 3, notes: 'lot A' }]);

    await service.updateStockQuantite(STRUCTURE_ID, STOCK_ID, USER_ID, {
      variation: -10,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantite: 0,
          disponible: false,
          notes: 'lot A',
        }) as unknown,
      }),
    );
  });

  it('3. aucune ligne verrouillée : 404 et rien n est écrit', async () => {
    queryRaw.mockResolvedValue([]);

    await expect(
      service.updateStockQuantite(STRUCTURE_ID, STOCK_ID, USER_ID, {
        variation: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('4. alerte seulement au franchissement du seuil de 10', async () => {
    queryRaw.mockResolvedValue([{ quantite: 12, notes: null }]);
    await service.updateStockQuantite(STRUCTURE_ID, STOCK_ID, USER_ID, {
      variation: -4,
    });
    expect(notifications.createManyNotifications).toHaveBeenCalledTimes(1);
    expect(notifications.createManyNotifications).toHaveBeenCalledWith(
      [USER_ID],
      expect.objectContaining({
        message: 'Le stock de "Doliprane 500 mg" est descendu à 8 unités.',
      }),
    );

    notifications.createManyNotifications.mockClear();
    queryRaw.mockResolvedValue([{ quantite: 8, notes: null }]);
    await service.updateStockQuantite(STRUCTURE_ID, STOCK_ID, USER_ID, {
      variation: -2,
    });
    expect(notifications.createManyNotifications).not.toHaveBeenCalled();
  });
});
