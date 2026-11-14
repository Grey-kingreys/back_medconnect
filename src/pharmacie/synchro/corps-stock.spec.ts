import { randomUUID } from 'node:crypto';
import {
  CorpsCorrectionQuantiteDto,
  CorpsSortieStockDto,
  TYPES_EVENEMENT,
} from '../dto/synchro.dto';
import { permissionsRequisesPourType, resumeEvenement } from './rejeu-regles';
import { validerCorps } from './valider-corps';

describe('Événements de stock hors ligne : corps et droits', () => {
  it('les deux types sont acceptés et exigent stock:write', () => {
    expect(TYPES_EVENEMENT).toEqual(
      expect.arrayContaining(['SORTIE_STOCK', 'CORRECTION_QUANTITE']),
    );
    expect(permissionsRequisesPourType('SORTIE_STOCK')).toEqual([
      'stock:write',
    ]);
    expect(permissionsRequisesPourType('CORRECTION_QUANTITE')).toEqual([
      'stock:write',
    ]);
  });

  it('une sortie valide passe, une unité inconnue ou une clé en trop est refusée', async () => {
    const corps = {
      id: randomUUID(),
      stockId: 's',
      lotId: 'l',
      unite: 'UNITE',
      quantite: 2,
      raison: 'CASSE',
      commentaire: '',
    };
    expect((await validerCorps(CorpsSortieStockDto, corps)).ok).toBe(true);
    expect(
      (await validerCorps(CorpsSortieStockDto, { ...corps, unite: 'LOT' })).ok,
    ).toBe(false);
    expect(
      (await validerCorps(CorpsSortieStockDto, { ...corps, prix: 1 })).ok,
    ).toBe(false);
    expect(
      (await validerCorps(CorpsSortieStockDto, { ...corps, quantite: 0 })).ok,
    ).toBe(false);
  });

  it('une correction à variation nulle est refusée', async () => {
    const corps = {
      id: randomUUID(),
      stockId: 's',
      lotId: 'l',
      variation: -2,
      motif: 'Comptage',
    };
    expect((await validerCorps(CorpsCorrectionQuantiteDto, corps)).ok).toBe(
      true,
    );
    expect(
      (
        await validerCorps(CorpsCorrectionQuantiteDto, {
          ...corps,
          variation: 0,
        })
      ).ok,
    ).toBe(false);
  });

  it('le résumé d une anomalie ne porte ni motif ni commentaire', () => {
    const r = resumeEvenement('SORTIE_STOCK', {
      id: 'a',
      stockId: 's',
      quantite: 3,
      commentaire: 'secret',
    });
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(r).toEqual({ sortieId: 'a', stockId: 's', quantite: 3 });
  });
});
