'use client';

/**
 * A dialog / slideover wrapper.
 *
 * Every form uses this component to present slideover drawers and modals
 * with standardized inner padding, sticky header titles/descriptions, and
 * internal scrolling bounds.
 */

import { useIsMobile } from '@/hooks/use-breakpoint';
import { Drawer } from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

const WIDTH = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
} as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'sm',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: keyof typeof WIDTH;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();

  return (
    <Drawer
      isOpen={open}
      onClose={onClose}
      title={title}
      description={description}
      variant={isMobile ? 'modal' : 'slideover'}
    >
      {children}
    </Drawer>
  );
}

/** The row of actions at the bottom of a dialog. Cancel left, commit right. */
export function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4 bg-surface shrink-0">
      {children}
    </div>
  );
}

export function ModalBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('space-y-5 px-6 py-5', className)}>{children}</div>;
}
