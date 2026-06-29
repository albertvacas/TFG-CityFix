import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getReportsPaginated, transitionReport } from '../api/reports';
import PriorityBadge from '../components/PriorityBadge';
import Pagination from '../components/Pagination';
import { useLiveEvent } from '../hooks/liveEvents';
import type { Report, IncidentEvent } from '../types';

const RELATIVE_DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 20;

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / RELATIVE_DAY_MS);
}

export default function ValidationsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchData = useCallback(() => {
    setLoading(true);
    getReportsPaginated({ state: 'VALIDATED' }, page, PAGE_SIZE)
      .then((res) => {
        // Si la pàgina ha quedat buida després d'una acció, retrocedeix.
        if (res.items.length === 0 && page > 1) {
          setPage((p) => p - 1);
          return;
        }
        setReports(res.items);
        setTotal(res.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Sincronització en viu entre admins: si un altre administrador resol, tanca
  // o rebutja una incidència (o el tècnic en marca una de nova com a resolta),
  // la llista de validacions pendents s'actualitza sense recarregar.
  useLiveEvent('report.transitioned', fetchData);
  useLiveEvent('report.classified', fetchData);

  const handleAction = async (reportId: string, event: IncidentEvent) => {
    if (!confirm(event === 'CLOSE' ? t('validations.confirmClose') : t('validations.confirmReject'))) return;
    setError('');
    setActing(reportId + ':' + event);
    try {
      await transitionReport(reportId, event);
      fetchData();
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError(`Error en l'acció ${event}.`);
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('validations.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('validations.subtitle')}
          </p>
        </div>
        <span className="rounded-full bg-purple-100 px-3 py-1 text-sm font-semibold text-purple-800">
          {total === 1
            ? t('validations.pendingOne', { count: total })
            : t('validations.pendingMany', { count: total })}
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {reports.length === 0 ? (
        <div className="rounded-xl bg-white p-12 text-center ring-1 ring-gray-200">
          <svg className="mx-auto mb-3 h-12 w-12 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <p className="font-medium text-gray-700">{t('validations.noPendingTitle')}</p>
          <p className="mt-1 text-sm text-gray-500">{t('validations.noPendingBody')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => {
            const days = daysAgo(r.lastModified);
            const isStale = days >= 7;
            return (
              <div key={r.report_id} className="rounded-xl bg-white ring-1 ring-gray-200">
                <div className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{r.title}</h3>
                      <PriorityBadge priority={r.priority} />
                      {r.category && (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                          {t(`categories.${r.category}`)}
                        </span>
                      )}
                      {isStale && (
                        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 6v6l4 2" />
                          </svg>
                          {t('validations.daysAgo', { count: days })}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-gray-600">{r.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span>
                        {t('validations.reportedBy')} <span className="font-medium text-gray-700">{r.createdBy.name}</span>
                      </span>
                      <span>·</span>
                      <span>
                        {t('validations.resolvedBy')}{' '}
                        <span className="font-medium text-gray-700">
                          {r.assignedTo ? r.assignedTo.name : '—'}
                        </span>
                      </span>
                      <span>·</span>
                      <span>
                        {days === 0
                          ? t('validations.validatedToday')
                          : days === 1
                          ? t('validations.validatedDaysAgoOne', { count: days })
                          : t('validations.validatedDaysAgoMany', { count: days })}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button
                      onClick={() => navigate(`/reports/${r.report_id}`)}
                      className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-200"
                    >
                      {t('validations.seeDetail')}
                    </button>
                    <button
                      onClick={() => handleAction(r.report_id, 'CLOSE')}
                      disabled={acting === r.report_id + ':CLOSE'}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {acting === r.report_id + ':CLOSE' ? '...' : t('validations.closeDefinitely')}
                    </button>
                    <button
                      onClick={() => handleAction(r.report_id, 'REJECT')}
                      disabled={acting === r.report_id + ':REJECT'}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                    >
                      {acting === r.report_id + ':REJECT' ? '...' : t('validations.rejectResolution')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        label="validations"
      />
    </div>
  );
}
