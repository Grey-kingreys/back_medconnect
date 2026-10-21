import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from '../notifications/notifications.service';
import {
  RevocationService,
  type EvenementRevocation,
} from '../auth/revocation.service';
import {
  DELAI_DECONNEXION_SOCKET_MS,
  messagePourCode,
} from '../auth/sessions.constants';

const ACCES_REFUSE = "Vous n'avez pas accès à cette conversation.";

// CORS aligné sur celui de l'API HTTP (src/main.ts) : seule l'origine du front est autorisée.
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  server: Server;

  private userSockets = new Map<string, Set<string>>();

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly notificationsService: NotificationsService,
    private readonly revocation: RevocationService,
  ) {}

  onModuleInit() {
    this.revocation.enregistrerDiffuseur((evt) => this.diffuserRevocation(evt));
  }

  /** Prévient les appareils concernés (salles de session, et d'utilisateur si compte désactivé) puis les déconnecte. */
  diffuserRevocation(evt: EvenementRevocation): void {
    const salles = evt.sessionIds.map((id) => `session:${id}`);
    if (evt.code === 'COMPTE_DESACTIVE')
      salles.push(`utilisateur:${evt.userId}`);
    if (salles.length === 0) return;
    this.server.to(salles).emit('sessionRevoquee', {
      code: evt.code,
      message: messagePourCode(evt.code),
    });
    const t = setTimeout(
      () => this.server.in(salles).disconnectSockets(true),
      DELAI_DECONNEXION_SOCKET_MS,
    );
    t.unref?.();
  }

  async handleConnection(client: Socket) {
    try {
      const auth = client.handshake.auth as { token?: string };
      const authHeader: string | undefined =
        auth.token || client.handshake.headers.authorization;
      const token = authHeader?.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : authHeader;

      if (!token) {
        client.disconnect();
        return;
      }

      // Secret centralisé (validé au boot, cf. config/env.validation.ts) — plus de fallback en dur.
      const decoded = this.jwtService.verify<{ userId: string; sid?: string }>(
        token,
        { secret: process.env.JWT_SECRET },
      );
      const userId = decoded.userId;

      const code = await this.revocation.verifier({
        userId,
        sid: decoded.sid,
      });
      if (code) {
        client.emit('sessionRevoquee', {
          code,
          message: messagePourCode(code),
        });
        client.disconnect(true);
        return;
      }

      const donnees = client.data as { userId?: string; sid?: string };
      donnees.userId = userId;
      if (decoded.sid) donnees.sid = decoded.sid;
      void client.join(`utilisateur:${userId}`);
      if (decoded.sid) void client.join(`session:${decoded.sid}`);

      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(client.id);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = (client.data as { userId?: string }).userId;
    if (userId && this.userSockets.has(userId)) {
      this.userSockets.get(userId)!.delete(client.id);
      if (this.userSockets.get(userId)!.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  @SubscribeMessage('joinConversation')
  async handleJoinConversation(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: Socket,
  ) {
    const userId = (client.data as { userId?: string }).userId;
    if (
      !userId ||
      !(await this.chatService.isParticipant(conversationId, userId))
    ) {
      return { event: 'error', data: { message: ACCES_REFUSE } };
    }
    void client.join(`conv_${conversationId}`);
    return { event: 'joined', data: conversationId };
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @MessageBody()
    payload: {
      conversationId: string;
      content: string;
      isLocation?: boolean;
      lat?: number;
      lng?: number;
      receiverId?: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = (client.data as { userId?: string }).userId;
    if (!userId) return;

    const { conversation, allowed } = await this.chatService.checkAccess(
      payload.conversationId,
      userId,
    );
    if (!conversation || !allowed) {
      return { event: 'error', data: { message: ACCES_REFUSE } };
    }

    // Le destinataire n'est notifié que s'il fait partie de la conversation (et n'est pas l'émetteur).
    const receiverId =
      payload.receiverId &&
      payload.receiverId !== userId &&
      (payload.receiverId === conversation.patientId ||
        payload.receiverId === conversation.medecinId)
        ? payload.receiverId
        : undefined;

    const message = await this.chatService.saveMessage(
      payload.conversationId,
      userId,
      payload.content,
      payload.isLocation || false,
      payload.lat,
      payload.lng,
    );

    this.server
      .to(`conv_${payload.conversationId}`)
      .emit('newMessage', message);

    // Notification persistante (DB)
    if (receiverId) {
      await this.notificationsService.createNotification({
        userId: receiverId,
        type: 'MESSAGE',
        titre: `Nouveau message de ${message.sender.prenom} ${message.sender.nom}`,
        message: payload.isLocation ? '📍 Position partagée' : payload.content,
        lien: `/dashboard/chat?conv=${payload.conversationId}`,
      });
    }

    // Notification temps réel (Socket)
    if (receiverId && this.userSockets.has(receiverId)) {
      for (const socketId of this.userSockets.get(receiverId)!) {
        this.server.to(socketId).emit('notification', {
          type: 'NEW_MESSAGE',
          conversationId: payload.conversationId,
          senderName: `${message.sender.prenom} ${message.sender.nom}`,
          content: payload.isLocation
            ? '📍 Position partagée'
            : payload.content,
        });
      }
    }

    return message;
  }

  // --- SOS / EMERGENCY ALERTS ---

  // eslint-disable-next-line @typescript-eslint/require-await -- signature asynchrone conservée pour les appelants existants
  async sendEmergencyAlert(userIds: string[], data: any) {
    userIds.forEach((userId) => {
      if (this.userSockets.has(userId)) {
        for (const socketId of this.userSockets.get(userId)!) {
          this.server.to(socketId).emit('emergencyAlert', data);
        }
      }
    });
  }

  // Prise en charge d'une alerte SOS : émise aux seuls utilisateurs concernés.
  sendEmergencyHandled(userIds: string[], data: any) {
    userIds.forEach((userId) => {
      if (this.userSockets.has(userId)) {
        for (const socketId of this.userSockets.get(userId)!) {
          this.server.to(socketId).emit('emergencyHandled', data);
        }
      }
    });
  }
}
