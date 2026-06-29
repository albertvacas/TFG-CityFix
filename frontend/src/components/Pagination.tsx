import { useTranslation } from 'react-i18next';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Clau del nom plural de l'element ("incidents", "users"…) dins de `pagination.*`. */
  label?: string;
}

/**
 * Controls de paginació numerada reutilitzables: resum "X–Y de Z" + botons
 * Anterior/Següent. No es renderitza si tot cap en una sola pàgina.
 */
export default function Pagination({ page, pageSize, total, onPageChange, label = 'results' }: PaginationProps) {
  const { t } = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const labelText = t(`pagination.${label}`, { defaultValue: label });

  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-sm">
      <span className="text-gray-500">
        {t('pagination.summary', { from, to, total, label: labelText })}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('pagination.previous')}
        </button>
        <span className="text-gray-600">
          {t('pagination.pageOf', { page, total: totalPages })}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg border border-gray-300 px-3 py-1.5 font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('pagination.next')}
        </button>
      </div>
    </div>
  );
}
