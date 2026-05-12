import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/services/prisma.service';

import { NotificationType } from '../../generated/prisma/enums';


@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Récupérer toutes les notifications d'un utilisateur (les 50 dernières) */
  async getNotifications(userId: string) {
    const [notifications, nonLues] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.notification.count({
        where: { userId, lu: false },
      }),
    ]);
    return { data: { notifications, nonLues }, message: 'Notifications récupérées', success: true };
  }

  /** Marquer une notification comme lue */
  async markAsRead(userId: string, notifId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notifId, userId },
      data: { lu: true },
    });
    return { data: null, message: 'Notification marquée comme lue', success: true };
  }

  /** Marquer toutes les notifications comme lues */
  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, lu: false },
      data: { lu: true },
    });
    return { data: null, message: 'Toutes les notifications marquées comme lues', success: true };
  }

  /** Supprimer une notification */
  async deleteNotification(userId: string, notifId: string) {
    await this.prisma.notification.deleteMany({
      where: { id: notifId, userId },
    });
    return { data: null, message: 'Notification supprimée', success: true };
  }

  /** Supprimer toutes les notifications lues */
  async clearRead(userId: string) {
    await this.prisma.notification.deleteMany({
      where: { userId, lu: true },
    });
    return { data: null, message: 'Notifications lues supprimées', success: true };
  }

  /** Créer une notification (appelé par d'autres services) */
  async createNotification(data: {
    userId: string;
    type: NotificationType;
    titre: string;
    message: string;
    lien?: string;
  }) {
    return this.prisma.notification.create({ data });
  }

  /** Créer des notifications en masse (pour plusieurs utilisateurs) */
  async createManyNotifications(
    userIds: string[],
    data: { type: NotificationType; titre: string; message: string; lien?: string },
  ) {
    if (userIds.length === 0) return;
    return this.prisma.notification.createMany({
      data: userIds.map((userId) => ({ userId, ...data })),
    });
  }
}
