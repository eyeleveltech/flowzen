import { useCallback, useMemo } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// --- Projects ---
export function useProjects(search?: string, includeCalendarData?: boolean, statusFilter?: string, clientId?: string, ownerId?: string, endDate?: string) {
  return useInfiniteQuery({
    queryKey: ['projects', search, includeCalendarData, statusFilter, clientId, ownerId, endDate],
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (includeCalendarData) params.set('includeCalendarData', 'true');
      if (statusFilter) params.set('status', statusFilter);
      if (clientId) params.set('clientId', clientId);
      if (ownerId) params.set('ownerId', ownerId);
      if (endDate) params.set('endDate', endDate);
      params.set('page', String(pageParam));
      params.set('limit', '50');
      return api.get<{ projects: any[], page: number, totalPages: number }>(`/projects?${params}`);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    placeholderData: (previousData) => previousData,
  });
}

// --- Tasks ---
export function useTasks(search?: string, statusFilter?: string, projectFilter?: string, assigneeId?: string, priorityFilter?: string, teamFilter?: string, filter?: string | null, sort?: string, dueDateFrom?: string, dueDateTo?: string, clientFilter?: string) {
  return useInfiniteQuery({
    queryKey: ['tasks', search, statusFilter, projectFilter, assigneeId, priorityFilter, teamFilter, filter, sort, dueDateFrom, dueDateTo, clientFilter],
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (projectFilter) params.set('projectId', projectFilter);
      if (assigneeId) params.set('assigneeId', assigneeId);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (teamFilter) params.set('teamId', teamFilter);
      if (filter) params.set('filter', filter);
      if (sort) params.set('sort', sort);
      if (dueDateFrom) params.set('dueDateFrom', dueDateFrom);
      if (dueDateTo) params.set('dueDateTo', dueDateTo);
      if (clientFilter) params.set('clientId', clientFilter);
      params.set('page', String(pageParam));
      params.set('limit', '50');
      return api.get<{ tasks: any[], page: number, totalPages: number }>(`/tasks?${params}`);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    placeholderData: (previousData) => previousData,
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
export function useTemplates(enabled: boolean = true) {
  return useQuery({
    queryKey: ['templates'],
    queryFn: async () => {
      return api.get<any[]>('/settings/templates');
    },
    enabled,
  });
}

// --- Dashboard ---
function buildDashboardQueryStr(dateRange?: { startDate?: string; endDate?: string }) {
  const params = new URLSearchParams();
  if (dateRange?.startDate) params.append('startDate', dateRange.startDate);
  if (dateRange?.endDate) params.append('endDate', dateRange.endDate);
  return params.toString() ? `?${params.toString()}` : '';
}

export function useDashboardStats(role?: string, dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'stats', role, dateRange],
    queryFn: () => api.get<any>(`/dashboard/stats${buildDashboardQueryStr(dateRange)}`),
    enabled: !!role,
    refetchOnMount: 'always',
  });
}

export function useDashboardActivity(role?: string, dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'activity', role, dateRange],
    queryFn: () => api.get<any[]>(`/dashboard/activity${buildDashboardQueryStr(dateRange)}`),
    enabled: !!role,
    refetchOnMount: 'always',
  });
}

export function useDashboardDeadlines(role?: string, dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'deadlines', role, dateRange],
    queryFn: () => api.get<any[]>(`/dashboard/deadlines${buildDashboardQueryStr(dateRange)}`),
    enabled: !!role,
    refetchOnMount: 'always',
  });
}

export function useDashboardVelocity(role?: string, dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'velocity', role, dateRange],
    queryFn: () => api.get<any[]>(`/dashboard/velocity${buildDashboardQueryStr(dateRange)}`),
    enabled: !!role,
    refetchOnMount: 'always',
  });
}

export function useDashboardMyTasks(role?: string, dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'my-tasks', role, dateRange],
    queryFn: () => api.get<any[]>(`/dashboard/my-tasks${buildDashboardQueryStr(dateRange)}`),
    enabled: !!role,
    refetchOnMount: 'always',
  });
}

export function useDashboardLeadTasks(role?: string, dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'lead-tasks', role, dateRange],
    queryFn: () => api.get<any[]>(`/dashboard/lead-tasks${buildDashboardQueryStr(dateRange)}`),
    enabled: !!role,
    refetchOnMount: 'always',
  });
}

