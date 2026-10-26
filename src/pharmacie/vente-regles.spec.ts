import type { LotCandidat } from './domaine/selection-lots';
import {
  allouerLignes,
  cleLigneVente,
  formaterNumeroTicket,
  passagesStockBas,
  preparerPaiements,
  type ModeConnu,
} from './vente-regles';

const JOUR = '2026-06-15';

function lot(
  id: string,
  solde: number,
  opts: {
    exp?: string | null;
    coef?: number;
    cout?: number;
    recu?: string;
  } = {},
): LotCandidat {
  return {
    id,
    numeroLot: id,
    dateExpiration: opts.exp ?? null,
    dateReception: opts.recu ?? '2026-01-01T00:00:00.000Z',
    solde,
    coefficientReception: opts.coef ?? 1,
    coutUnitaire: opts.cout ?? 0,
    lotTechnique: false,
  };
}

const MODES: ModeConnu[] = [
  {
    id: 'm-esp',
    code: 'ESPECES',
    libelle: 'Espèces',
    comptagePhysique: true,
    referenceAutorisee: false,
    ordre: 1,
  },
  {
    id: 'm-om',
    code: 'ORANGE_MONEY',
    libelle: 'Orange Money',
    comptagePhysique: false,
    referenceAutorisee: true,
    ordre: 2,
  },
  {
    id: 'm-mtn',
    code: 'MTN_MOMO',
    libelle: 'MTN MoMo',
    comptagePhysique: false,
    referenceAutorisee: true,
    ordre: 3,
  },
];

const resume = (a: { lotId: string; quantite: number }[]) =>
  a.map((x) => `${x.lotId}:${x.quantite}`);

describe('formaterNumeroTicket', () => {
  it('formate sur 7 chiffres au moins', () => {
    expect(formaterNumeroTicket(1, 1)).toBe('T1-0000001');
    expect(formaterNumeroTicket(2, 1234567)).toBe('T2-1234567');
    expect(formaterNumeroTicket(1, 12345678)).toBe('T1-12345678');
  });

  it('refuse un ordre ou un numéro invalide', () => {
    expect(() => formaterNumeroTicket(0, 1)).toThrow(RangeError);
    expect(() => formaterNumeroTicket(1, 0)).toThrow(RangeError);
  });
});

describe('cleLigneVente', () => {
  it('traite l’unité absente comme la boîte', () => {
    expect(cleLigneVente('s1')).toBe(cleLigneVente('s1', 'BOITE'));
    expect(cleLigneVente('s1')).not.toBe(cleLigneVente('s1', 'UNITE'));
  });
});

