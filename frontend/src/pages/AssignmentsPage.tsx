import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getReports, transitionReport } from '../api/reports';
import { getTechnicians } from '../api/users';
import PriorityBadge from '../components/PriorityBadge';
import TechnicianAssignmentList from '../components/TechnicianAssignmentList';
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

  const fetchData = () => {
    setLoading(true);
    Promise.all([getReports({ state: 'OPEN' }), getTechnicians()])
      .then(([rs, ts]) => {
        setReports(rs);
        setTechnicians(ts);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

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
        <span className="rounded-full bg-yellow-100 px-3 py-1 text-sm font-semibold text-yellow-800">
          {totalPending} {totalPending === 1 ? 'pendent' : 'pendents'}
        </span>
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
          {reports.map((r) => {
            const expanded = expandedId === r.report_id;
            // Quan estem assignant un tècnic, extraiem el techId si correspon a aquest report
            const assigningTechIdForThis =
              assigningKey?.startsWith(r.report_id + ':')
                ? assigningKey.slice(r.report_id.length + 1)
                : null;
            return (
              <div key={r.report_id} className="rounded-xl bg-white ring-1 ring-gray-200">
                {/* Capçalera del report */}
                <div className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{r.title}</h3>
                      <PriorityBadge priority={r.priority} />
                      {r.category && (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                          {CATEGORY_LABELS[r.category]}
                        </span>
                      )}
                    </div>
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
    </div>
  );
}
