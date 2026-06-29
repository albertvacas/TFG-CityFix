import { useTranslation } from 'react-i18next';
import type { State } from '../types';

const config: Record<State, string> = {
  OPEN: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  ASSIGNED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300',
  IN_PROGRESS: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300',
  VALIDATED: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
  CLOSED: 'bg-gray-100 text-gray-800 dark:bg-slate-600/40 dark:text-slate-300',
};

export default function ReportStatusBadge({ state }: { state: State }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${config[state]}`}>
      {t(`stateBadge.${state}`)}
    </span>
  );
}
