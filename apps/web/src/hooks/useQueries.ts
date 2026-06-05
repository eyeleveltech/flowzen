import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// --- Projects ---
export function useProjects(search?: string, includeCalendarData?: boolean) {
  return useInfiniteQuery({
    queryKey: ['projects', search, includeCalendarData],
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (includeCalendarData) params.set('includeCalendarData', 'true');
      params.set('page', String(pageParam));
      params.set('limit', '50');
      return api.get<{ projects: any[], page: number, totalPages: number }>(`/projects?${params}`);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });
}

// --- Tasks ---
export function useTasks(search?: string, statusFilter?: string, projectFilter?: string, assigneeId?: string) {
  return useInfiniteQuery({
    queryKey: ['tasks', search, statusFilter, projectFilter, assigneeId],
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (projectFilter) params.set('projectId', projectFilter);
      if (assigneeId) params.set('assigneeId', assigneeId);
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
export function useDashboardData(role?: string) {
  return useQuery({
    queryKey: ['dashboard', role],
    queryFn: async () => {
      const [stats, activity, deadlines, velocity] = await Promise.all([
        api.get<any>('/dashboard/stats'),
        api.get<any[]>('/dashboard/activity'),
        api.get<any[]>('/dashboard/deadlines'),
        api.get<any[]>('/dashboard/velocity')
      ]);
      
      let statusDist: any[] = [];
      let workload: any[] = [];
      
      if (role && role !== 'TEAM_MEMBER') {
        statusDist = await api.get<any[]>('/dashboard/status-distribution');
      }
      if (role === 'PROJECT_MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN') {
        workload = await api.get<any[]>('/dashboard/team-workload');
      }
      
      return { stats, activity, deadlines, velocity, statusDist, workload };
    },
    enabled: !!role,
  });
}
