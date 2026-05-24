import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getReports, autoAssignReports, type AutoAssignResult } from '../api/reports';
import { getTechnicians, getStudents } from '../api/users';
import ReportStatusBadge from '../components/ReportStatusBadge';
import PriorityBadge from '../components/PriorityBadge';
import { useLiveEvent } from '../hooks/liveEvents';
import type { Report, State, Technician, StudentSummary } from '../types';

const stateOptions: { value: '' | State; label: string }[] = [
  { value: '', label: 'Tots els estats' },
  { value: 'OPEN', label: 'Obertes' },
  { value: 'ASSIGNED', label: 'Assignades' },
  { value: 'IN_PROGRESS', label: 'En procés' },
  { value: 'VALIDATED', label: 'Validades' },
  { value: 'CLOSED', label: 'Tancades' },
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
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Llistes per als dropdowns
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [students, setStudents] = useState<StudentSummary[]>([]);

  // Selecció múltiple per a auto-assignació en lot. Només s'activa per als
  // reports OPEN — la resta no s'haurien d'auto-assignar (ja tenen tècnic
  // o estan en un estat no aplicable).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignResult, setAutoAssignResult] = useState<AutoAssignResult | null>(null);

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
    getReports({
      q: filters.q || undefined,
      state: (filters.state as State) || undefined,
      createdById: filters.createdById || undefined,
      assignedToId: filters.assignedToId || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
    })
      .then(setReports)
      .catch(() => {});
  }, [filters]);

  // Fetch dels reports cada cop que canvien filtres
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

  // ─── Selecció múltiple + auto-assignació ────────────────────────────────

  // Reports OPEN visibles ara mateix: només aquests es poden seleccionar.
  // Si l'admin canvia el filtre i un report seleccionat ja no és visible,
  // el deseleccionem implícitament filtrant per l'estat "encara visible i OPEN".
  const selectableIds = useMemo(
    () => reports.filter((r) => r.state === 'OPEN').map((r) => r.report_id),
    [reports],
  );

  // Si la llista canvia (filtres, refresh SSE), neteja les seleccions que ja
  // no apareixen — així no enviem ids fantasma al backend.
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>();
      const visible = new Set(selectableIds);
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next;
    });
  }, [selectableIds]);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(selectableIds));
  };

  const runAutoAssign = async () => {
    if (selectedIds.size === 0) return;
    setAutoAssigning(true);
    try {
      const result = await autoAssignReports([...selectedIds]);
      setAutoAssignResult(result);
      setSelectedIds(new Set());
      // El backend ja emet SSE `report.transitioned` per cada assignació, així
      // que la llista es refrescarà sola via useLiveEvent. No cal trucar refetch
      // explícitament.
    } catch (err: any) {
      setAutoAssignResult({
        assigned: [],
        skipped: [...selectedIds].map((reportId) => ({
          reportId,
          reason: err?.response?.data?.error ?? err?.message ?? 'Error desconegut',
        })),
      });
    } finally {
      setAutoAssigning(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Incidències</h1>
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={runAutoAssign}
              disabled={autoAssigning}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
            >
              {autoAssigning ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Assignant…
                </>
              ) : (
                <>
                  ✨ Auto-assignar ({selectedIds.size})
                </>
              )}
            </button>
          )}
          <span className="text-sm text-gray-500">
            {loading ? 'Carregant…' : `${reports.length} ${reports.length === 1 ? 'resultat' : 'resultats'}`}
          </span>
        </div>
      </div>

      {/* Filtres + cercador */}
      <div className="mb-4 rounded-xl bg-white p-4 ring-1 ring-gray-200">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-12">
          {/* Cercador */}
          <div className="lg:col-span-4">
            <label className="mb-1 block text-xs font-medium text-gray-600">Cerca</label>
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
                placeholder="Títol o descripció..."
                className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Estat */}
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">Estat</label>
            <select
              value={filters.state}
              onChange={(e) => updateFilter('state', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {stateOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Creador */}
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">Creador</label>
            <select
              value={filters.createdById}
              onChange={(e) => updateFilter('createdById', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">Tots</option>
              {students.map((s) => (
                <option key={s.user_id} value={s.user_id}>
                  {s.name} {s.surname}
                </option>
              ))}
            </select>
          </div>

          {/* Assignat a */}
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-600">Assignat a</label>
            <select
              value={filters.assignedToId}
              onChange={(e) => updateFilter('assignedToId', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">Tots</option>
              {technicians.map((t) => (
                <option key={t.user_id} value={t.user_id}>
                  {t.name} {t.surname}
                </option>
              ))}
            </select>
          </div>

          {/* Data des de */}
          <div className="lg:col-span-1">
            <label className="mb-1 block text-xs font-medium text-gray-600">Des de</label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => updateFilter('dateFrom', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Data fins */}
          <div className="lg:col-span-1">
            <label className="mb-1 block text-xs font-medium text-gray-600">Fins</label>
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
              {activeFilterCount} {activeFilterCount === 1 ? 'filtre actiu' : 'filtres actius'}
            </span>
            <button
              onClick={resetFilters}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              Netejar filtres
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
          <p className="text-gray-500">No s'han trobat incidències.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl ring-1 ring-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    disabled={selectableIds.length === 0}
                    title={
                      selectableIds.length === 0
                        ? 'No hi ha incidències OPEN per seleccionar'
                        : allSelected
                        ? 'Deseleccionar totes'
                        : 'Seleccionar totes les OPEN'
                    }
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">Títol</th>
                <th className="px-4 py-3 font-medium text-gray-600">Estat</th>
                <th className="px-4 py-3 font-medium text-gray-600">Prioritat</th>
                <th className="px-4 py-3 font-medium text-gray-600">Creador</th>
                <th className="px-4 py-3 font-medium text-gray-600">Assignat a</th>
                <th className="px-4 py-3 font-medium text-gray-600">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {reports.map((r) => {
                const isSelectable = r.state === 'OPEN';
                const isSelected = selectedIds.has(r.report_id);
                return (
                  <tr
                    key={r.report_id}
                    onClick={() => navigate(`/reports/${r.report_id}`)}
                    className="cursor-pointer transition-colors hover:bg-gray-50"
                  >
                    <td className="w-10 px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelection(r.report_id)}
                        disabled={!isSelectable}
                        title={
                          isSelectable
                            ? 'Seleccionar per a auto-assignació'
                            : "Només es poden auto-assignar incidències en estat OPEN"
                        }
                        className="h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{r.title}</div>
                      {r.aiSummary && (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-indigo-700">
                          <span className="text-indigo-400">✨</span>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de resultats després d'auto-assignar */}
      {autoAssignResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setAutoAssignResult(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-2xl ring-1 ring-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-gray-900">Resultat d'auto-assignació</h3>
            <p className="mt-1 text-sm text-gray-500">
              {autoAssignResult.assigned.length} assignades · {autoAssignResult.skipped.length} no assignades
            </p>

            {autoAssignResult.assigned.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Assignades</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {autoAssignResult.assigned.map((a) => (
                    <li key={a.reportId} className="rounded bg-green-50 px-3 py-1.5 text-green-900">
                      → {a.technicianName}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {autoAssignResult.skipped.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">No assignades</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {autoAssignResult.skipped.map((s) => (
                    <li key={s.reportId} className="rounded bg-amber-50 px-3 py-1.5 text-amber-900">
                      {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setAutoAssignResult(null)}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Tancar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
