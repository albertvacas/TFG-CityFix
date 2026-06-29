import client from './client';
import type { User, Technician, StudentSummary, TechnicianDetails, UserSearchResult, Paginated } from '../types';

export const getTechnicians = async (): Promise<Technician[]> => {
  const { data } = await client.get<{ technicians: Technician[] }>('/users/technicians');
  return data.technicians;
};

export const getTechnicianDetails = async (id: string): Promise<TechnicianDetails> => {
  const { data } = await client.get<{ technician: TechnicianDetails }>(`/users/technicians/${id}`);
  return data.technician;
};

export const getStudents = async (): Promise<StudentSummary[]> => {
  const { data } = await client.get<{ students: StudentSummary[] }>('/users/students');
  return data.students;
};

export const getPrivilegedUsers = async (
  page = 1,
  pageSize = 10,
): Promise<Paginated<User>> => {
  const { data } = await client.get<{ users: User[]; total: number; page: number; pageSize: number }>(
    '/users/privileged',
    { params: { page, pageSize } },
  );
  return { items: data.users, total: data.total, page: data.page, pageSize: data.pageSize };
};

export const revokeUser = async (userId: string): Promise<User> => {
  const { data } = await client.patch<{ user: User }>(`/users/${userId}/revoke`);
  return data.user;
};

// Cerca d'usuaris (STUDENT/TECHNICAL) per nom, cognoms o nickname.
// `includeInactive` (només admin) inclou comptes bloquejats, per poder gestionar-los.
export const searchUsers = async (
  q: string,
  includeInactive = false,
  page = 1,
  pageSize = 10,
): Promise<Paginated<UserSearchResult>> => {
  const { data } = await client.get<{
    users: UserSearchResult[];
    total: number;
    page: number;
    pageSize: number;
  }>('/users/search', {
    params: { q, includeInactive: includeInactive ? 'true' : undefined, page, pageSize },
  });
  return { items: data.users, total: data.total, page: data.page, pageSize: data.pageSize };
};

// Bloqueja (active=false) o reactiva (active=true) un compte de qualsevol rol.
export const setUserActive = async (userId: string, active: boolean): Promise<User> => {
  const { data } = await client.patch<{ user: User }>(`/users/${userId}/active`, { active });
  return data.user;
};

// Elimina (anonimitza) un compte. Conserva l'històric d'incidències.
export const deleteUser = async (userId: string): Promise<void> => {
  await client.delete(`/users/${userId}`);
};

export interface UpdateProfilePayload {
  name?: string;
  surname?: string;
  nickname?: string;
}

// Actualitza el perfil de l'usuari autenticat (PATCH /users/profile).
export const updateMyProfile = async (payload: UpdateProfilePayload): Promise<User> => {
  const { data } = await client.patch<{ user: User }>('/users/profile', payload);
  return data.user;
};
