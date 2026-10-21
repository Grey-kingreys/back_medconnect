import { AuthService } from './auth.service';

/** Tests de GET /auth/me : type de structure et permissions filtrées (B10). */
describe('AuthService.getMe (B10)', () => {
  let prisma: { user: { findUnique: jest.Mock } };
  let permissionsService: { getUserPermissions: jest.Mock };
  let service: AuthService;

  const utilisateur = (surcharge: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'admin@example.com',
    nom: 'Diallo',
    prenom: 'Awa',
    role: 'STRUCTURE_ADMIN',
    isActive: true,
    structureId: 's1',
    avatarFile: null,
    structure: { id: 's1', nom: 'Pharmacie', type: 'PHARMACIE' },
    administeredStructure: { type: 'PHARMACIE' },
    ...surcharge,
  });

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    permissionsService = {
      getUserPermissions: jest.fn().mockResolvedValue(['stock:read']),
    };
    service = new AuthService(
      prisma as never,
      {} as never, // jwtService
      {} as never, // emailService
      {} as never, // loginThrottle
      {} as never, // rolesService
      permissionsService as never,
      {} as never, // sessions
    );
  });

  it('13. renvoie structureType et permissions filtrées, sans champs internes', async () => {
    prisma.user.findUnique.mockResolvedValue(utilisateur());
    const { data } = await service.getMe('u1');
    expect(data.structureType).toBe('PHARMACIE');
    expect(data.permissions).toEqual(['stock:read']);
    expect(data.structure).toEqual({
      id: 's1',
      nom: 'Pharmacie',
      type: 'PHARMACIE',
    });
    expect(data).not.toHaveProperty('administeredStructure');
    expect(data).not.toHaveProperty('avatarFile');
    expect(permissionsService.getUserPermissions).toHaveBeenCalledWith('u1');
  });

  it('14. structure hôpital', async () => {
    prisma.user.findUnique.mockResolvedValue(
      utilisateur({
        structure: { id: 's1', nom: 'CHU', type: 'HOPITAL' },
        administeredStructure: null,
      }),
    );
    const { data } = await service.getMe('u1');
    expect(data.structureType).toBe('HOPITAL');
  });

  it('15. structure administrée seulement', async () => {
    prisma.user.findUnique.mockResolvedValue(
      utilisateur({
        structure: null,
        administeredStructure: { type: 'CLINIQUE' },
      }),
    );
    const { data } = await service.getMe('u1');
    expect(data.structureType).toBe('CLINIQUE');
  });

  it('16. patient sans structure', async () => {
    prisma.user.findUnique.mockResolvedValue(
      utilisateur({ structure: null, administeredStructure: null }),
    );
    const { data } = await service.getMe('u1');
    expect(data.structureType).toBeNull();
  });

  it('17. le select demande le type de la structure administrée', async () => {
    prisma.user.findUnique.mockResolvedValue(utilisateur());
    await service.getMe('u1');
    const select: unknown = expect.objectContaining({
      administeredStructure: { select: { type: true } },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select }),
    );
  });
});
