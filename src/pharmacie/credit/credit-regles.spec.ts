import {
  calculerEtatCredit,
  estVenteACredit,
  repartirRemboursements,
  resumerMedicaments,
  type PriseCalcul,
} from './credit-regles';

const prise = (
  venteId: string,
  total: number,
  jour: number,
  o: Partial<PriseCalcul> = {},
): PriseCalcul => ({
  venteId,
  total,
  annulee: false,
  dateLimite: null,
  createdAt: new Date(Date.UTC(2026, 10, jour)),
  ...o,
});

describe('Cahier de crédit : règles', () => {
  it('1. reste = prises non annulées moins remboursements', () => {
    const e = calculerEtatCredit(
      [prise('a', 50000, 1), prise('b', 30000, 2, { annulee: true })],
      20000,
      '2026-11-13',
    );
    expect(e.resteAPayer).toBe(30000);
    expect(e.totalPris).toBe(50000);
    expect(e.statut).toBe('EN_COURS');
  });

  it('2. soldé quand le reste est nul, et jamais négatif après une annulation', () => {
    expect(
      calculerEtatCredit([prise('a', 10000, 1)], 10000, '2026-11-13').statut,
    ).toBe('SOLDE');
    const e = calculerEtatCredit(
      [prise('a', 10000, 1, { annulee: true })],
      10000,
      '2026-11-13',
    );
    expect(e.resteAPayer).toBe(0);
    expect(e.statut).toBe('SOLDE');
  });

  it('3. en retard : une prise non soldée a une date limite dépassée', () => {
    const p = [prise('a', 10000, 1, { dateLimite: '2026-11-10' })];
    expect(calculerEtatCredit(p, 0, '2026-11-13').statut).toBe('EN_RETARD');
    expect(calculerEtatCredit(p, 0, '2026-11-10').statut).toBe('EN_COURS');
  });

  it('4. remboursements imputés aux prises les plus anciennes : la prise soldée ne met pas en retard', () => {
    const p = [
      prise('a', 10000, 1, { dateLimite: '2026-11-05' }),
      prise('b', 10000, 2, { dateLimite: '2026-12-01' }),
    ];
    const e = calculerEtatCredit(p, 10000, '2026-11-13');
    expect(e.statut).toBe('EN_COURS');
    expect(e.dateLimiteProche).toBe('2026-12-01');
    const r = repartirRemboursements(p, 15000);
    expect(r.map((x) => x.reste)).toEqual([0, 5000]);
  });

  it('5. client sans prise : soldé', () => {
    expect(calculerEtatCredit([], 0, '2026-11-13').statut).toBe('SOLDE');
  });

  it('6. résumé tronqué', () => {
    expect(resumerMedicaments(['A', 'B'])).toBe('A, B');
    expect(resumerMedicaments(['A', 'B', 'C', 'D', 'D', 'E'])).toBe(
      'A, B, C et 2 autres',
    );
  });

  it('7. une vente est à crédit si un client est fourni ou si le mode CREDIT est demandé', () => {
    expect(estVenteACredit({})).toBe(false);
    expect(estVenteACredit({ paiements: [{ mode: 'ESPECES' }] })).toBe(false);
    expect(estVenteACredit({ clientCreditId: 'x' })).toBe(true);
    expect(estVenteACredit({ nouveauClientCredit: {} })).toBe(true);
    expect(estVenteACredit({ paiements: [{ mode: 'CREDIT' }] })).toBe(true);
  });
});
