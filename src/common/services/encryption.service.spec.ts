import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

// Point 19 : déchiffrement, alerte structurée sans jamais journaliser le contenu.
describe('EncryptionService', () => {
  let service: EncryptionService;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    const cle = randomBytes(32).toString('hex');
    const config = { get: () => cle } as unknown as ConfigService;
    service = new EncryptionService(config);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('chiffre puis déchiffre une valeur (aller-retour)', () => {
    const chiffre = service.encrypt('Allergie à la pénicilline');
    expect(chiffre).not.toContain('pénicilline');
    expect(service.decrypt(chiffre)).toBe('Allergie à la pénicilline');
  });

  it('renvoie une valeur en clair telle quelle et la signale sans son contenu', () => {
    const clair = 'Diabète: type 2';
    expect(service.decrypt(clair)).toBe(clair);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({
      evenement: 'encryption.valeur_non_chiffree',
      longueur: clair.length,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Diabète');
  });

  it('renvoie la valeur de repli si la donnée chiffrée est altérée', () => {
    const chiffre = service.encrypt('Hypertension');
    const [iv, tag, texte] = chiffre.split(':');
    const altere = `${iv}:${tag}:${texte.slice(0, -2)}${texte.endsWith('00') ? '11' : '00'}`;

    expect(service.decrypt(altere)).toBe(' [Donnée illisible] ');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        evenement: 'encryption.dechiffrement_echoue',
        longueur: altere.length,
      }),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain(texte);
  });

  it('renvoie une chaîne vide telle quelle sans journaliser', () => {
    expect(service.decrypt('')).toBe('');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
