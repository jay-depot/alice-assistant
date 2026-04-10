import { defineEntity, p } from '@mikro-orm/sqlite';

const NotificationsChatSegueNotificationSchema = defineEntity({
  name: 'NotificationsChatSegueNotification',
  properties: {
    id: p.integer().primary(),
    title: p.string(),
    message: p.string(),
    source: p.string(),
    status: p.enum(['pending', 'delivered']),
    createdAt: p.datetime(),
    updatedAt: p.datetime(),
  }
});

export class NotificationsChatSegueNotification extends NotificationsChatSegueNotificationSchema.class {
  declare id: number;
  declare title: string;
  declare message: string;
  declare source: string;
  declare status: 'pending' | 'delivered';
  declare createdAt: Date;
  declare updatedAt: Date;
}

NotificationsChatSegueNotificationSchema.setClass(NotificationsChatSegueNotification);