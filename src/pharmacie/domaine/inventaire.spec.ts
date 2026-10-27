import {
  ciblerLot,
  lotsEnStockFefo,
  planifierInventaireFiche,
  type LigneCiblee,
  type SaisieCible,
} from './inventaire';
import type { LotCandidat } from './selection-lots';

const JOUR = '2026-10-27';

function lot(
  id: string,
  solde: number,
  date: string | null,
  numero: string | null = null,
): LotCandidat {
  return {
    id,
    numeroLot: numero,
    dateExpiration: date,
    dateReception: `2026-09-${String(10 + Number(id.replace(/\D/g, '') || 0)).padStart(2, '0')}T00:00:00.000Z`,
    solde,
    coefficientReception: 10,
    coutUnitaire: 100,
    lotTechnique: false,
  };
}

const saisie = (s: Partial<SaisieCible> = {}): SaisieCible => ({
  lotId: null,
  numeroLot: null,
  dateExpiration: null,
  sansPeremption: false,
  quantiteNulle: false,
  ...s,
});

const sur = (
  lotId: string,
  quantiteComptee: number,
  index = 0,
): LigneCiblee => ({
  index,
  cible: { type: 'LOT', lotId },
  quantiteComptee,
});

function plan(
  lots: LotCandidat[],
  lignes: LigneCiblee[],
  provisoires: {
    allocationId: string;
    venteCreeLe: string;
    quantite: number;
  }[] = [],
  tolerance = 0,
) {
  return planifierInventaireFiche({
    lots,
    lignes,
    provisoires,
    coefficientBoite: 10,
    dateReceptionNouveaux: '2026-10-27T08:00:00.000Z',
    tolerance,
    jour: JOUR,
  });
}

