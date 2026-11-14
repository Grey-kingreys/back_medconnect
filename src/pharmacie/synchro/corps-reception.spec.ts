import { randomUUID } from 'node:crypto';
import {
  CorpsFournisseurCreeDto,
  CorpsReceptionEnregistreeDto,
  TYPES_EVENEMENT,
} from '../dto/synchro.dto';
import { permissionsRequisesPourType, resumeEvenement } from './rejeu-regles';
import { validerCorps } from './valider-corps';

describe('Événements de réception hors ligne : corps et droits', () => {
  const ligne = () => ({
    stockId: 's',
    lotId: randomUUID(),
    coefficientLocal: 10,
    nombreBoites: 2,
    dateExpiration: '2030-01-31',
  });
  const corps = () => ({ id: randomUUID(), lignes: [ligne()] });

  it('les deux types sont acceptés et exigent reception:write', () => {
    expect(TYPES_EVENEMENT).toEqual(
      expect.arrayContaining(['FOURNISSEUR_CREE', 'RECEPTION_ENREGISTREE']),
    );
    expect(permissionsRequisesPourType('FOURNISSEUR_CREE')).toEqual([
      'reception:write',
    ]);
    expect(permissionsRequisesPourType('RECEPTION_ENREGISTREE')).toEqual([
      'reception:write',
    ]);
  });

  it('une réception valide passe ; lot, coefficient ou id manquant, clé en trop : refus', async () => {
    expect((await validerCorps(CorpsReceptionEnregistreeDto, corps())).ok).toBe(
      true,
    );
    const sansLot = corps();
    delete (sansLot.lignes[0] as { lotId?: string }).lotId;
    expect((await validerCorps(CorpsReceptionEnregistreeDto, sansLot)).ok).toBe(
      false,
    );
    const coef = corps();
    coef.lignes[0].coefficientLocal = 0;
    expect((await validerCorps(CorpsReceptionEnregistreeDto, coef)).ok).toBe(
      false,
    );
    expect(
      (await validerCorps(CorpsReceptionEnregistreeDto, { lignes: [ligne()] }))
        .ok,
    ).toBe(false);
    expect(
      (
        await validerCorps(CorpsReceptionEnregistreeDto, {
          ...corps(),
          prixAchat: 1,
        })
      ).ok,
    ).toBe(false);
  });

  it('un fournisseur valide passe, un nom trop court est refusé', async () => {
    const id = randomUUID();
    expect(
      (await validerCorps(CorpsFournisseurCreeDto, { id, nom: 'Sopharma' })).ok,
    ).toBe(true);
    expect(
      (await validerCorps(CorpsFournisseurCreeDto, { id, nom: 'S' })).ok,
    ).toBe(false);
  });

  it('le résumé ne contient jamais le corps', () => {
    const c = corps();
    expect(resumeEvenement('RECEPTION_ENREGISTREE', c)).toEqual({
      receptionId: c.id,
      nombreLignes: 1,
    });
  });
});
