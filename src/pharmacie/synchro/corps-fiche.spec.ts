import { TYPES_EVENEMENT } from '../dto/synchro.dto';
import { CorpsFicheCreeeDto, CorpsFicheModifieeDto } from '../dto/synchro.dto';
import { normaliserValeurFiche } from './fiches-rejeu';
import { permissionsRequisesPourType, resumeEvenement } from './rejeu-regles';
import { validerCorps } from './valider-corps';

describe('Événements de fiche hors ligne : corps et règles pures', () => {
  it('les deux types sont acceptés et exigent stock:write', () => {
    expect(TYPES_EVENEMENT).toEqual(
      expect.arrayContaining(['FICHE_MODIFIEE', 'FICHE_CREEE']),
    );
    expect(permissionsRequisesPourType('FICHE_MODIFIEE')).toEqual([
      'stock:write',
    ]);
    expect(permissionsRequisesPourType('FICHE_CREEE')).toEqual(['stock:write']);
  });

  it('FICHE_MODIFIEE : champs sûrs seulement, bornes du web', async () => {
    const ok = await validerCorps(CorpsFicheModifieeDto, {
      stockId: 's1',
      avant: { prixUnitaire: 1000, prixUnite: null, notes: null },
      apres: { prixUnitaire: 1200, prixUnite: 100, toleranceInventaire: 2 },
    });
    expect(ok.ok).toBe(true);
    for (const apres of [
      { coefficientBoite: 3 },
      { prixUnite: 0 },
      { prixUnitaire: -1 },
      { toleranceInventaire: 1_000_001 },
      { prixUnitaire: 1.5 },
    ]) {
      const r = await validerCorps(CorpsFicheModifieeDto, {
        stockId: 's1',
        avant: {},
        apres,
      });
      expect(r.ok).toBe(false);
    }
  });

  it('FICHE_CREEE : identifiant UUID, prix entier, aucune quantité', async () => {
    const id = '0b8f2c3e-6a41-4c58-9f0e-1a2b3c4d5e6f';
    expect(
      (await validerCorps(CorpsFicheCreeeDto, { id, medicamentId: 'm1' })).ok,
    ).toBe(true);
    expect(
      (
        await validerCorps(CorpsFicheCreeeDto, {
          id,
          medicamentId: 'm1',
          quantiteInitiale: 5,
        })
      ).ok,
    ).toBe(false);
    expect(
      (await validerCorps(CorpsFicheCreeeDto, { id: 'x', medicamentId: 'm1' }))
        .ok,
    ).toBe(false);
  });

  it('valeurs comparables : notes vides valent null', () => {
    expect(normaliserValeurFiche('notes', '  ')).toBeNull();
    expect(normaliserValeurFiche('notes', ' a ')).toBe('a');
    expect(normaliserValeurFiche('prixUnitaire', undefined)).toBeNull();
    expect(normaliserValeurFiche('prixUnitaire', 5)).toBe(5);
  });

  it('le résumé ne contient ni notes ni prix', () => {
    expect(
      resumeEvenement('FICHE_MODIFIEE', {
        stockId: 's1',
        apres: { notes: 'secret', prixUnitaire: 1 },
      }),
    ).toEqual({ stockId: 's1' });
    expect(
      resumeEvenement('FICHE_CREEE', {
        id: 'a',
        medicamentId: 'm',
        notes: 'secret',
      }),
    ).toEqual({ stockId: 'a', medicamentId: 'm' });
  });
});
