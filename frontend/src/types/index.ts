export type Role = 'STUDENT' | 'ADMIN' | 'TECHNICAL';
export type State = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'VALIDATED' | 'CLOSED';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IncidentEvent = 'ASSIGN' | 'START' | 'REASSIGN' | 'RESOLVE' | 'CLOSE' | 'REJECT';
export type InviteStatus = 'PENDING' | 'USED' | 'REVOKED';

export interface User {
  user_id: string;
  email: string;
  name: string;
  surname: string;
  nickname: string;
  role: Role;
  active: boolean;
  points: number;
  createdAt: string;
}

export interface Report {
  report_id: string;
  title: string;
  description: string;
  state: State;
  priority: Priority;
  category: string | null;
  latitude: number;
  longitude: number;
  createdBy: { user_id: string; name: string; nickname: string };
  assignedTo: { user_id: string; name: string; nickname: string } | null;
  images: Image[];
  comments: Comment[];
  createdAt: string;
  lastModified: string;
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
  createdAt: string;
}

// Map of valid transitions per state (for the admin UI)
export const STATE_TRANSITIONS: Record<State, IncidentEvent[]> = {
  OPEN: ['ASSIGN'],
  ASSIGNED: ['START', 'REASSIGN'],
  IN_PROGRESS: ['RESOLVE'],
  VALIDATED: ['CLOSE', 'REJECT'],
  CLOSED: [],
};
