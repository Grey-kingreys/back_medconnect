import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async getConversations(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { structureId: true }
    });

    const orConditions: any[] = [
      { patientId: userId },
      { medecinId: userId },
    ];
    if (user?.structureId) {
      orConditions.push({ structureId: user.structureId });
    }

    return this.prisma.conversation.findMany({
      where: { OR: orConditions },
      include: {
        patient: { select: { id: true, nom: true, prenom: true } },
        medecin: { select: { id: true, nom: true, prenom: true, specialite: true } },
        structure: { select: { id: true, nom: true, type: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: { updatedAt: 'desc' }
    });
  }

  async getOrCreateConversation(patientId: string, type: 'PRIVE' | 'STRUCTURE', targetId: string) {
    let conv;
    if (type === 'PRIVE') {
      conv = await this.prisma.conversation.findFirst({
        where: { patientId, medecinId: targetId, type: 'PRIVE' }
      });
      if (!conv) {
        conv = await this.prisma.conversation.create({
          data: { patientId, medecinId: targetId, type: 'PRIVE' }
        });
      }
    } else {
      conv = await this.prisma.conversation.findFirst({
        where: { patientId, structureId: targetId, type: 'STRUCTURE' }
      });
      if (!conv) {
        conv = await this.prisma.conversation.create({
          data: { patientId, structureId: targetId, type: 'STRUCTURE' }
        });
      }
    }
    return conv;
  }

  async getMessages(conversationId: string, userId: string) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: { select: { id: true, nom: true, prenom: true, role: true } }
      }
    });
  }

  async saveMessage(conversationId: string, senderId: string, content: string, isLocation: boolean = false, lat?: number, lng?: number) {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    });

    return this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        content,
        isLocation,
        latitude: lat,
        longitude: lng
      },
      include: {
        sender: { select: { id: true, nom: true, prenom: true, role: true } }
      }
    });
  }
}
