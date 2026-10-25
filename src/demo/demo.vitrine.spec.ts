import { COMPTES_DEMO, COMPTES_VITRINE, STRUCTURES_DEMO } from './demo.donnees';

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

  it('propose un compte par rôle, et deux administrateurs de structure (un hôpital, une pharmacie)', () => {
    const rolesVitrine = COMPTES_VITRINE.map((e) => parEmail.get(e)?.role);
    const rolesDemo = new Set(COMPTES_DEMO.map((c) => c.role));

    expect(new Set(rolesVitrine)).toEqual(rolesDemo);
    for (const role of rolesDemo) {
      const attendu = role === 'STRUCTURE_ADMIN' ? 2 : 1;
      expect(rolesVitrine.filter((r) => r === role)).toHaveLength(attendu);
    }

    const typesAdmins = COMPTES_VITRINE.map((e) => parEmail.get(e))
      .filter((c) => c?.role === 'STRUCTURE_ADMIN')
      .map((c) => STRUCTURES_DEMO.find((s) => s.cle === c?.structure)?.type)
      .sort();
    expect(typesAdmins).toEqual(['HOPITAL', 'PHARMACIE']);
  });

  it("l'administratrice de Kaloum est proposée, sa description parle du stock et de l'annulation", () => {
    const email = 'admin.kaloum@demo.medconnecte.gn';
    expect(COMPTES_VITRINE).toContain(email);
    const description = parEmail.get(email)?.description ?? '';
    expect(description).toContain('stock');
    expect(description).toContain('annulation');
  });
});
