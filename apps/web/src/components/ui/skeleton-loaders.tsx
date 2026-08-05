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

export function ClientDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-4 w-24 rounded-md" />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 sm:gap-4 mb-8">
        <div className="flex items-start gap-4">
          <Skeleton className="h-16 w-16 rounded-2xl shrink-0" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48 rounded-lg" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-36 rounded-md" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </div>
        </div>
        <Skeleton className="h-10 w-32 rounded-xl shrink-0" />
      </div>

      <div className="border-b border-border flex gap-6 pb-2">
        <Skeleton className="h-6 w-20 rounded-md" />
        <Skeleton className="h-6 w-24 rounded-md" />
        <Skeleton className="h-6 w-20 rounded-md" />
        <Skeleton className="h-6 w-28 rounded-md" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-border space-y-4">
          <Skeleton className="h-5 w-32 rounded-md" />
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3 w-20 rounded" />
                <Skeleton className="h-4 w-36 rounded" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3 w-24 rounded" />
                <Skeleton className="h-4 w-40 rounded" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3 w-16 rounded" />
                <Skeleton className="h-4 w-28 rounded" />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-border space-y-4">
          <Skeleton className="h-5 w-36 rounded-md" />
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3 w-24 rounded" />
                <Skeleton className="h-4 w-32 rounded" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3 w-20 rounded" />
                <Skeleton className="h-4 w-44 rounded" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3 w-28 rounded" />
                <Skeleton className="h-4 w-36 rounded" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <TableSkeleton rows={5} />
    </div>
  );
}

export function ProjectDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <Skeleton className="h-4 w-24 rounded-md" />

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-8">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-8 w-56 rounded-lg" />
            <Skeleton className="h-6 w-20 rounded-lg" />
            <Skeleton className="h-6 w-24 rounded-lg" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-40 rounded-md" />
        </div>
        <Skeleton className="h-10 w-40 rounded-xl shrink-0" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white p-5 rounded-2xl border border-border space-y-3">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-5 w-5 rounded-md" />
              <Skeleton className="h-4 w-24 rounded" />
            </div>
            <Skeleton className="h-6 w-32 rounded-md" />
            <Skeleton className="h-3 w-20 rounded" />
          </div>
        ))}
      </div>

      <TableSkeleton rows={6} />
    </div>
  );
}
