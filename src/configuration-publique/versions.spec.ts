import { comparerVersions, lireVersion } from './versions';

describe('lireVersion', () => {
  it.each([
    ['1.4.2', [1, 4, 2]],
    ['1.4', [1, 4, 0]],
    ['2', [2, 0, 0]],
    [' 1.2.0-beta ', [1, 2, 0]],
    ['1.2.0+45', [1, 2, 0]],
  ])('lit « %s »', (brut, attendu) => {
    expect(lireVersion(brut)).toEqual(attendu);
  });

  it.each(['', undefined, 'abc', '1..2', 'v1.2.0'])(
    'renvoie null pour « %s »',
    (brut) => {
      expect(lireVersion(brut)).toBeNull();
    },
  );
});

describe('comparerVersions', () => {
  it('1.10.0 est supérieure à 1.9.0', () => {
    expect(comparerVersions([1, 10, 0], [1, 9, 0])).toBeGreaterThan(0);
  });

  it('deux versions égales donnent 0', () => {
    expect(comparerVersions([1, 2, 0], [1, 2, 0])).toBe(0);
  });

  it('0.9.9 est inférieure à 1.0.0', () => {
    expect(comparerVersions([0, 9, 9], [1, 0, 0])).toBeLessThan(0);
  });
});
