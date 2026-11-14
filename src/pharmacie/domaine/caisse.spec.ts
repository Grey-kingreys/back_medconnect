import { calculerTheorique, ecartCaisse, totalComptage } from './caisse';

const modes = ['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO'];

describe('caisse (domaine pharmacie)', () => {
  it('totalComptage : coupures du franc guinéen de 20 000 à 500', () => {
    expect(
      totalComptage([
        { valeurFaciale: 20000, nombre: 10 },
        { valeurFaciale: 10000, nombre: 5 },
        { valeurFaciale: 5000, nombre: 4 },
        { valeurFaciale: 2000, nombre: 0 },
        { valeurFaciale: 1000, nombre: 7 },
        { valeurFaciale: 500, nombre: 6 },
      ]),
    ).toBe(280000);
    expect(totalComptage([])).toBe(0);
  });

  it('totalComptage refuse un nombre négatif ou une coupure nulle', () => {
    expect(() => totalComptage([{ valeurFaciale: 500, nombre: -1 }])).toThrow(
      RangeError,
    );
    expect(() => totalComptage([{ valeurFaciale: 0, nombre: 1 }])).toThrow(
      RangeError,
    );
  });

  it('CA15 : fond 200 000, ventes 400 000, prélèvement 100 000 : théorique 500 000, écart -10 000', () => {
    const r = calculerTheorique({
      modes,
      fondEspeces: 200000,
      paiements: [
        { mode: 'ESPECES', montant: 150000 },
        { mode: 'ESPECES', montant: 100000 },
        { mode: 'ESPECES', montant: 150000 },
      ],
      mouvements: [{ type: 'PRELEVEMENT', mode: 'ESPECES', montant: 100000 }],
    });
    expect(r).toEqual([
      { mode: 'ESPECES', theorique: 500000 },
      { mode: 'ORANGE_MONEY', theorique: 0 },
      { mode: 'MTN_MOMO', theorique: 0 },
    ]);
    const compte = totalComptage([
      { valeurFaciale: 20000, nombre: 24 },
      { valeurFaciale: 10000, nombre: 1 },
    ]);
    expect(compte).toBe(490000);
    expect(ecartCaisse(compte, 500000)).toBe(-10000);
  });

  it('CA16 au calcul : moitié espèces moitié Orange Money, chaque mode a son théorique et son écart', () => {
    const r = calculerTheorique({
      modes,
      fondEspeces: 50000,
      paiements: [
        { mode: 'ESPECES', montant: 10000 },
        { mode: 'ORANGE_MONEY', montant: 10000 },
      ],
      mouvements: [],
    });
    expect(r).toEqual([
      { mode: 'ESPECES', theorique: 60000 },
      { mode: 'ORANGE_MONEY', theorique: 10000 },
      { mode: 'MTN_MOMO', theorique: 0 },
    ]);
    expect(ecartCaisse(9500, 10000)).toBe(-500);
    expect(ecartCaisse(null, 10000)).toBeNull();
  });

  it('apports et remboursements s appliquent à leur mode', () => {
    const r = calculerTheorique({
      modes,
      fondEspeces: 0,
      paiements: [{ mode: 'MTN_MOMO', montant: 7000 }],
      mouvements: [
        { type: 'APPORT', mode: 'ESPECES', montant: 20000 },
        { type: 'REMBOURSEMENT', mode: 'ESPECES', montant: 3000 },
        { type: 'REMBOURSEMENT', mode: 'MTN_MOMO', montant: 2000 },
      ],
    });
    expect(r).toEqual([
      { mode: 'ESPECES', theorique: 17000 },
      { mode: 'ORANGE_MONEY', theorique: 0 },
      { mode: 'MTN_MOMO', theorique: 5000 },
    ]);
  });

  it('un paiement négatif d annulation diminue le théorique', () => {
    const r = calculerTheorique({
      modes,
      fondEspeces: 0,
      paiements: [
        { mode: 'ESPECES', montant: 8000 },
        { mode: 'ESPECES', montant: -5000 },
      ],
      mouvements: [],
    });
    expect(r[0]).toEqual({ mode: 'ESPECES', theorique: 3000 });
  });

  it('l ordre du résultat suit l ordre des modes reçus', () => {
    const inverse = [...modes].reverse();
    const r = calculerTheorique({
      modes: inverse,
      fondEspeces: 0,
      paiements: [],
      mouvements: [],
    });
    expect(r.map((x) => x.mode)).toEqual(inverse);
  });

  it('refuse un mode inconnu, un mouvement non positif, un fond négatif, un fond sans espèces et un mode en double', () => {
    const base = { modes, fondEspeces: 0, paiements: [], mouvements: [] };
    expect(() =>
      calculerTheorique({
        ...base,
        paiements: [{ mode: 'CHEQUE', montant: 100 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculerTheorique({
        ...base,
        mouvements: [{ type: 'APPORT', mode: 'ESPECES', montant: 0 }],
      }),
    ).toThrow(RangeError);
    expect(() => calculerTheorique({ ...base, fondEspeces: -1 })).toThrow(
      RangeError,
    );
    expect(() =>
      calculerTheorique({
        ...base,
        modes: ['ORANGE_MONEY'],
        fondEspeces: 1000,
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculerTheorique({ ...base, modes: ['ESPECES', 'ESPECES'] }),
    ).toThrow(RangeError);
  });

  it('ecartCaisse : écart positif affiché tel quel', () => {
    expect(ecartCaisse(510000, 500000)).toBe(10000);
    expect(ecartCaisse(500000, 500000)).toBe(0);
  });
});
