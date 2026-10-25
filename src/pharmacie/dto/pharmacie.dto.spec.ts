import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpsertStockDto } from './pharmacie.dto';

async function erreursQuantite(quantite: number) {
  const dto = plainToInstance(UpsertStockDto, {
    medicamentId: 'med-1',
    quantite,
  });
  return validate(dto);
}

describe('UpsertStockDto : quantité entière', () => {
  it('1. quantité décimale refusée (isInt)', async () => {
    const erreurs = await erreursQuantite(2.5);
    const erreur = erreurs.find((e) => e.property === 'quantite');
    expect(erreur).toBeDefined();
    expect(erreur?.constraints).toHaveProperty('isInt');
    expect(erreur?.constraints?.isInt).toBe(
      'La quantité doit être un nombre entier.',
    );
  });

  it('2. quantité négative refusée (min)', async () => {
    const erreurs = await erreursQuantite(-1);
    const erreur = erreurs.find((e) => e.property === 'quantite');
    expect(erreur).toBeDefined();
    expect(erreur?.constraints).toHaveProperty('min');
  });

  it('3. quantité entière acceptée', async () => {
    const erreurs = await erreursQuantite(3);
    expect(erreurs).toHaveLength(0);
  });
});
