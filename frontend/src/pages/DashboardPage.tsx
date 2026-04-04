import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getReports } from '../api/reports';
import type { Report, State } from '../types';

const stateConfig: Record<State, { label: string; color: string; bg: string }> = {
  OPEN: { label: 'Obertes', color: 'text-blue-700', bg: 'bg-blue-50 ring-blue-200' },
  ASSIGNED: { label: 'Assignades', color: 'text-yellow-700', bg: 'bg-yellow-50 ring-yellow-200' },
  IN_PROGRESS: { label: 'En procés', color: 'text-orange-700', bg: 'bg-orange-50 ring-orange-200' },
  VALIDATED: { label: 'Validades', color: 'text-green-700', bg: 'bg-green-50 ring-green-200' },
  CLOSED: { label: 'Tancades', color: 'text-gray-700', bg: 'bg-gray-50 ring-gray-200' },
};

export default function DashboardPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getReports()
      .then(setReports)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const counts: Record<State, number> = {
    OPEN: 0,
    ASSIGNED: 0,
    IN_PROGRESS: 0,
    VALIDATED: 0,
    CLOSED: 0,
  };
  for (const r of reports) {
    counts[r.state]++;
  }

  const recentReports = reports.slice(0, 5);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Stats cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {(Object.keys(stateConfig) as State[]).map((state) => (
          <button
            key={state}
            onClick={() => navigate(`/reports?state=${state}`)}
            className={`rounded-xl p-5 text-left ring-1 transition-shadow hover:shadow-md ${stateConfig[state].bg}`}
          >
            <p className="text-sm font-medium text-gray-600">{stateConfig[state].label}</p>
            <p className={`mt-1 text-3xl font-bold ${stateConfig[state].color}`}>{counts[state]}</p>
          </button>
        ))}
      </div>

      {/* Total */}
      <div className="mb-8 rounded-xl bg-indigo-50 p-5 ring-1 ring-indigo-200">
        <p className="text-sm font-medium text-gray-600">Total incidències</p>
        <p className="mt-1 text-3xl font-bold text-indigo-700">{reports.length}</p>
      </div>

      {/* Recent reports */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Incidències recents</h2>
        {recentReports.length === 0 ? (
          <p className="text-gray-500">No hi ha incidències registrades.</p>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium text-gray-600">Títol</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Estat</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Creador</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {recentReports.map((r) => (
                  <tr
                    key={r.report_id}
                    onClick={() => navigate(`/reports/${r.report_id}`)}
                    className="cursor-pointer transition-colors hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{r.title}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${stateConfig[r.state].bg} ${stateConfig[r.state].color}`}>
                        {stateConfig[r.state].label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.createdBy.name}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(r.createdAt).toLocaleDateString('ca-ES')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
