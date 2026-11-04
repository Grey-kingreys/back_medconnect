import 'reflect-metadata';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { CreerSortieStockDto, LigneInventaireDto } from './inventaires.dto';
import { LigneReceptionDto } from './receptions.dto';
import { LigneVenteDto } from './vente.dto';

/**
 * Aucune quantité d'entrée n'accepte un négatif (D713, D718) : le journal et l'agrégat
 * ne peuvent passer sous zéro que par les écritures permises, jamais par une saisie
 * négative.
 */
async function contraintes<T extends object>(
  classe: ClassConstructor<T>,
  donnees: object,
  champ: string,
) {
  const erreurs = await validate(plainToInstance(classe, donnees));
  return erreurs.find((e) => e.property === champ)?.constraints;
}

describe('quantités d entrée jamais négatives', () => {
  it('vente : quantite au moins 1', async () => {
    const base = { stockId: 's1' };
    expect(
      await contraintes(LigneVenteDto, { ...base, quantite: -1 }, 'quantite'),
    ).toHaveProperty('min');
    expect(
      await contraintes(LigneVenteDto, { ...base, quantite: 0 }, 'quantite'),
    ).toHaveProperty('min');
    expect(
      await contraintes(LigneVenteDto, { ...base, quantite: 1 }, 'quantite'),
    ).toBeUndefined();
  });

  it('sortie manuelle : quantite au moins 1', async () => {
    const base = { stockId: 's1', lotId: 'l1', unite: 'UNITE' };
    expect(
      await contraintes(
        CreerSortieStockDto,
        { ...base, quantite: -2 },
        'quantite',
      ),
    ).toHaveProperty('min');
    expect(
      await contraintes(
        CreerSortieStockDto,
        { ...base, quantite: 1 },
        'quantite',
      ),
    ).toBeUndefined();
  });

  it('réception : nombreBoites et quantiteUnites au moins 1', async () => {
    for (const champ of ['nombreBoites', 'quantiteUnites']) {
      expect(
        await contraintes(
          LigneReceptionDto,
          { stockId: 's1', [champ]: -1 },
          champ,
        ),
      ).toHaveProperty('min');
      expect(
        await contraintes(
          LigneReceptionDto,
          { stockId: 's1', [champ]: 3 },
          champ,
        ),
      ).toBeUndefined();
    }
  });

  it('inventaire : quantiteComptee, nombreBoites et unitesEnPlus au moins 0', async () => {
    for (const champ of ['quantiteComptee', 'nombreBoites', 'unitesEnPlus']) {
      expect(
        await contraintes(
          LigneInventaireDto,
          { stockId: 's1', [champ]: -1 },
          champ,
        ),
      ).toHaveProperty('min');
      expect(
        await contraintes(
          LigneInventaireDto,
          { stockId: 's1', [champ]: 0 },
          champ,
        ),
      ).toBeUndefined();
    }
  });
});
