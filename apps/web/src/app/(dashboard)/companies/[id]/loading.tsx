/**
 * Shown by Next the instant this route is navigated to, before its code and
 * data arrive (Perf Plan 1, decision 3). The same shape the screen itself
 * shows while its first request is out, so nothing jumps.
 */
import { ClientDetailSkeleton } from '@/components/ui/skeleton-loaders';

export default function Loading() {
  return <div className="page-shell"><ClientDetailSkeleton /></div>;
}
