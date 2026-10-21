import { normaliserTelephone } from 'src/common/telephone/telephone';
import { COMPTES_DEMO } from './demo.donnees';

describe('Téléphones du jeu de démonstration (TB17)', () => {
  it('chaque compte a un numéro reconnu', () => {
    for (const compte of COMPTES_DEMO) {
      expect(normaliserTelephone(compte.telephone)).not.toBeNull();
    }
  });

  it('les numéros normalisés sont tous distincts', () => {
    const formes = new Set(
      COMPTES_DEMO.map((compte) => normaliserTelephone(compte.telephone)),
    );
    expect(formes.size).toBe(COMPTES_DEMO.length);
  });
});
