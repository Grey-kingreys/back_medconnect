import { CarnetSanteService } from './carnet-sante.service';

/**
 * Régression : `getAnalyses` renvoyait le laboratoire brut, donc chiffré, au
 * patient. Le champ doit sortir déchiffré, avec le repli sur le nom du médecin
 * quand aucun laboratoire n'est renseigné.
 */
describe('CarnetSanteService : getAnalyses', () => {
  const chiffrer = (v: string) => (v ? `CHIFFRE:${v}` : '');
  const encryption = {
    decrypt: (v: string) => (v.startsWith('CHIFFRE:') ? v.slice(8) : v),
  };

  const analyse = (laboratoire: string, medecin: unknown = null) => ({
    id: 'a1',
    patientId: 'p1',
    typeAnalyse: chiffrer('Bilan lipidique'),
    laboratoire,
    resultats: chiffrer('Normal'),
    notes: '',
    medecin,
  });

  const service = (analyses: unknown[]) =>
    new CarnetSanteService(
      {
        resultatAnalyse: { findMany: jest.fn().mockResolvedValue(analyses) },
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

  it('renvoie le laboratoire déchiffré', async () => {
    const res = await service([
      analyse(chiffrer('Laboratoire de Donka')),
    ]).getAnalyses('p1');
    expect(res.data[0].laboratoire).toBe('Laboratoire de Donka');
    expect(res.data[0].typeAnalyse).toBe('Bilan lipidique');
  });

  it('se replie sur le nom du médecin sans laboratoire', async () => {
    const res = await service([
      analyse(chiffrer(''), { id: 'm1', prenom: 'Mamadou', nom: 'Diallo' }),
    ]).getAnalyses('p1');
    expect(res.data[0].laboratoire).toBe('Dr. Mamadou Diallo');
  });
});
