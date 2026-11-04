import { cheminsCout, masquerCouts, MOTIF_CLE_COUT } from './masquer-couts';

describe('masquerCouts', () => {
  const entree4 = () => ({
    lots: [{ id: 'l1', coutUnitaire: 4, quantite: 3 }],
    groupes: [[{ marge: 1, n: 2 }]],
    resume: { valeurCout: 9, total: 9 },
  });

  it('1. avec marge:read : même référence, rien retiré', () => {
    const obj = { id: 'a', coutUnitaire: 10 };
    expect(masquerCouts(obj, true)).toBe(obj);
  });

  it('2. sans marge:read : clés de coût retirées à la racine', () => {
    const obj = {
      id: 'a',
      coutUnitaire: 10,
      coutAchatBoite: 120,
      valeurCout: 5,
      margeBrute: 3,
      tauxMarge: 0.2,
      prixUnitaire: 150,
    };
    expect(masquerCouts(obj, false)).toEqual({ id: 'a', prixUnitaire: 150 });
  });

  it('3. casse ignorée', () => {
    expect(masquerCouts({ CoutTotal: 1, MARGE: 2, nom: 'x' }, false)).toEqual({
      nom: 'x',
    });
  });

  it('4. objets imbriqués et tableaux, y compris tableaux de tableaux', () => {
    expect(masquerCouts(entree4(), false)).toEqual({
      lots: [{ id: 'l1', quantite: 3 }],
      groupes: [[{ n: 2 }]],
      resume: { total: 9 },
    });
  });

  it('5. une clé de coût dont la valeur est un objet est retirée entière', () => {
    expect(
      masquerCouts({ marge: { total: 1, detail: [1] }, a: 1 }, false),
    ).toEqual({ a: 1 });
  });

  it('6. l entrée n est pas modifiée', () => {
    const entree = entree4();
    const avant = JSON.stringify(entree);
    const resultat = masquerCouts(entree, false);
    expect(JSON.stringify(entree)).toBe(avant);
    expect(resultat).not.toBe(entree);
  });

  it('7. valeurs conservées telles quelles : Date, null, undefined, primitives, chaînes qui contiennent cout', () => {
    const d = new Date();
    const resultat = masquerCouts(
      { le: d, n: null, u: undefined, x: 0, nom: 'coût du transport' },
      false,
    );
    expect(resultat.le).toBe(d);
    expect(resultat.n).toBeNull();
    expect('u' in resultat).toBe(true);
    expect(resultat.x).toBe(0);
    expect(resultat.nom).toBe('coût du transport');
  });

  it('8. entrée primitive, null ou tableau racine', () => {
    expect(masquerCouts(5, false)).toBe(5);
    expect(masquerCouts(null, false)).toBeNull();
    expect(masquerCouts([{ coutUnitaire: 1, a: 1 }], false)).toEqual([
      { a: 1 },
    ]);
  });

  it('9. cheminsCout liste les clés de coût, vide après masquage', () => {
    const entree = entree4();
    expect(cheminsCout(entree)).toEqual([
      'lots[0].coutUnitaire',
      'groupes[0][0].marge',
      'resume.valeurCout',
    ]);
    expect(cheminsCout(masquerCouts(entree, false))).toEqual([]);
    expect(cheminsCout([{ marge: { cout: 1 } }])).toEqual(['[0].marge']);
  });

  it('10. MOTIF_CLE_COUT correspond au motif du test transversal (D407)', () => {
    expect(MOTIF_CLE_COUT.source).toBe('cout|marge');
    expect(MOTIF_CLE_COUT.flags).toBe('i');
  });
});
