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

/**
 * Puja la foto de perfil capturada amb expo-image-picker (URI local file://)
 * al backend, que la desa a Supabase Storage i actualitza User.avatarUrl.
 * Mateix patró multipart que uploadReportImage.
 */
export const uploadAvatar = async (imageUri: string): Promise<User> => {
  const filename = imageUri.split('/').pop() ?? `avatar-${Date.now()}.jpg`;
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimetype =
    ext === 'png'
      ? 'image/png'
      : ext === 'webp'
      ? 'image/webp'
      : ext === 'heic' || ext === 'heif'
      ? 'image/heic'
      : 'image/jpeg';

  const form = new FormData();
  // React Native serialitza { uri, name, type } com a fitxer multipart.
  form.append('image', { uri: imageUri, name: filename, type: mimetype } as any);

  const { data } = await client.post<{ user: User }>('/users/avatar', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    transformRequest: (d) => d,
    timeout: 30000,
  });
  return data.user;
};
