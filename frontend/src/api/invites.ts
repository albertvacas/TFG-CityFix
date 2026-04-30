import client from './client';
import type { Invite } from '../types';

export const getInvites = async (): Promise<Invite[]> => {
  const { data } = await client.get<{ invites: Invite[] }>('/invites');
  return data.invites;
};

export const createInvite = async (email: string, role: 'ADMIN' | 'TECHNICAL'): Promise<Invite> => {
  const { data } = await client.post<{ invite: Invite }>('/invites', { email, role });
  return data.invite;
};

export const revokeInvite = async (id: string): Promise<Invite> => {
  const { data } = await client.patch<{ invite: Invite }>(`/invites/${id}/revoke`);
  return data.invite;
};
