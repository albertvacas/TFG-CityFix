// Resposta paginada genèrica (offset-based) normalitzada al frontend.
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type Role = 'STUDENT' | 'ADMIN' | 'TECHNICAL';
export type State = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'VALIDATED' | 'CLOSED';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IncidentEvent = 'ASSIGN' | 'START' | 'REASSIGN' | 'RESOLVE' | 'CLOSE' | 'REJECT';
export type InviteStatus = 'PENDING' | 'USED' | 'REVOKED';
export type Category = 'LIGHTING' | 'URBAN_FURNITURE' | 'PAVEMENT' | 'CLEANING' | 'GREEN_AREAS' | 'SIGNAGE' | 'ACCESSIBILITY' | 'TECHNOLOGY' | 'OTHER';

export const CATEGORY_LABELS: Record<Category, string> = {
  LIGHTING: 'Il·luminació',
  URBAN_FURNITURE: 'Mobiliari urbà',
  PAVEMENT: 'Via pública',
  CLEANING: 'Neteja',
  GREEN_AREAS: 'Zones verdes',
  SIGNAGE: 'Senyalització',
  ACCESSIBILITY: 'Accessibilitat',
  TECHNOLOGY: 'Tecnologia',
  OTHER: 'Altres',
};

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
  createdAt: string;
  // true si és l'admin master (ROOT_ADMIN_EMAIL): compte intocable.
  isRoot?: boolean;
  // Camps específics per a tècnics (null per a STUDENT/ADMIN)
  position?: string | null;
  workCategory?: Category | null;
  company?: string | null;
}

// Resultat de la cerca d'usuaris (GET /users/search): info bàsica + solvedCount
// (reports resolts: propis per a estudiant, assignats per a tècnic).
export interface UserSearchResult {
  user_id: string;
  email: string;
  name: string;
  surname: string;
  nickname: string;
  role: Role;
  points: number;
  active: boolean;
  avatarUrl?: string | null;
  position?: string | null;
  workCategory?: Category | null;
  company?: string | null;
  solvedCount: number;
  // true si és l'admin master (ROOT_ADMIN_EMAIL): compte intocable.
  isRoot?: boolean;
}

// Resposta enriquida que retorna GET /users/technicians (inclou càrrega actual)
export interface Technician extends User {
  _count?: { reportsAssigned: number };
}

export interface TechnicianStats {
  assigned: number;
  inProgress: number;
  validated: number;
  closed: number;
  total: number;
}

export interface TechnicianDetails {
  user_id: string;
  email: string;
  name: string;
  surname: string;
  nickname: string;
  active: boolean;
  avatarUrl?: string | null;
  position: string | null;
  workCategory: Category | null;
  company: string | null;
  createdAt: string;
  stats: TechnicianStats;
}

export interface StudentSummary {
  user_id: string;
  name: string;
  surname: string;
  nickname: string;
}

export interface Report {
  report_id: string;
  title: string;
  description: string;
  state: State;
  priority: Priority;
  category: Category | null;
  latitude: number;
  longitude: number;
  createdBy: { user_id: string; name: string; nickname: string };
  assignedTo: { user_id: string; name: string; nickname: string } | null;
  images: Image[];
  comments: Comment[];
  createdAt: string;
  lastModified: string;
  // Camps escrits per l'auto-classificació IA (Sprint 6).
  aiSummary?: string | null;
  aiClassifiedAt?: string | null;
}

export interface Image {
  id: string;
  url: string;
  type: 'INITIAL' | 'RESOLUTION' | 'PROGRESS';
  createdAt: string;
}

export interface Comment {
  id: string;
  content: string;
  author: { user_id: string; name: string; nickname: string };
  createdAt: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface Invite {
  id: string;
  email: string;
  role: 'ADMIN' | 'TECHNICAL';
  token: string;
  status: InviteStatus;
  expiresAt: string;
  createdAt: string;
}

// Map of valid transitions per state (for the admin UI)
// REASSIGN des d'IN_PROGRESS torna a ASSIGNED (escollint un nou tècnic), per
// als casos en què el tècnic original no pot continuar amb la feina.
export const STATE_TRANSITIONS: Record<State, IncidentEvent[]> = {
  OPEN: ['ASSIGN'],
  ASSIGNED: ['START', 'REASSIGN'],
  IN_PROGRESS: ['RESOLVE', 'REASSIGN'],
  VALIDATED: ['CLOSE', 'REJECT'],
  CLOSED: [],
};

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

export interface PointsTransaction {
  id: string;
  amount: number;
  priority: Priority;
  createdAt: string;
  user?: { user_id: string; name: string; surname: string; nickname: string };
  report: {
    report_id: string;
    title: string;
    priority: Priority;
    category: Category | null;
  };
}

// Punts atorgats per prioritat — mirall de POINTS_BY_PRIORITY del backend.
// Es duplica al frontend per renderitzar previsualitzacions sense una crida
// extra (per exemple, mostrar "Quan es tanqui guanyaràs +X punts").
export const POINTS_BY_PRIORITY: Record<Priority, number> = {
  LOW: 5,
  MEDIUM: 10,
  HIGH: 20,
  CRITICAL: 40,
};
