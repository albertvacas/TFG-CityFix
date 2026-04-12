import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getReportById, transitionReport } from '../api/reports';
import { getTechnicians } from '../api/users';
import ReportStatusBadge from '../components/ReportStatusBadge';
import PriorityBadge from '../components/PriorityBadge';
import type { Report, User, IncidentEvent } from '../types';
import { STATE_TRANSITIONS, CATEGORY_LABELS } from '../types';

const eventLabels: Record<IncidentEvent, { label: string; className: string }> = {
  ASSIGN: { label: 'Assignar', className: 'bg-yellow-600 hover:bg-yellow-700' },
  START: { label: 'Iniciar', className: 'bg-orange-600 hover:bg-orange-700' },
  REASSIGN: { label: 'Reassignar', className: 'bg-gray-600 hover:bg-gray-700' },
  RESOLVE: { label: 'Resoldre', className: 'bg-green-600 hover:bg-green-700' },
  CLOSE: { label: 'Tancar', className: 'bg-indigo-600 hover:bg-indigo-700' },
  REJECT: { label: 'Rebutjar', className: 'bg-red-600 hover:bg-red-700' },
};

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [technicians, setTechnicians] = useState<User[]>([]);
  const [selectedTechId, setSelectedTechId] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.all([getReportById(id), getTechnicians()])
      .then(([r, t]) => {
        setReport(r);
        setTechnicians(t);
      })
      .catch(() => navigate('/reports'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const handleTransition = async (event: IncidentEvent) => {
    if (!report) return;
    if (event === 'ASSIGN' && !selectedTechId) {
      setError('Selecciona un tècnic per assignar la incidència.');
      return;
    }
    setError('');
    setActionLoading(true);
    try {
      const updated = await transitionReport(
        report.report_id,
        event,
        event === 'ASSIGN' ? selectedTechId : undefined,
      );
      setReport(updated);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError('Error en la transició.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading || !report) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  const availableEvents = STATE_TRANSITIONS[report.state];

  return (
    <div>
      {/* Header */}
      <button
        onClick={() => navigate('/reports')}
        className="mb-4 text-sm text-indigo-600 hover:text-indigo-800"
      >
        &larr; Tornar a incidències
      </button>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{report.title}</h1>
          <div className="mt-2 flex items-center gap-3">
            <ReportStatusBadge state={report.state} />
            <PriorityBadge priority={report.priority} />
            {report.category && (
              <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700">
                {CATEGORY_LABELS[report.category]}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <div className="rounded-xl bg-white p-6 ring-1 ring-gray-200">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Descripció</h2>
            <p className="text-gray-800 whitespace-pre-wrap">{report.description}</p>
          </div>

          {/* Images */}
          {report.images.length > 0 && (
            <div className="rounded-xl bg-white p-6 ring-1 ring-gray-200">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Imatges</h2>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {report.images.map((img) => (
                  <img
                    key={img.id}
                    src={img.url}
                    alt={img.type}
                    className="h-40 w-full rounded-lg object-cover"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          {report.comments.length > 0 && (
            <div className="rounded-xl bg-white p-6 ring-1 ring-gray-200">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Comentaris</h2>
              <div className="space-y-3">
                {report.comments.map((c) => (
                  <div key={c.id} className="rounded-lg bg-gray-50 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">{c.author.name}</span>
                      <span className="text-xs text-gray-500">
                        {new Date(c.createdAt).toLocaleString('ca-ES')}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700">{c.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Details */}
          <div className="rounded-xl bg-white p-6 ring-1 ring-gray-200">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Detalls</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-500">Creat per</dt>
                <dd className="font-medium text-gray-900">{report.createdBy.name} (@{report.createdBy.nickname})</dd>
              </div>
              <div>
                <dt className="text-gray-500">Assignat a</dt>
                <dd className="font-medium text-gray-900">
                  {report.assignedTo ? `${report.assignedTo.name} (@${report.assignedTo.nickname})` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Coordenades</dt>
                <dd className="font-medium text-gray-900">
                  {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Data de creació</dt>
                <dd className="font-medium text-gray-900">
                  {new Date(report.createdAt).toLocaleString('ca-ES')}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Última modificació</dt>
                <dd className="font-medium text-gray-900">
                  {new Date(report.lastModified).toLocaleString('ca-ES')}
                </dd>
              </div>
            </dl>
          </div>

          {/* Actions */}
          {availableEvents.length > 0 && (
            <div className="rounded-xl bg-white p-6 ring-1 ring-gray-200">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Accions</h2>

              {error && (
                <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
              )}

              {/* Technician selector for ASSIGN */}
              {report.state === 'OPEN' && (
                <div className="mb-3">
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Seleccionar tècnic
                  </label>
                  <select
                    value={selectedTechId}
                    onChange={(e) => setSelectedTechId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">— Escull un tècnic —</option>
                    {technicians.map((t) => (
                      <option key={t.user_id} value={t.user_id}>
                        {t.name} {t.surname} (@{t.nickname})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {availableEvents.map((event) => (
                  <button
                    key={event}
                    onClick={() => handleTransition(event)}
                    disabled={actionLoading}
                    className={`w-full rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${eventLabels[event].className}`}
                  >
                    {actionLoading ? '...' : eventLabels[event].label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
