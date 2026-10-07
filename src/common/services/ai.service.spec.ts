import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { AiService } from './ai.service';

// HttpService et ConfigService simulés : aucun appel réseau
function creerService(variables: Record<string, string | undefined>) {
  const post = jest.fn().mockReturnValue(of({ data: { ok: true } }));
  const httpService = { post } as unknown as HttpService;
  const configService = {
    get: (cle: string) => variables[cle],
  } as unknown as ConfigService;
  return { service: new AiService(httpService, configService), post };
}

const SECRET = 's'.repeat(40);

describe('AiService : secret partagé avec les services IA', () => {
  it("envoie l'en-tête X-MedConnecte-Secret quand AI_SHARED_SECRET est définie", async () => {
    const { service, post } = creerService({ AI_SHARED_SECRET: SECRET });

    await service.predictMaladie('fièvre et toux');
    await service.getEmergencyFirstAid('que faire en cas de brûlure ?');

    expect(post).toHaveBeenCalledTimes(2);
    for (const appel of post.mock.calls as unknown[][]) {
      expect(appel[2]).toEqual({
        headers: { 'X-MedConnecte-Secret': SECRET },
      });
    }
  });

  it("n'envoie aucun en-tête quand AI_SHARED_SECRET est absente", async () => {
    const { service, post } = creerService({});

    await service.predictMaladie('fièvre et toux');
    await service.getEmergencyFirstAid('que faire en cas de brûlure ?');

    expect(post).toHaveBeenCalledTimes(2);
    for (const appel of post.mock.calls as unknown[][]) {
      expect(appel[2]).toBeUndefined();
    }
  });
});
