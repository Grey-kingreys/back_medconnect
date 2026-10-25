import { analyserDoublons, type CompteTelephone } from './doublons-telephone';

const compte = (
  id: string,
  telephone: string,
  createdAt: string,
): CompteTelephone => ({
  id,
  email: `${id}@exemple.gn`,
  role: 'PATIENT',
  telephone,
  createdAt: new Date(createdAt),
});

describe('analyserDoublons', () => {
  it("regroupe les formes d'un même numéro et isole les numéros non reconnus", () => {
    const A = compte('A', '+224 622 98 87 76', '2026-01-02');
    const B = compte('B', '622988776', '2026-01-01');
    const C = compte('C', '+224 628 40 50 61', '2026-01-03');
    const D = compte('D', '12345', '2026-01-04');

    const analyse = analyserDoublons([A, B, C, D]);

    expect(analyse.total).toBe(4);
    expect(analyse.doublons).toEqual([
      { numero: '+224622988776', comptes: [B, A] },
    ]);
    expect(analyse.nonReconnus).toEqual([D]);
  });

  it('renvoie une analyse vide pour une liste vide', () => {
    expect(analyserDoublons([])).toEqual({
      total: 0,
      doublons: [],
      nonReconnus: [],
    });
  });

  it('trie les groupes par numéro, puis les comptes par date et par identifiant', () => {
    const a1 = compte('b', '628405061', '2026-02-01');
    const a2 = compte('a', '+224628405061', '2026-02-01');
    const b1 = compte('z', '622988776', '2026-03-01');
    const b2 = compte('y', '622 98 87 76', '2026-01-01');

    const analyse = analyserDoublons([a1, b1, a2, b2]);

    expect(analyse.doublons.map((g) => g.numero)).toEqual([
      '+224622988776',
      '+224628405061',
    ]);
    expect(analyse.doublons[0].comptes).toEqual([b2, b1]);
    expect(analyse.doublons[1].comptes).toEqual([a2, a1]);
  });
});
