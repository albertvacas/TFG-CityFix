import type { Priority } from '../types';

const config: Record<Priority, { label: string; className: string }> = {
  LOW: { label: 'Baixa', className: 'bg-gray-100 text-gray-700' },
  MEDIUM: { label: 'Mitjana', className: 'bg-blue-100 text-blue-700' },
  HIGH: { label: 'Alta', className: 'bg-orange-100 text-orange-700' },
  CRITICAL: { label: 'Crítica', className: 'bg-red-100 text-red-700' },
};

export default function PriorityBadge({ priority }: { priority: Priority }) {
  const { label, className } = config[priority];
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}
