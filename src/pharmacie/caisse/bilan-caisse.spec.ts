import {
  commentaireEcartRequis,
  formaterGnf,
  resultatsParMode,
  type EntreeResultats,
  type ModeReferentiel,
} from './bilan-caisse';

const modes: ModeReferentiel[] = [
  {
    code: 'ESPECES',
    libelle: 'Espèces',
    actif: true,
    comptagePhysique: true,
  },
  {
    code: 'ORANGE_MONEY',
    libelle: 'Orange Money',
    actif: true,
    comptagePhysique: false,
  },
  {
    code: 'MTN_MOMO',
    libelle: 'MTN MoMo',
    actif: true,
    comptagePhysique: false,
  },
  {
    code: 'CHEQUE',
    libelle: 'Chèque',
    actif: false,
    comptagePhysique: false,
  },
];

const base: EntreeResultats = {
  modes,
  fondEspeces: 0,
  paiements: [],
  mouvements: [],
  totalEspecesCompte: null,
  releves: [],
};

describe('Bilan de caisse (règles pures)', () => {
  it('CA15 : fond 200 000, ventes 400 000, prélèvement 100 000, compté 490 000 donnent 500 000 et -10 000', () => {
    const r = resultatsParMode({
      ...base,
      fondEspeces: 200000,
      paiements: [{ mode: 'ESPECES', montant: 400000 }],
      mouvements: [{ type: 'PRELEVEMENT', mode: 'ESPECES', montant: 100000 }],
      totalEspecesCompte: 490000,
    });
    expect(r.map((x) => x.mode)).toEqual([
      'ESPECES',
      'ORANGE_MONEY',
      'MTN_MOMO',
    ]);
    expect(r[0]).toMatchObject({
      theorique: 500000,
      compte: 490000,
      ecart: -10000,
    });
    expect(r[1]).toMatchObject({ theorique: 0, compte: null, ecart: null });
    expect(r[2]).toMatchObject({ theorique: 0, compte: null, ecart: null });
  });

  it('CA16 : moitié espèces moitié Orange Money, relevé 45 000', () => {
    const r = resultatsParMode({
      ...base,
      paiements: [
        { mode: 'ESPECES', montant: 50000 },
        { mode: 'ORANGE_MONEY', montant: 50000 },
      ],
      totalEspecesCompte: 50000,
      releves: [{ mode: 'ORANGE_MONEY', montant: 45000 }],
    });
    expect(r[0]).toMatchObject({ mode: 'ESPECES', ecart: 0 });
    expect(r[1]).toMatchObject({
      mode: 'ORANGE_MONEY',
      theorique: 50000,
      compte: 45000,
      ecart: -5000,
    });
    expect(r[2]).toMatchObject({ mode: 'MTN_MOMO', compte: null });
  });

  it('mode inactif affiché seulement s il a un théorique ou un compté', () => {
    const avec = resultatsParMode({
      ...base,
      paiements: [{ mode: 'CHEQUE', montant: 10000 }],
    });
    expect(avec.find((x) => x.mode === 'CHEQUE')?.theorique).toBe(10000);
    const sans = resultatsParMode(base);
    expect(sans.find((x) => x.mode === 'CHEQUE')).toBeUndefined();
  });

  it('sans comptage de fermeture, espèces non rapprochées', () => {
    const r = resultatsParMode({ ...base, totalEspecesCompte: null });
    expect(r[0]).toMatchObject({ mode: 'ESPECES', compte: null, ecart: null });
  });

  it('relevé des espèces, mode inconnu ou en double : RangeError', () => {
    expect(() =>
      resultatsParMode({
        ...base,
        releves: [{ mode: 'ESPECES', montant: 1 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      resultatsParMode({
        ...base,
        releves: [{ mode: 'CARTE', montant: 1 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      resultatsParMode({
        ...base,
        releves: [
          { mode: 'MTN_MOMO', montant: 1 },
          { mode: 'MTN_MOMO', montant: 2 },
        ],
      }),
    ).toThrow(RangeError);
  });

  it('commentaireEcartRequis : strictement au-delà du seuil', () => {
    expect(commentaireEcartRequis(-10000, 5000)).toBe(true);
    expect(commentaireEcartRequis(5000, 5000)).toBe(false);
    expect(commentaireEcartRequis(-5001, 5000)).toBe(true);
    expect(commentaireEcartRequis(null, 0)).toBe(false);
    expect(commentaireEcartRequis(1, 0)).toBe(true);
  });

  it('formaterGnf : espace ordinaire, signe conservé', () => {
    expect(formaterGnf(-10000)).toBe('-10 000');
    expect(formaterGnf(490000)).toBe('490 000');
    expect(formaterGnf(500)).toBe('500');
    expect(formaterGnf(0)).toBe('0');
  });
});
