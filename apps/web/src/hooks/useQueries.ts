import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// --- Projects ---
export function useProjects(search?: string) {
  return useQuery({
    queryKey: ['projects', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      params.set('limit', '100');
      const data = await api.get<{ projects: any[] }>(`/projects?${params}`);
      return data.projects;
    },
  });
}

// --- Tasks ---
export function useTasks(search?: string, statusFilter?: string, projectFilter?: string, assigneeId?: string) {
  return useQuery({
    queryKey: ['tasks', search, statusFilter, projectFilter, assigneeId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (projectFilter) params.set('projectId', projectFilter);
      if (assigneeId) params.set('assigneeId', assigneeId);
      params.set('limit', '200');
      const data = await api.get<{ tasks: any[] }>(`/tasks?${params}`);
      return data.tasks;
    },
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
