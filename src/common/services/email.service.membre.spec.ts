import { Logger } from '@nestjs/common';
import { EmailService } from './email.service';

/** sendMemberWelcomeEmail indique si l'email est réellement parti. */
describe('EmailService : sendMemberWelcomeEmail', () => {
  let envoyer: jest.Mock;
  let service: EmailService;

  const appeler = (email: string) =>
    service.sendMemberWelcomeEmail(
      email,
      'Bah',
      'Awa',
      'MEDECIN',
      'Clinique Test',
      'Mc-temporaire-1',
    );

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    envoyer = jest.fn();
    service = new EmailService();
    (service as unknown as { resendInstance: unknown }).resendInstance = {
      emails: { send: envoyer },
    };
  });

  afterEach(() => jest.restoreAllMocks());

  it('renvoie true quand Resend accepte l email', async () => {
    envoyer.mockResolvedValue({ data: { id: 'x' }, error: null });
    await expect(appeler('awa@exemple.gn')).resolves.toBe(true);
  });

  it('renvoie false quand Resend renvoie une erreur', async () => {
    envoyer.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'clé invalide' },
    });
    await expect(appeler('awa@exemple.gn')).resolves.toBe(false);
  });

  it('renvoie false quand l envoi est rejeté', async () => {
    envoyer.mockRejectedValue(new Error('réseau'));
    await expect(appeler('awa@exemple.gn')).resolves.toBe(false);
  });

  it('renvoie true sans envoi pour une adresse de démonstration', async () => {
    await expect(appeler('awa@demo.medconnecte.gn')).resolves.toBe(true);
    expect(envoyer).not.toHaveBeenCalled();
  });
});
