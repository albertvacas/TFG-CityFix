import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getReports,
  transitionReport,
  autoAssignReports,
  type AutoAssignResult,
} from '../api/reports';
import { getTechnicians } from '../api/users';
import PriorityBadge from '../components/PriorityBadge';
import TechnicianAssignmentList from '../components/TechnicianAssignmentList';
import { useLiveEvent } from '../hooks/liveEvents';
import type { Report, Technician } from '../types';
import { CATEGORY_LABELS } from '../types';

export default function AssignmentsPage() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Clau d'assignació en curs: <reportId>:<techId>
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Selecció múltiple per a l'auto-assignació en lot. Tots els reports
  // d'aquesta pàgina són OPEN (filtrat per la query), així que qualsevol
  // és seleccionable.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoAssignResult, setAutoAssignResult] = useState<AutoAssignResult | null>(null);

  const fetchData = useCallback(() => {
    Promise.all([getReports({ state: 'OPEN' }), getTechnicians()])
      .then(([rs, ts]) => {
        setReports(rs);
        setTechnicians(ts);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData();
    setLoading(false);
  }, [fetchData]);

  // Refresc en viu: aquesta pantalla es manté sincronitzada amb els
  // esdeveniments del backend (noves incidències, classificacions o
  // transicions fetes des d'un altre admin).
  useLiveEvent('report.created', fetchData);
  useLiveEvent('report.transitioned', fetchData);
  useLiveEvent('report.classified', fetchData);

  // Si la llista canvia, neteja les seleccions que ja no apareixen perquè
  // no enviem ids fantasma al backend.
  const visibleIds = useMemo(() => reports.map((r) => r.report_id), [reports]);
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>();
      const visible = new Set(visibleIds);
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next;
    });
  }, [visibleIds]);

  const handleAssign = async (reportId: string, techId: string) => {
    setError('');
    setAssigningKey(reportId + ':' + techId);
    try {
      await transitionReport(reportId, 'ASSIGN', techId);
      fetchData();
      setExpandedId(null);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError('Error assignant la incidència.');
    } finally {
      setAssigningKey(null);
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(visibleIds));
  };

  const runAutoAssign = async () => {
    if (selectedIds.size === 0) return;
    setAutoAssigning(true);
    try {
      const result = await autoAssignReports([...selectedIds]);
      setAutoAssignResult(result);
      setSelectedIds(new Set());
      // El backend emet SSE `report.transitioned` per cada assignació, així
      // que la llista es refrescarà sola via useLiveEvent.
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

  const totalPending = reports.length;

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
          <h1 className="text-2xl font-bold text-gray-900">Assignacions pendents</h1>
          <p className="mt-1 text-sm text-gray-500">
            Incidències obertes esperant que un tècnic les agafi.
            {technicians.length > 0 &&
              ` ${technicians.length} ${technicians.length === 1 ? 'tècnic disponible' : 'tècnics disponibles'}.`}
          </p>
        </div>
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
                <>Auto-assignar ({selectedIds.size})</>
              )}
            </button>
          )}
          <span className="rounded-full bg-yellow-100 px-3 py-1 text-sm font-semibold text-yellow-800">
            {totalPending} {totalPending === 1 ? 'pendent' : 'pendents'}
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {totalPending === 0 ? (
        <div className="rounded-xl bg-white p-12 text-center ring-1 ring-gray-200">
          <svg className="mx-auto mb-3 h-12 w-12 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <p className="font-medium text-gray-700">No hi ha incidències pendents d'assignar</p>
          <p className="mt-1 text-sm text-gray-500">
            Totes les incidències obertes han estat assignades.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Barra de selecció massiva */}
          <div className="flex items-center gap-2 px-1 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>
              {selectedIds.size === 0
                ? 'Seleccionar totes per a l\'auto-assignació'
                : `${selectedIds.size} seleccionades`}
            </span>
          </div>

          {reports.map((r) => {
            const expanded = expandedId === r.report_id;
            const isSelected = selectedIds.has(r.report_id);
            // Quan estem assignant un tècnic, extraiem el techId si correspon a aquest report
            const assigningTechIdForThis =
              assigningKey?.startsWith(r.report_id + ':')
                ? assigningKey.slice(r.report_id.length + 1)
                : null;
            return (
              <div
                key={r.report_id}
                className={`rounded-xl bg-white ring-1 transition-colors ${
                  isSelected ? 'ring-2 ring-indigo-400' : 'ring-gray-200'
                }`}
              >
                {/* Capçalera del report */}
                <div className="flex items-start gap-3 p-4">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelection(r.report_id)}
                    title="Seleccionar per a auto-assignació"
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{r.title}</h3>
                      <PriorityBadge priority={r.priority} />
                      {r.category && (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                          {CATEGORY_LABELS[r.category]}
                        </span>
                      )}
                      {r.aiClassifiedAt && (
                        <span
                          className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200"
                          title="Categoria i prioritat establertes per l'IA"
                        >
                          IA
                        </span>
                      )}
                    </div>
                    {r.aiSummary && (
                      <p className="mt-1 text-xs text-indigo-700">{r.aiSummary}</p>
                    )}
                    <p className="mt-1 line-clamp-2 text-sm text-gray-600">{r.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span>
                        Reportat per <span className="font-medium text-gray-700">{r.createdBy.name}</span>
                      </span>
                      <span>·</span>
                      <span>{new Date(r.createdAt).toLocaleDateString('ca-ES')}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button
                      onClick={() => navigate(`/reports/${r.report_id}`)}
                      className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-200"
                    >
                      Veure detall
                    </button>
                    <button
                      onClick={() => setExpandedId(expanded ? null : r.report_id)}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
                    >
                      {expanded ? 'Amagar tècnics' : 'Assignar'}
                    </button>
                  </div>
                </div>

                {/* Llistat de tècnics */}
                {expanded && (
                  <div className="border-t border-gray-100 bg-gray-50 p-4">
                    <TechnicianAssignmentList
                      technicians={technicians}
                      category={r.category}
                      onAssign={(techId) => handleAssign(r.report_id, techId)}
                      assigningTechId={assigningTechIdForThis}
                    />
                  </div>
                )}
              </div>
            );
          })}
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