export function useDashboardStatusDist(role?: string, dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'status-distribution', role, dateRange],
    queryFn: () => api.get<any[]>(`/dashboard/status-distribution${buildDashboardQueryStr(dateRange)}`),
    enabled: !!role && role !== 'TEAM_MEMBER',
    refetchOnMount: 'always',
  });
}

export function useDashboardPendingApprovals(role?: string, dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'pending-approvals', role, dateRange],
    queryFn: () => api.get<any[]>(`/dashboard/pending-approvals${buildDashboardQueryStr(dateRange)}`),
    enabled: !!role && role !== 'TEAM_MEMBER',
    refetchOnMount: 'always',
  });
}

export function useDashboardClientHealth(role?: string, dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'client-health', role, dateRange],
    queryFn: () => api.get<any[]>(`/dashboard/client-health${buildDashboardQueryStr(dateRange)}`),
    enabled: !!role && role !== 'TEAM_MEMBER',
    refetchOnMount: 'always',
  });
}

export function useDashboardMyProjects(role?: string) {
  return useQuery({
    queryKey: ['dashboard', 'my-projects', role],
    queryFn: async () => {
      const res = await api.get<any>('/projects?status=ACTIVE&limit=5');
      return res.projects || [];
    },
    enabled: role === 'TEAM_MEMBER',
    refetchOnMount: 'always',
  });
}

export function useDashboardWorkload(role?: string, dateRange?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'team-workload', role, dateRange],
    queryFn: () => api.get<any[]>(`/dashboard/team-workload${buildDashboardQueryStr(dateRange)}`),
    enabled: role === 'PROJECT_MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN',
    refetchOnMount: 'always',
  });
}

export function useDashboardData(role?: string, dateRange?: { startDate?: string; endDate?: string }) {
  const queryClient = useQueryClient();

  const statsQ = useDashboardStats(role, dateRange);
  const activityQ = useDashboardActivity(role, dateRange);
  const deadlinesQ = useDashboardDeadlines(role, dateRange);
  const velocityQ = useDashboardVelocity(role, dateRange);
  const myTasksQ = useDashboardMyTasks(role, dateRange);
  const leadTasksQ = useDashboardLeadTasks(role, dateRange);
  const statusDistQ = useDashboardStatusDist(role, dateRange);
  const pendingApprovalsQ = useDashboardPendingApprovals(role, dateRange);
  const clientHealthQ = useDashboardClientHealth(role, dateRange);
  const myProjectsQ = useDashboardMyProjects(role);
  const workloadQ = useDashboardWorkload(role, dateRange);

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }, [queryClient]);

  const isSuccess = statsQ.isSuccess || activityQ.isSuccess;
  const isLoading = statsQ.isLoading && activityQ.isLoading;

  const data = useMemo(() => {
    if (!role) return undefined;
    return {
      stats: statsQ.data,
      activity: activityQ.data || [],
      deadlines: deadlinesQ.data || [],
      velocity: velocityQ.data || [],
      statusDist: statusDistQ.data || [],
      workload: workloadQ.data || [],
      myTasks: myTasksQ.data || [],
      leadTasks: leadTasksQ.data || [],
      pendingApprovals: pendingApprovalsQ.data || [],
      clientHealth: clientHealthQ.data || [],
      myProjects: myProjectsQ.data || [],
    };
  }, [
    role,
    statsQ.data,
    activityQ.data,
    deadlinesQ.data,
    velocityQ.data,
    statusDistQ.data,
    workloadQ.data,
    myTasksQ.data,
    leadTasksQ.data,
    pendingApprovalsQ.data,
    clientHealthQ.data,
    myProjectsQ.data,
  ]);

  return {
    data,
    refetch,
    isSuccess,
    isLoading,
  };
}

// --- Executive report (boss view) ---
export function useExecutiveReport(dateRange?: { startDate?: string, endDate?: string }, enabled: boolean = true) {
  return useQuery({
    queryKey: ['executive', dateRange],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange?.startDate) params.append('startDate', dateRange.startDate);
      if (dateRange?.endDate) params.append('endDate', dateRange.endDate);
      const qs = params.toString() ? `?${params.toString()}` : '';
      return api.get<any>(`/reports/executive${qs}`);
    },
    enabled,
    refetchOnMount: 'always',
    staleTime: 0,
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
