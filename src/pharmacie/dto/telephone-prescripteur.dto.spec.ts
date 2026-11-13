import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CorpsVenteDto } from './synchro.dto';
import { CreerVenteDto } from './vente.dto';

const ligne = { stockId: 's1', quantite: 1 };

async function verifier(valeur: unknown) {
  const dto = plainToInstance(CreerVenteDto, {
    lignes: [ligne],
    ...(valeur === undefined ? {} : { telephonePrescripteur: valeur }),
  });
  const erreurs = await validate(dto);
  return {
    dto,
    invalide: erreurs.some((e) => e.property === 'telephonePrescripteur'),
  };
}

describe('telephonePrescripteur (CreerVenteDto)', () => {
  it('est facultatif', async () => {
    const r = await verifier(undefined);
    expect(r.invalide).toBe(false);
    expect(r.dto.telephonePrescripteur).toBeUndefined();
  });

  it('vide ou espaces : devient null', async () => {
    for (const v of ['', '   ', null]) {
      const r = await verifier(v);
      expect(r.invalide).toBe(false);
      expect(r.dto.telephonePrescripteur).toBeNull();
    }
  });

  it('nettoie les espaces autour', async () => {
    const r = await verifier('  622 11 22 33  ');
    expect(r.invalide).toBe(false);
    expect(r.dto.telephonePrescripteur).toBe('622 11 22 33');
  });

  it('accepte chiffres, espaces, + et tirets (6 à 20 chiffres)', async () => {
    for (const v of [
      '+224 622-11-22-33',
      '622112233',
      '123456',
      '1'.repeat(20),
    ]) {
      expect((await verifier(v)).invalide).toBe(false);
    }
  });

  it('refuse lettres, trop court, trop long, + au milieu', async () => {
    for (const v of [
      '06 abc 12 34',
      '12345',
      '1'.repeat(21),
      '62+2112233',
      42,
    ]) {
      expect((await verifier(v)).invalide).toBe(true);
    }
  });
});

describe('telephonePrescripteur (CorpsVenteDto)', () => {
  it('un ancien poste qui ne l envoie pas reste valide', async () => {
    const dto = plainToInstance(CorpsVenteDto, {
      telephonePrescripteur: undefined,
    });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === 'telephonePrescripteur')).toBe(
      false,
    );
  });

  it('valide et nettoie le numéro envoyé', async () => {
    const dto = plainToInstance(CorpsVenteDto, {
      telephonePrescripteur: ' 622 11 22 33 ',
    });
    const erreurs = await validate(dto);
    expect(erreurs.some((e) => e.property === 'telephonePrescripteur')).toBe(
      false,
    );
    expect(dto.telephonePrescripteur).toBe('622 11 22 33');
    const mauvais = plainToInstance(CorpsVenteDto, {
      telephonePrescripteur: 'abc',
    });
    expect(
      (await validate(mauvais)).some(
        (e) => e.property === 'telephonePrescripteur',
      ),
    ).toBe(true);
  });
});
