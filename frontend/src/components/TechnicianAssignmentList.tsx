import { useMemo } from 'react';
import type { Category, Technician } from '../types';
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
export function rankTechnicians(technicians: Technician[], category: Category | null): RankedTech[] {
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

interface Props {
  technicians: Technician[];
  category: Category | null;
  onAssign: (techId: string) => void;
  /** Tècnic que actualment està en procés d'assignació (loading state). */
  assigningTechId?: string | null;
}

export default function TechnicianAssignmentList({
  technicians,
  category,
  onAssign,
  assigningTechId,
}: Props) {
  const ranked = useMemo(() => rankTechnicians(technicians, category), [technicians, category]);
  const recommended = ranked.filter((t) => t.matchesCategory);
  const others = ranked.filter((t) => !t.matchesCategory);

  if (ranked.length === 0) {
    return <p className="text-center text-sm text-gray-500">No hi ha tècnics actius.</p>;
  }

  return (
    <div>
      {recommended.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 15.09 8.26 22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
            </svg>
            Recomanats
            {category && (
              <span className="ml-1 font-normal text-gray-500">
                ({CATEGORY_LABELS[category]})
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
                loading={assigningTechId === t.user_id}
              />
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
            {recommended.length > 0 ? 'Altres tècnics disponibles' : 'Tècnics disponibles'}
          </h4>
          <div className="space-y-2">
            {others.map((t) => (
              <TechnicianRow
                key={t.user_id}
                tech={t}
                recommended={false}
                onAssign={() => onAssign(t.user_id)}
                loading={assigningTechId === t.user_id}
              />
            ))}
          </div>
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
            <span className="font-semibold">{tech.workload}</span>{' '}
            {tech.workload === 1 ? 'tasca activa' : 'tasques actives'}
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
