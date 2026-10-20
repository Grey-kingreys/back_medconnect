import {
  estCompteDemo,
  estModeDemoActif,
  estResetDemoDemande,
} from './demo-mode';

describe('estResetDemoDemande (analyse de DEMO_RESET)', () => {
  const valeurInitiale = process.env.DEMO_RESET;
  afterEach(() => {
    if (valeurInitiale === undefined) delete process.env.DEMO_RESET;
    else process.env.DEMO_RESET = valeurInitiale;
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    [' True ', true],
    ['false', false],
    ['', false],
    ['1', false],
    ['oui', false],
    ['truee', false],
  ])('« %s » donne %s', (valeur, attendu) => {
    expect(estResetDemoDemande(valeur)).toBe(attendu);
  });

  it('variable absente : pas de remise à zéro', () => {
    delete process.env.DEMO_RESET;
    expect(estResetDemoDemande()).toBe(false);
  });

  it('lit process.env.DEMO_RESET par défaut', () => {
    process.env.DEMO_RESET = 'TRUE';
    expect(estResetDemoDemande()).toBe(true);
    process.env.DEMO_RESET = 'false';
    expect(estResetDemoDemande()).toBe(false);
  });
});

describe('estModeDemoActif (analyse de DEMO_MODE)', () => {
  const valeurInitiale = process.env.DEMO_MODE;
  afterEach(() => {
    if (valeurInitiale === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = valeurInitiale;
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    [' true ', true],
    ['True', true],
    ['false', false],
    ['FALSE', false],
    ['', false],
    ['1', false],
    ['oui', false],
    ['yes', false],
    ['truee', false],
  ])('« %s » donne %s', (valeur, attendu) => {
    expect(estModeDemoActif(valeur)).toBe(attendu);
  });

  it('variable absente : mode inactif', () => {
    delete process.env.DEMO_MODE;
    expect(estModeDemoActif()).toBe(false);
  });

  it('lit process.env.DEMO_MODE par défaut', () => {
    process.env.DEMO_MODE = ' TRUE ';
    expect(estModeDemoActif()).toBe(true);
    process.env.DEMO_MODE = 'false';
    expect(estModeDemoActif()).toBe(false);
  });
});

describe('estCompteDemo', () => {
  it.each([
    ['aminata.diallo@demo.medconnecte.gn', true],
    ['Aminata.Diallo@DEMO.medconnecte.gn', true],
    ['awa@medconnecte.gn', false],
    ['pirate@demo.medconnecte.gn.example.com', false],
    ['demo.medconnecte.gn@exemple.com', false],
    ['', false],
  ])('« %s » donne %s', (email, attendu) => {
    expect(estCompteDemo(email)).toBe(attendu);
  });

  it('refuse une valeur absente', () => {
    expect(estCompteDemo(null)).toBe(false);
    expect(estCompteDemo(undefined)).toBe(false);
  });
});
