import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

// --- Activity Feed ---
export function useActivityFeed(filter: string) {
  return useInfiniteQuery({
    queryKey: ['activityFeed', filter],
    queryFn: async ({ pageParam = 0 }) => {
      const limit = 20;
      return api.get<any[]>(`/dashboard/activity?filter=${filter}&limit=${limit}&skip=${pageParam}`);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === 20 ? allPages.length * 20 : undefined;
    },
  });
}
