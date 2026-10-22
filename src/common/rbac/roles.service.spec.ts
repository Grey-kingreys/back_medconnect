import { RolesService } from './roles.service';
import {
  DEFAULT_STRUCTURE_ROLES,
  PERMISSIONS_GARANTIES_ADMIN_PHARMACIE,
} from './permissions.constants';

/**
 * Rôle « Administrateur de structure » d'une pharmacie : stock et ventes garantis,
 * y compris pour les pharmacies existantes (étape de démarrage). Prisma et le
 * service de permissions sont des faux : aucun accès réseau ni base.
 */
describe('RolesService (administrateur de pharmacie)', () => {
  const NOM_ROLE = 'Administrateur de structure';

  let prisma: {
    permission: { upsert: jest.Mock };
    appRole: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
    rolePermission: { createMany: jest.Mock };
    structure: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
  };
  let permissions: { invalidateRole: jest.Mock };
  let service: RolesService;

  const catalogue = () =>
    new Map(
      PERMISSIONS_GARANTIES_ADMIN_PHARMACIE.map((code) => [code, `p-${code}`]),
    );

  beforeEach(() => {
    prisma = {
      permission: { upsert: jest.fn() },
      appRole: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      rolePermission: { createMany: jest.fn() },
      structure: { findMany: jest.fn() },
      user: { findMany: jest.fn() },
    };
    permissions = { invalidateRole: jest.fn() };
    service = new RolesService(prisma as never, permissions as never);
  });

  it('1. définitions : l’admin d’une pharmacie a stock:read, stock:write et les trois vente:*', () => {
    const admin = DEFAULT_STRUCTURE_ROLES.PHARMACIE.find(
      (def) => def.legacyRole === 'STRUCTURE_ADMIN',
    );
    expect(PERMISSIONS_GARANTIES_ADMIN_PHARMACIE).toHaveLength(5);
    for (const code of PERMISSIONS_GARANTIES_ADMIN_PHARMACIE) {
      expect(admin?.permissions).toContain(code);
    }
  });

  it('2. définitions : aucun rôle d’hôpital ni de clinique n’a stock:* ni vente:*', () => {
    const interdits = [
      'stock:read',
      'stock:write',
      'vente:read',
      'vente:write',
      'vente:annuler',
    ];
    for (const type of ['HOPITAL', 'CLINIQUE']) {
      for (const role of DEFAULT_STRUCTURE_ROLES[type]) {
        for (const code of interdits) {
          expect(role.permissions as string[]).not.toContain(code);
        }
      }
    }
  });

  it('3. complète les rôles d’admin des pharmacies et invalide le cache', async () => {
    prisma.appRole.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    prisma.rolePermission.createMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 0 });

    const total = await service.completerRolesAdminPharmacie(catalogue());

    expect(prisma.appRole.findMany).toHaveBeenCalledWith({
      where: { nom: NOM_ROLE, structure: { type: 'PHARMACIE' } },
      select: { id: true },
    });
    expect(prisma.rolePermission.createMany).toHaveBeenCalledTimes(2);
    for (const [i, id] of ['r1', 'r2'].entries()) {
      const appels = prisma.rolePermission.createMany.mock.calls as unknown[][];
      const appel = appels[i][0] as {
        data: { appRoleId: string; permissionId: string }[];
        skipDuplicates: boolean;
      };
      expect(appel.skipDuplicates).toBe(true);
      expect(appel.data).toHaveLength(5);
      expect(appel.data.every((l) => l.appRoleId === id)).toBe(true);
    }
    expect(permissions.invalidateRole).toHaveBeenCalledTimes(1);
    expect(permissions.invalidateRole).toHaveBeenCalledWith('r1');
    expect(total).toBe(2);
  });

  it('4. idempotent : rien d’ajouté, aucun journal ni invalidation', async () => {
    prisma.appRole.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    prisma.rolePermission.createMany.mockResolvedValue({ count: 0 });
    const journal = jest
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined);

    const total = await service.completerRolesAdminPharmacie(catalogue());

    expect(total).toBe(0);
    expect(permissions.invalidateRole).not.toHaveBeenCalled();
    expect(journal).not.toHaveBeenCalled();
  });

  it('5. catalogue sans ces permissions : aucune requête', async () => {
    const total = await service.completerRolesAdminPharmacie(new Map());

    expect(total).toBe(0);
    expect(prisma.appRole.findMany).not.toHaveBeenCalled();
  });

  it('6. le démarrage appelle l’étape après le seed des structures', async () => {
    prisma.permission.upsert.mockImplementation(
      (args: { create: { code: string } }) =>
        Promise.resolve({
          id: `p-${args.create.code}`,
          code: args.create.code,
        }),
    );
    prisma.appRole.findFirst.mockResolvedValue({ id: 'x' });
    prisma.structure.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.appRole.findMany.mockResolvedValue([{ id: 'r1' }]);
    prisma.rolePermission.createMany.mockResolvedValue({ count: 5 });

    await service.onApplicationBootstrap();

    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ appRoleId: 'r1' }),
        ]) as unknown,
      }),
    );
    expect(permissions.invalidateRole).toHaveBeenCalledWith('r1');
  });
});
