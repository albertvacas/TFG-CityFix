import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getReportById, transitionReport, updateReportPriority } from '../api/reports';
import { getTechnicians, getTechnicianDetails } from '../api/users';
import ReportStatusBadge from '../components/ReportStatusBadge';
import PriorityBadge from '../components/PriorityBadge';
import ImageLightbox from '../components/ImageLightbox';
import TechnicianAssignmentList from '../components/TechnicianAssignmentList';
import { useLiveEvent } from '../hooks/liveEvents';
import type { Report, Technician, TechnicianDetails, IncidentEvent, Priority } from '../types';
import { STATE_TRANSITIONS } from '../types';

const PRIORITY_OPTIONS: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

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
  const { t } = useTranslation();
  const [report, setReport] = useState<Report | null>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [assigningTechId, setAssigningTechId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  // Modal d'una transició que requereix (o accepta) un comentari + tècnic.
  // Emprat per a:
  //   - REJECT: comentari obligatori (motiu del rebuig)
  //   - REASSIGN des d'IN_PROGRESS: tècnic obligatori + comentari opcional
  const [transitionModal, setTransitionModal] = useState<IncidentEvent | null>(null);
  const [modalComment, setModalComment] = useState('');
  const [modalTechId, setModalTechId] = useState<string>('');
  const [priorityLoading, setPriorityLoading] = useState(false);
  // Accordió "Assignat a": carrega lazy el detall del tècnic la primera vegada
  // que s'obre i el cachegem aquí per no fer crides repetides.
  const [techDetailsOpen, setTechDetailsOpen] = useState(false);
  const [techDetails, setTechDetails] = useState<TechnicianDetails | null>(null);
  const [techDetailsLoading, setTechDetailsLoading] = useState(false);
  const [techDetailsError, setTechDetailsError] = useState('');

  // Recàrrega només del report (sense tornar a fer servir endpoints
  // pesants). Útil per refrescar quan arriba un esdeveniment SSE referit
  // a aquesta mateixa incidència.
  const refetchReport = useCallback(() => {
    if (!id) return;
    getReportById(id)
      .then(setReport)
      .catch(() => {});
  }, [id]);

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

  // Si arriba un esdeveniment del MATEIX report (un altre admin l'ha tocat,
  // un tècnic ha resolt, etc.), refresquem la vista perquè no es desincronitzi.
  // Filtrem per reportId per no fer crides innecessàries quan l'esdeveniment
  // és d'una incidència diferent.
  useLiveEvent('report.transitioned', (e) => {
    if (e.reportId === id) refetchReport();
  });
  useLiveEvent('report.priority_changed', (e) => {
    if (e.reportId === id) refetchReport();
  });
  useLiveEvent('report.comment_added', (e) => {
    if (e.reportId === id) refetchReport();
  });
  useLiveEvent('report.classified', (e) => {
    if (e.reportId === id) refetchReport();
  });

  const handleTransition = async (event: IncidentEvent) => {
    if (!report) return;

    // REJECT: comentari obligatori amb el motiu del rebuig.
    // REASSIGN des d'IN_PROGRESS: cal triar un nou tècnic. Des d'ASSIGNED es
    // manté el comportament actual (torna a OPEN sense modal).
    if (event === 'REJECT' || (event === 'REASSIGN' && report.state === 'IN_PROGRESS')) {
      setModalComment('');
      setModalTechId('');
      setTransitionModal(event);
      return;
    }

    setError('');
    setActionLoading(true);
    try {
      const updated = await transitionReport(report.report_id, event);
      setReport(updated);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError('Error en la transició.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAssignTechnician = async (techId: string) => {
    if (!report) return;
    setError('');
    setAssigningTechId(techId);
    try {
      const updated = await transitionReport(report.report_id, 'ASSIGN', techId);
      setReport(updated);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError('Error assignant la incidència.');
    } finally {
      setAssigningTechId(null);
    }
  };

  // Si canvia el tècnic assignat (per ASSIGN, REASSIGN o pèrdua d'assignació),
  // invalidem el detall cachegat per no mostrar dades del tècnic anterior.
  useEffect(() => {
    setTechDetails(null);
    setTechDetailsOpen(false);
    setTechDetailsError('');
  }, [report?.assignedTo?.user_id]);

  const toggleTechDetails = async () => {
    if (!report?.assignedTo) return;
    const nextOpen = !techDetailsOpen;
    setTechDetailsOpen(nextOpen);
    if (nextOpen && !techDetails && !techDetailsLoading) {
      setTechDetailsLoading(true);
      setTechDetailsError('');
      try {
        const d = await getTechnicianDetails(report.assignedTo.user_id);
        setTechDetails(d);
      } catch (err: unknown) {
        setTechDetailsError(err instanceof Error ? err.message : 'Error carregant el tècnic.');
      } finally {
        setTechDetailsLoading(false);
      }
    }
  };

  const handlePriorityChange = async (next: Priority) => {
    if (!report || next === report.priority) return;
    setError('');
    setPriorityLoading(true);
    try {
      const updated = await updateReportPriority(report.report_id, next);
      setReport(updated);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError('Error actualitzant la prioritat.');
    } finally {
      setPriorityLoading(false);
    }
  };

  const closeTransitionModal = () => {
    setTransitionModal(null);
    setModalComment('');
    setModalTechId('');
  };

  const submitTransitionModal = async () => {
    if (!report || !transitionModal) return;

    const trimmed = modalComment.trim();
    if (transitionModal === 'REJECT' && !trimmed) {
      setError('Cal indicar el motiu del rebuig.');
      return;
    }
    if (transitionModal === 'REASSIGN' && !modalTechId) {
      setError('Cal seleccionar un nou tècnic per reassignar la incidència.');
      return;
    }

    setError('');
    setActionLoading(true);
    try {
      const updated = await transitionReport(
        report.report_id,
        transitionModal,
        transitionModal === 'REASSIGN' ? modalTechId : undefined,
        trimmed || undefined,
      );
      setReport(updated);
      closeTransitionModal();
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
                {t(`categories.${report.category}`)}
              </span>
            )}
            {report.aiClassifiedAt && (
              <span
                className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200"
                title={`Classificat per IA el ${new Date(report.aiClassifiedAt).toLocaleString()}`}
              >
                Classificat per IA
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
            {report.aiSummary && (
              <div className="mb-4 rounded-lg bg-indigo-50 px-4 py-3 ring-1 ring-indigo-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                  Resum IA
                </p>
                <p className="mt-1 text-sm text-indigo-900">{report.aiSummary}</p>
              </div>
            )}
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Descripció</h2>
            <p className="text-gray-800 whitespace-pre-wrap">{report.description}</p>
          </div>

          {/* Images */}
          {(report.images?.length ?? 0) > 0 && (
            <div className="rounded-xl bg-white p-6 ring-1 ring-gray-200">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Imatges</h2>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {report.images?.map((img, i) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setLightboxIdx(i)}
                    className="group relative overflow-hidden rounded-lg ring-1 ring-gray-200 transition-shadow hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <img
                      src={img.url}
                      alt={img.type}
                      className="h-40 w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    />
                    {/* Etiqueta de tipus a la cantonada superior */}
                    <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      {img.type === 'INITIAL' ? 'Inicial' : img.type === 'RESOLUTION' ? 'Resolució' : 'Progrés'}
                    </span>
                    {/* Hint d'expansió que apareix amb hover */}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                      </svg>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          {(report.comments?.length ?? 0) > 0 && (
            <div className="rounded-xl bg-white p-6 ring-1 ring-gray-200">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Comentaris</h2>
              <div className="space-y-3">
                {report.comments?.map((c) => (
                  <div key={c.id} className="rounded-lg bg-gray-50 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">
                        {c.author?.name ?? 'Usuari'}
                      </span>
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
          {/* Priority — editable per ADMIN. La incidència es crea amb MEDIUM
              per defecte; aquest selector és la palanca per ajustar-ho quan
              l'admin revisa la incidència acabada d'arribar. */}
          <div className="rounded-xl bg-white p-6 ring-1 ring-gray-200">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Prioritat
            </h2>
            <div className="flex items-center gap-3">
              <PriorityBadge priority={report.priority} />
              <select
                value={report.priority}
                onChange={(e) => handlePriorityChange(e.target.value as Priority)}
                disabled={priorityLoading}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {t(`priorities.${p}`)}
                  </option>
                ))}
              </select>
            </div>
            {priorityLoading && (
              <p className="mt-2 text-xs text-gray-500">Actualitzant…</p>
            )}
          </div>

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
                  {report.assignedTo ? (
                    <>
                      <button
                        type="button"
                        onClick={toggleTechDetails}
                        className="flex w-full items-center justify-between gap-2 rounded-md text-left hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        aria-expanded={techDetailsOpen}
                      >
                        <span>{report.assignedTo.name} (@{report.assignedTo.nickname})</span>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`transition-transform ${techDetailsOpen ? 'rotate-180' : ''}`}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {techDetailsOpen && (
                        <div className="mt-3 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
                          {techDetailsLoading && (
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <span className="h-3 w-3 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                              Carregant detalls…
                            </div>
                          )}
                          {techDetailsError && !techDetailsLoading && (
                            <p className="text-xs text-red-600">{techDetailsError}</p>
                          )}
                          {techDetails && !techDetailsLoading && (
                            <dl className="space-y-2 text-xs">
                              <div>
                                <dt className="text-gray-500">Empresa</dt>
                                <dd className="font-medium text-gray-900">{techDetails.company ?? '—'}</dd>
                              </div>
                              <div>
                                <dt className="text-gray-500">Lloc de treball</dt>
                                <dd className="font-medium text-gray-900">{techDetails.position ?? '—'}</dd>
                              </div>
                              <div>
                                <dt className="text-gray-500">Categoria</dt>
                                <dd>
                                  {techDetails.workCategory ? (
                                    <span className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
                                      {t(`categories.${techDetails.workCategory}`)}
                                    </span>
                                  ) : (
                                    <span className="font-medium text-gray-900">—</span>
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-gray-500">Email</dt>
                                <dd className="font-medium text-gray-900 break-all">
                                  <a href={`mailto:${techDetails.email}`} className="hover:text-indigo-700">
                                    {techDetails.email}
                                  </a>
                                </dd>
                              </div>
                              <div>
                                <dt className="text-gray-500">Alta al sistema</dt>
                                <dd className="font-medium text-gray-900">
                                  {new Date(techDetails.createdAt).toLocaleDateString('ca-ES')}
                                </dd>
                              </div>
                              <div className="pt-2 mt-2 border-t border-gray-200">
                                <dt className="mb-1.5 text-gray-500">Incidències</dt>
                                <dd className="grid grid-cols-2 gap-1.5 text-[11px]">
                                  <span className="rounded bg-yellow-50 px-2 py-1 text-yellow-800 ring-1 ring-yellow-200">
                                    Assignades: <span className="font-bold">{techDetails.stats.assigned}</span>
                                  </span>
                                  <span className="rounded bg-orange-50 px-2 py-1 text-orange-800 ring-1 ring-orange-200">
                                    En procés: <span className="font-bold">{techDetails.stats.inProgress}</span>
                                  </span>
                                  <span className="rounded bg-green-50 px-2 py-1 text-green-800 ring-1 ring-green-200">
                                    Validades: <span className="font-bold">{techDetails.stats.validated}</span>
                                  </span>
                                  <span className="rounded bg-gray-100 px-2 py-1 text-gray-700 ring-1 ring-gray-200">
                                    Tancades: <span className="font-bold">{techDetails.stats.closed}</span>
                                  </span>
                                  <span className="col-span-2 rounded bg-indigo-50 px-2 py-1 text-indigo-800 ring-1 ring-indigo-200 text-center">
                                    Total: <span className="font-bold">{techDetails.stats.total}</span>
                                  </span>
                                </dd>
                              </div>
                            </dl>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
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

              {/* Quan la incidència és OPEN, mostrem la mateixa llista que a la pàgina
                  d'Assignacions: tècnics recomanats (match de workCategory) i resta,
                  cada fila amb el seu botó "Assignar". */}
              {report.state === 'OPEN' ? (
                <TechnicianAssignmentList
                  technicians={technicians}
                  category={report.category}
                  onAssign={handleAssignTechnician}
                  assigningTechId={assigningTechId}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {availableEvents
                    .filter((event) => event !== 'ASSIGN')
                    .map((event) => (
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
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox d'imatges */}
      {lightboxIdx !== null && (report.images?.length ?? 0) > 0 && (
        <ImageLightbox
          images={(report.images ?? []).map((img) => ({ url: img.url, alt: img.type }))}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}

      {/* Modal de transició amb comentari/tècnic.
          - REJECT: comentari obligatori (motiu del rebuig).
          - REASSIGN des d'IN_PROGRESS: cal triar un nou tècnic + comentari opcional. */}
      {transitionModal && (
        <TransitionModal
          event={transitionModal}
          report={report}
          technicians={technicians}
          comment={modalComment}
          onCommentChange={setModalComment}
          techId={modalTechId}
          onTechChange={setModalTechId}
          loading={actionLoading}
          error={error}
          onCancel={closeTransitionModal}
          onConfirm={submitTransitionModal}
        />
      )}
    </div>
  );
}

interface TransitionModalProps {
  event: IncidentEvent;
  report: Report;
  technicians: Technician[];
  comment: string;
  onCommentChange: (v: string) => void;
  techId: string;
  onTechChange: (v: string) => void;
  loading: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}

function TransitionModal({
  event,
  report,
  technicians,
  comment,
  onCommentChange,
  techId,
  onTechChange,
  loading,
  error,
  onCancel,
  onConfirm,
}: TransitionModalProps) {
  const isReject = event === 'REJECT';
  const isReassign = event === 'REASSIGN';
  // Excloem el tècnic actualment assignat de la llista de reassignació; no té
  // sentit "reassignar" a la mateixa persona.
  const eligibleTechnicians = isReassign
    ? technicians.filter((t) => t.user_id !== report.assignedTo?.user_id)
    : technicians;

  const title = isReject ? 'Rebutjar incidència' : 'Reassignar incidència';
  const description = isReject
    ? 'Indica el motiu pel qual rebutges la resolució. L\'autor i el tècnic veuran aquest missatge al timeline.'
    : 'Tria un nou tècnic per continuar la incidència. Pots adjuntar un comentari per explicar el canvi.';
  const confirmLabel = isReject ? 'Rebutjar' : 'Reassignar';
  const confirmClass = isReject
    ? 'bg-red-600 hover:bg-red-700'
    : 'bg-gray-700 hover:bg-gray-800';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Tancar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
        )}

        {isReassign && (
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Nou tècnic
            </label>
            <select
              value={techId}
              onChange={(e) => onTechChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">— Selecciona un tècnic —</option>
              {eligibleTechnicians.map((t) => (
                <option key={t.user_id} value={t.user_id}>
                  {t.name} {t.surname} (@{t.nickname})
                  {t.workCategory === report.category ? ' · recomanat' : ''}
                </option>
              ))}
            </select>
            {report.assignedTo && (
              <p className="mt-1.5 text-xs text-gray-500">
                Actualment assignat a <span className="font-medium">{report.assignedTo.name}</span>{' '}
                (@{report.assignedTo.nickname}).
              </p>
            )}
          </div>
        )}

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            {isReject ? 'Motiu del rebuig' : 'Comentari (opcional)'}
            {isReject && <span className="ml-1 text-red-500">*</span>}
          </label>
          <textarea
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            rows={4}
            placeholder={
              isReject
                ? 'Ex: La fotografia no demostra que el problema estigui resolt…'
                : 'Ex: El tècnic original està de baixa, traspasso la feina a…'
            }
            className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-50"
          >
            Cancel·lar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 ${confirmClass}`}
          >
            {loading ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
