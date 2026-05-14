import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ChatService } from './chat.service';
import { AuthGuard } from '../common/guards/auth.guard';

@Controller('chat')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('conversations')
  async getConversations(@Request() req) {
    const data = await this.chatService.getConversations(req.user.userId);
    return { success: true, data, message: 'Conversations récupérées' };
  }

  @Get('conversations/:id/messages')
  async getMessages(@Param('id') id: string, @Request() req) {
    const data = await this.chatService.getMessages(id, req.user.userId);
    return { success: true, data, message: 'Messages récupérés' };
  }

  @Post('conversations/start')
  async startConversation(@Request() req, @Body() body: { targetId: string, type: 'PRIVE' | 'STRUCTURE' }) {
    const data = await this.chatService.getOrCreateConversation(req.user.userId, body.type, body.targetId);
    return { success: true, data, message: 'Conversation créée' };
  }
}
