import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUrgenceDto } from './carnet-sante.dto';

// Qualité de la position d'une alerte SOS (TB10b).
describe('CreateUrgenceDto', () => {
  const erreurs = (corps: Record<string, unknown>) =>
    validate(plainToInstance(CreateUrgenceDto, corps));

  const complet = {
    latitude: 9.5,
    longitude: -13.7,
    precision: 12.5,
    horodatagePosition: '2026-10-21T14:03:12.000Z',
    source: 'gps',
  };

  it('accepte la position seule et le corps vide', async () => {
    expect(await erreurs({ latitude: 9.5, longitude: -13.7 })).toHaveLength(0);
    expect(await erreurs({})).toHaveLength(0);
  });

  it('accepte un corps complet, toutes les origines et une précision nulle', async () => {
    expect(await erreurs(complet)).toHaveLength(0);
    expect(await erreurs({ ...complet, source: 'reseau' })).toHaveLength(0);
    expect(await erreurs({ ...complet, source: 'inconnue' })).toHaveLength(0);
    expect(await erreurs({ ...complet, precision: null })).toHaveLength(0);
  });

  it('refuse une précision négative avec un message clair', async () => {
    const e = await erreurs({ ...complet, precision: -1 });
    expect(e).toHaveLength(1);
    expect(e[0].property).toBe('precision');
    expect(Object.values(e[0].constraints ?? {})).toContain(
      'La précision de la position ne peut pas être négative.',
    );
  });

  it('refuse une précision qui n’est pas un nombre', async () => {
    const e = await erreurs({ ...complet, precision: 'abc' });
    expect(e.map((x) => x.property)).toEqual(['precision']);
  });

  it('refuse une heure ou une origine invalide', async () => {
    const heure = await erreurs({ ...complet, horodatagePosition: 'hier' });
    expect(heure.map((x) => x.property)).toEqual(['horodatagePosition']);
    const origine = await erreurs({ ...complet, source: 'satellite' });
    expect(origine.map((x) => x.property)).toEqual(['source']);
  });
});
