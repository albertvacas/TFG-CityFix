import client from './client';
import type { Invite, Paginated } from '../types';

export const getInvites = async (page = 1, pageSize = 10): Promise<Paginated<Invite>> => {
  const { data } = await client.get<{ invites: Invite[]; total: number; page: number; pageSize: number }>(
    '/invites',
    { params: { page, pageSize } },
  );
  return { items: data.invites, total: data.total, page: data.page, pageSize: data.pageSize };
};

export const createInvite = async (email: string, role: 'ADMIN' | 'TECHNICAL'): Promise<Invite> => {
  const { data } = await client.post<{ invite: Invite }>('/invites', { email, role });
  return data.invite;
};

export const revokeInvite = async (id: string): Promise<Invite> => {
  const { data } = await client.patch<{ invite: Invite }>(`/invites/${id}/revoke`);
  return data.invite;
};
