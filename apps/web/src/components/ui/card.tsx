import { cn } from '@/lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /**
   * So a caller can scroll a card into view — a notification that names a thing
   * should land on that thing. React 19 passes `ref` as an ordinary prop, but
   * `HTMLAttributes` does not include it, so it has to be declared.
   */
  ref?: React.Ref<HTMLDivElement>;
}

export function Card({ padding = 'md', className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'bg-white border border-border rounded-card',
        {
          none: '',
          sm: 'p-4',
          md: 'p-5',
          lg: 'p-6',
        }[padding],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-5 py-4 flex items-center justify-between border-b border-border', className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-sm font-[650] text-primary', className)} {...props}>
      {children}
    </h3>
  );
}

export function CardBody({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-5', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-5 py-4 border-t border-border flex items-center justify-end gap-3', className)} {...props}>
      {children}
    </div>
  );
}
