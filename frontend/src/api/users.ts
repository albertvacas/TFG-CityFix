import client from './client';
import type { User, Technician, StudentSummary } from '../types';

export const getTechnicians = async (): Promise<Technician[]> => {
  const { data } = await client.get<{ technicians: Technician[] }>('/users/technicians');
  return data.technicians;
};

export const getStudents = async (): Promise<StudentSummary[]> => {
  const { data } = await client.get<{ students: StudentSummary[] }>('/users/students');
  return data.students;
};

export const getPrivilegedUsers = async (): Promise<User[]> => {
  const { data } = await client.get<{ users: User[] }>('/users/privileged');
  return data.users;
};

export const revokeUser = async (userId: string): Promise<User> => {
  const { data } = await client.patch<{ user: User }>(`/users/${userId}/revoke`);
  return data.user;
};
