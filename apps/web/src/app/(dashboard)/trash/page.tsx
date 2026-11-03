'use client';

/**
 * Trash, for whoever deleted the thing.
 *
 * It was only a tab in Settings, and Settings is admin-only — so every delete
 * dialog that said "it can be restored" sent BD, Accounts and heads to a screen
 * they could not open. The same tab, here, shows each person the sections they
 * can put back (see TrashTab on which access each needs). Reached from the
 * account menu; Settings keeps its tab for admins.
 */

import { PageHeader } from '@/components/PageHeader';
import { TrashTab } from '@/app/(dashboard)/settings/components/TrashTab';

export default function TrashPage() {
  return (
    <div className="page-shell">
      <PageHeader title="Trash" subtitle="Deleted, not destroyed. Put back anything you deleted by mistake." />
      <div className="mx-auto max-w-4xl lg:mx-0">
        <TrashTab />
      </div>
    </div>
  );
}
