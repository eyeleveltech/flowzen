import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

interface NotFoundPanelProps {
  title?: string;
  message?: string;
  backHref?: string;
  backLabel?: string;
}

export function NotFoundPanel({
  title = 'Resource Not Found',
  message = 'The record you are looking for does not exist or has been removed.',
  backHref = '/dashboard',
  backLabel = 'Back to Safety',
}: NotFoundPanelProps) {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
      <div className="w-12 h-12 rounded-2xl bg-gray-100 text-secondary flex items-center justify-center mb-4 border border-border">
        <FileQuestion className="w-6 h-6" />
      </div>
      <h2 className="text-lg font-bold text-primary mb-1">{title}</h2>
      <p className="text-sm text-secondary mb-6">{message}</p>
      <Link
        href={backHref}
        className="bg-primary text-white text-xs font-semibold px-5 py-2.5 rounded-xl hover:bg-black transition-colors"
      >
        {backLabel}
      </Link>
    </div>
  );
}
