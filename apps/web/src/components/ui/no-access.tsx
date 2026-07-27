import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

interface NoAccessProps {
  title?: string;
  message?: string;
  backHref?: string;
  backLabel?: string;
}

export function NoAccess({
  title = 'Access Restricted',
  message = 'You do not have permission or module access to view this page.',
  backHref = '/dashboard',
  backLabel = 'Back to Dashboard',
}: NoAccessProps) {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
      <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4 border border-amber-200">
        <ShieldAlert className="w-6 h-6" />
      </div>
      <h2 className="text-lg font-bold text-primary mb-1">{title}</h2>
      <p className="text-sm text-secondary mb-6">{message}</p>
      <div className="flex items-center justify-center gap-3">
        <Link
          href={backHref}
          className="bg-primary text-white text-xs font-semibold px-4 py-2.5 rounded-xl hover:bg-black transition-colors"
        >
          {backLabel}
        </Link>
        <Link
          href="/modules"
          className="border border-border text-primary text-xs font-semibold px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
        >
          View Modules
        </Link>
      </div>
    </div>
  );
}
