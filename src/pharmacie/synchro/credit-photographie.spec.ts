import {
  bornerClientsCredit,
  CLIENTS_SOLDES_PHOTOGRAPHIE_MAX,
  HISTORIQUE_CREDIT_PHOTOGRAPHIE_MAX,
  type ClientCreditSynchro,
} from './catalogue-synchro.service';

const jour = (n: number) =>
  new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString();

function client(
  id: string,
  o: {
    reste?: number;
    prises?: number;
    remboursements?: number;
    activite?: number;
  } = {},
): ClientCreditSynchro {
  const nbPrises = o.prises ?? 0;
  return {
    id,
    nomComplet: `Client ${id}`,
    telephone: null,
    note: null,
    createdAt: jour(0),
    resteAPayer: o.reste ?? 0,
    totalPris: 0,
    totalRembourse: 0,
    statut: (o.reste ?? 0) > 0 ? 'EN_COURS' : 'SOLDE',
    prises: Array.from({ length: nbPrises }, (_, i) => ({
      venteId: `${id}-v${String(i).padStart(4, '0')}`,
      numero: `T1-${i}`,
      createdAt: jour((o.activite ?? 1) + i),
      jourMetier: '2026-01-01',
      vendeurNom: 'X',
      total: 1000,
      annulee: i === 0 && nbPrises > 1,
      motifAnnulation: null,
      dateLimite: null,
      resteSurPrise: 0,
      lignes: [],
    })),
    remboursements: Array.from({ length: o.remboursements ?? 0 }, (_, i) => ({
      id: `${id}-r${String(i).padStart(4, '0')}`,
      montant: 100,
      note: null,
      verseEnCaisse: false,
      auteurNom: null,
      createdAt: jour((o.activite ?? 1) + i),
    })),
    anterieur: { totalPris: 0, totalRembourse: 0 },
  };
}

describe('borne de la part crédit de la photographie', () => {
  it('garde tous les clients non soldés et les soldés les plus récemment actifs', () => {
    const soldes = Array.from(
      { length: CLIENTS_SOLDES_PHOTOGRAPHIE_MAX + 20 },
      (_, i) =>
        client(`s${String(i).padStart(4, '0')}`, {
          prises: 1,
          activite: i + 1,
        }),
    );
    const dus = [
      client('a-du-1', { reste: 500 }),
      client('z-du-2', { reste: 1 }),
    ];
    const borne = bornerClientsCredit([...soldes, ...dus]);
    expect(borne).toHaveLength(CLIENTS_SOLDES_PHOTOGRAPHIE_MAX + 2);
    const ids = borne.map((c) => c.id);
    expect(ids).toContain('a-du-1');
    expect(ids).toContain('z-du-2');
    // Les plus anciens soldés sont écartés, les plus récents gardés.
    expect(ids).not.toContain('s0000');
    expect(ids).toContain(
      `s${String(CLIENTS_SOLDES_PHOTOGRAPHIE_MAX + 19).padStart(4, '0')}`,
    );
    expect([...ids].sort()).toEqual(ids);
  });

  it("limite l'historique par client et résume ce qui est retiré dans `anterieur`", () => {
    const n = HISTORIQUE_CREDIT_PHOTOGRAPHIE_MAX + 5;
    const [c] = bornerClientsCredit([
      client('c1', { reste: 10, prises: n, remboursements: n }),
    ]);
    expect(c.prises).toHaveLength(HISTORIQUE_CREDIT_PHOTOGRAPHIE_MAX);
    expect(c.remboursements).toHaveLength(HISTORIQUE_CREDIT_PHOTOGRAPHIE_MAX);
    // Les 5 plus anciennes prises (dont la première, annulée, non comptée) et 5 remboursements de 100.
    expect(c.anterieur).toEqual({ totalPris: 4000, totalRembourse: 500 });
    expect(c.prises[0].venteId).toBe('c1-v0005');
  });

  it("ne dépend pas de l'ordre d'entrée et ne change rien sous les bornes", () => {
    const a = client('a', { reste: 1, prises: 2 });
    const b = client('b', { prises: 1 });
    expect(bornerClientsCredit([b, a])).toEqual(bornerClientsCredit([a, b]));
    expect(bornerClientsCredit([a])[0].anterieur).toEqual({
      totalPris: 0,
      totalRembourse: 0,
    });
  });
});
