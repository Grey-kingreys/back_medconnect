import { NotFoundException } from '@nestjs/common';
import { StructureService } from './structure.service';

/** Détails publics d'une structure : une structure absente est une 404, jamais une 401. */
describe('StructureService : détails publics', () => {
  it('structure introuvable : NotFoundException', async () => {
    const prisma = {
      structure: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new StructureService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const e: unknown = await service
      .getPublicStructureDetails('inconnue')
      .catch((err: unknown) => err);

    expect(e).toBeInstanceOf(NotFoundException);
    expect((e as NotFoundException).message).toBe(
      'Structure introuvable ou inactive',
    );
  });
});
