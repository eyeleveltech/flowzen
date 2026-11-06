/**
 * The main screens, as shapes, while they load (Perf Plan 1, decision 3).
 *
 * Each is the layout of its screen — the tiles, the toolbar, the table —
 * drawn in grey, so the page does not jump when the real thing arrives and
 * a click on the sidebar is answered at once. Used twice over: by the
 * route's `loading.tsx`, which Next shows the instant you navigate, and by
 * the screen itself while its first request is out.
 */

import { Skeleton } from './skeleton';
import { TableSkeleton } from './skeleton-loaders';

const block = (cls: string) => <Skeleton className={`rounded-card motion-reduce:animate-none ${cls}`} />;

/** A row of stat tiles, as My Work, All tasks and Money open with. */
export function StatTilesSkeleton({ count = 4, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-2 gap-3 md:grid-cols-4 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-card border border-border bg-white p-4">
          <Skeleton className="h-3 w-20 rounded" />
          <Skeleton className="h-7 w-16 rounded-md" />
          <Skeleton className="h-3 w-24 rounded" />
        </div>
      ))}
    </div>
  );
}

/** My Work: four tiles, then the grouped table. */
export function MyWorkSkeleton() {
  return (
    <div className="page-shell" aria-busy="true" aria-label="Loading your work">
      <StatTilesSkeleton className="mb-8" />
      <TableSkeleton rows={8} />
    </div>
  );
}

/** All tasks: tiles, a filter bar, then the table. */
export function TaskListSkeleton() {
  return (
    <div className="page-shell space-y-6" aria-busy="true" aria-label="Loading tasks">
      <StatTilesSkeleton count={5} />
      <div className="flex flex-wrap gap-2">
        {block('h-9 w-40')}
        {block('h-9 w-32')}
        {block('h-9 w-32')}
        {block('h-9 w-28')}
      </div>
      <TableSkeleton rows={10} />
    </div>
  );
}

/** The Monday brief: the week line, the summary, the scoreboard, two columns. */
export function BriefSkeleton() {
  const spans = ['lg:col-span-2', 'lg:col-span-2', 'lg:col-span-2', 'lg:col-span-3', 'col-span-2 lg:col-span-3'];
  return (
    <div className="mx-auto w-full max-w-240 space-y-8" aria-busy="true" aria-label="Loading the brief">
      <div className="space-y-2">
        {block('h-4 w-40')}
        {block('h-7 w-64')}
      </div>
      {block('h-28')}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {spans.map((span, i) => (
          <div key={i} className={span}>
            {block('h-36')}
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {block('h-48')}
        {block('h-48')}
      </div>
      {block('h-32')}
      {block('h-40')}
    </div>
  );
}

/** Money: the tabs, the range, the figures, then a table. */
export function MoneySkeleton() {
  return (
    <div className="page-shell space-y-6" aria-busy="true" aria-label="Loading money">
      <div className="flex gap-6 border-b border-border pb-2">
        {block('h-6 w-20')}
        {block('h-6 w-24')}
        {block('h-6 w-20')}
        {block('h-6 w-24')}
      </div>
      <StatTilesSkeleton />
      <TableSkeleton rows={6} />
    </div>
  );
}

/** Calendar: the toolbar and a month of cells. */
export function CalendarSkeleton() {
  return (
    <div className="page-shell flex flex-col gap-6" aria-busy="true" aria-label="Loading the calendar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {block('h-9 w-9')}
          {block('h-9 w-9')}
          {block('h-7 w-40')}
        </div>
        <div className="flex gap-2">
          {block('h-9 w-24')}
          {block('h-9 w-24')}
          {block('h-9 w-28')}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-card border border-border bg-border">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="h-24 bg-white p-2">
            <Skeleton className="h-3 w-5 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** My Department: the tabs and the list, with the panel beside them on a wide screen. */
export function DepartmentSkeleton() {
  return (
    <div className="page-shell space-y-6" aria-busy="true" aria-label="Loading your department">
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-5">
          <div className="flex gap-6 border-b border-border pb-2">
            {block('h-6 w-20')}
            {block('h-6 w-24')}
            {block('h-6 w-20')}
          </div>
          <TableSkeleton rows={7} />
        </div>
        <div className="hidden space-y-3 xl:block">
          {block('h-40')}
          {block('h-56')}
        </div>
      </div>
    </div>
  );
}

/** A list screen: a toolbar, then the table. Companies, projects, retainers. */
export function ListSkeleton() {
  return (
    <div className="page-shell space-y-6" aria-busy="true" aria-label="Loading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {block('h-9 w-64')}
        {block('h-9 w-32')}
      </div>
      <TableSkeleton rows={8} />
    </div>
  );
}
