import {
  avecStock,
  avecStockPublic,
  calculerEtatStock,
  filtreLotVendable,
  jourVersDate,
  type LotStockLu,
} from './lecture-stock';

const JOUR = '2026-10-25';

function lot(
  id: string,
  date: string | null,
  solde: number,
  coef = 1,
  reception = '2026-01-01T00:00:00.000Z',
): LotStockLu {
  return {
    id,
    numeroLot: null,
    dateExpiration: date ? jourVersDate(date) : null,
    dateReception: new Date(reception),
    coefficientReception: coef,
    coutUnitaire: 0,
    lotTechnique: false,
    solde,
  };
}

describe('calculerEtatStock', () => {
  it('1. aucun lot, solde 0', () => {
    expect(calculerEtatStock(0, [], JOUR)).toEqual({
      quantite: 0,
      quantiteVendable: 0,
      dateExpiration: null,
      reliquat: [],
      lots: [],
    });
  });

  it('2. un lot daté du jour reste vendable', () => {
    const etat = calculerEtatStock(12, [lot('A', JOUR, 12)], JOUR);
    expect(etat.dateExpiration).toEqual(jourVersDate(JOUR));
    expect(etat.quantiteVendable).toBe(12);
    expect(etat.reliquat).toEqual([]);
    expect(etat.lots).toEqual([
      {
        id: 'A',
        numeroLot: null,
        dateExpiration: jourVersDate(JOUR),
        quantite: 12,
        lotTechnique: false,
        coutUnitaire: 0,
      },
    ]);
  });

  it('3. tous périmés : la plus ancienne date, rien de vendable', () => {
    const etat = calculerEtatStock(
      8,
      [lot('S', '2026-09-01', 5), lot('O', '2026-08-01', 3)],
      JOUR,
    );
    expect(etat.dateExpiration).toEqual(jourVersDate('2026-08-01'));
    expect(etat.quantiteVendable).toBe(0);
    expect(etat.lots.map((l) => l.id)).toEqual(['O', 'S']);
  });

  it('4. reliquat d abord', () => {
    const etat = calculerEtatStock(
      35,
      [lot('A', '2027-01-01', 20, 10), lot('B', '2027-06-01', 15, 10)],
      JOUR,
    );
    expect(etat.dateExpiration).toEqual(jourVersDate('2027-06-01'));
    expect(etat.reliquat).toEqual([{ lotId: 'B', unitesRestantes: 5 }]);
    expect(etat.quantiteVendable).toBe(35);
    expect(etat.lots.map((l) => l.id)).toEqual(['A', 'B']);
  });

  it('5. sans date avant daté', () => {
    const etat = calculerEtatStock(
      10,
      [lot('D', '2027-01-01', 6), lot('N', null, 4)],
      JOUR,
    );
    expect(etat.dateExpiration).toBeNull();
    expect(etat.lots.map((l) => l.id)).toEqual(['N', 'D']);
  });

  it('6. périmé et vendable', () => {
    const etat = calculerEtatStock(
      16,
      [lot('P', '2026-01-01', 11), lot('V', '2027-01-01', 5)],
      JOUR,
    );
    expect(etat.quantite).toBe(16);
    expect(etat.quantiteVendable).toBe(5);
    expect(etat.dateExpiration).toEqual(jourVersDate('2027-01-01'));
    expect(etat.reliquat).toEqual([]);
  });

  it('7. stock négatif sans lot', () => {
    const etat = calculerEtatStock(-3, [], JOUR);
    expect(etat.quantite).toBe(-3);
    expect(etat.quantiteVendable).toBe(0);
    expect(etat.dateExpiration).toBeNull();
  });

  it('8. un lot à solde 0 est ignoré', () => {
    const etat = calculerEtatStock(0, [lot('Z', '2027-01-01', 0)], JOUR);
    expect(etat.lots).toEqual([]);
    expect(etat.dateExpiration).toBeNull();
  });
});

describe('avecStock et avecStockPublic', () => {
  it('9. avecStock reprend l état calculé', () => {
    const etat = calculerEtatStock(12, [lot('A', JOUR, 12)], JOUR);
    const fiche = avecStock(
      {
        id: 'f',
        archiveLe: null,
        quantite: 99,
        disponible: false,
        dateExpiration: null,
      },
      etat,
    );
    expect(fiche.quantite).toBe(12);
    expect(fiche.disponible).toBe(true);
    expect(fiche.quantiteVendable).toBe(12);
    expect(fiche).toHaveProperty('reliquat');
    expect(fiche).toHaveProperty('lots');
    const archivee = avecStock(
      {
        id: 'f',
        archiveLe: new Date(),
        quantite: 99,
        disponible: true,
        dateExpiration: null,
      },
      etat,
    );
    expect(archivee.disponible).toBe(false);
  });

  it('9. avecStockPublic ne montre ni lots ni quantité vendable', () => {
    const etat = calculerEtatStock(
      16,
      [lot('P', '2026-01-01', 11), lot('V', '2027-01-01', 5)],
      JOUR,
    );
    const fiche = avecStockPublic({ id: 'f' }, etat);
    expect(fiche.quantite).toBe(5);
    expect(fiche.disponible).toBe(true);
    expect(fiche).not.toHaveProperty('lots');
    expect(fiche).not.toHaveProperty('reliquat');
    expect(fiche).not.toHaveProperty('quantiteVendable');
  });
});

describe('filtreLotVendable', () => {
  it('10. solde positif et non périmé', () => {
    expect(filtreLotVendable(JOUR)).toEqual({
      agregat: { is: { quantite: { gt: 0 } } },
      OR: [
        { dateExpiration: null },
        { dateExpiration: { gte: new Date('2026-10-25T00:00:00.000Z') } },
      ],
    });
  });
});
