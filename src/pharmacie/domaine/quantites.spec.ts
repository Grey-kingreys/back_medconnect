import {
  arrondiGnf,
  boitesVersUm,
  coutUnitaireDepuisBoite,
  etatStock,
  exigerEntier,
  formaterQuantiteLisible,
  reliquatLot,
  umVersBoites,
} from './quantites';

describe('quantites (domaine pharmacie)', () => {
  it('arrondiGnf arrondit au plus proche, moitié éloignée de zéro', () => {
    expect(arrondiGnf(2.5)).toBe(3);
    expect(arrondiGnf(-2.5)).toBe(-3);
    expect(arrondiGnf(2.4999)).toBe(2);
    expect(arrondiGnf(10000 / 3)).toBe(3333);
    expect(arrondiGnf(62.5)).toBe(63);
    expect(Object.is(arrondiGnf(-0.4), 0)).toBe(true);
  });

  it('arrondiGnf refuse un nombre non fini', () => {
    expect(() => arrondiGnf(NaN)).toThrow(RangeError);
    expect(() => arrondiGnf(Infinity)).toThrow(RangeError);
  });

  it('boitesVersUm multiplie par le coefficient', () => {
    expect(boitesVersUm(3, 20)).toBe(60);
    expect(boitesVersUm(0, 20)).toBe(0);
    expect(() => boitesVersUm(1.5, 20)).toThrow(RangeError);
    expect(() => boitesVersUm(-1, 20)).toThrow(RangeError);
    expect(() => boitesVersUm(2, 0)).toThrow(RangeError);
  });

  it('umVersBoites donne boîtes entières et unités restantes', () => {
    expect(umVersBoites(34, 20)).toEqual({ boites: 1, unites: 14 });
    expect(umVersBoites(40, 20)).toEqual({ boites: 2, unites: 0 });
    expect(umVersBoites(0, 20)).toEqual({ boites: 0, unites: 0 });
    expect(umVersBoites(7, 1)).toEqual({ boites: 7, unites: 0 });
  });

  it('umVersBoites est symétrique pour un stock négatif, sans -0', () => {
    expect(umVersBoites(-25, 20)).toEqual({ boites: -1, unites: -5 });
    const a = umVersBoites(-20, 20);
    expect(a.boites).toBe(-1);
    expect(Object.is(a.unites, 0)).toBe(true);
    const b = umVersBoites(-3, 20);
    expect(Object.is(b.boites, 0)).toBe(true);
    expect(b.unites).toBe(-3);
  });

  it('coutUnitaireDepuisBoite arrondit le coût par UM (D413)', () => {
    expect(coutUnitaireDepuisBoite(7500, 20)).toBe(375);
    expect(coutUnitaireDepuisBoite(1000, 3)).toBe(333);
    expect(coutUnitaireDepuisBoite(500, 8)).toBe(63);
    expect(coutUnitaireDepuisBoite(0, 20)).toBe(0);
    expect(() => coutUnitaireDepuisBoite(-1, 20)).toThrow(RangeError);
  });

  it('reliquatLot : CA5, 14 unités restent après 6 sur une plaquette de 20', () => {
    expect(reliquatLot(40 - 6, 20)).toBe(14);
  });

  it('reliquatLot vaut 0 sans plaquette entamée', () => {
    expect(reliquatLot(40, 20)).toBe(0);
    expect(reliquatLot(26, 1)).toBe(0);
    expect(reliquatLot(0, 20)).toBe(0);
    expect(reliquatLot(-5, 20)).toBe(0);
    expect(reliquatLot(26, 20)).toBe(6);
  });

  it('reliquatLot refuse un coefficient inférieur à 1', () => {
    expect(() => reliquatLot(10, 0)).toThrow(RangeError);
  });

  it('etatStock : seuil en boîtes, identique à aujourd hui à coefficient 1 (A4)', () => {
    expect(etatStock(9, 1, 10)).toBe('BAS');
    expect(etatStock(10, 1, 10)).toBe('NORMAL');
    expect(etatStock(1, 1, 10)).toBe('BAS');
    expect(etatStock(0, 1, 10)).toBe('RUPTURE');
  });

  it('etatStock : seuil multiplié par le coefficient', () => {
    expect(etatStock(199, 20, 10)).toBe('BAS');
    expect(etatStock(200, 20, 10)).toBe('NORMAL');
    expect(etatStock(1, 20, 10)).toBe('BAS');
  });

  it('etatStock : un stock négatif est une rupture (D416)', () => {
    expect(etatStock(-3, 1, 10)).toBe('RUPTURE');
    expect(etatStock(-3, 20, 10)).toBe('RUPTURE');
    expect(etatStock(5, 1, 0)).toBe('NORMAL');
  });

  it('exigerEntier nomme le champ dans le message', () => {
    expect(() => exigerEntier(1.5, 'solde', 0)).toThrow(
      'solde doit être un entier supérieur ou égal à 0 (reçu : 1.5).',
    );
  });

  describe('formaterQuantiteLisible', () => {
    it('boîtes seules, singulier et pluriel', () => {
      expect(formaterQuantiteLisible(12, 1, 'UNITE')).toBe('12 boîtes');
      expect(formaterQuantiteLisible(1, 1, 'UNITE')).toBe('1 boîte');
      expect(formaterQuantiteLisible(0, 1, 'UNITE')).toBe('0 boîte');
      expect(formaterQuantiteLisible(40, 20, 'COMPRIME')).toBe('2 boîtes');
    });

    it('boîtes et unités, unités seules', () => {
      expect(formaterQuantiteLisible(35, 20, 'COMPRIME')).toBe(
        '1 boîte et 15 comprimés',
      );
      expect(formaterQuantiteLisible(46, 20, 'GELULE')).toBe(
        '2 boîtes et 6 gélules',
      );
      expect(formaterQuantiteLisible(6, 20, 'COMPRIME')).toBe('6 comprimés');
      expect(formaterQuantiteLisible(1, 20, 'COMPRIME')).toBe('1 comprimé');
      expect(formaterQuantiteLisible(0, 20, 'COMPRIME')).toBe('0 boîte');
    });

    it('les sept libellés d unité', () => {
      expect(formaterQuantiteLisible(2, 10, 'ML')).toBe('2 ml');
      expect(formaterQuantiteLisible(2, 10, 'SACHET')).toBe('2 sachets');
      expect(formaterQuantiteLisible(1, 10, 'SACHET')).toBe('1 sachet');
      expect(formaterQuantiteLisible(2, 10, 'GRAMME')).toBe('2 grammes');
      expect(formaterQuantiteLisible(2, 10, 'AMPOULE')).toBe('2 ampoules');
      expect(formaterQuantiteLisible(2, 10, 'UNITE')).toBe('2 unités');
      expect(formaterQuantiteLisible(1, 10, 'UNITE')).toBe('1 unité');
    });

    it('grand nombre au format français', () => {
      expect(formaterQuantiteLisible(2000, 1, 'UNITE')).toBe(
        `${(2000).toLocaleString('fr-FR')} boîtes`,
      );
    });

    it('RangeError pour une quantité négative ou non entière', () => {
      expect(() => formaterQuantiteLisible(-1, 20, 'COMPRIME')).toThrow(
        RangeError,
      );
      expect(() => formaterQuantiteLisible(1.5, 20, 'COMPRIME')).toThrow(
        RangeError,
      );
      expect(() => formaterQuantiteLisible(3, 0, 'COMPRIME')).toThrow(
        RangeError,
      );
    });
  });
});
