import {
  instantLisible,
  joursAvant,
  jourLisible,
  lendemain,
} from './jour-metier';

describe('Jour métier : outils de date', () => {
  it('1. lendemain passe les fins de mois et d’année', () => {
    expect(lendemain('2026-10-30')).toBe('2026-10-31');
    expect(lendemain('2026-10-31')).toBe('2026-11-01');
    expect(lendemain('2026-12-31')).toBe('2027-01-01');
    expect(lendemain('2028-02-28')).toBe('2028-02-29');
  });

  it('2. joursAvant recule de n jours', () => {
    expect(joursAvant('2026-11-03', 7)).toBe('2026-10-27');
    expect(joursAvant('2026-10-30', 0)).toBe('2026-10-30');
  });

  it('3. jourLisible écrit JJ/MM/AAAA', () => {
    expect(jourLisible('2026-10-05')).toBe('05/10/2026');
  });

  it('4. instantLisible écrit la date et l’heure de Conakry', () => {
    expect(instantLisible(new Date('2026-10-30T09:05:00.000Z'))).toBe(
      '30/10/2026 à 09:05',
    );
  });
});
