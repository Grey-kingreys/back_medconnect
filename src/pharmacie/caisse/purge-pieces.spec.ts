import { purgerPiecesPharmacies } from './purge-pieces';

const MODELES = [
  'allocationLot',
  'paiement',
  'ligneVente',
  'vente',
  'echeanceCredit',
  'remboursementCredit',
  'clientCredit',
  'mouvementCaisse',
  'resultatSessionMode',
  'releveModePaiement',
  'ligneComptage',
  'comptageCaisse',
  'sessionCaisse',
  'totalClotureMode',
  'clotureJournaliere',
  'ligneInventaire',
  'inventaire',
  'evenementSynchro',
] as const;

function creerTx() {
  const modele = () => ({
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  });
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    allocationLot: modele(),
    paiement: modele(),
    ligneVente: modele(),
    vente: {
      ...modele(),
      findMany: jest.fn().mockResolvedValue([{ id: 'v1' }, { id: 'v2' }]),
    },
    echeanceCredit: modele(),
    remboursementCredit: modele(),
    clientCredit: modele(),
    mouvementCaisse: modele(),
    resultatSessionMode: modele(),
    releveModePaiement: modele(),
    ligneComptage: modele(),
    comptageCaisse: modele(),
    sessionCaisse: modele(),
    totalClotureMode: modele(),
    clotureJournaliere: modele(),
    ligneInventaire: modele(),
    inventaire: modele(),
    evenementSynchro: modele(),
  };
}

describe('purgerPiecesPharmacies', () => {
  it('liste vide : aucune requête', async () => {
    const tx = creerTx();

    await purgerPiecesPharmacies(tx as never, []);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    for (const nom of MODELES) {
      expect(tx[nom].deleteMany).not.toHaveBeenCalled();
    }
  });

  it("pose le contournement, supprime dans l'ordre des dépendances, puis le retire", async () => {
    const tx = creerTx();

    await purgerPiecesPharmacies(tx as never, ['s1', 's2']);

    const F = { structureId: { in: ['s1', 's2'] } };
    const P = { pointDeVente: F };
    const S = { sessionCaisse: P };

    expect(tx.allocationLot.deleteMany).toHaveBeenCalledWith({
      where: { ligneVente: { vente: F } },
    });
    expect(tx.paiement.deleteMany).toHaveBeenCalledWith({
      where: { vente: F },
    });
    expect(tx.ligneVente.deleteMany).toHaveBeenCalledWith({
      where: { vente: F },
    });
    expect(tx.echeanceCredit.deleteMany).toHaveBeenCalledWith({
      where: { venteId: { in: ['v1', 'v2'] } },
    });
    expect(tx.vente.deleteMany).toHaveBeenCalledTimes(2);
    expect(tx.vente.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { ...F, venteOrigineId: { not: null } },
    });
    expect(tx.vente.deleteMany).toHaveBeenNthCalledWith(2, { where: F });
    for (const modele of [
      tx.mouvementCaisse,
      tx.sessionCaisse,
      tx.clotureJournaliere,
      tx.inventaire,
    ]) {
      expect(modele.deleteMany).toHaveBeenCalledWith({ where: P });
    }
    for (const modele of [tx.resultatSessionMode, tx.comptageCaisse]) {
      expect(modele.deleteMany).toHaveBeenCalledWith({ where: S });
    }
    for (const modele of [tx.releveModePaiement, tx.ligneComptage]) {
      expect(modele.deleteMany).toHaveBeenCalledWith({
        where: { comptage: S },
      });
    }
    expect(tx.totalClotureMode.deleteMany).toHaveBeenCalledWith({
      where: { cloture: P },
    });
    expect(tx.ligneInventaire.deleteMany).toHaveBeenCalledWith({
      where: { inventaire: P },
    });
    expect(tx.evenementSynchro.deleteMany).toHaveBeenCalledWith({
      where: { poste: P },
    });

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
      tx.allocationLot.deleteMany.mock.invocationCallOrder[0],
      tx.paiement.deleteMany.mock.invocationCallOrder[0],
      tx.ligneVente.deleteMany.mock.invocationCallOrder[0],
      tx.echeanceCredit.deleteMany.mock.invocationCallOrder[0],
      tx.vente.deleteMany.mock.invocationCallOrder[0],
      tx.vente.deleteMany.mock.invocationCallOrder[1],
      tx.mouvementCaisse.deleteMany.mock.invocationCallOrder[0],
      tx.resultatSessionMode.deleteMany.mock.invocationCallOrder[0],
      tx.releveModePaiement.deleteMany.mock.invocationCallOrder[0],
      tx.ligneComptage.deleteMany.mock.invocationCallOrder[0],
      tx.comptageCaisse.deleteMany.mock.invocationCallOrder[0],
      tx.sessionCaisse.deleteMany.mock.invocationCallOrder[0],
      tx.totalClotureMode.deleteMany.mock.invocationCallOrder[0],
      tx.clotureJournaliere.deleteMany.mock.invocationCallOrder[0],
      tx.ligneInventaire.deleteMany.mock.invocationCallOrder[0],
      tx.inventaire.deleteMany.mock.invocationCallOrder[0],
      tx.evenementSynchro.deleteMany.mock.invocationCallOrder[0],
      tx.$queryRaw.mock.invocationCallOrder[1],
    ];
    expect(ordre).toEqual([...ordre].sort((a, b) => a - b));
    expect(new Set(ordre).size).toBe(ordre.length);
  });
});
