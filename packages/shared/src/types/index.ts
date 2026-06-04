// ──────────────────────────────────────────────
// User
// ──────────────────────────────────────────────

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'PROJECT_MANAGER' | 'TEAM_MEMBER';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  role: UserRole;
  department?: string | null;
  phone?: string | null;
  joiningDate: string;
  isActive: boolean;
  organization?: Organization;
}

export interface Organization {
  id: string;
  name: string;
  logo?: string | null;
  website?: string | null;
}

// ──────────────────────────────────────────────
// Client
// ──────────────────────────────────────────────

export type ClientStatus = 'LEAD' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ARCHIVED';

export interface Client {
  id: string;
  name: string;
  company?: string | null;
  industry?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  contractValue?: number | null;
  startDate?: string | null;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
  _count?: { projects: number };
  projects?: Project[];
  notes?: Note[];
  activities?: Activity[];
}

// ──────────────────────────────────────────────
// Project
// ──────────────────────────────────────────────

export type ProjectStatus = 'PLANNING' | 'IN_PROGRESS' | 'REVIEW' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED';
export type ProjectPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  priority: ProjectPriority;
  status: ProjectStatus;
  budget?: number | null;
  progress: number;
  clientId: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; name: string; company?: string | null };
  owner?: { id: string; name: string; avatar?: string | null };
  members?: ProjectMember[];
  tasks?: Task[];
  milestones?: Milestone[];
  _count?: { tasks: number };
}

export interface ProjectMember {
  id: string;
  userId: string;
  user?: { id: string; name: string; avatar?: string | null; role?: UserRole };
}

export interface Milestone {
  id: string;
  name: string;
  dueDate?: string | null;
  completed: boolean;
  projectId: string;
}

// ──────────────────────────────────────────────
// Task
// ──────────────────────────────────────────────

export type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'BLOCKED' | 'COMPLETED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: string | null;
  order: number;
  projectId: string;
  assigneeId?: string | null;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
  project?: { id: string; name: string };
  assignee?: { id: string; name: string; avatar?: string | null };
  subtasks?: Task[];
  comments?: Comment[];
  checklist?: ChecklistItem[];
  _count?: { subtasks: number; comments: number; checklist?: number };
}

export interface Comment {
  id: string;
  content: string;
  mentions: string[];
  createdAt: string;
  author: { id: string; name: string; avatar?: string | null };
}

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  order: number;
}

// ──────────────────────────────────────────────
// Activity & Notifications
// ──────────────────────────────────────────────

export interface Activity {
  id: string;
  type: string;
  message: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  user: { id: string; name: string; avatar?: string | null };
}

export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'TASK_COMPLETED'
  | 'DEADLINE_APPROACHING'
  | 'COMMENT_ADDED'
  | 'PROJECT_STATUS_CHANGED'
  | 'CLIENT_ADDED'
  | 'MENTION';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  read: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface Note {
  id: string;
  content: string;
  type: 'INTERNAL' | 'MEETING';
  createdAt: string;
  author: { id: string; name: string; avatar?: string | null };
}

// ──────────────────────────────────────────────
// API Response Types
// ──────────────────────────────────────────────

export interface PaginatedResponse<T> {
  total: number;
  page: number;
  totalPages: number;
  [key: string]: T[] | number;
}

export interface DashboardStats {
  activeClients: number;
  activeProjects: number;
  openTasks: number;
  completedTasks: number;
  delayedProjects: number;
  totalMembers: number;
}

export interface ProjectHealth {
  onTrack: number;
  atRisk: number;
  delayed: number;
  total: number;
}

export interface TeamMember extends User {
  totalTasks: number;
  totalProjects: number;
  activeTasks: number;
  capacity: number;
}

export interface SearchResults {
  clients: { id: string; name: string; company?: string | null; status: string }[];
  projects: { id: string; name: string; status: string; client: { name: string } }[];
  tasks: { id: string; title: string; status: string; project: { name: string } }[];
  members: { id: string; name: string; email: string; avatar?: string | null; role: string }[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description?: string | null;
  structure: {
    tasks?: { title: string; subtasks?: { title: string }[] }[];
  };
}
