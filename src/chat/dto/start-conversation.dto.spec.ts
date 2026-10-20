import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StartConversationDto } from './start-conversation.dto';

const ID_VALIDE = '3f2b8c1e-6a4d-4e2b-9c1a-7d5e8f9a0b1c';

async function erreurs(corps: Record<string, unknown>) {
  return validate(plainToInstance(StartConversationDto, corps));
}

describe('StartConversationDto', () => {
  it('accepte un destinataire et un type valides', async () => {
    expect(await erreurs({ targetId: ID_VALIDE, type: 'PRIVE' })).toHaveLength(
      0,
    );
    expect(
      await erreurs({ targetId: ID_VALIDE, type: 'STRUCTURE' }),
    ).toHaveLength(0);
  });

  it('rejette un type de conversation inconnu', async () => {
    const res = await erreurs({ targetId: ID_VALIDE, type: 'GROUPE' });
    expect(res).toHaveLength(1);
    expect(res[0].property).toBe('type');
    expect(Object.values(res[0].constraints ?? {})).toContain(
      'Le type de conversation est invalide.',
    );
  });

  it('rejette un destinataire absent', async () => {
    const res = await erreurs({ type: 'PRIVE' });
    expect(res).toHaveLength(1);
    expect(res[0].property).toBe('targetId');
    expect(Object.values(res[0].constraints ?? {})).toContain(
      'Le destinataire de la conversation est invalide.',
    );
  });
});
