import { avertissementEcartPrix, calculerLigne, EntreeLigne } from './prix';

const fiche = {
  coefficientBoite: 20,
  prixBoite: 10000 as number | null,
  prixUnite: 600 as number | null,
  deconditionnable: true,
};

describe('calculerLigne (domaine pharmacie)', () => {
  it('CA1 : 6 unités à 600 donnent 6 UM et 3 600 GNF', () => {
    expect(calculerLigne({ ...fiche, unite: 'UNITE', nombre: 6 })).toEqual({
      ok: true,
      uniteAffichee: 'UNITE',
      nombreAffiche: 6,
      coefficientApplique: 1,
      quantiteUm: 6,
      prixAppliqueParUm: 600,
      montantLigne: 3600,
    });
  });

  it('CA1 : le prix boîte n intervient pas dans une vente à l unité', () => {
    const ref = calculerLigne({ ...fiche, unite: 'UNITE', nombre: 6 });
    expect(
      calculerLigne({ ...fiche, prixBoite: null, unite: 'UNITE', nombre: 6 }),
    ).toEqual(ref);
    expect(
      calculerLigne({ ...fiche, prixBoite: 99999, unite: 'UNITE', nombre: 6 }),
    ).toEqual(ref);
  });

  it('CA2 : une boîte de 20 à 10 000 donne 20 UM, 500 par UM et 10 000 GNF', () => {
    const r = calculerLigne({ ...fiche, unite: 'BOITE', nombre: 1 });
    expect(r).toEqual({
      ok: true,
      uniteAffichee: 'BOITE',
      nombreAffiche: 1,
      coefficientApplique: 20,
      quantiteUm: 20,
      prixAppliqueParUm: 500,
      montantLigne: 10000,
    });
    expect(r.ok && r.montantLigne).not.toBe(200000);
  });

  it('L arrondi est porté par le prix affiché, jamais par le montant de ligne', () => {
    const a = calculerLigne({
      unite: 'BOITE',
      nombre: 3,
      coefficientBoite: 3,
      prixBoite: 1000,
      prixUnite: null,
      deconditionnable: false,
    });
    expect(a).toMatchObject({
      ok: true,
      quantiteUm: 9,
      prixAppliqueParUm: 333,
      montantLigne: 3000,
    });
    const b = calculerLigne({
      unite: 'BOITE',
      nombre: 1,
      coefficientBoite: 8,
      prixBoite: 500,
      prixUnite: null,
      deconditionnable: false,
    });
    expect(b).toMatchObject({
      ok: true,
      prixAppliqueParUm: 63,
      montantLigne: 500,
    });
  });

  it('Coefficient 1 par boîte : identique au calcul actuel prix x quantité', () => {
    expect(
      calculerLigne({
        unite: 'BOITE',
        nombre: 2,
        coefficientBoite: 1,
        prixBoite: 1500,
        prixUnite: null,
        deconditionnable: false,
      }),
    ).toMatchObject({
      ok: true,
      quantiteUm: 2,
      prixAppliqueParUm: 1500,
      montantLigne: 3000,
    });
  });

  it('CA3 au calcul : changer le prix boîte ne change pas une ligne à l unité, et réciproquement', () => {
    expect(
      calculerLigne({ ...fiche, prixBoite: 10000, unite: 'UNITE', nombre: 6 }),
    ).toEqual(
      calculerLigne({ ...fiche, prixBoite: 12000, unite: 'UNITE', nombre: 6 }),
    );
    expect(
      calculerLigne({ ...fiche, prixUnite: 600, unite: 'BOITE', nombre: 2 }),
    ).toEqual(
      calculerLigne({ ...fiche, prixUnite: 700, unite: 'BOITE', nombre: 2 }),
    );
  });

  it('CA4 : vente à l unité refusée sur une fiche non déconditionnable, même avec un prix unité', () => {
    expect(
      calculerLigne({
        ...fiche,
        deconditionnable: false,
        unite: 'UNITE',
        nombre: 2,
      }),
    ).toEqual({ ok: false, code: 'VENTE_UNITE_INTERDITE' });
  });

  it('CA4 : la même fiche se vend par boîte', () => {
    const r = calculerLigne({
      ...fiche,
      deconditionnable: false,
      prixUnite: null,
      unite: 'BOITE',
      nombre: 1,
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.montantLigne).toBe(10000);
  });

  it('Prix unité absent ou nul : PRIX_UNITE_MANQUANT', () => {
    const attendu = { ok: false, code: 'PRIX_UNITE_MANQUANT' };
    expect(
      calculerLigne({ ...fiche, prixUnite: null, unite: 'UNITE', nombre: 1 }),
    ).toEqual(attendu);
    expect(
      calculerLigne({ ...fiche, prixUnite: 0, unite: 'UNITE', nombre: 1 }),
    ).toEqual(attendu);
  });

  it('Prix boîte absent ou nul : PRIX_MANQUANT', () => {
    const attendu = { ok: false, code: 'PRIX_MANQUANT' };
    expect(
      calculerLigne({ ...fiche, prixBoite: null, unite: 'BOITE', nombre: 1 }),
    ).toEqual(attendu);
    expect(
      calculerLigne({ ...fiche, prixBoite: 0, unite: 'BOITE', nombre: 1 }),
    ).toEqual(attendu);
  });

  it('Entrées impossibles : RangeError', () => {
    const base: EntreeLigne = { ...fiche, unite: 'UNITE', nombre: 1 };
    expect(() => calculerLigne({ ...base, nombre: 0 })).toThrow(RangeError);
    expect(() => calculerLigne({ ...base, nombre: 1.5 })).toThrow(RangeError);
    expect(() => calculerLigne({ ...base, coefficientBoite: 0 })).toThrow(
      RangeError,
    );
    expect(() => calculerLigne({ ...base, prixUnite: -1 })).toThrow(RangeError);
  });

  it('Invariant : quantiteUm = nombreAffiche x coefficientApplique', () => {
    for (const unite of ['BOITE', 'UNITE'] as const) {
      for (const nombre of [1, 2, 7]) {
        for (const coefficientBoite of [1, 10, 20]) {
          const r = calculerLigne({
            unite,
            nombre,
            coefficientBoite,
            prixBoite: 1000,
            prixUnite: 60,
            deconditionnable: true,
          });
          expect(r.ok).toBe(true);
          if (r.ok) {
            expect(r.quantiteUm).toBe(r.nombreAffiche * r.coefficientApplique);
          }
        }
      }
    }
  });
});

describe('avertissementEcartPrix (domaine pharmacie)', () => {
  it('Écart de 20 % sous le seuil de 25 : aucun avertissement', () => {
    expect(avertissementEcartPrix(10000, 600, 20, 25)).toBeNull();
  });

  it('Écart de 30 % : avertissement ECART_PRIX 30', () => {
    expect(avertissementEcartPrix(10000, 650, 20, 25)).toEqual({
      code: 'ECART_PRIX',
      ecartPct: 30,
    });
  });

  it('Écart égal au seuil : aucun avertissement, au-delà : avertissement', () => {
    expect(avertissementEcartPrix(10000, 625, 20, 25)).toBeNull();
    expect(avertissementEcartPrix(10000, 370, 20, 25)).toEqual({
      code: 'ECART_PRIX',
      ecartPct: 26,
    });
    expect(avertissementEcartPrix(10000, 375, 20, 25)).toBeNull();
  });

  it('Prix unité moins cher que la boîte : l écart compte en valeur absolue', () => {
    expect(avertissementEcartPrix(10000, 300, 20, 25)).toEqual({
      code: 'ECART_PRIX',
      ecartPct: 40,
    });
  });

  it('Un prix absent ou nul : jamais d avertissement', () => {
    expect(avertissementEcartPrix(null, 600, 20, 25)).toBeNull();
    expect(avertissementEcartPrix(10000, null, 20, 25)).toBeNull();
    expect(avertissementEcartPrix(0, 600, 20, 25)).toBeNull();
    expect(avertissementEcartPrix(10000, 0, 20, 25)).toBeNull();
  });

  it('Seuil 0 : avertissement dès le moindre écart', () => {
    expect(avertissementEcartPrix(10000, 500, 20, 0)).toBeNull();
    expect(avertissementEcartPrix(10000, 501, 20, 0)).toEqual({
      code: 'ECART_PRIX',
      ecartPct: 0,
    });
  });
});
