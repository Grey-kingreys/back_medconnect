import { planifierResolution } from './resolution';
import type { LotCandidat } from './selection-lots';

const JOUR = '2026-10-27';

function lot(
  id: string,
  solde: number,
  date: string | null,
  reception = '2026-10-01T00:00:00.000Z',
  cout = 100,
): LotCandidat {
  return {
    id,
    numeroLot: id,
    dateExpiration: date,
    dateReception: reception,
    solde,
    coefficientReception: 1,
    coutUnitaire: cout,
    lotTechnique: false,
  };
}

const prov = (allocationId: string, venteCreeLe: string, quantite: number) => ({
  allocationId,
  venteCreeLe,
  quantite,
});

describe('planifierResolution', () => {
  it('résolution complète sur un lot', () => {
    expect(
      planifierResolution(
        [prov('a1', '2026-10-20T10:00:00.000Z', 2)],
        [lot('L1', 10, '2027-06-30')],
        JOUR,
      ),
    ).toEqual([
      {
        allocationId: 'a1',
        prises: [
          {
            lotId: 'L1',
            numeroLot: 'L1',
            dateExpiration: '2027-06-30',
            quantite: 2,
            coutUnitaire: 100,
            lotTechnique: false,
          },
        ],
        reste: 0,
      },
    ]);
  });

  it('résolution partielle', () => {
    const plan = planifierResolution(
      [prov('a1', '2026-10-20T10:00:00.000Z', 5)],
      [lot('L1', 3, '2027-06-30')],
      JOUR,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].prises.map((x) => [x.lotId, x.quantite])).toEqual([
      ['L1', 3],
    ]);
    expect(plan[0].reste).toBe(2);
  });

  it('plusieurs lots en FEFO', () => {
    const plan = planifierResolution(
      [prov('a1', '2026-10-20T10:00:00.000Z', 7)],
      [lot('L2', 5, '2027-12-31'), lot('L1', 4, '2027-01-31')],
      JOUR,
    );
    expect(plan[0].prises.map((x) => [x.lotId, x.quantite])).toEqual([
      ['L1', 4],
      ['L2', 3],
    ]);
    expect(plan[0].reste).toBe(0);
  });

  it("lot sans date d'abord, puis date croissante", () => {
    const plan = planifierResolution(
      [prov('a1', '2026-10-20T10:00:00.000Z', 2)],
      [lot('L1', 4, '2027-01-31'), lot('L0', 1, null)],
      JOUR,
    );
    expect(plan[0].prises.map((x) => [x.lotId, x.quantite])).toEqual([
      ['L0', 1],
      ['L1', 1],
    ]);
  });

  it('ventes les plus anciennes d’abord', () => {
    const plan = planifierResolution(
      [
        prov('a2', '2026-10-21T10:00:00.000Z', 3),
        prov('a1', '2026-10-20T10:00:00.000Z', 3),
      ],
      [lot('L1', 4, '2027-06-30')],
      JOUR,
    );
    expect(plan.map((r) => r.allocationId)).toEqual(['a1', 'a2']);
    expect(plan[0].prises.map((x) => x.quantite)).toEqual([3]);
    expect(plan[0].reste).toBe(0);
    expect(plan[1].prises.map((x) => x.quantite)).toEqual([1]);
    expect(plan[1].reste).toBe(2);
  });

  it('égalité d’horodatage : identifiant croissant', () => {
    const plan = planifierResolution(
      [
        prov('b', '2026-10-20T10:00:00.000Z', 1),
        prov('a', '2026-10-20T10:00:00.000Z', 1),
      ],
      [lot('L1', 5, '2027-06-30')],
      JOUR,
    );
    expect(plan.map((r) => r.allocationId)).toEqual(['a', 'b']);
  });

  it('lot périmé jamais pris, le jour même accepté', () => {
    const p = [prov('a1', '2026-10-20T10:00:00.000Z', 2)];
    expect(planifierResolution(p, [lot('LP', 10, '2026-10-26')], JOUR)).toEqual(
      [],
    );
    const plan = planifierResolution(p, [lot('LP', 10, '2026-10-27')], JOUR);
    expect(plan).toHaveLength(1);
    expect(plan[0].reste).toBe(0);
  });

  it('plus de stock : provisoires suivantes absentes', () => {
    const plan = planifierResolution(
      [
        prov('a1', '2026-10-20T10:00:00.000Z', 3),
        prov('a2', '2026-10-21T10:00:00.000Z', 2),
      ],
      [lot('L1', 3, '2027-06-30')],
      JOUR,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].allocationId).toBe('a1');
  });

  it('aucun lot : résultat vide', () => {
    expect(
      planifierResolution(
        [prov('a1', '2026-10-20T10:00:00.000Z', 3)],
        [],
        JOUR,
      ),
    ).toEqual([]);
  });

  it('entrées impossibles', () => {
    const lots = [lot('L1', 3, '2027-06-30')];
    expect(() =>
      planifierResolution(
        [prov('a1', '2026-10-20T10:00:00.000Z', 0)],
        lots,
        JOUR,
      ),
    ).toThrow(RangeError);
    expect(() =>
      planifierResolution([prov('a1', 'pas une date', 1)], lots, JOUR),
    ).toThrow(RangeError);
    expect(() =>
      planifierResolution(
        [
          prov('a1', '2026-10-20T10:00:00.000Z', 1),
          prov('a1', '2026-10-21T10:00:00.000Z', 1),
        ],
        lots,
        JOUR,
      ),
    ).toThrow(RangeError);
  });
});
