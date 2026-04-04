import client from './client';
import type { LoginResponse, User } from '../types';

export const login = async (email: string, password: string): Promise<LoginResponse> => {
  const { data } = await client.post<LoginResponse>('/auth/login', { email, password });
  return data;
};

export const getProfile = async (): Promise<User> => {
  const { data } = await client.get<{ user: User }>('/users/profile');
  return data.user;
};
