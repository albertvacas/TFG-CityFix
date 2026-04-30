import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getReports, transitionReport } from '../api/reports';
import { getTechnicians } from '../api/users';
import PriorityBadge from '../components/PriorityBadge';
import type { Report, Technician, Category } from '../types';
import { CATEGORY_LABELS } from '../types';

interface RankedTech extends Technician {
  matchesCategory: boolean;
  workload: number;
}

/**
 * Ordena els tècnics per recomanació:
 *  1. Match exacte de workCategory amb la categoria de la incidència (prioritari)
 *  2. Càrrega actual ascendent (menys feina = més disponible)
 *  3. Punts (gamificació) descendent com a desempat
 */
function rankTechnicians(technicians: Technician[], category: Category | null): RankedTech[] {
  return technicians
    .map((t) => ({
      ...t,
      matchesCategory: !!category && t.workCategory === category,
      workload: t._count?.reportsAssigned ?? 0,
    }))
    .sort((a, b) => {
      if (a.matchesCategory !== b.matchesCategory) return a.matchesCategory ? -1 : 1;
      if (a.workload !== b.workload) return a.workload - b.workload;
      return (b.points ?? 0) - (a.points ?? 0);
    });
}

export default function AssignmentsPage() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
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
    setAssigning(reportId + ':' + techId);
    try {
      await transitionReport(reportId, 'ASSIGN', techId);
      fetchData();
      setExpandedId(null);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError('Error assignant la incidència.');
    } finally {
      setAssigning(null);
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
            {technicians.length > 0 && ` ${technicians.length} ${technicians.length === 1 ? 'tècnic disponible' : 'tècnics disponibles'}.`}
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
          <p className="mt-1 text-sm text-gray-500">Totes les incidències obertes han estat assignades.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <ReportAssignmentCard
              key={r.report_id}
              report={r}
              technicians={technicians}
              expanded={expandedId === r.report_id}
              onToggle={() => setExpandedId(expandedId === r.report_id ? null : r.report_id)}
              onAssign={(techId) => handleAssign(r.report_id, techId)}
              onView={() => navigate(`/reports/${r.report_id}`)}
              assigningKey={assigning}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportAssignmentCard({
  report,
  technicians,
  expanded,
  onToggle,
  onAssign,
  onView,
  assigningKey,
}: {
  report: Report;
  technicians: Technician[];
  expanded: boolean;
  onToggle: () => void;
  onAssign: (techId: string) => void;
  onView: () => void;
  assigningKey: string | null;
}) {
  const ranked = useMemo(
    () => rankTechnicians(technicians, report.category),
    [technicians, report.category],
  );
  const recommended = ranked.filter((t) => t.matchesCategory);
  const others = ranked.filter((t) => !t.matchesCategory);

  return (
    <div className="rounded-xl bg-white ring-1 ring-gray-200">
      {/* Capçalera del report */}
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-gray-900">{report.title}</h3>
            <PriorityBadge priority={report.priority} />
            {report.category && (
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                {CATEGORY_LABELS[report.category]}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-gray-600">{report.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>Reportat per <span className="font-medium text-gray-700">{report.createdBy.name}</span></span>
            <span>·</span>
            <span>{new Date(report.createdAt).toLocaleDateString('ca-ES')}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <button
            onClick={onView}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-200"
          >
            Veure detall
          </button>
          <button
            onClick={onToggle}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            {expanded ? 'Amagar tècnics' : 'Assignar'}
          </button>
        </div>
      </div>

      {/* Llistat de tècnics */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-4">
          {ranked.length === 0 ? (
            <p className="text-center text-sm text-gray-500">No hi ha tècnics actius.</p>
          ) : (
            <>
              {recommended.length > 0 && (
                <div className="mb-4">
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
                    </svg>
                    Recomanats
                    {report.category && (
                      <span className="ml-1 font-normal text-gray-500">
                        ({CATEGORY_LABELS[report.category]})
                      </span>
                    )}
                  </h4>
                  <div className="space-y-2">
                    {recommended.map((t) => (
                      <TechnicianRow
                        key={t.user_id}
                        tech={t}
                        recommended
                        onAssign={() => onAssign(t.user_id)}
                        loading={assigningKey === report.report_id + ':' + t.user_id}
                      />
                    ))}
                  </div>
                </div>
              )}

              {others.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                    Altres tècnics disponibles
                  </h4>
                  <div className="space-y-2">
                    {others.map((t) => (
                      <TechnicianRow
                        key={t.user_id}
                        tech={t}
                        recommended={false}
                        onAssign={() => onAssign(t.user_id)}
                        loading={assigningKey === report.report_id + ':' + t.user_id}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TechnicianRow({
  tech,
  recommended,
  onAssign,
  loading,
}: {
  tech: RankedTech;
  recommended: boolean;
  onAssign: () => void;
  loading: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg bg-white p-3 ring-1 ${
        recommended ? 'ring-emerald-200' : 'ring-gray-200'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">
            {tech.name} {tech.surname}
          </span>
          <span className="text-xs text-gray-400">@{tech.nickname}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
          {tech.position && <span>{tech.position}</span>}
          {tech.position && tech.workCategory && <span>·</span>}
          {tech.workCategory && (
            <span className="rounded-full bg-purple-50 px-2 py-0.5 text-purple-700">
              {CATEGORY_LABELS[tech.workCategory]}
            </span>
          )}
          {tech.company && (
            <>
              <span>·</span>
              <span className="italic">{tech.company}</span>
            </>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs">
          <span className="text-gray-600">
            <span className="font-semibold">{tech.workload}</span> {tech.workload === 1 ? 'tasca activa' : 'tasques actives'}
          </span>
          <span className="text-gray-500">·</span>
          <span className="text-gray-600">
            <span className="font-semibold">{tech.points}</span> punts
          </span>
        </div>
      </div>
      <button
        onClick={onAssign}
        disabled={loading}
        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
          recommended ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'
        }`}
      >
        {loading ? '...' : 'Assignar'}
      </button>
    </div>
  );
}
