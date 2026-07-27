import React from 'react';
import { Skeleton } from './skeleton';

export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-48 rounded-lg mb-2" />
          <Skeleton className="h-4 w-72 rounded-md" />
        </div>
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-border space-y-3">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-8 w-36 rounded-lg" />
        </div>
        <div className="bg-white p-6 rounded-2xl border border-border space-y-3">
          <Skeleton className="h-4 w-28 rounded" />
          <Skeleton className="h-8 w-32 rounded-lg" />
        </div>
        <div className="bg-white p-6 rounded-2xl border border-border space-y-3">
          <Skeleton className="h-4 w-20 rounded" />
          <Skeleton className="h-8 w-40 rounded-lg" />
        </div>
      </div>

      <TableSkeleton rows={5} />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-2xl border border-border overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <Skeleton className="h-5 w-32 rounded" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 shrink-0">
              <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-36 rounded" />
                <Skeleton className="h-3 w-24 rounded" />
              </div>
            </div>
            <Skeleton className="h-4 w-24 rounded hidden sm:block" />
            <Skeleton className="h-4 w-20 rounded hidden md:block" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
