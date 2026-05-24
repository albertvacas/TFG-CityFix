import client from './client';
import type { NotificationItem } from '../types';

export const registerPushToken = async (
  token: string,
  platform: 'ios' | 'android',
): Promise<void> => {
  await client.post('/notifications/tokens', { token, platform });
};

export const unregisterPushToken = async (token: string): Promise<void> => {
  await client.delete(`/notifications/tokens/${encodeURIComponent(token)}`);
};

export interface NotificationListResponse {
  notifications: NotificationItem[];
  unreadCount: number;
}

export const listNotifications = async (
  options?: { unreadOnly?: boolean; limit?: number },
): Promise<NotificationListResponse> => {
  const params: Record<string, string> = {};
  if (options?.unreadOnly) params.unreadOnly = 'true';
  if (options?.limit) params.limit = String(options.limit);
  const { data } = await client.get<NotificationListResponse>('/notifications', { params });
  return data;
};

export const markNotificationRead = async (id: string): Promise<void> => {
  await client.patch(`/notifications/${id}/read`);
};

export const markAllNotificationsRead = async (): Promise<void> => {
  await client.patch('/notifications/read-all');
};
