import { BadRequestException, type ValidationError } from '@nestjs/common';
import { champsFautifs, fabriquerErreurValidation } from './erreur-validation';

describe('erreur-validation', () => {
  const erreurs = [
    {
      property: 'telephone',
      value: 'SECRET-123',
      constraints: { matches: 'x', isNotEmpty: 'y' },
      children: [],
    },
    {
      property: 'medicaments',
      value: [{ nom: 'SECRET-456' }],
      constraints: undefined,
      children: [
        {
          property: '0',
          children: [
            {
              property: 'nom',
              value: 'SECRET-456',
              constraints: { isString: 'z' },
              children: [],
            },
          ],
        },
      ],
    },
  ] as unknown as ValidationError[];

  const attendus = [
    { champ: 'telephone', contraintes: ['matches', 'isNotEmpty'] },
    { champ: 'medicaments.0.nom', contraintes: ['isString'] },
  ];

  it('liste les champs fautifs avec leur chemin, sans valeur', () => {
    expect(champsFautifs(erreurs)).toEqual(attendus);
  });

  it('fabrique une 400 avec code, champs et messages, sans fuite de valeur', () => {
    const erreur = fabriquerErreurValidation(erreurs);
    expect(erreur).toBeInstanceOf(BadRequestException);
    expect(erreur.getResponse()).toEqual({
      message: ['x', 'y', 'z'],
      code: 'VALIDATION',
      champs: attendus,
    });
    const texte = JSON.stringify(erreur.getResponse());
    expect(texte).not.toContain('SECRET-123');
    expect(texte).not.toContain('SECRET-456');
  });
});
