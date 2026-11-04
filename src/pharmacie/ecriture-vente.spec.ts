import type { Prisma } from 'generated/prisma/client';
import { ecrirePieceVente, type PieceVenteAEcrire } from './ecriture-vente';
import type { MouvementsStockService } from './stock/mouvements-stock.service';

/** Filet de D716 : une vente en ligne ne porte jamais de reste provisoire. */
describe('ecrirePieceVente : provisoireAutorise', () => {
  function piece(provisoireAutorise: boolean): PieceVenteAEcrire {
    return {
      structureId: 's1',
      adminId: null,
      pointDeVenteId: 'pv1',
      posteId: 'p1',
      posteCode: 'W1',
      sessionId: 'se1',
      typePiece: 'VENTE',
      provisoireAutorise,
      numero: 'T1-0000001',
      numeroTicket: 1,
      jourMetier: new Date('2026-11-03T00:00:00.000Z'),
      vendeur: { id: 'u1', nom: 'Essai' },
      clientNom: null,
      clientTelephone: null,
      ordonnanceVerifiee: false,
      total: 1000,
      cleIdempotence: null,
      paiements: [],
      lignes: [
        {
          fiche: { id: 'f1', medicamentId: 'm1', nom: 'Doliprane' },
          calcul: {
            prixAppliqueParUm: 1000,
            quantiteUm: 1,
            montantLigne: 1000,
            uniteAffichee: 'BOITE',
            nombreAffiche: 1,
            coefficientApplique: 1,
          },
          allocation: {
            index: 0,
            allocations: [],
            resteProvisoire: 1,
            lotsPerimesDisponibles: [],
            quantiteAllouee: 0,
          },
        },
      ],
    };
  }

  it('à false, un reste provisoire lève une RangeError avant toute écriture', async () => {
    const create = jest.fn();
    const tx = { vente: { create } } as unknown as Prisma.TransactionClient;
    await expect(
      ecrirePieceVente(tx, {} as MouvementsStockService, piece(false)),
    ).rejects.toThrow(RangeError);
    expect(create).not.toHaveBeenCalled();
  });

  it('à true (rejeu), le reste provisoire passe le filet', async () => {
    const create = jest.fn().mockRejectedValue(new Error('écriture atteinte'));
    const tx = { vente: { create } } as unknown as Prisma.TransactionClient;
    await expect(
      ecrirePieceVente(tx, {} as MouvementsStockService, piece(true)),
    ).rejects.toThrow('écriture atteinte');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
