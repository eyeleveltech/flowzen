import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// --- Projects ---
export function useProjects(search?: string, includeCalendarData?: boolean, statusFilter?: string, clientId?: string, ownerId?: string) {
  return useInfiniteQuery({
    queryKey: ['projects', search, includeCalendarData, statusFilter, clientId, ownerId],
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (includeCalendarData) params.set('includeCalendarData', 'true');
      if (statusFilter) params.set('status', statusFilter);
      if (clientId) params.set('clientId', clientId);
      if (ownerId) params.set('ownerId', ownerId);
      params.set('page', String(pageParam));
      params.set('limit', '50');
      return api.get<{ projects: any[], page: number, totalPages: number }>(`/projects?${params}`);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });
}

// --- Tasks ---
export function useTasks(search?: string, statusFilter?: string, projectFilter?: string, assigneeId?: string, priorityFilter?: string, filter?: string | null) {
  return useInfiniteQuery({
    queryKey: ['tasks', search, statusFilter, projectFilter, assigneeId, priorityFilter, filter],
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (projectFilter) params.set('projectId', projectFilter);
      if (assigneeId) params.set('assigneeId', assigneeId);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (filter) params.set('filter', filter);
      params.set('page', String(pageParam));
      params.set('limit', '50');
      return api.get<{ tasks: any[], page: number, totalPages: number }>(`/tasks?${params}`);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });
}

// --- Common Form Data ---
export function useClients() {
  return useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const data = await api.get<{ clients: any[] }>('/clients?limit=100');
      return data.clients;
    },
  });
}

export function useMembers() {
  return useQuery({
    queryKey: ['members'],
    queryFn: async () => {
      return api.get<any[]>('/team');
    },
  });
}

export function useTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: async () => {
      const data = await api.get<{ teams: any[] }>('/teams');
      return data.teams;
    },
  });
}

// --- Templates ---
export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      return api.get<any[]>('/settings/templates');
    },
  });
}

// --- Dashboard ---
export function useDashboardData(role?: string, dateRange?: { startDate?: string, endDate?: string }) {
  return useQuery({
    queryKey: ['dashboard', role, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange?.startDate) params.append('startDate', dateRange.startDate);
      if (dateRange?.endDate) params.append('endDate', dateRange.endDate);
      const queryStr = params.toString() ? `?${params.toString()}` : '';

      const [stats, activity, deadlines, velocity, myTasks] = await Promise.all([
        api.get<any>(`/dashboard/stats${queryStr}`),
        api.get<any[]>(`/dashboard/activity${queryStr}`),
        api.get<any[]>(`/dashboard/deadlines${queryStr}`),
        api.get<any[]>(`/dashboard/velocity${queryStr}`),
        api.get<any[]>(`/dashboard/my-tasks${queryStr}`)
      ]);
      
      let statusDist: any[] = [];
      let workload: any[] = [];
      let pendingApprovals: any[] = [];
      let clientHealth: any[] = [];
      
      if (role && role !== 'TEAM_MEMBER') {
        const [dist, pending, health] = await Promise.all([
          api.get<any[]>(`/dashboard/status-distribution${queryStr}`),
          api.get<any[]>(`/dashboard/pending-approvals${queryStr}`),
          api.get<any[]>(`/dashboard/client-health${queryStr}`)
        ]);
        statusDist = dist;
        pendingApprovals = pending;
        clientHealth = health;
      }
      if (role === 'PROJECT_MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN') {
        workload = await api.get<any[]>(`/dashboard/team-workload${queryStr}`);
      }
      
      return { stats, activity, deadlines, velocity, statusDist, workload, myTasks, pendingApprovals, clientHealth };
    },
    enabled: !!role,
    refetchInterval: 60000,
  });
}

// --- Notifications ---
export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      return api.get<{ notifications: any[], unreadCount: number }>('/notifications');
    },
  });
}

// --- CRM Leads ---
export function useLead(leadId: string) {
  return useQuery({
    queryKey: ['lead', leadId],
    queryFn: async () => {
      return api.get<any>(`/crm/leads/${leadId}`);
    },
    enabled: !!leadId,
  });
}
