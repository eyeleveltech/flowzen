import { cn } from '@/lib/utils';

export function NarrowPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-3xl', className)}>{children}</div>;
}
