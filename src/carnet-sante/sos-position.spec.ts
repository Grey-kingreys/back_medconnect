import {
  evaluerPositionSos,
  formaterMetres,
  avertissementPositionApproximative,
  messagePositionNonUtilisee,
} from './sos-position';

describe('evaluerPositionSos', () => {
  const reference = new Date('2026-10-21T12:00:00Z');
  const position = { latitude: 9.5, longitude: -13.7 };
  const il = (minutes: number, secondes = 0) =>
    new Date(reference.getTime() - minutes * 60_000 - secondes * 1000);

  it('signale une position absente', () => {
    expect(evaluerPositionSos({ longitude: -13.7 }, reference)).toMatchObject({
      qualite: 'absente',
      utilisable: false,
    });
    expect(evaluerPositionSos({ latitude: 9.5 }, reference)).toMatchObject({
      qualite: 'absente',
      utilisable: false,
    });
  });

  it('garde le comportement d’avant sans précision ni horodatage', () => {
    expect(evaluerPositionSos(position, reference)).toMatchObject({
      qualite: 'non_qualifiee',
      utilisable: true,
    });
  });

  it.each([0, 500])('juge précise une précision de %s m', (precisionMetres) => {
    expect(
      evaluerPositionSos({ ...position, precisionMetres }, reference),
    ).toMatchObject({ qualite: 'precise', utilisable: true });
  });

  it.each([501, 2000])(
    'juge approximative mais utilisable une précision de %s m',
    (precisionMetres) => {
      expect(
        evaluerPositionSos({ ...position, precisionMetres }, reference),
      ).toMatchObject({ qualite: 'approximative', utilisable: true });
    },
  );

  it('refuse une précision de 2001 m', () => {
    expect(
      evaluerPositionSos({ ...position, precisionMetres: 2001 }, reference),
    ).toMatchObject({ qualite: 'trop_imprecise', utilisable: false });
  });

  it('accepte une position vieille de 15 min pile, pas de 15 min et 1 s', () => {
    expect(
      evaluerPositionSos({ ...position, horodatagePosition: il(15) }, reference)
        .utilisable,
    ).toBe(true);
    expect(
      evaluerPositionSos(
        { ...position, horodatagePosition: il(15, 1) },
        reference,
      ),
    ).toMatchObject({ qualite: 'trop_ancienne', utilisable: false });
  });

  it('tolère une avance de 4 min et ignore une avance de 10 min', () => {
    expect(
      evaluerPositionSos(
        {
          ...position,
          precisionMetres: 30,
          horodatagePosition: il(-4),
        },
        reference,
      ),
    ).toMatchObject({ qualite: 'precise', horodatageIgnore: false });
    expect(
      evaluerPositionSos(
        {
          ...position,
          precisionMetres: 3000,
          horodatagePosition: il(-10),
        },
        reference,
      ),
    ).toMatchObject({
      qualite: 'trop_imprecise',
      horodatageIgnore: true,
    });
    expect(
      evaluerPositionSos(
        { ...position, horodatagePosition: il(-10) },
        reference,
      ),
    ).toMatchObject({
      qualite: 'non_qualifiee',
      utilisable: true,
      horodatageIgnore: true,
    });
  });

  it('donne la priorité à l’ancienneté sur l’imprécision', () => {
    expect(
      evaluerPositionSos(
        {
          ...position,
          precisionMetres: 3000,
          horodatagePosition: il(20),
        },
        reference,
      ).qualite,
    ).toBe('trop_ancienne');
  });
});

describe('textes de la position SOS', () => {
  it('arrondit les mètres à la dizaine avec espace insécable', () => {
    expect(formaterMetres(847)).toBe('850');
    expect(formaterMetres(1987)).toBe('1 990');
  });

  it('formule l’avertissement de position approximative', () => {
    expect(avertissementPositionApproximative(900)).toBe(
      'Position approximative, environ 900 m',
    );
  });

  it('formule le message quand la position n’a pas servi', () => {
    const imprecise = messagePositionNonUtilisee('trop_imprecise', '');
    expect(imprecise).toContain('trop imprécise');
    expect(imprecise).toContain('Appelez immédiatement les secours');
    expect(messagePositionNonUtilisee('trop_ancienne', '')).toContain(
      'plus de 15 minutes',
    );
  });
});
