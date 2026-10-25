import { normaliserTelephone } from './telephone';

describe('normaliserTelephone', () => {
  it.each([
    '+224622988776',
    '622988776',
    '622 98 87 76',
    '622-98-87-76',
    '622.98.87.76',
    '00224 622 98 87 76',
    '00224-622-98-87-76',
    '224622988776',
    '+224 622 98 87 76',
    ' +224 622 98 87 76 ',
    '+224 622 98 87 76',
    '+224\t622988776',
  ])('normalise %j en +224622988776', (saisie) => {
    expect(normaliserTelephone(saisie)).toBe('+224622988776');
  });

  it.each([
    '',
    '   ',
    null,
    undefined,
    '62298877',
    '6229887761',
    '+33612345678',
    '+224 62298877',
    'abc622988776',
    '+224 (622) 98 87 76',
    '622\n988776',
    '++224622988776',
  ])('rejette %j', (saisie) => {
    expect(normaliserTelephone(saisie)).toBeNull();
  });

  it('traite 224123456 comme un numéro local à 9 chiffres', () => {
    expect(normaliserTelephone('224123456')).toBe('+224224123456');
  });
});
