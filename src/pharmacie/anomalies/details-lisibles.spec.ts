import { detailsLisibles } from './details-lisibles';

describe('detailsLisibles (D720)', () => {
  it('écrête soldeProduit et réécrit un ancien message négatif', () => {
    const brut = {
      stockId: 's1',
      soldeProduit: -3,
      quantiteProvisoire: 3,
      message:
        "Ventoline : 3 unité(s) vendue(s) sans stock disponible (vente V1). Le stock de ce médicament est à -3 unité(s) : enregistrez la réception ou l'inventaire qui rattachera ces unités à un lot.",
    };
    const lu = detailsLisibles('STOCK_NEGATIF', brut) as Record<
      string,
      unknown
    >;
    expect(lu.soldeProduit).toBe(0);
    expect(lu.stockId).toBe('s1');
    expect(lu.message).toBe(
      "Ventoline : 3 unité(s) vendue(s) sans stock disponible (vente V1). Le stock de ce médicament affiche 0 unité(s) et cette vente reste à régulariser : enregistrez la réception ou l'inventaire qui rattachera ces unités à un lot.",
    );
    expect(String(lu.message)).not.toMatch(/-\d/);
    // La source n'est jamais modifiée
    expect(brut.soldeProduit).toBe(-3);
  });

  it('un détail positif et un message actuel ne sont pas touchés', () => {
    const brut = {
      soldeProduit: 4,
      message:
        "Le stock de ce médicament est à 4 unité(s) : enregistrez la réception ou l'inventaire.",
    };
    expect(detailsLisibles('STOCK_NEGATIF', brut)).toEqual(brut);
    const actuel = {
      soldeProduit: -1,
      message:
        "Le stock de ce médicament affiche 0 unité(s) et cette vente reste à régulariser : enregistrez la réception ou l'inventaire.",
    };
    expect(
      (detailsLisibles('STOCK_NEGATIF', actuel) as { message: string }).message,
    ).toBe(actuel.message);
  });

  it('écrête quantiteTheorique des lignes, l écart reste signé', () => {
    const lu = detailsLisibles('ECART_INVENTAIRE', {
      ecart: 3,
      lignes: [
        { lotId: 'l1', quantiteTheorique: -2, quantiteComptee: 1, ecart: 3 },
        { lotId: 'l2', quantiteTheorique: 4, quantiteComptee: 4, ecart: 0 },
      ],
    }) as { lignes: Record<string, number | string>[] };
    expect(lu.lignes[0].quantiteTheorique).toBe(0);
    expect(lu.lignes[0].ecart).toBe(3);
    expect(lu.lignes[1].quantiteTheorique).toBe(4);
  });

  it('un autre type sans quantité, ou un détail qui n est pas un objet, est rendu tel quel', () => {
    expect(detailsLisibles('ECART_CAISSE', { ecart: -500 })).toEqual({
      ecart: -500,
    });
    expect(detailsLisibles('STOCK_NEGATIF', null)).toBeNull();
    expect(detailsLisibles('STOCK_NEGATIF', [1, 2])).toEqual([1, 2]);
  });
});
