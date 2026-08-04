import type { ComponentProps, ComponentType } from 'react';
import { cn } from '@/lib/utils';

const ICON = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-5 w-5' } as const;
export type IconSize = keyof typeof ICON;

type IconProps = {
  as: ComponentType<{ className?: string; strokeWidth?: number }>;
  size?: IconSize;
  strokeWidth?: number; // passthrough — preserves custom strokeWidth checks
} & Omit<ComponentProps<'svg'>, 'className' | 'strokeWidth'> & { className?: string };

export function Icon({ as: C, size = 'md', strokeWidth = 1.75, className, ...rest }: IconProps) {
  return <C className={cn(ICON[size], className)} strokeWidth={strokeWidth} aria-hidden {...rest} />;
}