describe("Règles de l'inventaire par lot", () => {
  it('ciblage par identifiant', () => {
    const lots = [lot('l1', 5, '2027-01-31')];
    expect(ciblerLot(saisie({ lotId: 'l1' }), lots)).toEqual({
      type: 'LOT',
      lotId: 'l1',
    });
    expect(ciblerLot(saisie({ lotId: 'x' }), lots)).toEqual({
      type: 'REFUS',
      code: 'LOT_INTROUVABLE',
    });
  });

  it('ciblage par numéro, casse et espaces ignorés', () => {
    const lots = [
      lot('l1', 5, '2027-01-31', 'A12'),
      lot('l2', 5, '2027-02-28', 'B07'),
    ];
    expect(ciblerLot(saisie({ numeroLot: ' a 12 ' }), lots)).toEqual({
      type: 'LOT',
      lotId: 'l1',
    });

    const doubles = [
      lot('l1', 5, '2027-01-31', 'A12'),
      lot('l2', 5, '2027-02-28', 'A12'),
    ];
    expect(ciblerLot(saisie({ numeroLot: 'A12' }), doubles)).toEqual({
      type: 'REFUS',
      code: 'LOT_REQUIS',
    });
    expect(
      ciblerLot(
        saisie({ numeroLot: 'A12', dateExpiration: '2027-02-28' }),
        doubles,
      ),
    ).toEqual({ type: 'LOT', lotId: 'l2' });

    expect(
      ciblerLot(
        saisie({ numeroLot: 'Z99', dateExpiration: '2027-05-31' }),
        lots,
      ),
    ).toEqual({
      type: 'NOUVEAU',
      numeroLot: 'Z99',
      dateExpiration: '2027-05-31',
    });
    expect(ciblerLot(saisie({ numeroLot: 'Z99' }), lots)).toEqual({
      type: 'REFUS',
      code: 'DATE_PEREMPTION_REQUISE',
    });
    expect(
      ciblerLot(saisie({ numeroLot: 'Z99', quantiteNulle: true }), lots),
    ).toEqual({ type: 'REFUS', code: 'LOT_INCONNU_VIDE' });
  });

  it('ciblage par date ou sans péremption', () => {
    const lots = [
      lot('l1', 5, '2027-01-31'),
      lot('l2', 5, '2027-02-28'),
      lot('l3', 5, null),
      lot('l4', 0, '2027-03-31'),
    ];
    expect(ciblerLot(saisie({ dateExpiration: '2027-02-28' }), lots)).toEqual({
      type: 'LOT',
      lotId: 'l2',
    });
    expect(ciblerLot(saisie({ sansPeremption: true }), lots)).toEqual({
      type: 'LOT',
      lotId: 'l3',
    });
    // D600 : la date désigne aussi un lot épuisé
    expect(ciblerLot(saisie({ dateExpiration: '2027-03-31' }), lots)).toEqual({
      type: 'LOT',
      lotId: 'l4',
    });
    expect(ciblerLot(saisie({ dateExpiration: '2020-01-31' }), lots)).toEqual({
      type: 'NOUVEAU',
      numeroLot: null,
      dateExpiration: '2020-01-31',
    });
  });

  it('sans précision', () => {
    expect(
      ciblerLot(saisie(), [lot('l1', 5, '2027-01-31'), lot('l2', 0, null)]),
    ).toEqual({ type: 'LOT', lotId: 'l1' });
    expect(
      ciblerLot(saisie(), [lot('l1', 5, '2027-01-31'), lot('l2', 2, null)]),
    ).toEqual({ type: 'REFUS', code: 'LOT_REQUIS' });
    const epuises = [lot('l1', 0, null), lot('l2', -2, '2027-01-31')];
    for (const lots of [[], epuises]) {
      expect(ciblerLot(saisie({ quantiteNulle: true }), lots)).toEqual({
        type: 'SANS_LOT',
      });
      expect(ciblerLot(saisie(), lots)).toEqual({
        type: 'REFUS',
        code: 'DATE_PEREMPTION_REQUISE',
      });
    }
  });

  it('D600 : lot unique de la fiche ciblé même épuisé ou négatif', () => {
    for (const solde of [0, -3]) {
      const lots = [lot('l1', solde, '2027-01-31')];
      expect(ciblerLot(saisie(), lots)).toEqual({ type: 'LOT', lotId: 'l1' });
      expect(ciblerLot(saisie({ quantiteNulle: true }), lots)).toEqual({
        type: 'LOT',
        lotId: 'l1',
      });
    }
    // Un numéro inconnu reste un nouveau lot
    expect(
      ciblerLot(saisie({ numeroLot: 'Z99', dateExpiration: '2027-05-31' }), [
        lot('l1', -3, '2027-01-31', 'A1'),
      ]),
    ).toEqual({
      type: 'NOUVEAU',
      numeroLot: 'Z99',
      dateExpiration: '2027-05-31',
    });
  });

  it('D600 : la date désigne un lot épuisé parmi plusieurs', () => {
    const lots = [
      lot('l1', 5, '2027-01-31'),
      lot('l2', 0, '2027-02-28'),
      lot('l3', -1, '2027-03-31'),
    ];
    expect(ciblerLot(saisie({ dateExpiration: '2027-02-28' }), lots)).toEqual({
      type: 'LOT',
      lotId: 'l2',
    });
    expect(ciblerLot(saisie({ dateExpiration: '2027-03-31' }), lots)).toEqual({
      type: 'LOT',
      lotId: 'l3',
    });
    // Sans date, plusieurs lots dont un seul en stock : celui en stock
    expect(ciblerLot(saisie(), lots)).toEqual({ type: 'LOT', lotId: 'l1' });

    // À date égale, le seul lot en stock l'emporte ; sinon LOT_REQUIS
    const memeDate = [lot('l1', 5, '2027-01-31'), lot('l2', 0, '2027-01-31')];
    expect(
      ciblerLot(saisie({ dateExpiration: '2027-01-31' }), memeDate),
    ).toEqual({ type: 'LOT', lotId: 'l1' });
    const epuisesMemeDate = [
      lot('l1', 0, '2027-01-31'),
      lot('l2', -1, '2027-01-31'),
    ];
    expect(
      ciblerLot(saisie({ dateExpiration: '2027-01-31' }), epuisesMemeDate),
    ).toEqual({ type: 'REFUS', code: 'LOT_REQUIS' });
    // La liste d'un LOT_REQUIS n'est jamais vide
    expect(lotsEnStockFefo(epuisesMemeDate).map((l) => l.id)).toEqual([
      'l1',
      'l2',
    ]);
    expect(lotsEnStockFefo(memeDate).map((l) => l.id)).toEqual(['l1']);
  });

  it('écart et tolérance sous et au-dessus (CA8)', () => {
    const lots = [lot('l1', 30, '2027-01-31')];
    const sous = plan(lots, [sur('l1', 27)], [], 5).lignes[0];
    expect(sous).toMatchObject({
      quantiteTheorique: 30,
      ecart: -3,
      mouvement: -3,
    });
    expect(plan(lots, [sur('l1', 27)], [], 5).sousTolerance).toBe(true);
    expect(plan(lots, [sur('l1', 20)], [], 5)).toMatchObject({
      ecartFiche: -10,
      sousTolerance: false,
    });
    expect(plan(lots, [sur('l1', 29)], [], 0).sousTolerance).toBe(false);
    expect(plan(lots, [sur('l1', 30)], [], 0).lignes[0].mouvement).toBe(0);
  });

  it('tolérance par fiche : écarts compensés', () => {
    const lots = [lot('l1', 10, '2027-01-31'), lot('l2', 10, '2027-02-28')];
    const p = plan(lots, [sur('l1', 12, 0), sur('l2', 8, 1)], [], 0);
    expect(p.ecartFiche).toBe(0);
    expect(p.sousTolerance).toBe(true);
  });

  it('ventes sans stock : théorique diminué, lot compté au comptage final', () => {
    const prov = [
      {
        allocationId: 'a1',
        venteCreeLe: '2026-10-26T10:00:00.000Z',
        quantite: 2,
      },
    ];
    const p1 = plan([lot('l1', 0, '2027-01-31')], [sur('l1', 3)], prov);
    expect(p1.resolution[0].prises).toMatchObject([
      { lotId: 'l1', quantite: 2 },
    ]);
    expect(p1.lignes[0]).toMatchObject({
      quantiteTheorique: -2,
      ecart: 5,
      mouvement: 5,
    });

    const p2 = plan([lot('l1', 5, '2027-01-31')], [sur('l1', 3)], prov);
    expect(p2.lignes[0]).toMatchObject({ quantiteTheorique: 3, ecart: 0 });

    const p3 = plan([lot('l1', 5, '2027-01-31')], [sur('l1', 1)], prov);
    expect(p3.resolution[0].prises).toMatchObject([
      { lotId: 'l1', quantite: 2 },
    ]);
    expect(p3.lignes[0]).toMatchObject({ quantiteTheorique: 3, ecart: -2 });
  });

  it("ventes sans stock : FEFO, lot non compté pris d'abord s'il expire avant", () => {
    const prov = [
      {
        allocationId: 'a1',
        venteCreeLe: '2026-10-26T10:00:00.000Z',
        quantite: 2,
      },
    ];
    const lots = [lot('l1', 4, '2027-01-31'), lot('l2', 3, '2027-06-30')];
    const p = plan(lots, [sur('l2', 3)], prov);
    expect(p.resolution[0].prises).toMatchObject([
      { lotId: 'l1', quantite: 2 },
    ]);
    expect(p.lignes[0]).toMatchObject({ quantiteTheorique: 3, ecart: 0 });

    const perime = plan([lot('l1', 0, '2026-10-01')], [sur('l1', 4)], prov);
    expect(perime.resolution).toEqual([]);
    expect(perime.lignes[0].mouvement).toBe(4);
  });

  it('nouveau lot', () => {
    const prov = [
      {
        allocationId: 'a1',
        venteCreeLe: '2026-10-26T10:00:00.000Z',
        quantite: 1,
      },
    ];
    const p = plan(
      [],
      [
        {
          index: 0,
          cible: {
            type: 'NOUVEAU',
            idVirtuel: 'nouveau:0',
            numeroLot: 'Z99',
            dateExpiration: '2027-05-31',
          },
          quantiteComptee: 4,
        },
      ],
      prov,
    );
    expect(p.resolution[0].prises).toMatchObject([
      { lotId: 'nouveau:0', quantite: 1 },
    ]);
    expect(p.lignes[0]).toMatchObject({
      nouveauLot: true,
      soldeAvant: 0,
      quantiteTheorique: -1,
      ecart: 5,
      mouvement: 5,
    });
  });

  it('contrôles', () => {
    const lots = [lot('l1', 5, '2027-01-31')];
    expect(() => plan(lots, [sur('l1', 1, 0), sur('l1', 2, 1)])).toThrow(
      RangeError,
    );
    expect(() =>
      plan(lots, [
        { index: 0, cible: { type: 'SANS_LOT' }, quantiteComptee: 3 },
      ]),
    ).toThrow(RangeError);
  });
});
