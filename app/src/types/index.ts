export type Role = 'STUDENT' | 'ADMIN' | 'TECHNICAL';

export interface User {
  user_id: string;
  email: string;
  name: string;
  surname: string;
  nickname: string;
  role: Role;
  active: boolean;
  points: number;
  avatarUrl?: string | null;
  // Camps específics per a tècnics (null per a STUDENT/ADMIN)
  position?: string | null;
  workCategory?: ReportCategory | null;
  company?: string | null;
  createdAt: string;
}

// Resultat de la cerca d'usuaris (GET /users/search). Inclou la informació
// bàsica + `solvedCount` (reports resolts: propis per a estudiant, assignats
// per a tècnic).
export interface UserSearchResult {
  user_id: string;
  email: string;
  name: string;
  surname: string;
  nickname: string;
  role: Role;
  points: number;
  avatarUrl?: string | null;
  position?: string | null;
  workCategory?: ReportCategory | null;
  company?: string | null;
  solvedCount: number;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface RegisterPayload {
  email: string;
  name: string;
  surname: string;
  password: string;
  nickname: string;
  token?: string; // Codi d'invitació (només TECHNICAL/ADMIN)
  role?: 'ADMIN' | 'TECHNICAL'; // Opcional, només si s'usa token
  // Camps de tècnic (només s'envien al backend si la invitació és TECHNICAL)
  position?: string;
  company?: string;
  workCategory?: ReportCategory;
}

export interface UpdateProfilePayload {
  name?: string;
  surname?: string;
  position?: string | null;
  company?: string | null;
  workCategory?: ReportCategory | null;
}

export type ReportState = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'VALIDATED' | 'CLOSED';
export type ReportPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ReportCategory =
  | 'LIGHTING'
  | 'URBAN_FURNITURE'
  | 'PAVEMENT'
  | 'CLEANING'
  | 'GREEN_AREAS'
  | 'SIGNAGE'
  | 'ACCESSIBILITY'
  | 'TECHNOLOGY'
  | 'OTHER';

export type IncidentEvent = 'ASSIGN' | 'START' | 'REASSIGN' | 'RESOLVE' | 'CLOSE' | 'REJECT';

export interface ReportImage {
  id: string;
  url: string;
  type: 'INITIAL' | 'RESOLUTION' | 'PROGRESS';
  createdAt?: string;
  uploadedById?: string | null;
}

export interface ReportAuthor {
  user_id: string;
  name: string;
  nickname: string;
  email?: string;
  role?: Role;
}

export interface ReportComment {
  id: string;
  content: string;
  author?: ReportAuthor;
  authorId?: string;
  transitionEvent?: IncidentEvent | null;
  createdAt: string;
}

export interface Report {
  report_id: string;
  title: string;
  description: string;
  state: ReportState;
  priority: ReportPriority;
  category: ReportCategory | null;
  latitude: number;
  longitude: number;
  createdBy: ReportAuthor;
  assignedTo: ReportAuthor | null;
  images?: ReportImage[];
  comments?: ReportComment[];
  createdAt: string;
  resolvedAt?: string;
  lastModified?: string;
  // Camps escrits per l'auto-classificació IA (Sprint 6).
  aiSummary?: string | null;
  aiClassifiedAt?: string | null;
}

export type NotificationType =
  | 'REPORT_ASSIGNED'
  | 'REPORT_REASSIGNED'
  | 'REPORT_UNASSIGNED'
  | 'REPORT_STATE_CHANGED'
  | 'POINTS_EARNED';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  reportId: string | null;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Gamificació
// ────────────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  user_id: string;
  name: string;
  surname: string;
  nickname: string;
  points: number;
  avatarUrl?: string | null;
}

export interface PointsTransactionItem {
  id: string;
  amount: number;
  priority: ReportPriority;
  createdAt: string;
  report: {
    report_id: string;
    title: string;
    priority: ReportPriority;
    category: ReportCategory | null;
  };
}

export interface UserRank {
  rank: number;
  total: number;
  points: number;
}

// Mirall de POINTS_BY_PRIORITY del backend per renderitzar previsualitzacions
// al mòbil (per exemple, "guanyaràs +X punts quan es tanqui").
export const POINTS_BY_PRIORITY: Record<ReportPriority, number> = {
  LOW: 5,
  MEDIUM: 10,
  HIGH: 20,
  CRITICAL: 40,
};
