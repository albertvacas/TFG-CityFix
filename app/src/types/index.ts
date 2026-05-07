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
  // Camps específics per a tècnics (null per a STUDENT/ADMIN)
  position?: string | null;
  workCategory?: ReportCategory | null;
  company?: string | null;
  createdAt: string;
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
}
