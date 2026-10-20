import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';

/**
 * Accès aux messages limité aux participants : patient, médecin, ou membre de la
 * structure disposant de la permission chat:structure.
 */
describe('ChatService : accès aux conversations', () => {
  const conv = {
    id: 'c1',
    patientId: 'p1',
    medecinId: 'm1',
    structureId: 's1',
  };

  let prisma: {
    conversation: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    message: { findMany: jest.Mock };
  };
  let permissions: { hasPermissions: jest.Mock };
  let service: ChatService;

  beforeEach(() => {
    prisma = {
      conversation: { findUnique: jest.fn().mockResolvedValue(conv) },
      user: { findUnique: jest.fn().mockResolvedValue({ structureId: 's1' }) },
      message: { findMany: jest.fn().mockResolvedValue([{ id: 'x' }]) },
    };
    permissions = { hasPermissions: jest.fn().mockResolvedValue(true) };
    service = new ChatService(prisma as never, permissions as never);
  });

  it('refuse un non participant sans lire les messages', async () => {
    prisma.user.findUnique.mockResolvedValue({ structureId: null });
    await expect(service.getMessages('c1', 'intrus')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('renvoie NotFound pour une conversation inexistante', async () => {
    prisma.conversation.findUnique.mockResolvedValue(null);
    await expect(service.getMessages('nope', 'p1')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('renvoie les messages au patient', async () => {
    await expect(service.getMessages('c1', 'p1')).resolves.toEqual([
      { id: 'x' },
    ]);
  });

  it('renvoie les messages au médecin', async () => {
    await expect(service.getMessages('c1', 'm1')).resolves.toEqual([
      { id: 'x' },
    ]);
  });

  it('renvoie les messages à un membre de la structure avec chat:structure', async () => {
    await expect(service.getMessages('c1', 'agent')).resolves.toEqual([
      { id: 'x' },
    ]);
  });

  it('refuse un membre de la structure sans la permission', async () => {
    permissions.hasPermissions.mockResolvedValue(false);
    await expect(service.getMessages('c1', 'agent')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });

  it("refuse un membre d'une autre structure", async () => {
    prisma.user.findUnique.mockResolvedValue({ structureId: 'autre' });
    await expect(service.isParticipant('c1', 'agent')).resolves.toBe(false);
  });
});
