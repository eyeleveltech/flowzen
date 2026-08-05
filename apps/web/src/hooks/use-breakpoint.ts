import { useMediaQuery } from '@/hooks/use-media-query';

export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767.98px)');
}
