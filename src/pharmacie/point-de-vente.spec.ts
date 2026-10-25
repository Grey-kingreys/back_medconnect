import type { Prisma } from 'generated/prisma/client';
import {
  assurerPointDeVente,
  supprimerConfigurationPharmacies,
} from './point-de-vente';

describe('Point de vente : fonctions communes', () => {
  const MODELES_SUPPRESSION = [
    'anomalie',
    'plageTicket',
    'poste',
    'compteurTicket',
    'pointDeVente',
    'parametresPharmacie',
    'fournisseur',
  ] as const;

  function creerTx() {
    return {
      pointDeVente: {
        upsert: jest.fn().mockResolvedValue({ id: 'pv1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      poste: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      compteurTicket: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      parametresPharmacie: {
        upsert: jest
          .fn()
          .mockResolvedValue({ structureId: 's1', seuilStockBas: 10 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      anomalie: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      plageTicket: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      fournisseur: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
  }

  const comme = (tx: ReturnType<typeof creerTx>) =>
    tx as unknown as Prisma.TransactionClient;

  it("1. assurerPointDeVente : point de vente d'ordre 1, poste REPRISE inactif, compteur et paramètres, sans mise à jour", async () => {
    const tx = creerTx();
    await assurerPointDeVente(comme(tx), { id: 's1', nom: 'Pharmacie Test' });

    expect(tx.pointDeVente.upsert).toHaveBeenCalledWith({
      where: { structureId_ordre: { structureId: 's1', ordre: 1 } },
      create: { structureId: 's1', ordre: 1, nom: 'Pharmacie Test' },
      update: {},
    });
    expect(tx.poste.upsert).toHaveBeenCalledWith({
      where: {
        pointDeVenteId_code: { pointDeVenteId: 'pv1', code: 'REPRISE' },
      },
      create: {
        pointDeVenteId: 'pv1',
        code: 'REPRISE',
        libelle: 'Reprise des ventes historiques',
        type: 'TECHNIQUE',
        actif: false,
      },
      update: {},
    });
    expect(tx.compteurTicket.upsert).toHaveBeenCalledWith({
      where: { pointDeVenteId: 'pv1' },
      create: { pointDeVenteId: 'pv1' },
      update: {},
    });
    expect(tx.parametresPharmacie.upsert).toHaveBeenCalledWith({
      where: { structureId: 's1' },
      create: { structureId: 's1' },
      update: {},
    });
    const ordre = [
      tx.pointDeVente.upsert,
      tx.poste.upsert,
      tx.compteurTicket.upsert,
      tx.parametresPharmacie.upsert,
    ].map((m) => m.mock.invocationCallOrder[0]);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
  });

  it('2. assurerPointDeVente : renvoie le point de vente et les paramètres', async () => {
    const tx = creerTx();
    const resultat = await assurerPointDeVente(comme(tx), {
      id: 's1',
      nom: 'Pharmacie Test',
    });
    expect(resultat).toEqual({
      pointDeVente: { id: 'pv1' },
      parametres: { structureId: 's1', seuilStockBas: 10 },
    });
  });

  it('3. supprimerConfigurationPharmacies : ordre des suppressions et filtres', async () => {
    const tx = creerTx();
    await supprimerConfigurationPharmacies(comme(tx), ['s1', 's2']);

    const ordre = MODELES_SUPPRESSION.map(
      (m) => tx[m].deleteMany.mock.invocationCallOrder[0],
    );
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    expect(tx.anomalie.deleteMany).toHaveBeenCalledWith({
      where: { pointDeVente: { structureId: { in: ['s1', 's2'] } } },
    });
    expect(tx.pointDeVente.deleteMany).toHaveBeenCalledWith({
      where: { structureId: { in: ['s1', 's2'] } },
    });
  });

  it('4. supprimerConfigurationPharmacies : liste vide, aucune requête', async () => {
    const tx = creerTx();
    await supprimerConfigurationPharmacies(comme(tx), []);
    for (const m of MODELES_SUPPRESSION) {
      expect(tx[m].deleteMany).not.toHaveBeenCalled();
    }
  });
});
