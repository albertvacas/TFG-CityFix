import { useTranslation } from 'react-i18next';
import type { Priority } from '../types';

const config: Record<Priority, string> = {
  LOW: 'bg-gray-100 text-gray-700 dark:bg-slate-600/40 dark:text-slate-300',
  MEDIUM: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  HIGH: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  CRITICAL: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

export default function PriorityBadge({ priority }: { priority: Priority }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${config[priority]}`}>
      {t(`priorities.${priority}`)}
    </span>
  );
}
