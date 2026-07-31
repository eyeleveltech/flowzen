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
    expect(result.current.data?.pages[0].projects).toEqual(mockProjects);
    expect(api.get).toHaveBeenCalledWith('/projects?page=1&limit=50');
  });

  it('useDashboardData fetches aggregate dashboard data', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/dashboard/stats')) return { openTasks: 10 };
      if (url.includes('/projects')) return { projects: [] };
      return [];
    });

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    // Only enabled when role is provided
    const { result } = renderHook(() => useDashboardData('TEAM_MEMBER'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    
    expect(result.current.data?.stats).toEqual({ openTasks: 10 });
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/dashboard/stats'));
  });
});
