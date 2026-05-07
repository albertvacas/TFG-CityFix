import client from './client';
import type { LoginResponse, RegisterPayload, UpdateProfilePayload, User } from '../types';

export const login = async (email: string, password: string): Promise<LoginResponse> => {
  const { data } = await client.post<LoginResponse>('/auth/login', { email, password });
  return data;
};

export const register = async (payload: RegisterPayload): Promise<User> => {
  const { data } = await client.post<{ user: User }>('/auth/register', payload);
  return data.user;
};

export const getProfile = async (): Promise<User> => {
  const { data } = await client.get<{ user: User }>('/users/profile');
  return data.user;
};

export const updateProfile = async (payload: UpdateProfilePayload): Promise<User> => {
  const { data } = await client.patch<{ user: User }>('/users/profile', payload);
  return data.user;
};
