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
  let revocation: { verifier: jest.Mock; enregistrerDiffuseur: jest.Mock };
  let jwt: { verify: jest.Mock };
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
    revocation = {
      verifier: jest.fn().mockResolvedValue(null),
      enregistrerDiffuseur: jest.fn(),
    };
    jwt = { verify: jest.fn() };
    gateway = new ChatGateway(
      chatService as never,
      jwt as never,
      notifications as never,
      revocation as never,
    );
    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as never;
  });

  describe('révocation des sessions', () => {
    const socketConnexion = () => ({
      handshake: { auth: { token: 'jeton' }, headers: {} },
      data: {} as Record<string, unknown>,
      id: 'sock1',
      join: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    });

    it('connexion avec session révoquée : événement puis déconnexion, sans salle', async () => {
      jwt.verify.mockReturnValue({ userId: 'u1', sid: 's1' });
      revocation.verifier.mockResolvedValue('SESSION_REVOQUEE');
      const s = socketConnexion();

      await gateway.handleConnection(s as never);

      expect(s.emit).toHaveBeenCalledWith('sessionRevoquee', {
        code: 'SESSION_REVOQUEE',
        message: 'Vous avez été déconnecté. Reconnectez-vous pour continuer.',
      });
      expect(s.disconnect).toHaveBeenCalledWith(true);
      expect(s.join).not.toHaveBeenCalled();
      expect(s.data.userId).toBeUndefined();
    });

    it('connexion valide : rejoint la salle utilisateur et la salle de session', async () => {
      jwt.verify.mockReturnValue({ userId: 'u1', sid: 's1' });
      const s = socketConnexion();

      await gateway.handleConnection(s as never);

      expect(s.join).toHaveBeenCalledWith('utilisateur:u1');
      expect(s.join).toHaveBeenCalledWith('session:s1');
      expect(s.data).toMatchObject({ userId: 'u1', sid: 's1' });
      expect(s.disconnect).not.toHaveBeenCalled();
    });

    it('diffuserRevocation : prévient les salles puis coupe après 1 s', () => {
      jest.useFakeTimers();
      const emitSalles = jest.fn();
      const disconnectSockets = jest.fn();
      const toSalles = jest.fn().mockReturnValue({ emit: emitSalles });
      const inSalles = jest.fn().mockReturnValue({ disconnectSockets });
      gateway.server = { to: toSalles, in: inSalles } as never;

      gateway.diffuserRevocation({
        userId: 'u1',
        sessionIds: ['a', 'b'],
        code: 'SESSION_REVOQUEE',
      });

      expect(toSalles).toHaveBeenCalledWith(['session:a', 'session:b']);
      expect(emitSalles).toHaveBeenCalledWith('sessionRevoquee', {
        code: 'SESSION_REVOQUEE',
        message: 'Vous avez été déconnecté. Reconnectez-vous pour continuer.',
      });
      expect(disconnectSockets).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1000);
      expect(inSalles).toHaveBeenCalledWith(['session:a', 'session:b']);
      expect(disconnectSockets).toHaveBeenCalledWith(true);
      jest.useRealTimers();
    });

    it('diffuserRevocation : la salle utilisateur seulement pour COMPTE_DESACTIVE', () => {
      jest.useFakeTimers();
      const toSalles = jest.fn().mockReturnValue({ emit: jest.fn() });
      gateway.server = {
        to: toSalles,
        in: jest.fn().mockReturnValue({ disconnectSockets: jest.fn() }),
      } as never;

      gateway.diffuserRevocation({
        userId: 'u1',
        sessionIds: [],
        code: 'COMPTE_DESACTIVE',
      });

      expect(toSalles).toHaveBeenCalledWith(['utilisateur:u1']);
      jest.useRealTimers();
    });

    it('diffuserRevocation : aucune salle, rien à diffuser', () => {
      const toSalles = jest.fn();
      gateway.server = { to: toSalles } as never;
      gateway.diffuserRevocation({
        userId: 'u1',
        sessionIds: [],
        code: 'SESSION_REVOQUEE',
      });
      expect(toSalles).not.toHaveBeenCalled();
    });

    it('onModuleInit : enregistre le diffuseur', () => {
      gateway.onModuleInit();
      expect(revocation.enregistrerDiffuseur).toHaveBeenCalledTimes(1);
    });
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
