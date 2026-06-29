import client from './client';
import type { UserSearchResult } from '../types';

export interface UserSearchPage {
  users: UserSearchResult[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Cerca d'usuaris (STUDENT/TECHNICAL) per nom, cognoms o nickname.
 * Accessible per a qualsevol usuari autenticat. Paginada (offset-based).
 */
export const searchUsers = async (q: string, page = 1, pageSize = 20): Promise<UserSearchPage> => {
  const { data } = await client.get<UserSearchPage>('/users/search', {
    params: { q, page, pageSize },
  });
  return data;
};
