import { 
  WebSocketGateway, 
  SubscribeMessage, 
  MessageBody, 
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userSockets = new Map<string, Set<string>>();

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService
  ) {}

  async handleConnection(client: Socket) {
    try {
      const authHeader = client.handshake.auth.token || client.handshake.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
      
      if (!token) {
        client.disconnect();
        return;
      }
      
      const secret = process.env.JWT_SECRET || 'secret'; 
      const decoded = this.jwtService.verify(token, { secret });
      const userId = decoded.userId;
      client.data.userId = userId;

      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(client.id);

    } catch (error) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId && this.userSockets.has(userId)) {
      this.userSockets.get(userId)!.delete(client.id);
      if (this.userSockets.get(userId)!.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  @SubscribeMessage('joinConversation')
  handleJoinConversation(
    @MessageBody() conversationId: string,
    @ConnectedSocket() client: Socket
  ) {
    client.join(`conv_${conversationId}`);
    return { event: 'joined', data: conversationId };
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @MessageBody() payload: { conversationId: string, content: string, isLocation?: boolean, lat?: number, lng?: number, receiverId?: string },
    @ConnectedSocket() client: Socket
  ) {
    const userId = client.data.userId;
    if (!userId) return;

    const message = await this.chatService.saveMessage(
      payload.conversationId,
      userId,
      payload.content,
      payload.isLocation || false,
      payload.lat,
      payload.lng
    );

    this.server.to(`conv_${payload.conversationId}`).emit('newMessage', message);
    
    // Notification (Si on veut alerter le receiver s'il n'est pas dans la room)
    if (payload.receiverId && this.userSockets.has(payload.receiverId)) {
      for (const socketId of this.userSockets.get(payload.receiverId)!) {
        this.server.to(socketId).emit('notification', {
          type: 'NEW_MESSAGE',
          conversationId: payload.conversationId,
          senderName: `${message.sender.prenom} ${message.sender.nom}`,
          content: payload.isLocation ? '📍 Position partagée' : payload.content
        });
      }
    }

    return message;
  }

  // --- SOS / EMERGENCY ALERTS ---
  
  async sendEmergencyAlert(userIds: string[], data: any) {
    userIds.forEach(userId => {
      if (this.userSockets.has(userId)) {
        for (const socketId of this.userSockets.get(userId)!) {
          this.server.to(socketId).emit('emergencyAlert', data);
        }
      }
    });
  }
}
