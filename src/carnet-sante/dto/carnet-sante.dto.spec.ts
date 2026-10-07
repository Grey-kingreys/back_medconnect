import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOrdonnanceDto } from './carnet-sante.dto';

// Validation en profondeur des lignes d'ordonnance (F2).
describe('CreateOrdonnanceDto', () => {
  const ligne = {
    nom: 'Paracétamol 500 mg',
    dosage: '1 comprimé matin et soir',
    duree: '5 jours',
  };

  const erreurs = async (medicaments: unknown) => {
    const dto = plainToInstance(CreateOrdonnanceDto, { medicaments });
    return validate(dto);
  };

  it('accepte une ligne en saisie libre (sans medicamentId)', async () => {
    expect(await erreurs([ligne])).toHaveLength(0);
  });

  it('accepte une ligne liée au catalogue (UUID)', async () => {
    expect(
      await erreurs([
        { ...ligne, medicamentId: '3f6c2a1e-8b4d-4c7a-9e21-5d0b7f3a6c11' },
      ]),
    ).toHaveLength(0);
  });

  it('refuse un medicamentId qui n’est pas un identifiant valide', async () => {
    const res = await erreurs([{ ...ligne, medicamentId: 'abc' }]);
    expect(res).toHaveLength(1);
    expect(res[0].property).toBe('medicaments');
  });

  it('refuse une ligne sans posologie', async () => {
    const res = await erreurs([{ nom: ligne.nom, duree: ligne.duree }]);
    expect(res).toHaveLength(1);
    const message = JSON.stringify(res[0].children);
    expect(message).toContain('Indiquez la posologie.');
  });

  it('refuse une ordonnance sans médicament', async () => {
    const res = await erreurs([]);
    expect(res).toHaveLength(1);
    expect(res[0].constraints?.arrayMinSize).toBe(
      "Ajoutez au moins un médicament à l'ordonnance.",
    );
  });
});
