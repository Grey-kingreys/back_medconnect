import { CarnetSanteService } from './carnet-sante.service';

/**
 * Régression : `getOrdonnances` renvoyait au patient la consultation liée avec
 * son motif, son diagnostic et ses notes encore chiffrés.
 */
describe('CarnetSanteService : getOrdonnances', () => {
  const chiffrer = (v: string) => `CHIFFRE:${v}`;
  const encryption = {
    decrypt: (v: string) => (v.startsWith('CHIFFRE:') ? v.slice(8) : v),
  };

  const service = (ordonnances: unknown[]) =>
    new CarnetSanteService(
      {
        ordonnance: { findMany: jest.fn().mockResolvedValue(ordonnances) },
      } as never,
      {} as never, // aiService
      {} as never, // emailService
      {} as never, // chatGateway
      {} as never, // notificationsService
      encryption as never,
      {} as never, // smsService
      {} as never, // queueService
      {} as never, // storage
      {} as never, // permissionsService
    );

  const ordonnance = (consultation: unknown) => ({
    id: 'o1',
    patientId: 'p1',
    medecinNom: 'Dr. Mamadou Diallo',
    medicaments: chiffrer('[]'),
    notes: '',
    medecin: null,
    consultation,
  });

  it('déchiffre la consultation liée', async () => {
    const res = await service([
      ordonnance({
        id: 'c1',
        motif: chiffrer('Palpitations'),
        diagnostic: chiffrer('Extrasystoles bénignes'),
        notes: chiffrer('Bilan demandé'),
        structure: { id: 's1', nom: 'Donka' },
      }),
    ]).getOrdonnances('p1');
    const consultation = res.data[0].consultation as {
      motif: string;
      diagnostic: string | null;
      notes: string | null;
    };
    expect(consultation.motif).toBe('Palpitations');
    expect(consultation.diagnostic).toBe('Extrasystoles bénignes');
    expect(consultation.notes).toBe('Bilan demandé');
  });

  it('accepte une ordonnance sans consultation', async () => {
    const res = await service([ordonnance(null)]).getOrdonnances('p1');
    expect(res.data[0].consultation).toBeNull();
  });
});
