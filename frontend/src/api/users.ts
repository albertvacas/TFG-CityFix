import client from './client';
import type { User } from '../types';

export const getTechnicians = async (): Promise<User[]> => {
  const { data } = await client.get<{ technicians: User[] }>('/users/technicians');
  return data.technicians;
};

export const getPrivilegedUsers = async (): Promise<User[]> => {
  const { data } = await client.get<{ users: User[] }>('/users/privileged');
  return data.users;
};

export const revokeUser = async (userId: string): Promise<User> => {
  const { data } = await client.patch<{ user: User }>(`/users/${userId}/revoke`);
  return data.user;
};
