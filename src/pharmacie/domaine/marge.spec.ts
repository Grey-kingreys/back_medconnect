import { AllocationMarge, calculerMarge } from './marge';

function alloc(
  quantite: number,
  coutUnitaire: number,
  champs: Partial<AllocationMarge> = {},
): AllocationMarge {
  return {
    quantite,
    coutUnitaire,
    lotTechnique: false,
    statut: 'DEFINITIVE',
    ...champs,
  };
}

const zeros = {
  chiffreAffairesValorise: 0,
  coutAlloue: 0,
  marge: 0,
  nonValorisable: { nombreVentes: 0, nombreLignes: 0, chiffreAffaires: 0 },
  provisoires: { nombreLignes: 0, chiffreAffaires: 0 },
};

describe('calculerMarge (domaine pharmacie)', () => {
  it('CA11 : marge = somme des montants de ligne moins somme des coûts alloués', () => {
    const r = calculerMarge([
      {
        id: 'V1',
        lignes: [
          { montantLigne: 10000, allocations: [alloc(12, 300), alloc(8, 350)] },
          { montantLigne: 3600, allocations: [alloc(6, 250)] },
        ],
      },
    ]);
    expect(r).toEqual({
      ...zeros,
      chiffreAffairesValorise: 13600,
      coutAlloue: 7900,
      marge: 5700,
    });
  });

  it('CA12 : une allocation de lot technique rend la vente non valorisable', () => {
    const r = calculerMarge([
      {
        id: 'V2',
        lignes: [
          {
            montantLigne: 5000,
            allocations: [alloc(10, 0, { lotTechnique: true })],
          },
        ],
      },
    ]);
    expect(r.nonValorisable).toEqual({
      nombreVentes: 1,
      nombreLignes: 1,
      chiffreAffaires: 5000,
    });
    expect(r.chiffreAffairesValorise).toBe(0);
    expect(r.marge).toBe(0);
  });

  it('CA12 : un coût nul rend la vente non valorisable', () => {
    const r = calculerMarge([
      {
        id: 'V3',
        lignes: [{ montantLigne: 2000, allocations: [alloc(4, 0)] }],
      },
    ]);
    expect(r.nonValorisable.nombreVentes).toBe(1);
  });

  it('CA12 : vente mixte, toute la vente sort du calcul mais seule la ligne en cause est comptée', () => {
    const r = calculerMarge([
      {
        id: 'V4',
        lignes: [
          { montantLigne: 3000, allocations: [alloc(10, 100)] },
          {
            montantLigne: 2000,
            allocations: [alloc(5, 0, { lotTechnique: true })],
          },
        ],
      },
    ]);
    expect(r.nonValorisable).toEqual({
      nombreVentes: 1,
      nombreLignes: 1,
      chiffreAffaires: 5000,
    });
    expect(r.coutAlloue).toBe(0);
  });

  it('une ligne provisoire est exclue jusqu à sa résolution, le reste de la vente est calculé', () => {
    const r = calculerMarge([
      {
        id: 'V5',
        lignes: [
          { montantLigne: 2000, allocations: [alloc(4, 200)] },
          {
            montantLigne: 1000,
            allocations: [alloc(5, 0, { statut: 'PROVISOIRE' })],
          },
        ],
      },
    ]);
    expect(r.provisoires).toEqual({ nombreLignes: 1, chiffreAffaires: 1000 });
    expect(r.chiffreAffairesValorise).toBe(2000);
    expect(r.coutAlloue).toBe(800);
    expect(r.marge).toBe(1200);
    expect(r.nonValorisable.nombreVentes).toBe(0);
  });

  it('les allocations remplacées sont ignorées après résolution', () => {
    const r = calculerMarge([
      {
        id: 'V6',
        lignes: [
          {
            montantLigne: 1500,
            allocations: [alloc(5, 0, { statut: 'REMPLACEE' }), alloc(5, 100)],
          },
        ],
      },
    ]);
    expect(r.chiffreAffairesValorise).toBe(1500);
    expect(r.coutAlloue).toBe(500);
    expect(r.marge).toBe(1000);
  });

  it('une ligne sans allocation (vente historique) est non valorisable', () => {
    const r = calculerMarge([
      { id: 'V7', lignes: [{ montantLigne: 4000, allocations: [] }] },
    ]);
    expect(r.nonValorisable).toEqual({
      nombreVentes: 1,
      nombreLignes: 1,
      chiffreAffaires: 4000,
    });
  });

  it('une vente et sa pièce d annulation s annulent', () => {
    const r = calculerMarge([
      {
        id: 'V6',
        lignes: [{ montantLigne: 5000, allocations: [alloc(10, 200)] }],
      },
      {
        id: 'A-V6',
        lignes: [{ montantLigne: -5000, allocations: [alloc(-10, 200)] }],
      },
    ]);
    expect(Object.is(r.chiffreAffairesValorise, 0)).toBe(true);
    expect(Object.is(r.coutAlloue, 0)).toBe(true);
    expect(Object.is(r.marge, 0)).toBe(true);
  });

  it('une marge négative est renvoyée telle quelle', () => {
    const r = calculerMarge([
      {
        id: 'V8',
        lignes: [{ montantLigne: 1000, allocations: [alloc(10, 150)] }],
      },
    ]);
    expect(r.marge).toBe(-500);
  });

  it('aucune vente : tout à zéro', () => {
    expect(calculerMarge([])).toEqual(zeros);
  });

  it('refuse un coût négatif ou une quantité non entière', () => {
    expect(() =>
      calculerMarge([
        {
          id: 'X',
          lignes: [{ montantLigne: 100, allocations: [alloc(1, -5)] }],
        },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      calculerMarge([
        {
          id: 'X',
          lignes: [{ montantLigne: 100, allocations: [alloc(1.5, 5)] }],
        },
      ]),
    ).toThrow(RangeError);
  });
});
