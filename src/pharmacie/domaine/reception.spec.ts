import {
  jourValide,
  preparerLigneReception,
  type SaisieLigneReception,
} from './reception';

const JOUR = '2026-10-27';

function saisie(
  partiel: Partial<SaisieLigneReception> = {},
): SaisieLigneReception {
  return {
    coefficientBoite: 1,
    nombreBoites: null,
    quantiteUnites: null,
    coutAchatBoite: null,
    dateExpiration: '2027-12-31',
    sansPeremption: false,
    ...partiel,
  };
}

describe('jourValide', () => {
  it('jourValide : dates réelles et fausses', () => {
    expect(jourValide('2027-12-31')).toBe(true);
    expect(jourValide('2028-02-29')).toBe(true);
    expect(jourValide('2027-02-30')).toBe(false);
    expect(jourValide('2027-13-01')).toBe(false);
    expect(jourValide('27-12-31')).toBe(false);
    expect(jourValide('')).toBe(false);
  });
});

describe('preparerLigneReception', () => {
  it('10 boîtes de 20 au coût de 1000 la boîte : 200 unités à 50', () => {
    expect(
      preparerLigneReception(
        saisie({
          coefficientBoite: 20,
          nombreBoites: 10,
          coutAchatBoite: 1000,
        }),
        JOUR,
      ),
    ).toEqual({
      ok: true,
      quantiteUm: 200,
      coefficientReception: 20,
      coutUnitaire: 50,
      coutAchatBoite: 1000,
      dateExpiration: '2027-12-31',
    });
  });

  it('coût arrondi au GNF, moitié éloignée de zéro', () => {
    const cout = (coefficientBoite: number, coutAchatBoite: number) => {
      const r = preparerLigneReception(
        saisie({ coefficientBoite, nombreBoites: 1, coutAchatBoite }),
        JOUR,
      );
      return r.ok ? r.coutUnitaire : null;
    };
    expect(cout(3, 1000)).toBe(333);
    expect(cout(2, 1001)).toBe(501);
    expect(cout(3, 2)).toBe(1);
  });

  it('sans coût : coût 0 et coût boîte nul', () => {
    const r = preparerLigneReception(saisie({ nombreBoites: 1 }), JOUR);
    expect(r).toMatchObject({
      ok: true,
      coutUnitaire: 0,
      coutAchatBoite: null,
    });
  });

  it('quantité en unités : telle quelle, coût divisé par le coefficient de la fiche', () => {
    const r = preparerLigneReception(
      saisie({ coefficientBoite: 10, quantiteUnites: 15, coutAchatBoite: 500 }),
      JOUR,
    );
    expect(r).toMatchObject({ ok: true, quantiteUm: 15, coutUnitaire: 50 });
  });

  it('quantité absente ou double', () => {
    expect(preparerLigneReception(saisie(), JOUR)).toEqual({
      ok: false,
      code: 'QUANTITE_REQUISE',
    });
    expect(
      preparerLigneReception(
        saisie({ nombreBoites: 1, quantiteUnites: 1 }),
        JOUR,
      ),
    ).toEqual({ ok: false, code: 'QUANTITE_UNIQUE' });
  });

  it('quantité trop grande', () => {
    expect(
      preparerLigneReception(
        saisie({ coefficientBoite: 10000, nombreBoites: 1000000 }),
        JOUR,
      ),
    ).toEqual({ ok: false, code: 'QUANTITE_TROP_GRANDE' });
    expect(
      preparerLigneReception(saisie({ quantiteUnites: 2147483647 }), JOUR),
    ).toMatchObject({ ok: true });
  });

  it('date invalide', () => {
    expect(
      preparerLigneReception(
        saisie({ nombreBoites: 1, dateExpiration: '2027-02-30' }),
        JOUR,
      ),
    ).toEqual({ ok: false, code: 'DATE_INVALIDE' });
  });

  it('date obligatoire sauf sans péremption (A3)', () => {
    expect(
      preparerLigneReception(
        saisie({ nombreBoites: 1, dateExpiration: null }),
        JOUR,
      ),
    ).toEqual({ ok: false, code: 'DATE_PEREMPTION_REQUISE' });
    expect(
      preparerLigneReception(
        saisie({ nombreBoites: 1, dateExpiration: null, sansPeremption: true }),
        JOUR,
      ),
    ).toMatchObject({ ok: true, dateExpiration: null });
    expect(
      preparerLigneReception(
        saisie({
          nombreBoites: 1,
          dateExpiration: '2027-01-01',
          sansPeremption: true,
        }),
        JOUR,
      ),
    ).toMatchObject({ ok: true, dateExpiration: '2027-01-01' });
  });

  it('date passée refusée, le jour même accepté', () => {
    expect(
      preparerLigneReception(
        saisie({ nombreBoites: 1, dateExpiration: '2026-10-26' }),
        JOUR,
      ),
    ).toEqual({ ok: false, code: 'DATE_PEREMPTION_PASSEE' });
    expect(
      preparerLigneReception(
        saisie({ nombreBoites: 1, dateExpiration: '2026-10-27' }),
        JOUR,
      ),
    ).toMatchObject({ ok: true });
  });

  it('ordre des refus', () => {
    expect(
      preparerLigneReception(saisie({ dateExpiration: null }), JOUR),
    ).toEqual({ ok: false, code: 'QUANTITE_REQUISE' });
  });

  it('entrées impossibles', () => {
    expect(() =>
      preparerLigneReception(
        saisie({ coefficientBoite: 0, nombreBoites: 1 }),
        JOUR,
      ),
    ).toThrow(RangeError);
    expect(() =>
      preparerLigneReception(saisie({ nombreBoites: 1.5 }), JOUR),
    ).toThrow(RangeError);
    expect(() =>
      preparerLigneReception(
        saisie({ nombreBoites: 1, coutAchatBoite: -1 }),
        JOUR,
      ),
    ).toThrow(RangeError);
  });
});
