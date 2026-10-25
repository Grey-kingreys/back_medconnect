import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateStockQuantiteDto, UpsertStockDto } from './pharmacie.dto';

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

describe('UpdateStockQuantiteDto et sansPeremption (PB08)', () => {
  const contraintes = async (donnees: object, propriete: string) => {
    const erreurs = await validate(
      plainToInstance(UpdateStockQuantiteDto, donnees),
    );
    return erreurs.find((e) => e.property === propriete)?.constraints;
  };

  it('refuse une variation nulle', async () => {
    const c = await contraintes({ variation: 0 }, 'variation');
    expect(c).toHaveProperty('notEquals');
    expect(c?.notEquals).toBe('La variation ne peut pas être nulle.');
  });

  it('refuse un motif de plus de 300 caractères', async () => {
    const c = await contraintes(
      { variation: -2, motif: 'x'.repeat(301) },
      'motif',
    );
    expect(c).toHaveProperty('maxLength');
  });

  it('refuse un lot vide', async () => {
    const c = await contraintes({ variation: 1, lotId: '' }, 'lotId');
    expect(c).toHaveProperty('isNotEmpty');
  });

  it('accepte une correction complète', async () => {
    const erreurs = await validate(
      plainToInstance(UpdateStockQuantiteDto, {
        variation: -2,
        lotId: 'lot-1',
        motif: 'Casse',
      }),
    );
    expect(erreurs).toHaveLength(0);
  });

  it('valide sansPeremption comme un booléen', async () => {
    const mauvais = await validate(
      plainToInstance(UpsertStockDto, {
        medicamentId: 'med-1',
        quantite: 3,
        sansPeremption: 'oui',
      }),
    );
    expect(
      mauvais.find((e) => e.property === 'sansPeremption')?.constraints,
    ).toHaveProperty('isBoolean');
    const bon = await validate(
      plainToInstance(UpsertStockDto, {
        medicamentId: 'med-1',
        quantite: 3,
        sansPeremption: true,
      }),
    );
    expect(bon).toHaveLength(0);
  });
});
