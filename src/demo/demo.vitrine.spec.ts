import { COMPTES_DEMO, COMPTES_VITRINE } from './demo.donnees';

/**
 * La page de connexion ne propose qu'un compte par rôle (COMPTES_VITRINE).
 * Ces tests empêchent qu'un renommage du jeu de données fasse disparaître un
 * rôle de la page, ou qu'un rôle y apparaisse deux fois.
 */
describe('Comptes vitrine du mode démo', () => {
  const parEmail = new Map(COMPTES_DEMO.map((c) => [c.email, c]));

  it('chaque compte vitrine existe dans le jeu de données démo', () => {
    for (const email of COMPTES_VITRINE) {
      expect(parEmail.has(email)).toBe(true);
    }
  });

  it('propose exactement un compte par rôle présent dans le jeu de données', () => {
    const rolesVitrine = COMPTES_VITRINE.map((e) => parEmail.get(e)?.role);
    const rolesDemo = new Set(COMPTES_DEMO.map((c) => c.role));

    expect(new Set(rolesVitrine).size).toBe(rolesVitrine.length);
    expect(new Set(rolesVitrine)).toEqual(rolesDemo);
  });
});
