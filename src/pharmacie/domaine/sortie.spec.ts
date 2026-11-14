import { motifSortie, typeMouvementSortie } from './sortie';

describe('Règles de la sortie manuelle', () => {
  it('type de mouvement par raison', () => {
    expect(typeMouvementSortie('PERIME')).toBe('PEREMPTION');
    expect(typeMouvementSortie('CASSE')).toBe('PERTE');
    expect(typeMouvementSortie('PERDU')).toBe('PERTE');
    expect(typeMouvementSortie('RETOUR_FOURNISSEUR')).toBe('RETOUR');
    expect(typeMouvementSortie('AUTRE')).toBe('PERTE');
  });

  it('raison absente refusée', () => {
    expect(motifSortie(null, 'x')).toEqual({
      ok: false,
      code: 'RAISON_REQUISE',
    });
  });

  it('AUTRE exige un commentaire de 3 caractères', () => {
    expect(motifSortie('AUTRE', '  ab ')).toEqual({
      ok: false,
      code: 'COMMENTAIRE_REQUIS',
    });
    expect(motifSortie('AUTRE', ' Don au dispensaire ')).toEqual({
      ok: true,
      motif: 'Don au dispensaire',
    });
  });

  it('libellé et commentaire', () => {
    expect(motifSortie('CASSE', null)).toEqual({
      ok: true,
      motif: 'Cassé ou abîmé',
    });
    expect(motifSortie('CASSE', ' flacon tombé ')).toEqual({
      ok: true,
      motif: 'Cassé ou abîmé : flacon tombé',
    });
    expect(motifSortie('PERIME', '')).toEqual({ ok: true, motif: 'Périmé' });
  });
});
