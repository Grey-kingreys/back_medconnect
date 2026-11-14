import { LIBELLES_ANOMALIE, etatRattachement } from './anomalies';

describe('Rattachement des ventes sans stock', () => {
  it('en attente', () => {
    const r = etatRattachement({
      quantiteInitiale: 2,
      quantiteEnAttente: 2,
      venteAnnulee: false,
    });
    expect(r.etat).toBe('EN_ATTENTE');
    expect(r.message).toBe(
      "Cette vente attend encore du stock : enregistrez la réception ou faites l'inventaire de ce médicament.",
    );
  });

  it('partielle', () => {
    const r = etatRattachement({
      quantiteInitiale: 3,
      quantiteEnAttente: 1,
      venteAnnulee: false,
    });
    expect(r.etat).toBe('PARTIELLE');
    expect(r.message).toBe(
      'Une partie de cette vente attend encore du stock : 1 unité(s).',
    );
  });

  it('rattachée', () => {
    const r = etatRattachement({
      quantiteInitiale: 2,
      quantiteEnAttente: 0,
      venteAnnulee: false,
    });
    expect(r.etat).toBe('RATTACHEE');
  });

  it('vente annulée prioritaire', () => {
    const r = etatRattachement({
      quantiteInitiale: 2,
      quantiteEnAttente: 2,
      venteAnnulee: true,
    });
    expect(r.etat).toBe('VENTE_ANNULEE');
  });

  it("quantité initiale jamais inférieure à l'attente", () => {
    const r = etatRattachement({
      quantiteInitiale: 0,
      quantiteEnAttente: 2,
      venteAnnulee: false,
    });
    expect(r.quantiteInitiale).toBe(2);
    expect(r.etat).toBe('EN_ATTENTE');
  });

  it('un libellé par type', () => {
    const cles = Object.keys(LIBELLES_ANOMALIE);
    expect(cles).toHaveLength(13);
    for (const valeur of Object.values(LIBELLES_ANOMALIE)) {
      expect(valeur.length).toBeGreaterThan(0);
    }
  });
});
