import type { State } from '../types';

const config: Record<State, { label: string; className: string }> = {
  OPEN: { label: 'Oberta', className: 'bg-blue-100 text-blue-800' },
  ASSIGNED: { label: 'Assignada', className: 'bg-yellow-100 text-yellow-800' },
  IN_PROGRESS: { label: 'En procés', className: 'bg-orange-100 text-orange-800' },
  VALIDATED: { label: 'Validada', className: 'bg-green-100 text-green-800' },
  CLOSED: { label: 'Tancada', className: 'bg-gray-100 text-gray-800' },
};

export default function ReportStatusBadge({ state }: { state: State }) {
  const { label, className } = config[state];
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}
