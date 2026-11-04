import type { LotCandidat } from './domaine/selection-lots';
import {
  allouerLignes,
  cleLigneVente,
  controlerStockVente,
  deriverAnnulation,
  formaterNumeroTicket,
  lignesInverses,
  numeroAnnulation,
  paiementsInverses,
  passagesStockBas,
  preparerPaiements,
  type AllocationOrigine,
  type LigneAControler,
  type LigneOrigine,
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

function ligneOrigine(
  o: Partial<LigneOrigine> & { allocations: AllocationOrigine[] },
): LigneOrigine {
  return {
    medicamentId: 'med',
    stockMedicamentId: 'stk',
    nomMedicament: 'Produit',
    prixUnitaire: 600,
    quantite: 1,
    sousTotal: 600,
    uniteAffichee: 'UNITE',
    nombreAffiche: 1,
    coefficientApplique: 1,
    ...o,
  };
}

function allocOrigine(
  lotId: string | null,
  quantite: number,
  o: Partial<AllocationOrigine> = {},
): AllocationOrigine {
  return {
    lotId,
    numeroLot: lotId,
    dateExpiration: null,
    quantite,
    coutUnitaire: 0,
    lotTechnique: false,
    statut: 'DEFINITIVE',
    ...o,
  };
}

describe('numeroAnnulation', () => {
  it('préfixe le numéro de la pièce d’origine par A-', () => {
    expect(numeroAnnulation('T1-0000042')).toBe('A-T1-0000042');
    expect(numeroAnnulation('V-2026-000003')).toBe('A-V-2026-000003');
  });
});

describe('lignesInverses', () => {
  it('inverse une ligne à l’unité sur deux lots', () => {
    const date = new Date('2026-07-15T00:00:00.000Z');
    const resultat = lignesInverses([
      ligneOrigine({
        quantite: 15,
        sousTotal: 9000,
        nombreAffiche: 15,
        allocations: [
          allocOrigine('L30', 10, { coutUnitaire: 400, dateExpiration: date }),
          allocOrigine('L90', 5, { coutUnitaire: 450 }),
        ],
      }),
    ]);
    expect(resultat).toEqual([
      {
        medicamentId: 'med',
        stockMedicamentId: 'stk',
        nomMedicament: 'Produit',
        prixUnitaire: 600,
        quantite: -15,
        sousTotal: -9000,
        uniteAffichee: 'UNITE',
        nombreAffiche: -15,
        coefficientApplique: 1,
        allocations: [
          {
            lotId: 'L30',
            numeroLot: 'L30',
            dateExpiration: date,
            quantite: -10,
            coutUnitaire: 400,
            lotTechnique: false,
            statut: 'DEFINITIVE',
          },
          {
            lotId: 'L90',
            numeroLot: 'L90',
            dateExpiration: null,
            quantite: -5,
            coutUnitaire: 450,
            lotTechnique: false,
            statut: 'DEFINITIVE',
          },
        ],
      },
    ]);
  });

  it('conserve la provisoire et ignore la remplacée', () => {
    const [a, b] = lignesInverses([
      ligneOrigine({
        quantite: 5,
        allocations: [
          allocOrigine('A', 2),
          allocOrigine(null, 3, { statut: 'PROVISOIRE' }),
        ],
      }),
      ligneOrigine({
        quantite: 4,
        allocations: [
          allocOrigine(null, 4, { statut: 'REMPLACEE' }),
          allocOrigine('B', 4),
        ],
      }),
    ]);
    expect(a.allocations.map((x) => [x.lotId, x.quantite, x.statut])).toEqual([
      ['A', -2, 'DEFINITIVE'],
      [null, -3, 'PROVISOIRE'],
    ]);
    expect(b.allocations.map((x) => [x.lotId, x.quantite, x.statut])).toEqual([
      ['B', -4, 'DEFINITIVE'],
    ]);
  });

  it('oppose le nombre affiché d’une vente à la boîte et garde le coefficient', () => {
    const [l] = lignesInverses([
      ligneOrigine({
        quantite: 40,
        nombreAffiche: 2,
        coefficientApplique: 20,
        uniteAffichee: 'BOITE',
        prixUnitaire: 500,
        sousTotal: 20000,
        allocations: [allocOrigine('A', 40)],
      }),
    ]);
    expect(l.quantite).toBe(-40);
    expect(l.nombreAffiche).toBe(-2);
    expect(l.coefficientApplique).toBe(20);
    expect(l.sousTotal).toBe(-20000);
    expect(l.quantite).toBe(l.nombreAffiche * l.coefficientApplique);
  });

  it('refuse les allocations incohérentes avec le numéro de la ligne', () => {
    expect(() => lignesInverses([ligneOrigine({ allocations: [] })])).toThrow(
      new RangeError(
        'Ligne 1 : allocations incohérentes, annulation impossible.',
      ),
    );
    expect(() =>
      lignesInverses([
        ligneOrigine({ quantite: 5, allocations: [allocOrigine('A', 5)] }),
        ligneOrigine({ quantite: 5, allocations: [allocOrigine('A', 3)] }),
      ]),
    ).toThrow(
      new RangeError(
        'Ligne 2 : allocations incohérentes, annulation impossible.',
      ),
    );
  });
});

describe('paiementsInverses', () => {
  it('oppose chaque paiement d’un paiement partagé', () => {
    expect(
      paiementsInverses(
        [
          { modePaiementId: 'esp', montant: 1000 },
          { modePaiementId: 'om', montant: 2000 },
        ],
        3000,
      ),
    ).toEqual([
      {
        modePaiementId: 'esp',
        montant: -1000,
        referenceExterne: null,
        montantRecu: null,
      },
      {
        modePaiementId: 'om',
        montant: -2000,
        referenceExterne: null,
        montantRecu: null,
      },
    ]);
  });

  it('refuse une liste vide ou une somme différente du total', () => {
    expect(() => paiementsInverses([], 0)).toThrow(RangeError);
    expect(() =>
      paiementsInverses(
        [
          { modePaiementId: 'esp', montant: 1000 },
          { modePaiementId: 'om', montant: 1500 },
        ],
        3000,
      ),
    ).toThrow(RangeError);
  });
});

describe('deriverAnnulation', () => {
  const d = new Date('2026-10-26T10:00:00.000Z');
  const vente = {
    typePiece: 'VENTE' as const,
    statut: 'VALIDEE' as const,
    annuleeLe: null,
    annuleeParId: null,
    motifAnnulation: null,
  };
  const liee = {
    id: 'p1',
    numero: 'A-T1-0000001',
    typePiece: 'ANNULATION' as const,
    motifAnnulation: 'Erreur de quantité',
    createdAt: d,
    vendeurId: 'u2',
    vendeurNom: 'Fatoumata Camara',
  };

  it('dérive l’annulation d’une vente de sa pièce liée', () => {
    expect(deriverAnnulation(vente, liee)).toEqual({
      statut: 'ANNULEE',
      annuleeLe: d,
      annuleeParId: 'u2',
      motifAnnulation: 'Erreur de quantité',
      motif: null,
      annulation: {
        id: 'p1',
        numero: 'A-T1-0000001',
        motif: 'Erreur de quantité',
        le: d,
        par: { id: 'u2', nom: 'Fatoumata Camara' },
      },
    });
  });

  it('présente la pièce d’annulation elle-même comme validée', () => {
    const etat = deriverAnnulation(
      {
        typePiece: 'ANNULATION',
        statut: 'VALIDEE',
        annuleeLe: null,
        annuleeParId: null,
        motifAnnulation: 'Erreur de quantité',
      },
      null,
    );
    expect(etat.statut).toBe('VALIDEE');
    expect(etat.motifAnnulation).toBeNull();
    expect(etat.motif).toBe('Erreur de quantité');
    expect(etat.annulation).toBeNull();
  });

  it('recopie les colonnes d’une vente historique annulée', () => {
    expect(
      deriverAnnulation(
        {
          typePiece: 'VENTE',
          statut: 'ANNULEE',
          annuleeLe: d,
          annuleeParId: 'u2',
          motifAnnulation: 'Erreur de saisie',
        },
        null,
      ),
    ).toEqual({
      statut: 'ANNULEE',
      annuleeLe: d,
      annuleeParId: 'u2',
      motifAnnulation: 'Erreur de saisie',
      motif: null,
      annulation: null,
    });
  });

  it('ignore une pièce liée de régularisation', () => {
    const etat = deriverAnnulation(vente, {
      ...liee,
      typePiece: 'REGULARISATION',
    });
    expect(etat.statut).toBe('VALIDEE');
    expect(etat.annulation).toBeNull();
  });
});

describe('controlerStockVente (D713 à D715)', () => {
  const FICHE = 'f1';
  const ligneC = (
    index: number,
    o: Partial<LigneAControler> & { quantiteUm: number },
  ): LigneAControler => ({
    index,
    stockMedicamentId: FICHE,
    nom: 'Doliprane',
    unite: 'BOITE',
    nombre: o.quantiteUm,
    coefficientLigne: 1,
    sortieManuelle: false,
    ...o,
  });

  /** Alloue puis contrôle : `solde` est l'agrégat du produit, `lots` les lots à solde positif. */
  function controler(
    lignes: LigneAControler[],
    lots: LotCandidat[],
    solde: number,
    manuelles: Record<number, string> = {},
  ) {
    const allouees = allouerLignes(
      JOUR,
      lignes.map((l) => ({
        index: l.index,
        stockMedicamentId: l.stockMedicamentId,
        unite: l.unite,
        quantiteUm: l.quantiteUm,
        sortieManuelle: manuelles[l.index]
          ? { lotId: manuelles[l.index], motif: 'Produit retiré' }
          : null,
      })),
      new Map([[FICHE, lots]]),
    );
    return controlerStockVente({
      lignes,
      allouees,
      soldeProduit: new Map([[FICHE, solde]]),
    });
  }

  it('1. refus simple : stock vide, disponible 0', () => {
    const r = controler([ligneC(0, { quantiteUm: 1 })], [], 0);
    expect(r.sortiesManuelles).toEqual([]);
    expect(r.insuffisantes).toEqual([
      {
        index: 0,
        stockMedicamentId: FICHE,
        nom: 'Doliprane',
        unite: 'BOITE',
        demande: 1,
        disponible: 0,
        disponibleUm: 0,
      },
    ]);
  });

  it('2. vente couverte : rien à signaler', () => {
    const r = controler(
      [ligneC(0, { quantiteUm: 3 })],
      [lot('A', 5, { exp: '2027-01-01' })],
      5,
    );
    expect(r).toEqual({ insuffisantes: [], sortiesManuelles: [] });
  });

  it('3. boîtes et unités : la somme est contrôlée, disponible par ligne', () => {
    // Coefficient 20, 35 unités en stock (1 boîte et 15 unités)
    const lots = [lot('A', 35, { exp: '2027-01-01', coef: 20 })];
    const r = controler(
      [
        ligneC(0, { quantiteUm: 20, nombre: 1, coefficientLigne: 20 }),
        ligneC(1, {
          quantiteUm: 20,
          nombre: 20,
          unite: 'UNITE',
          coefficientLigne: 1,
        }),
      ],
      lots,
      35,
    );
    expect(r.insuffisantes).toHaveLength(2);
    // Boîte : 35 - 20 (unités) = 15 unités, soit 0 boîte
    expect(r.insuffisantes[0]).toMatchObject({
      index: 0,
      unite: 'BOITE',
      demande: 1,
      disponible: 0,
      disponibleUm: 35,
    });
    // Unités : 35 - 20 (boîte) = 15 unités
    expect(r.insuffisantes[1]).toMatchObject({
      index: 1,
      unite: 'UNITE',
      demande: 20,
      disponible: 15,
      disponibleUm: 35,
    });
  });

  it('4. périmés seuls, agrégat positif : sortie manuelle requise', () => {
    const r = controler(
      [ligneC(0, { quantiteUm: 2 })],
      [lot('P', 4, { exp: '2026-01-01' })],
      4,
    );
    expect(r.insuffisantes).toEqual([]);
    expect(r.sortiesManuelles).toHaveLength(1);
    expect(r.sortiesManuelles[0].lotsPerimesDisponibles).toHaveLength(1);
  });

  it('5. stock non périmé partiel et lot périmé : insuffisant, jamais de sortie manuelle', () => {
    const r = controler(
      [ligneC(0, { quantiteUm: 5 })],
      [lot('V', 2, { exp: '2027-01-01' }), lot('P', 4, { exp: '2026-01-01' })],
      6,
    );
    expect(r.sortiesManuelles).toEqual([]);
    expect(r.insuffisantes).toHaveLength(1);
    expect(r.insuffisantes[0]).toMatchObject({
      disponible: 2,
      disponibleUm: 2,
    });
  });

  it('6. agrégat négatif avec lot périmé : insuffisant, disponible 0', () => {
    const r = controler(
      [ligneC(0, { quantiteUm: 1 })],
      [lot('P', 3, { exp: '2026-01-01' })],
      -1,
    );
    expect(r.sortiesManuelles).toEqual([]);
    expect(r.insuffisantes[0]).toMatchObject({
      disponible: 0,
      disponibleUm: 0,
    });
  });

  it('7. lots 3 et part à régulariser 1 : 2 disponibles', () => {
    const r = controler(
      [ligneC(0, { quantiteUm: 3 })],
      [lot('A', 3, { exp: '2027-01-01' })],
      2,
    );
    expect(r.insuffisantes).toHaveLength(1);
    expect(r.insuffisantes[0]).toMatchObject({
      demande: 3,
      disponible: 2,
      disponibleUm: 2,
    });
    // Deux unités passent
    expect(
      controler(
        [ligneC(0, { quantiteUm: 2 })],
        [lot('A', 3, { exp: '2027-01-01' })],
        2,
      ).insuffisantes,
    ).toEqual([]);
  });

  it('8. sortie manuelle au-delà du lot : insuffisant', () => {
    const r = controler(
      [ligneC(0, { quantiteUm: 5 })],
      [lot('P', 3, { exp: '2026-01-01' })],
      3,
      { 0: 'P' },
    );
    expect(r.sortiesManuelles).toEqual([]);
    expect(r.insuffisantes[0]).toMatchObject({
      disponible: 3,
      disponibleUm: 3,
    });
  });

  it('9. sortie manuelle au-delà de l agrégat : insuffisant borné par l agrégat', () => {
    const r = controler(
      [ligneC(0, { quantiteUm: 3 })],
      [lot('P', 3, { exp: '2026-01-01' })],
      2,
      { 0: 'P' },
    );
    expect(r.insuffisantes[0]).toMatchObject({ demande: 3, disponible: 2 });
    // Dans la limite de l'agrégat, la sortie manuelle passe
    expect(
      controler(
        [ligneC(0, { quantiteUm: 2 })],
        [lot('P', 3, { exp: '2026-01-01' })],
        2,
        { 0: 'P' },
      ),
    ).toEqual({ insuffisantes: [], sortiesManuelles: [] });
  });

  it('10. plusieurs fiches : seules celles en cause sont signalées', () => {
    const lignes = [
      ligneC(0, { quantiteUm: 1 }),
      ligneC(1, { quantiteUm: 1, stockMedicamentId: 'f2', nom: 'Flagyl' }),
    ];
    const allouees = allouerLignes(
      JOUR,
      lignes.map((l) => ({
        index: l.index,
        stockMedicamentId: l.stockMedicamentId,
        unite: l.unite,
        quantiteUm: l.quantiteUm,
        sortieManuelle: null,
      })),
      new Map([
        [FICHE, [lot('A', 5, { exp: '2027-01-01' })]],
        ['f2', []],
      ]),
    );
    const r = controlerStockVente({
      lignes,
      allouees,
      soldeProduit: new Map([
        [FICHE, 5],
        ['f2', 0],
      ]),
    });
    expect(r.insuffisantes.map((i) => i.nom)).toEqual(['Flagyl']);
  });
});
