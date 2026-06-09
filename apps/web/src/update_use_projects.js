const fs = require('fs');

const file = 'c:\\Users\\Harish\\Documents\\Eyelevel\\Saas\\apps\\web\\src\\hooks\\useQueries.ts';
let content = fs.readFileSync(file, 'utf-8');

const oldUseProjects = `export function useProjects(search?: string, includeCalendarData?: boolean) {
  return useInfiniteQuery({
    queryKey: ['projects', search, includeCalendarData],
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (includeCalendarData) params.set('includeCalendarData', 'true');
      params.set('page', String(pageParam));
      params.set('limit', '50');
      return api.get<{ projects: any[], page: number, totalPages: number }>(\`/projects?\${params}\`);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });
}`;

const newUseProjects = `export function useProjects(search?: string, includeCalendarData?: boolean, statusFilter?: string, clientId?: string, ownerId?: string) {
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
      return api.get<{ projects: any[], page: number, totalPages: number }>(\`/projects?\${params}\`);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });
}`;

content = content.replace(oldUseProjects, newUseProjects);

fs.writeFileSync(file, content, 'utf-8');
console.log('Successfully updated useProjects hook');
