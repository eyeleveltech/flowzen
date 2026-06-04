import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useProjects, useDashboardData } from './useQueries';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

describe('useQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useProjects fetches projects data successfully', async () => {
    const mockProjects = [{ id: '1', name: 'Test Project' }];
    vi.mocked(api.get).mockResolvedValueOnce({ projects: mockProjects });

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useProjects(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockProjects);
    expect(api.get).toHaveBeenCalledWith('/projects?limit=100');
  });

  it('useDashboardData fetches aggregate dashboard data', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ openTasks: 10 }) // stats
      .mockResolvedValueOnce([]) // activity
      .mockResolvedValueOnce([]) // deadlines
      .mockResolvedValueOnce([]); // velocity

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    // Only enabled when role is provided
    const { result } = renderHook(() => useDashboardData('TEAM_MEMBER'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    
    expect(result.current.data?.stats).toEqual({ openTasks: 10 });
    expect(api.get).toHaveBeenCalledTimes(4); // Only the standard 4 endpoints for TEAM_MEMBER
  });
});
