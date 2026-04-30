import type { Report, ReportCategory, ReportPriority, ReportState } from '../types';
import type { Ionicons } from '@expo/vector-icons';

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  LIGHTING: 'Il·luminació',
  URBAN_FURNITURE: 'Mobiliari urbà',
  PAVEMENT: 'Paviment',
  CLEANING: 'Neteja',
  GREEN_AREAS: 'Zones verdes',
  SIGNAGE: 'Senyalització',
  ACCESSIBILITY: 'Accessibilitat',
  TECHNOLOGY: 'Tecnologia',
  OTHER: 'Altres',
};

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export const CATEGORY_IONICONS: Record<ReportCategory, IoniconName> = {
  LIGHTING: 'bulb-outline',
  URBAN_FURNITURE: 'cube-outline',
  PAVEMENT: 'construct-outline',
  CLEANING: 'sparkles-outline',
  GREEN_AREAS: 'leaf-outline',
  SIGNAGE: 'flag-outline',
  ACCESSIBILITY: 'accessibility-outline',
  TECHNOLOGY: 'desktop-outline',
  OTHER: 'pricetag-outline',
};

export const STATE_LABELS: Record<ReportState, string> = {
  OPEN: 'Oberta',
  ASSIGNED: 'Assignada',
  IN_PROGRESS: 'En curs',
  VALIDATED: 'Validada',
  CLOSED: 'Tancada',
};

export const STATE_COLORS: Record<ReportState, { bg: string; text: string; dot: string }> = {
  OPEN: { bg: '#dbeafe', text: '#1e40af', dot: '#3b82f6' },
  ASSIGNED: { bg: '#fef3c7', text: '#92400e', dot: '#eab308' },
  IN_PROGRESS: { bg: '#ffedd5', text: '#9a3412', dot: '#f97316' },
  VALIDATED: { bg: '#d1fae5', text: '#065f46', dot: '#22c55e' },
  CLOSED: { bg: '#e5e7eb', text: '#374151', dot: '#6b7280' },
};

export const PRIORITY_LABELS: Record<ReportPriority, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Mitjana',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

export const PRIORITY_COLORS: Record<ReportPriority, string> = {
  LOW: '#9ca3af',
  MEDIUM: '#eab308',
  HIGH: '#f97316',
  CRITICAL: '#dc2626',
};

export const PRIORITY_WEIGHTS: Record<ReportPriority, number> = {
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.75,
  CRITICAL: 1.0,
};

export const formatRelativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ara mateix';
  if (mins < 60) return `fa ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `fa ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `fa ${days}d`;
  const months = Math.floor(days / 30);
  return `fa ${months} mesos`;
};

export const getReportsByRole = (
  reports: Report[],
  role: 'STUDENT' | 'TECHNICAL' | 'ADMIN',
  userNickname: string,
): Report[] => {
  if (role === 'STUDENT') return reports.filter((r) => r.createdBy?.nickname === userNickname);
  if (role === 'TECHNICAL') return reports.filter((r) => r.assignedTo?.nickname === userNickname);
  return reports;
};
