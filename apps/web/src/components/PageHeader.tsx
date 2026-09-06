import { ReactNode } from 'react';
import { usePageHeader } from '@/hooks/usePageHeader';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

// The title/subtitle now live in TopNav's sticky bar (usePageHeader), not the
// scrolling body — this component's only remaining job is the action slot.
export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  usePageHeader(title, subtitle);
  if (!action) return null;
  return <div className="flex justify-end mb-6">{action}</div>;
}
