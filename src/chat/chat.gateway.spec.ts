import { ChatGateway } from './chat.gateway';

describe('ChatGateway : contrôle des participants', () => {
  const conv = {
    id: 'c1',
    patientId: 'p1',
    medecinId: 'm1',
    structureId: null,
  };

  let chatService: {
    isParticipant: jest.Mock;
    checkAccess: jest.Mock;
    saveMessage: jest.Mock;
  };
  let notifications: { createNotification: jest.Mock };
  let gateway: ChatGateway;
  let emit: jest.Mock;
  let to: jest.Mock;

  const client = (userId?: string) => {
    const join = jest.fn();
    return { socket: { data: { userId }, join } as never, join };
  };

  beforeEach(() => {
    chatService = {
      isParticipant: jest.fn().mockResolvedValue(true),
      checkAccess: jest
        .fn()
        .mockResolvedValue({ conversation: conv, allowed: true }),
      saveMessage: jest.fn().mockResolvedValue({
        id: 'msg1',
        sender: { prenom: 'A', nom: 'B' },
      }),
    };
    notifications = { createNotification: jest.fn().mockResolvedValue({}) };
    gateway = new ChatGateway(
      chatService as never,
      {} as never,
      notifications as never,
    );
    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as never;
  });

  it('joinConversation : un non participant ne rejoint pas la room', async () => {
    chatService.isParticipant.mockResolvedValue(false);
    const c = client('intrus');
    const res = await gateway.handleJoinConversation('c1', c.socket);
    expect(c.join).not.toHaveBeenCalled();
    expect(res).toEqual({
      event: 'error',
      data: { message: "Vous n'avez pas accès à cette conversation." },
    });
  });

  it('joinConversation : un participant rejoint conv_<id>', async () => {
    const c = client('p1');
    await gateway.handleJoinConversation('c1', c.socket);
    expect(c.join).toHaveBeenCalledWith('conv_c1');
  });

  it("sendMessage : un non participant n'enregistre ni ne diffuse rien", async () => {
    chatService.checkAccess.mockResolvedValue({
      conversation: conv,
      allowed: false,
    });
    const res = await gateway.handleMessage(
      { conversationId: 'c1', content: 'salut' },
      client('intrus').socket,
    );
    expect(chatService.saveMessage).not.toHaveBeenCalled();
    expect(to).not.toHaveBeenCalled();
    expect(res).toEqual({
      event: 'error',
      data: { message: "Vous n'avez pas accès à cette conversation." },
    });
  });

  it("sendMessage : un receiverId étranger à la conversation n'est pas notifié", async () => {
    await gateway.handleMessage(
      { conversationId: 'c1', content: 'salut', receiverId: 'etranger' },
      client('p1').socket,
    );
    expect(chatService.saveMessage).toHaveBeenCalled();
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('sendMessage : le médecin de la conversation est notifié', async () => {
    await gateway.handleMessage(
      { conversationId: 'c1', content: 'salut', receiverId: 'm1' },
      client('p1').socket,
    );
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'm1' }),
    );
  });
});
