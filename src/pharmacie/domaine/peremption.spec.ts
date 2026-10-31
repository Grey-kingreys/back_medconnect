import {
  classerAlertesPeremption,
  type LotAlerte,
  type ResultatAlertes,
} from './peremption';

const JOUR = '2026-11-01';
const HORIZONS = [90, 30, 7];

/** Date AAAA-MM-JJ à `n` jours du jour fixe. */
function dans(n: number): string {
  const [a, m, j] = JOUR.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}

let compteur = 0;
function lot(surcharge: Partial<LotAlerte> = {}): LotAlerte {
  compteur += 1;
  return {
    lotId: `lot-${String(compteur).padStart(3, '0')}`,
    stockId: 'stk1',
    nom: 'Paracétamol',
    numeroLot: null,
    dateExpiration: dans(3),
    quantite: 10,
    coefficientReception: 10,
    prixBoite: 8000,
    coutUnitaire: 500,
    lotTechnique: false,
    ficheArchivee: false,
    ...surcharge,
  };
}

function idsDe(r: ResultatAlertes, jours: number): string[] {
  return (r.horizons.find((h) => h.jours === jours)?.lots ?? []).map(
    (l) => l.lotId,
  );
}

describe('classerAlertesPeremption', () => {
  it('classement exclusif par le plus petit horizon', () => {
    const l0 = lot({ dateExpiration: dans(0) });
    const l7 = lot({ dateExpiration: dans(7) });
    const l8 = lot({ dateExpiration: dans(8) });
    const l30 = lot({ dateExpiration: dans(30) });
    const l31 = lot({ dateExpiration: dans(31) });
    const l90 = lot({ dateExpiration: dans(90) });
    const l91 = lot({ dateExpiration: dans(91) });
    const lMoins1 = lot({ dateExpiration: dans(-1) });
    const lNul = lot({ dateExpiration: null });
    const r = classerAlertesPeremption(
      [l0, l7, l8, l30, l31, l90, l91, lMoins1, lNul],
      HORIZONS,
      JOUR,
    );
    expect(idsDe(r, 7).sort()).toEqual([l0.lotId, l7.lotId].sort());
    expect(idsDe(r, 30).sort()).toEqual([l8.lotId, l30.lotId].sort());
    expect(idsDe(r, 90).sort()).toEqual([l31.lotId, l90.lotId].sort());
    expect(r.perimes.lots.map((l) => l.lotId)).toEqual([lMoins1.lotId]);
    expect(r.perimes.lots[0].joursRestants).toBe(-1);
    expect(r.sansDate.nombreLots).toBe(1);
    const tous = [...r.horizons.flatMap((h) => h.lots), ...r.perimes.lots].map(
      (l) => l.lotId,
    );
    expect(tous).not.toContain(l91.lotId);
    expect(tous).not.toContain(lNul.lotId);
    expect(tous).toHaveLength(7);
  });

  it('horizons rangés en ordre décroissant', () => {
    const r = classerAlertesPeremption([], [7, 90, 30], JOUR);
    expect(r.horizons.map((h) => h.jours)).toEqual([90, 30, 7]);

    const l45 = lot({ dateExpiration: dans(45) });
    const l5 = lot({ dateExpiration: dans(5) });
    const r2 = classerAlertesPeremption([l45, l5], [60, 30], JOUR);
    expect(idsDe(r2, 60)).toEqual([l45.lotId]);
    expect(idsDe(r2, 30)).toEqual([l5.lotId]);
  });

  it("valorisation d'un lot", () => {
    const l = lot({ quantite: 25, coutUnitaire: 500 });
    const r = classerAlertesPeremption([l], HORIZONS, JOUR);
    const v = r.horizons[2].lots[0];
    expect(v.quantiteBoites).toBe(2);
    expect(v.unitesEnPlus).toBe(5);
    expect(v.valeurVente).toBe(20000);
    expect(v.valeurCout).toBe(12500);
    expect(v.coutConnu).toBe(true);
  });

  it('coût inconnu jamais compté pour 0', () => {
    const sansCout = classerAlertesPeremption(
      [lot({ coutUnitaire: 0 })],
      HORIZONS,
      JOUR,
    ).horizons[2].lots[0];
    expect(sansCout.valeurCout).toBeNull();
    expect(sansCout.coutConnu).toBe(false);

    const technique = classerAlertesPeremption(
      [lot({ coutUnitaire: 300, lotTechnique: true })],
      HORIZONS,
      JOUR,
    ).horizons[2].lots[0];
    expect(technique.valeurCout).toBeNull();

    const mixte = classerAlertesPeremption(
      [lot({ quantite: 10, coutUnitaire: 500 }), lot({ coutUnitaire: 0 })],
      HORIZONS,
      JOUR,
    ).horizons[2];
    expect(mixte.valeurCout).toBe(5000);
    expect(mixte.nombreLotsCoutInconnu).toBe(1);

    const tousInconnus = classerAlertesPeremption(
      [lot({ coutUnitaire: 0 }), lot({ coutUnitaire: 0 })],
      HORIZONS,
      JOUR,
    ).horizons[2];
    expect(tousInconnus.valeurCout).toBeNull();

    const vide = classerAlertesPeremption([], HORIZONS, JOUR).horizons[2];
    expect(vide.valeurCout).toBe(0);
    expect(vide.valeurVente).toBe(0);
    expect(vide.nombreLots).toBe(0);
  });

  it('prix inconnu', () => {
    const nul = classerAlertesPeremption(
      [lot({ prixBoite: null })],
      HORIZONS,
      JOUR,
    ).horizons[2];
    expect(nul.lots[0].valeurVente).toBeNull();
    expect(nul.nombreLotsSansPrix).toBe(1);
    expect(nul.valeurVente).toBeNull();

    const zero = classerAlertesPeremption(
      [lot({ prixBoite: 0 }), lot({ prixBoite: 0 })],
      HORIZONS,
      JOUR,
    ).horizons[2];
    expect(zero.lots[0].valeurVente).toBeNull();
    expect(zero.nombreLotsSansPrix).toBe(2);
    expect(zero.valeurVente).toBeNull();
  });

  it('lots ignorés et tri', () => {
    const date = dans(5);
    const c = lot({ lotId: 'c', nom: 'Paracétamol', dateExpiration: date });
    const b = lot({ lotId: 'b', nom: 'Amoxicilline', dateExpiration: date });
    const a = lot({ lotId: 'a', nom: 'Amoxicilline', dateExpiration: date });
    const tot = lot({ lotId: 'z', nom: 'Zinc', dateExpiration: dans(2) });
    const r = classerAlertesPeremption(
      [c, b, a, tot, lot({ quantite: 0 }), lot({ quantite: -3 })],
      HORIZONS,
      JOUR,
    );
    expect(r.horizons[2].nombreLots).toBe(4);
    expect(idsDe(r, 7)).toEqual(['z', 'a', 'b', 'c']);
  });

  it('entrées refusées', () => {
    expect(() => classerAlertesPeremption([], [], JOUR)).toThrow(RangeError);
    expect(() => classerAlertesPeremption([], [0], JOUR)).toThrow(RangeError);
    expect(() => classerAlertesPeremption([], [400], JOUR)).toThrow(RangeError);
    expect(() => classerAlertesPeremption([], [30, 30], JOUR)).toThrow(
      RangeError,
    );
    expect(() =>
      classerAlertesPeremption([], [1, 2, 3, 4, 5, 6], JOUR),
    ).toThrow(RangeError);
    expect(() => classerAlertesPeremption([], HORIZONS, '2026-13-01')).toThrow(
      RangeError,
    );
  });
});
