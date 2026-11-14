import { HttpException } from '@nestjs/common';
import { PrismaService } from 'src/common/services/prisma.service';
import {
  AccesPharmacieService,
  MESSAGE_ACCES_PHARMACIE_REFUSE,
  MESSAGE_PHARMACIE_INTROUVABLE,
} from './acces-pharmacie.service';

describe('AccesPharmacieService', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    structure: { findUnique: jest.Mock };
  };
  let service: AccesPharmacieService;

  const pharmacie = (extra: Record<string, unknown> = {}) => ({
    id: 's1',
    type: 'PHARMACIE',
    adminId: 'u-admin',
    isActive: true,
    nom: 'Pharmacie de Kaloum',
    adresse: null,
    ville: 'Conakry',
    telephone: null,
    logoFile: null,
    ...extra,
  });

  const membre = (extra: Record<string, unknown> = {}) => ({
    id: 'u1',
    nom: 'Bah',
    prenom: 'Mariama',
    structureId: 's1',
    ...extra,
  });

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(membre()) },
      structure: { findUnique: jest.fn().mockResolvedValue(pharmacie()) },
    };
    service = new AccesPharmacieService(prisma as unknown as PrismaService);
  });

  async function erreurDe(promesse: Promise<unknown>): Promise<HttpException> {
    try {
      await promesse;
    } catch (e) {
      return e as HttpException;
    }
    throw new Error('Une erreur était attendue.');
  }

  it('1. membre pharmacien : accès, utilisateur et structure renvoyés', async () => {
    await expect(service.verifier('s1', 'u1')).resolves.toEqual({
      user: membre(),
      structure: pharmacie(),
    });
  });

  it('2. administrateur non rattaché (structureId nul) : accès', async () => {
    const admin = membre({ id: 'u-admin', structureId: null });
    prisma.user.findUnique.mockResolvedValue(admin);
    await expect(service.verifier('s1', 'u-admin')).resolves.toEqual({
      user: admin,
      structure: pharmacie(),
    });
  });

  it('3. compte ACCUEIL membre : accès, l enum role n est plus lu', async () => {
    prisma.user.findUnique.mockResolvedValue(membre({ role: 'ACCUEIL' }));
    await expect(service.verifier('s1', 'u1')).resolves.toBeDefined();
  });

  it('4. pharmacie introuvable : 404', async () => {
    prisma.structure.findUnique.mockResolvedValue(null);
    const e = await erreurDe(service.verifier('s1', 'u1'));
    expect(e.getStatus()).toBe(404);
    expect(e.message).toBe(MESSAGE_PHARMACIE_INTROUVABLE);
    expect(MESSAGE_PHARMACIE_INTROUVABLE).toBe(
      'Cette pharmacie est introuvable.',
    );
  });

  it('5. membre d une autre pharmacie : 403', async () => {
    prisma.user.findUnique.mockResolvedValue(membre({ structureId: 's2' }));
    const e = await erreurDe(service.verifier('s1', 'u1'));
    expect(e.getStatus()).toBe(403);
    expect(e.message).toBe("Vous n'avez pas accès à cette pharmacie.");
  });

  it('6. utilisateur inconnu : 403', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const e = await erreurDe(service.verifier('s1', 'u1'));
    expect(e.getStatus()).toBe(403);
    expect(e.message).toBe(MESSAGE_ACCES_PHARMACIE_REFUSE);
  });

  it('7. structure de type HOPITAL, utilisateur membre : 403 même message', async () => {
    prisma.structure.findUnique.mockResolvedValue(
      pharmacie({ type: 'HOPITAL' }),
    );
    const e = await erreurDe(service.verifier('s1', 'u1'));
    expect(e.getStatus()).toBe(403);
    expect(e.message).toBe(MESSAGE_ACCES_PHARMACIE_REFUSE);
  });

  it('8. pharmacie désactivée, membre : 403 désactivée', async () => {
    prisma.structure.findUnique.mockResolvedValue(
      pharmacie({ isActive: false }),
    );
    const e = await erreurDe(service.verifier('s1', 'u1'));
    expect(e.getStatus()).toBe(403);
    expect(e.message).toBe(
      'Cette pharmacie est désactivée. Contactez l’administrateur de la plateforme.',
    );
  });

  it('9. pharmacie désactivée, non membre : 403 générique', async () => {
    prisma.structure.findUnique.mockResolvedValue(
      pharmacie({ isActive: false }),
    );
    prisma.user.findUnique.mockResolvedValue(membre({ structureId: 's2' }));
    const e = await erreurDe(service.verifier('s1', 'u1'));
    expect(e.getStatus()).toBe(403);
    expect(e.message).toBe(MESSAGE_ACCES_PHARMACIE_REFUSE);
  });

  it('10. sélections exactes : aucun autre champ lu', async () => {
    await service.verifier('s1', 'u1');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, nom: true, prenom: true, structureId: true },
    });
    expect(prisma.structure.findUnique).toHaveBeenCalledWith({
      where: { id: 's1' },
      select: {
        id: true,
        type: true,
        adminId: true,
        isActive: true,
        nom: true,
        adresse: true,
        ville: true,
        telephone: true,
        logoFile: { select: { key: true } },
      },
    });
  });
});
