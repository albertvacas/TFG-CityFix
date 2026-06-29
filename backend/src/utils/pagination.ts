/**
 * Utilitat de paginació offset-based compartida per tots els endpoints de
 * llistat. Parseja `page` i `pageSize` dels query params, aplicant valors per
 * defecte i un sostre per evitar que un client demani milers de files de cop.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export const parsePagination = (
  query: { page?: unknown; pageSize?: unknown },
  defaultPageSize = DEFAULT_PAGE_SIZE,
): PageParams => {
  const rawPage = Number.parseInt(String(query.page ?? ''), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawSize = Number.parseInt(String(query.pageSize ?? ''), 10);
  const pageSize = Number.isFinite(rawSize) && rawSize > 0
    ? Math.min(rawSize, MAX_PAGE_SIZE)
    : defaultPageSize;

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

/** Indica si la petició ha sol·licitat explícitament paginació. */
export const hasPagination = (query: { page?: unknown }): boolean =>
  query.page !== undefined;
