import type { Prisma } from 'generated/prisma/client';
import {
  cleVerrouFiche,
  memeContenu,
  MESSAGE_LOT_SANS_MOUVEMENT,
  MouvementsStockService,
  validerMouvement,
  validerNouveauLot,
  validerQualificationLot,
  type MouvementAEcrire,
  type NouveauLot,
  type QualificationLot,
} from './mouvements-stock.service';

function mouvement(surcharge: Partial<MouvementAEcrire> = {}) {
  return {
    pointDeVenteId: 'pv',
    stockMedicamentId: 'stk',
    lotId: 'lot',
    type: 'CORRECTION',
    quantite: 1,
    pieceOrigineType: 'RECEPTION',
    ...surcharge,
  } as MouvementAEcrire;
}

function lot(surcharge: Partial<NouveauLot> = {}): NouveauLot {
  return {
    stockMedicamentId: 'stk',
    pointDeVenteId: 'pv',
    numeroLot: null,
    dateExpiration: null,
    quantite: 5,
    coutUnitaire: 0,
    coutAchatBoite: null,
    coefficientReception: 1,
    fournisseurId: null,
    receptionId: null,
    lotTechnique: false,
    auteurId: null,
    pieceOrigineType: 'RECEPTION',
    pieceOrigineId: null,
    motif: null,
    ...surcharge,
  };
}

describe('validerMouvement', () => {
  it('refuse une quantité non entière', () => {
    expect(() => validerMouvement(mouvement({ quantite: 1.5 }))).toThrow(
      new RangeError(
        "La quantité d'un mouvement doit être un entier (reçu : 1.5).",
      ),
    );
  });

  it('refuse une quantité nulle hors inventaire', () => {
    expect(() => validerMouvement(mouvement({ quantite: 0 }))).toThrow(
      new RangeError('Un mouvement CORRECTION ne peut pas être nul.'),
    );
  });

  it('accepte une quantité nulle pour un inventaire', () => {
    expect(() =>
      validerMouvement(
        mouvement({
          quantite: 0,
          type: 'INVENTAIRE',
          pieceOrigineType: 'INVENTAIRE',
        }),
      ),
    ).not.toThrow();
  });

  it('refuse un mouvement sans lot hors vente, annulation ou résolution', () => {
    expect(() =>
      validerMouvement(
        mouvement({
          lotId: null,
          pieceOrigineType: 'AJUSTEMENT',
          motif: 'Test',
        }),
      ),
    ).toThrow(/sans lot/);
  });

  it('accepte une vente sans lot', () => {
    expect(() =>
      validerMouvement(
        mouvement({
          lotId: null,
          type: 'VENTE',
          quantite: -2,
          pieceOrigineType: 'VENTE',
        }),
      ),
    ).not.toThrow();
  });

  it('exige un motif pour un ajustement', () => {
    const erreur = new RangeError(
      'Le motif est obligatoire pour une pièce AJUSTEMENT.',
    );
    expect(() =>
      validerMouvement(mouvement({ pieceOrigineType: 'AJUSTEMENT' })),
    ).toThrow(erreur);
    expect(() =>
      validerMouvement(
        mouvement({ pieceOrigineType: 'AJUSTEMENT', motif: '   ' }),
      ),
    ).toThrow(erreur);
  });

  it('exige un motif pour une sortie manuelle', () => {
    expect(() =>
      validerMouvement(mouvement({ pieceOrigineType: 'SORTIE_MANUELLE' })),
    ).toThrow(RangeError);
  });
});

describe('validerNouveauLot', () => {
  it('refuse une quantité, un coefficient ou un coût invalide', () => {
    expect(() => validerNouveauLot(lot({ quantite: 0 }))).toThrow(RangeError);
    expect(() => validerNouveauLot(lot({ coefficientReception: 0 }))).toThrow(
      RangeError,
    );
    expect(() => validerNouveauLot(lot({ coutUnitaire: -1 }))).toThrow(
      RangeError,
    );
  });

  it('accepte un lot valide', () => {
    expect(() => validerNouveauLot(lot())).not.toThrow();
  });
});