describe('allouerLignes', () => {
  it('même fiche en boîte puis à l’unité', () => {
    const r = allouerLignes(
      JOUR,
      [
        {
          index: 0,
          stockMedicamentId: 's1',
          unite: 'BOITE',
          quantiteUm: 10,
          sortieManuelle: null,
        },
        {
          index: 1,
          stockMedicamentId: 's1',
          unite: 'UNITE',
          quantiteUm: 3,
          sortieManuelle: null,
        },
      ],
      new Map([['s1', [lot('L', 30, { coef: 10 })]]]),
    );
    expect(resume(r[0].allocations)).toEqual(['L:10']);
    expect(resume(r[1].allocations)).toEqual(['L:3']);
    expect(r[0].resteProvisoire).toBe(0);
    expect(r[1].resteProvisoire).toBe(0);
  });

  it('partage les soldes entre les lignes d’une même fiche', () => {
    const r = allouerLignes(
      JOUR,
      [
        {
          index: 0,
          stockMedicamentId: 's1',
          unite: 'BOITE',
          quantiteUm: 4,
          sortieManuelle: null,
        },
        {
          index: 1,
          stockMedicamentId: 's1',
          unite: 'UNITE',
          quantiteUm: 4,
          sortieManuelle: null,
        },
      ],
      new Map([['s1', [lot('L', 5)]]]),
    );
    expect(resume(r[0].allocations)).toEqual(['L:4']);
    expect(r[0].resteProvisoire).toBe(0);
    expect(resume(r[1].allocations)).toEqual(['L:1']);
    expect(r[1].resteProvisoire).toBe(3);
    expect(r[1].lotsPerimesDisponibles).toEqual([]);
  });

  it('sortie manuelle d’un périmé complétée par le FEFO', () => {
    const r = allouerLignes(
      JOUR,
      [
        {
          index: 0,
          stockMedicamentId: 's1',
          unite: 'BOITE',
          quantiteUm: 5,
          sortieManuelle: { lotId: 'P', motif: 'Client informé' },
        },
      ],
      new Map([
        [
          's1',
          [
            lot('P', 2, { exp: '2026-06-01' }),
            lot('F', 10, { exp: '2026-12-01' }),
          ],
        ],
      ]),
    );
    expect(
      r[0].allocations.map((a) => [
        a.lotId,
        a.quantite,
        a.sortieManuelle,
        a.motif,
      ]),
    ).toEqual([
      ['P', 2, true, 'Client informé'],
      ['F', 3, false, null],
    ]);
    expect(r[0].resteProvisoire).toBe(0);
    expect(r[0].lotsPerimesDisponibles).toEqual([]);
  });

  it('que du périmé sans sortie manuelle', () => {
    const r = allouerLignes(
      JOUR,
      [
        {
          index: 0,
          stockMedicamentId: 's1',
          unite: 'BOITE',
          quantiteUm: 2,
          sortieManuelle: null,
        },
      ],
      new Map([['s1', [lot('P', 10, { exp: '2026-06-01' })]]]),
    );
    expect(r[0].allocations).toEqual([]);
    expect(r[0].resteProvisoire).toBe(2);
    expect(r[0].lotsPerimesDisponibles).toEqual([
      {
        lotId: 'P',
        numeroLot: 'P',
        dateExpiration: '2026-06-01',
        quantite: 10,
      },
    ]);
    expect(r[0].quantiteAllouee).toBe(0);
  });

  it('sortie manuelle et reste non couvert', () => {
    const r = allouerLignes(
      JOUR,
      [
        {
          index: 0,
          stockMedicamentId: 's1',
          unite: 'BOITE',
          quantiteUm: 3,
          sortieManuelle: { lotId: 'P', motif: 'Motif valable' },
        },
      ],
      new Map([['s1', [lot('P', 1, { exp: '2026-06-01' })]]]),
    );
    expect(resume(r[0].allocations)).toEqual(['P:1']);
    expect(r[0].resteProvisoire).toBe(2);
    expect(r[0].lotsPerimesDisponibles).toEqual([]);
  });

  it('aucun lot', () => {
    const r = allouerLignes(
      JOUR,
      [
        {
          index: 0,
          stockMedicamentId: 's1',
          unite: 'BOITE',
          quantiteUm: 4,
          sortieManuelle: null,
        },
      ],
      new Map(),
    );
    expect(r[0].allocations).toEqual([]);
    expect(r[0].resteProvisoire).toBe(4);
    expect(r[0].lotsPerimesDisponibles).toEqual([]);
  });

  it('lot de sortie manuelle absent de la fiche', () => {
    expect(() =>
      allouerLignes(
        JOUR,
        [
          {
            index: 0,
            stockMedicamentId: 's1',
            unite: 'BOITE',
            quantiteUm: 1,
            sortieManuelle: { lotId: 'X', motif: 'Motif valable' },
          },
        ],
        new Map([['s1', [lot('L', 5)]]]),
      ),
    ).toThrow(RangeError);
  });

  it('lot de sortie manuelle épuisé par une ligne précédente', () => {
    const r = allouerLignes(
      JOUR,
      [
        {
          index: 0,
          stockMedicamentId: 's1',
          unite: 'BOITE',
          quantiteUm: 3,
          sortieManuelle: { lotId: 'A', motif: 'Premier motif' },
        },
        {
          index: 1,
          stockMedicamentId: 's1',
          unite: 'BOITE',
          quantiteUm: 2,
          sortieManuelle: { lotId: 'A', motif: 'Second motif' },
        },
      ],
      new Map([['s1', [lot('A', 3), lot('B', 10)]]]),
    );
    expect(resume(r[0].allocations)).toEqual(['A:3']);
    expect(resume(r[1].allocations)).toEqual(['B:2']);
  });
});

