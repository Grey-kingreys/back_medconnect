import { purgerStockPharmacies } from './purge-stock';

function creerTx() {
  const modele = () => ({
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  });
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    conditionnementOuvert: modele(),
    agregatStockLot: modele(),
    agregatStockProduit: modele(),
    mouvementStock: modele(),
    lotStock: modele(),
    reception: modele(),
  };
}

describe('purgerStockPharmacies', () => {
  it('liste vide : aucune requête', async () => {
    const tx = creerTx();

    await purgerStockPharmacies(tx as never, []);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.conditionnementOuvert.deleteMany).not.toHaveBeenCalled();
    expect(tx.agregatStockLot.deleteMany).not.toHaveBeenCalled();
    expect(tx.agregatStockProduit.deleteMany).not.toHaveBeenCalled();
    expect(tx.mouvementStock.deleteMany).not.toHaveBeenCalled();
    expect(tx.lotStock.deleteMany).not.toHaveBeenCalled();
    expect(tx.reception.deleteMany).not.toHaveBeenCalled();
  });

  it("pose le contournement, supprime dans l'ordre des dépendances, puis le retire", async () => {
    const tx = creerTx();

    await purgerStockPharmacies(tx as never, ['s1', 's2']);

    const filtre = {
      where: { pointDeVente: { structureId: { in: ['s1', 's2'] } } },
    };
    for (const modele of [
      tx.conditionnementOuvert,
      tx.agregatStockLot,
      tx.agregatStockProduit,
      tx.mouvementStock,
      tx.lotStock,
      tx.reception,
    ]) {
      expect(modele.deleteMany).toHaveBeenCalledTimes(1);
      expect(modele.deleteMany).toHaveBeenCalledWith(filtre);
    }
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const appels = tx.$queryRaw.mock.calls as [string[]][];
    expect(appels[0][0].join('')).toContain(
      "set_config('medconnecte.purge_autorisee', 'on', true)",
    );
    expect(appels[1][0].join('')).toContain(
      "set_config('medconnecte.purge_autorisee', 'off', true)",
    );
    const ordre = [
      tx.$queryRaw.mock.invocationCallOrder[0],
      tx.conditionnementOuvert.deleteMany.mock.invocationCallOrder[0],
      tx.agregatStockLot.deleteMany.mock.invocationCallOrder[0],
      tx.agregatStockProduit.deleteMany.mock.invocationCallOrder[0],
      tx.mouvementStock.deleteMany.mock.invocationCallOrder[0],
      tx.lotStock.deleteMany.mock.invocationCallOrder[0],
      tx.reception.deleteMany.mock.invocationCallOrder[0],
      tx.$queryRaw.mock.invocationCallOrder[1],
    ];
    expect(ordre).toEqual([...ordre].sort((a, b) => a - b));
    expect(new Set(ordre).size).toBe(ordre.length);
  });
});
