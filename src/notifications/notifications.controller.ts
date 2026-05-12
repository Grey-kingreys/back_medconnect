import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthGuard } from 'src/common/guards/auth.guard';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** GET /notifications — Récupérer mes notifications */
  @Get()
  getMyNotifications(@Request() req: any) {
    return this.notificationsService.getNotifications(req.user.userId);
  }

  /** PATCH /notifications/read-all — Tout marquer comme lu */
  @Patch('read-all')
  markAllAsRead(@Request() req: any) {
    return this.notificationsService.markAllAsRead(req.user.userId);
  }

  /** PATCH /notifications/:id/read — Marquer une notification comme lue */
  @Patch(':id/read')
  markAsRead(@Request() req: any, @Param('id') id: string) {
    return this.notificationsService.markAsRead(req.user.userId, id);
  }

  /** DELETE /notifications/clear-read — Supprimer les notifications lues */
  @Delete('clear-read')
  clearRead(@Request() req: any) {
    return this.notificationsService.clearRead(req.user.userId);
  }

  /** DELETE /notifications/:id — Supprimer une notification */
  @Delete(':id')
  deleteNotification(@Request() req: any, @Param('id') id: string) {
    return this.notificationsService.deleteNotification(req.user.userId, id);
  }
}