describe('preparerPaiements', () => {
  it('espèces par défaut', () => {
    const r = preparerPaiements(1000, undefined, MODES);
    expect(r).toEqual({
      ok: true,
      paiements: [
        {
          modePaiementId: 'm-esp',
          code: 'ESPECES',
          montant: 1000,
          referenceExterne: null,
          montantRecu: null,
        },
      ],
    });
  });

  it('mode inconnu', () => {
    expect(
      preparerPaiements(1000, [{ mode: 'CARTE', montant: 1000 }], MODES),
    ).toEqual({ ok: false, code: 'MODE_PAIEMENT_INCONNU', mode: 'CARTE' });
    expect(preparerPaiements(1000, undefined, MODES.slice(1))).toEqual({
      ok: false,
      code: 'MODE_PAIEMENT_INCONNU',
      mode: 'ESPECES',
    });
  });

  it('ordre des contrôles', () => {
    expect(
      preparerPaiements(
        1500,
        [
          { mode: 'CARTE', montant: 500 },
          { mode: 'ESPECES', montant: 500 },
          { mode: 'ESPECES', montant: 500 },
        ],
        MODES,
      ),
    ).toMatchObject({ ok: false, code: 'MODE_PAIEMENT_INCONNU' });
    expect(
      preparerPaiements(
        1000,
        [
          { mode: 'ESPECES', montant: 500 },
          { mode: 'ESPECES', montant: 500 },
        ],
        MODES,
      ),
    ).toEqual({ ok: false, code: 'MODE_EN_DOUBLE' });
    expect(
      preparerPaiements(
        1000,
        [
          { mode: 'ESPECES', montant: 600, montantRecu: 500 },
          { mode: 'ORANGE_MONEY', montant: 400 },
        ],
        MODES,
      ),
    ).toEqual({ ok: false, code: 'MONTANT_RECU_INSUFFISANT' });
    expect(
      preparerPaiements(
        1000,
        [
          { mode: 'ESPECES', montant: 600 },
          { mode: 'ORANGE_MONEY', montant: 300 },
        ],
        MODES,
      ),
    ).toEqual({ ok: false, code: 'PAIEMENTS_INCOHERENTS', somme: 900 });
  });

  it('normalise références et montants reçus', () => {
    const r = preparerPaiements(
      1000,
      [
        { mode: 'ESPECES', montant: 500, reference: 'X', montantRecu: 1000 },
        {
          mode: 'ORANGE_MONEY',
          montant: 500,
          reference: '  OM-1  ',
          montantRecu: 800,
        },
      ],
      MODES,
    );
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.paiements[0]).toMatchObject({
      referenceExterne: null,
      montantRecu: 1000,
    });
    expect(r.paiements[1]).toMatchObject({
      referenceExterne: 'OM-1',
      montantRecu: null,
    });
  });
});

describe('passagesStockBas', () => {
  const fiche = (avant: number, apres: number, coef = 1) => ({
    nom: 'Produit',
    coefficientBoite: coef,
    avant,
    apres,
  });

  it('retient les passages de NORMAL à BAS ou RUPTURE', () => {
    expect(passagesStockBas([fiche(105, 95, 10)], 10)).toEqual([
      { nom: 'Produit', apres: 95 },
    ]);
    expect(passagesStockBas([fiche(95, 85, 10)], 10)).toEqual([]);
    expect(passagesStockBas([fiche(12, 0)], 10)).toEqual([
      { nom: 'Produit', apres: 0 },
    ]);
    expect(passagesStockBas([fiche(5, 0)], 0)).toHaveLength(1);
    expect(passagesStockBas([fiche(3, -2)], 10)).toEqual([]);
  });
});
