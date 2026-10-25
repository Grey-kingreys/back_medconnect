import { readFileSync } from 'fs';
import { join } from 'path';
import {
  comparerFefo,
  DemandeSelection,
  estPerime,
  LotCandidat,
  ordonnerLotsPourVente,
  selectionnerLots,
} from './selection-lots';

// Types locaux du fichier de vecteurs.
interface CasVecteur {
  nom: string;
  entree: DemandeSelection;
  attendu: {
    allocations: { lotId: string; quantite: number }[];
    resteProvisoire: number;
    lotsPerimesDisponibles: string[];
  };
}
interface FichierVecteurs {
  version: number;
  description: string;
  cas: CasVecteur[];
}
const fichier = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'test',
      'vecteurs',
      'selection-lots.json',
    ),
    'utf8',
  ),
) as FichierVecteurs;

function lot(id: string, champs: Partial<LotCandidat> = {}): LotCandidat {
  return {
    id,
    numeroLot: id,
    dateExpiration: '2027-01-31',
    dateReception: '2026-10-01T08:00:00.000Z',
    solde: 10,
    coefficientReception: 1,
    coutUnitaire: 100,
    lotTechnique: false,
    ...champs,
  };
}

function cas(prefixe: string): CasVecteur {
  const trouve = fichier.cas.find((c) => c.nom.startsWith(prefixe + ' '));
  if (!trouve) throw new Error(`Vecteur introuvable : ${prefixe}`);
  return trouve;
}

describe('selectionnerLots : vecteurs partagés back et front', () => {
  it('le fichier de vecteurs est en version 1 et compte 24 cas', () => {
    expect(fichier.version).toBe(1);
    expect(fichier.cas).toHaveLength(24);
  });

  it.each(fichier.cas)('$nom', (c) => {
    const r = selectionnerLots(c.entree);
    expect({
      allocations: r.allocations.map((a) => ({
        lotId: a.lotId,
        quantite: a.quantite,
      })),
      resteProvisoire: r.resteProvisoire,
      lotsPerimesDisponibles: r.lotsPerimesDisponibles.map((l) => l.lotId),
    }).toEqual(c.attendu);
    const somme = r.allocations.reduce((s, a) => s + a.quantite, 0);
    expect(somme + r.resteProvisoire).toBe(c.entree.quantiteUm);
    for (const a of r.allocations) {
      const source = c.entree.lots.find((l) => l.id === a.lotId);
      expect(a.quantite).toBeLessThanOrEqual(source?.solde ?? 0);
    }
  });
});

describe('selectionnerLots : règles', () => {
  it('recopie les champs du lot dans chaque allocation (CA11)', () => {
    expect(selectionnerLots(cas('V04').entree).allocations).toEqual([
      {
        lotId: 'B',
        numeroLot: 'B-02',
        dateExpiration: '2027-09-30',
        quantite: 6,
        coutUnitaire: 300,
        lotTechnique: false,
      },
      {
        lotId: 'A',
        numeroLot: 'A-01',
        dateExpiration: '2027-03-31',
        quantite: 4,
        coutUnitaire: 280,
        lotTechnique: false,
      },
    ]);
  });

  it('ne modifie pas les lots reçus', () => {
    const entree = cas('V21').entree;
    const copie = structuredClone(entree);
    selectionnerLots(entree);
    expect(entree).toEqual(copie);
  });

  it('le résultat ne dépend pas de l ordre des lots reçus', () => {
    const entree = cas('V16').entree;
    const inverse = { ...entree, lots: [...entree.lots].reverse() };
    expect(selectionnerLots(inverse)).toEqual(selectionnerLots(entree));
  });

  it('les lots périmés disponibles ont la forme du 409 SORTIE_MANUELLE_REQUISE', () => {
    expect(selectionnerLots(cas('V12').entree).lotsPerimesDisponibles).toEqual([
      {
        lotId: 'P2',
        numeroLot: 'P-30',
        dateExpiration: '2026-09-30',
        quantite: 4,
      },
      {
        lotId: 'P1',
        numeroLot: 'P-15',
        dateExpiration: '2026-10-15',
        quantite: 8,
      },
    ]);
  });

  it('aucun périmé listé quand la quantité est couverte', () => {
    expect(selectionnerLots(cas('V10').entree).lotsPerimesDisponibles).toEqual(
      [],
    );
  });

  it('refuse les entrées impossibles', () => {
    const base: DemandeSelection = {
      jour: '2026-11-01',
      unite: 'UNITE',
      quantiteUm: 2,
      lots: [lot('A')],
    };
    const avecLot = (champs: Partial<LotCandidat>): DemandeSelection => ({
      ...base,
      lots: [lot('A', champs)],
    });
    expect(() => selectionnerLots({ ...base, quantiteUm: 0 })).toThrow(
      RangeError,
    );
    expect(() => selectionnerLots({ ...base, quantiteUm: 1.5 })).toThrow(
      RangeError,
    );
    expect(() => selectionnerLots({ ...base, jour: '2026-11-1' })).toThrow(
      RangeError,
    );
    expect(() =>
      selectionnerLots(avecLot({ coefficientReception: 0 })),
    ).toThrow(RangeError);
    expect(() => selectionnerLots(avecLot({ solde: -1 }))).toThrow(RangeError);
    expect(() => selectionnerLots(avecLot({ coutUnitaire: -1 }))).toThrow(
      RangeError,
    );
    expect(() =>
      selectionnerLots(avecLot({ dateExpiration: '31/01/2027' })),
    ).toThrow(RangeError);
    expect(() =>
      selectionnerLots(avecLot({ dateReception: 'pas une date' })),
    ).toThrow(RangeError);
    expect(() =>
      selectionnerLots({ ...base, lots: [lot('A'), lot('A')] }),
    ).toThrow(RangeError);
  });
});

describe('estPerime, comparerFefo, ordonnerLotsPourVente', () => {
  it('estPerime : veille périmée, jour même et futur vendables, sans date jamais périmé', () => {
    expect(estPerime('2026-10-31', '2026-11-01')).toBe(true);
    expect(estPerime('2026-11-01', '2026-11-01')).toBe(false);
    expect(estPerime('2026-11-02', '2026-11-01')).toBe(false);
    expect(estPerime(null, '2026-11-01')).toBe(false);
  });

  it('comparerFefo : date nulle, puis date, puis réception, puis identifiant', () => {
    expect(
      comparerFefo(lot('A', { dateExpiration: null }), lot('B')),
    ).toBeLessThan(0);
    expect(
      comparerFefo(
        lot('A', { dateExpiration: '2026-12-01' }),
        lot('B', { dateExpiration: '2027-01-01' }),
      ),
    ).toBeLessThan(0);
    expect(
      comparerFefo(
        lot('A', { dateReception: '2026-09-01T08:00:00.000Z' }),
        lot('B', { dateReception: '2026-10-01T08:00:00.000Z' }),
      ),
    ).toBeLessThan(0);
    expect(comparerFefo(lot('A'), lot('B'))).toBeLessThan(0);
    expect(comparerFefo(lot('A'), lot('A'))).toBe(0);
  });

  it('ordonnerLotsPourVente : lots à reliquat d abord, périmés et soldes nuls exclus', () => {
    const lots = [
      ...cas('V16').entree.lots,
      lot('PER', { dateExpiration: '2026-10-01' }),
      lot('ZERO', { solde: 0 }),
    ];
    expect(ordonnerLotsPourVente(lots, '2026-11-01').map((l) => l.id)).toEqual([
      'R2',
      'R1',
      'I',
    ]);
  });
});
