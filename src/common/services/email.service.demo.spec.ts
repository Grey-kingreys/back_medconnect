import { EmailService } from './email.service';

/**
 * Filet de sécurité du mode démo : aucun email réel ne part vers une adresse
 * @demo.medconnecte.gn, quel que soit l'appelant.
 */
describe('EmailService : adresses de démonstration', () => {
  let envoyer: jest.Mock;
  let service: EmailService;

  beforeEach(() => {
    envoyer = jest.fn().mockResolvedValue({ data: { id: 'x' }, error: null });
    service = new EmailService();
    (service as unknown as { resendInstance: unknown }).resendInstance = {
      emails: { send: envoyer },
    };
  });

  it('n’envoie rien vers une adresse de démonstration', async () => {
    await service.sendWelcomeEmail(
      'aminata.diallo@demo.medconnecte.gn',
      'Diallo',
      'Aminata',
    );
    expect(envoyer).not.toHaveBeenCalled();
  });

  it('envoie normalement vers une vraie adresse', async () => {
    await service.sendWelcomeEmail('patient@exemple.gn', 'Bah', 'Mariama');
    expect(envoyer).toHaveBeenCalledTimes(1);
    const [payload] = envoyer.mock.calls[0] as [{ to: string[] }];
    expect(payload.to).toEqual(['patient@exemple.gn']);
  });
});
