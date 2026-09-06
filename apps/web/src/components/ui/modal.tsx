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

/**
 * How wide the dialog may grow.
 *
 * This map and the `size` prop below both existed and NEITHER was used — the
 * value was destructured, defaulted, and then never reached the panel, so every
 * dialog in the app was locked to `max-w-md` however it asked to be sized. Which
 * is why the longer forms felt cramped: two columns inside 448px, minus padding,
 * leaves 200px a field.
 */
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
      // Ignored on mobile, where the sheet is full width by design.
      className={isMobile ? undefined : WIDTH[size]}
    >
      {children}
    </Drawer>
  );
}

/**
 * The body of a dialog: one scroll region, and the ONLY one.
 *
 * A dialog is a column — header, this, footer — and the scrolling belongs here so
 * that the footer stays put and the scrollbar sits against the panel edge rather
 * than floating inside the padding. Screens that added their own
 * `max-h-[70vh] overflow-y-auto` on top of this got two nested scrollbars and a
 * footer that only looked pinned.
 *
 * `ScrollingModalBody` is the same thing for a form that wants Enter-to-submit:
 * wrap the pair in a `<form className="flex h-full flex-col">`.
 */
export function ScrollingModalBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className={cn('space-y-7 px-6 py-6', className)}>{children}</div>
    </div>
  );
}

/** The row of actions at the bottom of a dialog. Cancel left, commit right. */
export function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2.5 border-t border-border px-6 py-4 bg-surface shrink-0">
      {children}
    </div>
  );
}

export function ModalBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('space-y-5 px-6 py-5', className)}>{children}</div>;
}
