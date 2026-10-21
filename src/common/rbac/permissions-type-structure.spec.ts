import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CarnetSanteController } from 'src/carnet-sante/carnet-sante.controller';
import { CarnetSanteService } from 'src/carnet-sante/carnet-sante.service';
import { UserController } from 'src/user/user.controller';
import { UserService } from 'src/user/user.service';
import { REDIS_CLIENT } from 'src/common/redis/redis.module';
import { PrismaService } from 'src/common/services/prisma.service';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { AllExceptionsFilter } from 'src/common/filters/all-exceptions.filter';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';
import {
  ALL_PERMISSION_CODES,
  DEFAULT_STRUCTURE_ROLES,
} from './permissions.constants';
import {
  PERMISSIONS_AUTORISEES_PHARMACIE,
  filtrerPermissionsSelonTypeStructure,
  typeStructureEffectif,
} from './permissions-type-structure';

describe('Permissions selon le type de structure (B10)', () => {
  describe('fonctions pures', () => {
    it('1. pharmacie : ne garde que la liste blanche, dans l ordre du catalogue', () => {
      const res = filtrerPermissionsSelonTypeStructure(
        ALL_PERMISSION_CODES,
        'PHARMACIE',
      );
      expect(res).toEqual([
        'stock:read',
        'stock:write',
        'catalogue:write',
        'catalogue:manage',
        'structure:read',
        'structure:write',
        'membre:read',
        'membre:manage',
        'role:manage',
        'chat:structure',
      ]);
      expect(res).toEqual([...PERMISSIONS_AUTORISEES_PHARMACIE]);
      for (const interdit of [
        'carnet:read',
        'consultation:write',
        'ordonnance:write',
        'analyse:write',
        'vaccination:write',
        'rendezvous:write',
        'patient:read',
        'sos:respond',
        'platform:admin',
      ]) {
        expect(res).not.toContain(interdit);
      }
    });

    it.each(['HOPITAL', 'CLINIQUE', null] as const)(
      '2. %s : permissions inchangées',
      (type) => {
        const entree = ['carnet:read', 'stock:read'];
        expect(filtrerPermissionsSelonTypeStructure(entree, type)).toBe(entree);
      },
    );

    it('3. les rôles par défaut d une pharmacie ne perdent rien', () => {
      for (const i of [0, 1]) {
        const entree: string[] = [
          ...DEFAULT_STRUCTURE_ROLES.PHARMACIE[i].permissions,
        ];
        expect(
          filtrerPermissionsSelonTypeStructure(entree, 'PHARMACIE'),
        ).toEqual(entree);
      }
    });

    it('4. typeStructureEffectif', () => {
      expect(typeStructureEffectif({ structure: { type: 'PHARMACIE' } })).toBe(
        'PHARMACIE',
      );
      expect(
        typeStructureEffectif({
          structure: null,
          administeredStructure: { type: 'CLINIQUE' },
        }),
      ).toBe('CLINIQUE');
      expect(
        typeStructureEffectif({
          structure: { type: 'HOPITAL' },
          administeredStructure: { type: 'PHARMACIE' },
        }),
      ).toBe('HOPITAL');
      expect(typeStructureEffectif({})).toBeNull();
      expect(typeStructureEffectif(null)).toBeNull();
      expect(typeStructureEffectif(undefined)).toBeNull();
    });
  });

  describe('PermissionsService', () => {
    const codesRole = [
      'carnet:read',
      'patient:read',
      'sos:respond',
      'stock:read',
      'structure:read',
    ];
    let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
    let prisma: { user: { findUnique: jest.Mock; findMany: jest.Mock } };
    let service: PermissionsService;

    const utilisateur = (extra: Record<string, unknown>) => ({
      appRole: {
        permissions: codesRole.map((code) => ({ permission: { code } })),
      },
      structure: null,
      administeredStructure: null,
      ...extra,
    });

    beforeEach(() => {
      redis = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn(),
      };
      prisma = { user: { findUnique: jest.fn(), findMany: jest.fn() } };
      service = new PermissionsService(redis as never, prisma as never);
    });

    it('5. pharmacie : permissions filtrées, cache v2, carnet refusé', async () => {
      prisma.user.findUnique.mockResolvedValue(
        utilisateur({ structure: { type: 'PHARMACIE' } }),
      );
      await expect(service.getUserPermissions('u1')).resolves.toEqual([
        'stock:read',
        'structure:read',
      ]);
      expect(redis.set).toHaveBeenCalledWith(
        'perms:v2:user:u1',
        JSON.stringify(['stock:read', 'structure:read']),
        'EX',
        300,
      );
      redis.get.mockResolvedValue(null);
      await expect(service.hasPermissions('u1', ['carnet:read'])).resolves.toBe(
        false,
      );
    });

    it('6. hôpital : les 5 codes sont renvoyés', async () => {
      prisma.user.findUnique.mockResolvedValue(
        utilisateur({ structure: { type: 'HOPITAL' } }),
      );
      await expect(service.getUserPermissions('u1')).resolves.toEqual(
        codesRole,
      );
      await expect(service.hasPermissions('u1', ['carnet:read'])).resolves.toBe(
        true,
      );
    });

    it('7. structure administrée de type pharmacie', async () => {
      prisma.user.findUnique.mockResolvedValue(
        utilisateur({ administeredStructure: { type: 'PHARMACIE' } }),
      );
      await expect(service.getUserPermissions('u1')).resolves.toEqual([
        'stock:read',
        'structure:read',
      ]);
    });

    it('8. le select demande le type des deux structures', async () => {
      prisma.user.findUnique.mockResolvedValue(utilisateur({}));
      await service.getUserPermissions('u1');
      const select: unknown = expect.objectContaining({
        structure: { select: { type: true } },
        administeredStructure: { select: { type: true } },
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ select }),
      );
    });
  });

  describe('HTTP de bout en bout (sans base)', () => {
    let app: INestApplication;
    const getPatientCarnetForDoctor = jest
      .fn()
      .mockResolvedValue({ success: true, data: { id: 'p1' } });
    const getPatientsForDoctor = jest
      .fn()
      .mockResolvedValue({ success: true, data: [] });

    const roleCustom = ['carnet:read', 'patient:read', 'structure:read'].map(
      (code) => ({ permission: { code } }),
    );
    const prisma = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) => {
          const type = where.id === 'admin-pharmacie' ? 'PHARMACIE' : 'HOPITAL';
          return Promise.resolve({
            appRole: { permissions: roleCustom },
            structure: { type },
            administeredStructure: null,
          });
        }),
      },
    };
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn(),
    };

    beforeAll(async () => {
      const module = await Test.createTestingModule({
        controllers: [CarnetSanteController, UserController],
        providers: [
          PermissionsService,
          PermissionsGuard,
          { provide: PrismaService, useValue: prisma },
          { provide: REDIS_CLIENT, useValue: redis },
          {
            provide: CarnetSanteService,
            useValue: { getPatientCarnetForDoctor },
          },
          { provide: UserService, useValue: { getPatientsForDoctor } },
        ],
      })
        .overrideGuard(AuthGuard)
        .useValue({
          canActivate: (ctx: ExecutionContext) => {
            const req = ctx.switchToHttp().getRequest<{
              headers: Record<string, string>;
              user?: unknown;
            }>();
            req.user = {
              userId: req.headers['x-essai-user'],
              role: 'STRUCTURE_ADMIN',
              structureId: 's1',
            };
            return true;
          },
        })
        .compile();
      app = module.createNestApplication();
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
    });

    afterAll(() => app.close());

    beforeEach(() => {
      getPatientCarnetForDoctor.mockClear();
      getPatientsForDoctor.mockClear();
    });

    const serveur = () => app.getHttpServer() as Parameters<typeof request>[0];

    it('9. carnet d un patient : 403 pour la pharmacie', async () => {
      const res = await request(serveur())
        .get('/carnet-sante/patient/p1')
        .set('x-essai-user', 'admin-pharmacie');
      expect(res.status).toBe(403);
      expect((res.body as { code?: string }).code).toBe('PERMISSION_REFUSEE');
      expect(getPatientCarnetForDoctor).not.toHaveBeenCalled();
    });

    it('10. liste des patients : 403 pour la pharmacie', async () => {
      const res = await request(serveur())
        .get('/users/patients/my')
        .set('x-essai-user', 'admin-pharmacie');
      expect(res.status).toBe(403);
      expect((res.body as { code?: string }).code).toBe('PERMISSION_REFUSEE');
      expect(getPatientsForDoctor).not.toHaveBeenCalled();
    });

    it('11. carnet d un patient : 200 pour l hôpital', async () => {
      const res = await request(serveur())
        .get('/carnet-sante/patient/p1')
        .set('x-essai-user', 'admin-hopital');
      expect(res.status).toBe(200);
      expect(getPatientCarnetForDoctor).toHaveBeenCalledWith(
        'admin-hopital',
        'p1',
        's1',
      );
    });

    it('12. liste des patients : 200 pour l hôpital', async () => {
      const res = await request(serveur())
        .get('/users/patients/my')
        .set('x-essai-user', 'admin-hopital');
      expect(res.status).toBe(200);
      expect(getPatientsForDoctor).toHaveBeenCalledWith('s1', true);
    });
  });
});
