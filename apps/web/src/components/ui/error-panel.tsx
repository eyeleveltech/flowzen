import { AlertCircle, RefreshCw } from 'lucide-react';
import { Icon } from '@/components/ui/icon';

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="h-12 w-12 rounded-2xl bg-red-50 flex items-center justify-center mb-4 border border-red-100">
        <AlertCircle className="h-6 w-6 text-red-500" />
      </div>
      <p className="text-sm font-semibold text-primary mb-1">Failed to load</p>
      <p className="text-xs text-secondary mb-5 max-w-xs">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-primary hover:bg-subtle transition-all">
          <Icon as={RefreshCw} size="sm" /> Try Again
        </button>
      )}
    </div>
  );
}
