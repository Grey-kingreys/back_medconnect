import {
  analyserOriginesDesktop,
  originesCors,
  validerOriginesDesktop,
} from './origines-cors';

describe('origines desktop du CORS', () => {
  it('absente, vide ou espaces : aucune origine, aucune erreur', () => {
    for (const valeur of [undefined, '', '   ']) {
      expect(analyserOriginesDesktop(valeur)).toEqual({
        origines: [],
        erreur: null,
      });
    }
  });

  it('accepte deux origines et retire un doublon', () => {
    const resultat = analyserOriginesDesktop(
      'http://127.0.0.1:47613, http://localhost:47614, http://127.0.0.1:47613',
    );
    expect(resultat.erreur).toBeNull();
    expect(resultat.origines).toEqual([
      'http://127.0.0.1:47613',
      'http://localhost:47614',
    ]);
  });

  it.each([
    'https://127.0.0.1:47613',
    'http://192.168.1.2:47613',
    'http://127.0.0.1:80',
    'http://127.0.0.1:70000',
    'http://127.0.0.1:47613/',
    'http://exemple.com:47613',
  ])('refuse « %s » sans répéter la valeur', (valeur) => {
    const erreur = validerOriginesDesktop(valeur);
    expect(erreur).not.toBeNull();
    expect(erreur).not.toContain(valeur);
    expect(erreur).toContain('n°1');
  });

  it('refuse 11 origines valides', () => {
    const liste = Array.from(
      { length: 11 },
      (_, i) => `http://127.0.0.1:${47613 + i}`,
    ).join(',');
    expect(validerOriginesDesktop(liste)).toContain('10 origines au plus');
  });

  describe('originesCors', () => {
    it("met le front d'abord, avec son défaut, puis les origines desktop", () => {
      expect(originesCors({})).toEqual(['http://localhost:3000']);
      expect(
        originesCors({
          FRONTEND_URL: 'https://app.exemple.test',
          DESKTOP_ORIGINS: 'http://127.0.0.1:47613',
        }),
      ).toEqual(['https://app.exemple.test', 'http://127.0.0.1:47613']);
    });

    it('retire les doublons et garde les origines valides malgré une entrée invalide', () => {
      expect(
        originesCors({
          FRONTEND_URL: 'http://localhost:3000',
          DESKTOP_ORIGINS:
            'http://localhost:3000,http://exemple.com:47613,http://127.0.0.1:47614',
        }),
      ).toEqual(['http://localhost:3000', 'http://127.0.0.1:47614']);
    });
  });
});
