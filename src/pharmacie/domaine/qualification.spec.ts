import {
  aDuStock,
  planifierMultiplication,
  type LotAConvertir,
} from './qualification';
import { reliquatLot } from './quantites';

function lot(partiel: Partial<LotAConvertir> = {}): LotAConvertir {
  return {
    lotId: 'l1',
    pointDeVenteId: 'pv1',
    lotTechnique: true,
    coefficientReception: 1,
    coutUnitaire: 0,
    solde: 12,
    ...partiel,
  };
}

describe('aDuStock', () => {
  it('aDuStock : aucun produit ni lot', () => {
    expect(aDuStock([], [])).toBe(false);
  });

  it('aDuStock : produit nul et lot vide', () => {
    expect(
      aDuStock([{ pointDeVenteId: 'pv1', quantite: 0 }], [lot({ solde: 0 })]),
    ).toBe(false);
  });

  it('aDuStock : stock négatif', () => {
    expect(aDuStock([{ pointDeVenteId: 'pv1', quantite: -2 }], [])).toBe(true);
  });

  it('aDuStock : lot positif', () => {
    expect(
      aDuStock([{ pointDeVenteId: 'pv1', quantite: 0 }], [lot({ solde: 3 })]),
    ).toBe(true);
  });
});

describe('planifierMultiplication', () => {
  const produit12 = [{ pointDeVenteId: 'pv1', quantite: 12 }];

  it('12 boîtes de coefficient 1 qualifiées à 20 donnent 240 unités et un reliquat nul', () => {
    expect(planifierMultiplication(20, produit12, [lot()])).toEqual({
      ok: true,
      quantiteAvant: 12,
      quantiteApres: 240,
      lots: [
        {
          lotId: 'l1',
          pointDeVenteId: 'pv1',
          quantiteAvant: 12,
          quantiteApres: 240,
          correction: 228,
          coutUnitaireApres: 0,
        },
      ],
    });
    expect(reliquatLot(240, 20)).toBe(0);
  });

  it('coefficient 1 : corrections nulles', () => {
    const plan = planifierMultiplication(1, produit12, [lot()]);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.lots[0].correction).toBe(0);
      expect(plan.lots[0].quantiteApres).toBe(12);
    }
  });

  it('lot de réception à coefficient 1 : converti (230 boîtes, 10 par boîte, 2300 unités)', () => {
    const plan = planifierMultiplication(
      10,
      [{ pointDeVenteId: 'pv1', quantite: 230 }],
      [lot({ lotTechnique: false, solde: 230, coutUnitaire: 5000 })],
    );
    expect(plan).toMatchObject({
      ok: true,
      quantiteAvant: 230,
      quantiteApres: 2300,
    });
    if (plan.ok)
      expect(plan.lots[0]).toMatchObject({
        correction: 2070,
        coutUnitaireApres: 500,
      });
  });

  it('lot de réception déjà converti (coefficient 20) : refus', () => {
    expect(
      planifierMultiplication(
        10,
        [{ pointDeVenteId: 'pv1', quantite: 240 }],
        [lot({ lotTechnique: false, coefficientReception: 20, solde: 240 })],
      ),
    ).toEqual({ ok: false, code: 'STOCK_NON_CONVERTIBLE' });
  });

  it('lot non technique vide : ignoré', () => {
    const plan = planifierMultiplication(20, produit12, [
      lot(),
      lot({ lotId: 'l2', lotTechnique: false, solde: 0 }),
    ]);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.lots).toHaveLength(1);
  });

  it('lot technique déjà converti : refus', () => {
    expect(
      planifierMultiplication(
        10,
        [{ pointDeVenteId: 'pv1', quantite: 240 }],
        [lot({ coefficientReception: 20, solde: 240 })],
      ),
    ).toEqual({ ok: false, code: 'STOCK_NON_CONVERTIBLE' });
  });

  it('part provisoire : refus', () => {
    expect(
      planifierMultiplication(
        20,
        [{ pointDeVenteId: 'pv1', quantite: 10 }],
        [lot()],
      ),
    ).toEqual({ ok: false, code: 'STOCK_NON_CONVERTIBLE' });
    expect(
      planifierMultiplication(
        20,
        [{ pointDeVenteId: 'pv1', quantite: -1 }],
        [],
      ),
    ).toEqual({ ok: false, code: 'STOCK_NON_CONVERTIBLE' });
  });

  it('quantité trop grande', () => {
    expect(
      planifierMultiplication(
        10000,
        [{ pointDeVenteId: 'pv1', quantite: 300000 }],
        [lot({ solde: 300000 })],
      ),
    ).toEqual({ ok: false, code: 'QUANTITE_TROP_GRANDE' });
    expect(
      planifierMultiplication(
        10000,
        [
          { pointDeVenteId: 'pv1', quantite: 150000 },
          { pointDeVenteId: 'pv2', quantite: 150000 },
        ],
        [
          lot({ solde: 150000 }),
          lot({ lotId: 'l2', pointDeVenteId: 'pv2', solde: 150000 }),
        ],
      ),
    ).toEqual({ ok: false, code: 'QUANTITE_TROP_GRANDE' });
  });

  it('coût divisé par le coefficient', () => {
    const cout = (coutUnitaire: number, coefficient: number) => {
      const plan = planifierMultiplication(coefficient, produit12, [
        lot({ coutUnitaire }),
      ]);
      return plan.ok ? plan.lots[0].coutUnitaireApres : null;
    };
    expect(cout(1000, 3)).toBe(333);
    expect(cout(1001, 2)).toBe(501);
    expect(cout(0, 3)).toBe(0);
  });

  it('ordre des lots par identifiant', () => {
    const plan = planifierMultiplication(
      2,
      [
        { pointDeVenteId: 'pv1', quantite: 1 },
        { pointDeVenteId: 'pv2', quantite: 1 },
      ],
      [
        lot({ lotId: 'l2', pointDeVenteId: 'pv2', solde: 1 }),
        lot({ lotId: 'l1', pointDeVenteId: 'pv1', solde: 1 }),
      ],
    );
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.lots.map((l) => l.lotId)).toEqual(['l1', 'l2']);
  });

  it('coefficient invalide', () => {
    expect(() => planifierMultiplication(0, produit12, [lot()])).toThrow(
      RangeError,
    );
    expect(() => planifierMultiplication(1.5, produit12, [lot()])).toThrow(
      RangeError,
    );
  });
});
