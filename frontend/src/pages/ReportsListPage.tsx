import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getReports } from '../api/reports';
import ReportStatusBadge from '../components/ReportStatusBadge';
import PriorityBadge from '../components/PriorityBadge';
import type { Report, State } from '../types';

const stateOptions: { value: '' | State; label: string }[] = [
  { value: '', label: 'Tots els estats' },
  { value: 'OPEN', label: 'Obertes' },
  { value: 'ASSIGNED', label: 'Assignades' },
  { value: 'IN_PROGRESS', label: 'En procés' },
  { value: 'VALIDATED', label: 'Validades' },
  { value: 'CLOSED', label: 'Tancades' },
];

export default function ReportsListPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const stateFilter = (searchParams.get('state') as State) || undefined;

  useEffect(() => {
    setLoading(true);
    getReports(stateFilter)
      .then(setReports)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [stateFilter]);

  const handleFilterChange = (value: string) => {
    if (value) {
      setSearchParams({ state: value });
    } else {
      setSearchParams({});
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Incidències</h1>
        <select
          value={stateFilter || ''}
          onChange={(e) => handleFilterChange(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {stateOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
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
                <th className="px-4 py-3 font-medium text-gray-600">Títol</th>
                <th className="px-4 py-3 font-medium text-gray-600">Estat</th>
                <th className="px-4 py-3 font-medium text-gray-600">Prioritat</th>
                <th className="px-4 py-3 font-medium text-gray-600">Creador</th>
                <th className="px-4 py-3 font-medium text-gray-600">Assignat a</th>
                <th className="px-4 py-3 font-medium text-gray-600">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {reports.map((r) => (
                <tr
                  key={r.report_id}
                  onClick={() => navigate(`/reports/${r.report_id}`)}
                  className="cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{r.title}</td>
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
    </div>
  );
}
