import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUrgenceStatusDto } from './carnet-sante.dto';

async function erreurs(corps: Record<string, unknown>) {
  return validate(plainToInstance(UpdateUrgenceStatusDto, corps));
}

describe('UpdateUrgenceStatusDto', () => {
  it('accepte chaque statut connu', async () => {
    for (const status of ['LANCE', 'PRIS_EN_CHARGE', 'TERMINE', 'ANNULE']) {
      expect(await erreurs({ status })).toHaveLength(0);
    }
  });

  it('rejette un statut inconnu avec un message en français', async () => {
    const res = await erreurs({ status: 'SUPPRIME' });
    expect(res).toHaveLength(1);
    expect(Object.values(res[0].constraints ?? {})).toContain(
      "Le statut de l'alerte est invalide.",
    );
  });

  it('rejette un statut absent', async () => {
    expect(await erreurs({})).toHaveLength(1);
  });
});