describe('validerQualificationLot', () => {
  const qualification = (surcharge: Partial<QualificationLot> = {}) => ({
    lotId: 'lot',
    stockMedicamentId: 'stk',
    pointDeVenteId: 'pv',
    coefficient: 20,
    coutUnitaire: 0,
    correction: 228,
    auteurId: null,
    horodatageServeur: new Date(),
    ...surcharge,
  });

  it('refuse un coefficient inférieur à 2, une correction nulle ou un coût négatif', () => {
    expect(() =>
      validerQualificationLot(qualification({ coefficient: 1 })),
    ).toThrow(RangeError);
    expect(() =>
      validerQualificationLot(qualification({ correction: 0 })),
    ).toThrow(RangeError);
    expect(() =>
      validerQualificationLot(qualification({ coutUnitaire: -1 })),
    ).toThrow(RangeError);
  });

  it('accepte une qualification valide', () => {
    expect(() => validerQualificationLot(qualification())).not.toThrow();
  });
});

describe('verrouillerFiches', () => {
  it('verrouille chaque fiche une fois, dans l ordre trié', async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const tx = {
      $executeRaw: executeRaw,
    } as unknown as Prisma.TransactionClient;
    await new MouvementsStockService().verrouillerFiches(tx, ['b', 'a', 'b']);
    expect(executeRaw).toHaveBeenCalledTimes(2);
    const appels = executeRaw.mock.calls as unknown[][];
    const cles = appels.map((appel) => appel[1] as string);
    expect(cles).toEqual(['medconnecte:stock:a', 'medconnecte:stock:b']);
  });

  it('ne fait rien pour une liste vide', async () => {
    const executeRaw = jest.fn();
    const tx = {
      $executeRaw: executeRaw,
    } as unknown as Prisma.TransactionClient;
    await new MouvementsStockService().verrouillerFiches(tx, []);
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe('cleVerrouFiche', () => {
  it('préfixe l identifiant', () => {
    expect(cleVerrouFiche('x')).toBe('medconnecte:stock:x');
  });
});

describe('creerLot avec lotId fourni (rejeu)', () => {
  const lotId = '0f0f0f0f-1111-5222-8333-444444444444';
  const existant = {
    id: lotId,
    stockMedicamentId: 'stk',
    pointDeVenteId: 'pv',
    numeroLot: 'L1',
    dateExpiration: new Date('2027-01-31T00:00:00.000Z'),
    quantiteRecue: 5,
    coutUnitaire: 10,
    coutAchatBoite: null,
    coefficientReception: 1,
  };
  const demande = (s: Partial<NouveauLot> = {}) =>
    lot({
      lotId,
      numeroLot: 'L1',
      dateExpiration: new Date('2027-01-31T00:00:00.000Z'),
      coutUnitaire: 10,
      ...s,
    });

  function tx(premier: unknown) {
    return {
      $executeRaw: jest.fn().mockResolvedValue(1),
      lotStock: {
        findUnique: jest.fn().mockResolvedValue(existant),
        create: jest.fn(),
      },
      mouvementStock: { findFirst: jest.fn().mockResolvedValue(premier) },
      agregatStockLot: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ quantite: 5 }),
      },
      agregatStockProduit: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ quantite: 5 }),
      },
    };
  }

  it('même contenu : reconnu identique, rien créé', async () => {
    expect(memeContenu(existant as never, demande())).toBe(true);
    const t = tx({ id: 'm' });
    const r = await new MouvementsStockService().creerLot(
      t as unknown as Prisma.TransactionClient,
      demande(),
    );
    expect(r.reception.soldeLot).toBe(5);
    expect(t.lotStock.create).not.toHaveBeenCalled();
  });

  it('contenu différent : quantité, numéro, péremption, coût', async () => {
    for (const d of [
      { quantite: 6 },
      { numeroLot: 'L2' },
      { dateExpiration: null },
      { coutUnitaire: 11 },
    ]) {
      const t = tx({ id: 'm' });
      await expect(
        new MouvementsStockService().creerLot(
          t as unknown as Prisma.TransactionClient,
          demande(d),
        ),
      ).rejects.toMatchObject({
        response: { code: 'IDENTIFIANT_DEJA_UTILISE' },
      });
      expect(t.lotStock.create).not.toHaveBeenCalled();
    }
  });

  it('premier mouvement introuvable : erreur typée', async () => {
    await expect(
      new MouvementsStockService().creerLot(
        tx(null) as unknown as Prisma.TransactionClient,
        demande(),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'LOT_SANS_MOUVEMENT',
        message: MESSAGE_LOT_SANS_MOUVEMENT,
      },
    });
  });
});
