import { cheminsCout } from '../masquer-couts';
import { ReceptionsService } from './receptions.service';

/**
 * Facture fournisseur : le vrai service avec une base simulée. Les montants de
 * facture sont des coûts d'achat, retirés sans marge:read.
 */
describe('Réceptions : champs de facture fournisseur (service)', () => {
  const lotLu = {
    id: 'lot1',
    stockMedicamentId: 'stk1',
    stockMedicament: { medicament: { nom: 'Paracétamol' } },
    numeroLot: 'A1',
    dateExpiration: new Date('2027-12-31T00:00:00.000Z'),
    quantiteRecue: 120,
    coefficientReception: 10,
    coutAchatBoite: 3000,
    coutUnitaire: 300,
    agregat: { quantite: 120 },
    codeArticleFournisseur: 'UBI-00123',
    codeBarres: '3400930000012',
    quantiteCommandee: 12,
    prixPublicBoite: 4500,
    codeTva: 'A',
    tauxTvaPourMille: 180,
    montantHTLigne: 36000,
    colisage: 10,
    tableau: 'Liste I',
    bonPreparation: 'BP-55',
  };
  const receptionLue = {
    id: 'r1',
    reference: 'BL-1',
    recueLe: new Date('2026-11-05T09:00:00.000Z'),
    createdAt: new Date('2026-11-05T09:00:00.000Z'),
    auteurId: 'titulaire',
    numeroFacture: 'FA-2026-0412',
    referenceCommande: 'CMD-778',
    dateFacture: new Date('2026-11-05T00:00:00.000Z'),
    nombrePages: 3,
    montantHT: 95630,
    totalTva: 17213,
    montantTTC: 112843,
    netAPayer: 112843,
    fournisseur: { id: 'f1', nom: 'UbiPharm' },
    lots: [lotLu],
  };
  const droits: Record<string, string[]> = {
    titulaire: ['reception:write', 'marge:read'],
    vendeur: ['reception:write'],
  };
  const prisma = {
    reception: {
      findFirst: jest.fn().mockResolvedValue({ id: 'r1' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(receptionLue),
    },
    allocationLot: { findMany: jest.fn().mockResolvedValue([]) },
    mouvementStock: { aggregate: jest.fn() },
    $transaction: jest.fn(),
  };
  const acces = {
    verifier: jest.fn().mockResolvedValue({
      structure: { id: 's1', type: 'PHARMACIE' },
      user: { id: 'titulaire' },
    }),
  };
  const permissions = {
    getUserPermissions: jest.fn((id: string) => Promise.resolve(droits[id])),
  };
  const service = new ReceptionsService(
    prisma as never,
    acces as never,
    {} as never,
    permissions as never,
  );

  const champsLigne = [
    'codeArticleFournisseur',
    'codeBarres',
    'quantiteCommandee',
    'prixPublicBoite',
    'codeTva',
    'tauxTvaPourMille',
    'montantHTLigne',
    'colisage',
    'tableau',
    'bonPreparation',
  ] as const;

  type Detail = Record<string, unknown> & { lots: Record<string, unknown>[] };

  it('le détail relit tous les champs de facture à l’identique avec marge:read', async () => {
    const res = await service.detail('s1', 'titulaire', 'r1');
    const d = res.data as unknown as Detail;
    expect(d.numeroFacture).toBe('FA-2026-0412');
    expect(d.referenceCommande).toBe('CMD-778');
    expect(d.dateFacture).toBe('2026-11-05');
    expect(d.nombrePages).toBe(3);
    expect(d.montantHT).toBe(95630);
    expect(d.totalTva).toBe(17213);
    expect(d.montantTTC).toBe(112843);
    expect(d.netAPayer).toBe(112843);
    for (const c of champsLigne) expect(d.lots[0][c]).toBe(lotLu[c]);
  });

  it('sans marge:read, les montants et les coûts disparaissent, le reste demeure', async () => {
    const res = await service.detail('s1', 'vendeur', 'r1');
    const d = res.data as unknown as Detail;
    for (const c of ['montantHT', 'totalTva', 'montantTTC', 'netAPayer']) {
      expect(c in d).toBe(false);
    }
    for (const c of ['montantHTLigne', 'coutAchatBoite', 'coutUnitaire']) {
      expect(c in d.lots[0]).toBe(false);
    }
    for (const c of [
      'numeroFacture',
      'referenceCommande',
      'dateFacture',
      'nombrePages',
    ]) {
      expect(c in d).toBe(true);
    }
    for (const c of champsLigne.filter((x) => x !== 'montantHTLigne')) {
      expect(d.lots[0][c]).toBe(lotLu[c]);
    }
    expect(cheminsCout(res.data)).toEqual([]);
  });

  it('enregistrer transmet les champs de facture, vides ramenés à null', async () => {
    const espion = jest
      .spyOn(service, 'enregistrerDansTransaction')
      .mockResolvedValue({
        receptionId: 'r1',
        cree: true,
        lignes: [],
        avertissements: [],
        resolutions: [],
      });
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn({}),
    );
    await service.enregistrer('s1', 'titulaire', {
      numeroFacture: ' FA-1 ',
      referenceCommande: '  ',
      dateFacture: '2026-11-05',
      montantHT: 95630,
      lignes: [
        { stockId: 'stk1', nombreBoites: 1, codeBarres: '123', tableau: '' },
      ],
    });
    const entree = espion.mock.calls[0][2];
    expect(entree.facture).toMatchObject({
      numeroFacture: 'FA-1',
      referenceCommande: null,
      montantHT: 95630,
      totalTva: null,
    });
    expect(entree.facture?.dateFacture?.toISOString()).toBe(
      '2026-11-05T00:00:00.000Z',
    );
    expect(entree.lignes[0].facture).toMatchObject({
      codeBarres: '123',
      tableau: null,
      montantHTLigne: null,
    });
    await expect(
      service.enregistrer('s1', 'titulaire', {
        dateFacture: '2026-02-31',
        lignes: [{ stockId: 'stk1', nombreBoites: 1 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    espion.mockRestore();
  });
});
