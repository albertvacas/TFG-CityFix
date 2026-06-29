import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getReportsPaginated } from '../api/reports';
import { getTechnicians, getStudents } from '../api/users';
import ReportStatusBadge from '../components/ReportStatusBadge';
import PriorityBadge from '../components/PriorityBadge';
import Pagination from '../components/Pagination';
import { useLiveEvent } from '../hooks/liveEvents';
import type { Report, State, Technician, StudentSummary } from '../types';

const PAGE_SIZE = 20;

const stateOptions: { value: '' | State; labelKey: string }[] = [
  { value: '', labelKey: 'reports.allStates' },
  { value: 'OPEN', labelKey: 'states.OPEN' },
  { value: 'ASSIGNED', labelKey: 'states.ASSIGNED' },
  { value: 'IN_PROGRESS', labelKey: 'states.IN_PROGRESS' },
  { value: 'VALIDATED', labelKey: 'states.VALIDATED' },
  { value: 'CLOSED', labelKey: 'states.CLOSED' },
];

interface FilterState {
  q: string;
  state: '' | State;
  createdById: string;
  assignedToId: string;
  dateFrom: string;
  dateTo: string;
}

export default function ReportsListPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Llistes per als dropdowns
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [students, setStudents] = useState<StudentSummary[]>([]);

  // Llegim filtres dels query params (URL persistent)
  const filters = useMemo<FilterState>(() => ({
    q: searchParams.get('q') ?? '',
    state: (searchParams.get('state') as State | null) ?? '',
    createdById: searchParams.get('createdById') ?? '',
    assignedToId: searchParams.get('assignedToId') ?? '',
    dateFrom: searchParams.get('dateFrom') ?? '',
    dateTo: searchParams.get('dateTo') ?? '',
  }), [searchParams]);

  // Estat local per al cercador (debounced)
  const [searchInput, setSearchInput] = useState(filters.q);

  // Carrega tècnics i estudiants un sol cop per omplir els selectors
  useEffect(() => {
    Promise.all([getTechnicians().catch(() => []), getStudents().catch(() => [])])
      .then(([techs, studs]) => {
        setTechnicians(techs);
        setStudents(studs);
      });
  }, []);

  // Sincronitza el cercador amb els query params després de 300ms
  useEffect(() => {
    if (searchInput === filters.q) return;
    const t = setTimeout(() => updateFilter('q', searchInput), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Funció reutilitzable per refer la consulta amb els filtres actuals.
  // Útil tant per a la càrrega inicial com per a les actualitzacions en
  // temps real disparades per esdeveniments SSE.
  const refetch = useCallback(() => {
    getReportsPaginated(
      {
        q: filters.q || undefined,
        state: (filters.state as State) || undefined,
        createdById: filters.createdById || undefined,
        assignedToId: filters.assignedToId || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
      },
      page,
      PAGE_SIZE,
    )
      .then((res) => {
        setReports(res.items);
        setTotal(res.total);
      })
      .catch(() => {});
  }, [filters, page]);

  // Quan canvien els filtres, tornem a la primera pàgina.
  useEffect(() => {
    setPage(1);
  }, [filters]);

  // Fetch dels reports cada cop que canvien filtres o pàgina
  useEffect(() => {
    setLoading(true);
    refetch();
    setLoading(false);
  }, [refetch]);

  // Refresc en temps real quan el backend ens avisa d'esdeveniments rellevants.
  // No fem polling: només refresquem quan SABEM que ha canviat alguna cosa.
  useLiveEvent('report.created', refetch);
  useLiveEvent('report.transitioned', refetch);
  useLiveEvent('report.priority_changed', refetch);
  // Quan l'IA acaba de classificar un report nou, la categoria/prioritat
  // que es mostra a la llista pot haver canviat → tornem a carregar.
  useLiveEvent('report.classified', refetch);

  const updateFilter = (key: keyof FilterState, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const resetFilters = () => {
    setSearchInput('');
    setSearchParams({});
  };

  const activeFilterCount = (Object.values(filters).filter(Boolean) as string[]).length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('reports.title')}</h1>
        <span className="text-sm text-gray-500">
          {loading
            ? t('common.loading')
            : total === 1
            ? t('reports.resultOne', { count: total })
            : t('reports.resultMany', { count: total })}
        </span>
      </div>

      {/* Filtres + cercador */}
      <div className="mb-4 rounded-xl bg-white p-4 ring-1 ring-gray-200">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12">
          {/* Cercador */}
          <div className="lg:col-span-4">
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('reports.search')}</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </span>
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('reports.searchPlaceholder')}
                className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Estat */}
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('reports.status')}</label>
            <select
              value={filters.state}
              onChange={(e) => updateFilter('state', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {stateOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
              ))}
            </select>
          </div>

          {/* Creador */}
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('reports.creator')}</label>
            <select
              value={filters.createdById}
              onChange={(e) => updateFilter('createdById', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">{t('common.all')}</option>
              {students.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.name} {s.surname}
                </option>
              ))}
            </select>
          </div>

          {/* Assignat a */}
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('reports.assignedTo')}</label>
            <select
              value={filters.assignedToId}
              onChange={(e) => updateFilter('assignedToId', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">{t('common.all')}</option>
              {technicians.map((t) => (
                <option key={t.user_id} value={t.user_id}>
                  {t.name} {t.surname}
                </option>
              ))}
            </select>
          </div>

          {/* Data des de */}
          <div className="lg:col-span-1">
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('reports.from')}</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => updateFilter('dateFrom', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Data fins */}
          <div className="lg:col-span-1">
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('reports.to')}</label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => updateFilter('dateTo', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {activeFilterCount > 0 && (
          <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
            <span className="text-xs text-gray-500">
              {activeFilterCount === 1
                ? t('reports.activeFilterOne', { count: activeFilterCount })
                : t('reports.activeFilterMany', { count: activeFilterCount })}
            </span>
            <button
              onClick={resetFilters}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              {t('reports.clearFilters')}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-xl bg-white p-12 text-center ring-1 ring-gray-200">
          <p className="text-gray-500">{t('reports.noResults')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl ring-1 ring-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-600">{t('reports.colTitle')}</th>
                <th className="px-4 py-3 font-medium text-gray-600">{t('reports.status')}</th>
                <th className="px-4 py-3 font-medium text-gray-600">{t('reports.colPriority')}</th>
                <th className="px-4 py-3 font-medium text-gray-600">{t('reports.creator')}</th>
                <th className="px-4 py-3 font-medium text-gray-600">{t('reports.assignedTo')}</th>
                <th className="px-4 py-3 font-medium text-gray-600">{t('reports.colDate')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {reports.map((r) => (
                <tr
                  key={r.report_id}
                  onClick={() => navigate(`/reports/${r.report_id}`)}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{r.title}</div>
                    {r.aiSummary && (
                      <div className="mt-0.5 text-xs text-indigo-700">
                        <span className="truncate">{r.aiSummary}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3"><ReportStatusBadge state={r.state} /></td>
                  <td className="px-4 py-3"><PriorityBadge priority={r.priority} /></td>
                  <td className="px-4 py-3 text-gray-600">{r.createdBy.name}</td>
                  <td className="px-4 py-3 text-gray-600">{r.assignedTo?.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(r.createdAt).toLocaleDateString('ca-ES')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          label="incidents"
        />
      )}
    </div>
  );
}
