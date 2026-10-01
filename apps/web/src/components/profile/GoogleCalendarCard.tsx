'use client';

/**
 * Your Google Calendar, connected to Flowzen — or not; it is optional.
 *
 * Connected, Flowzen reads your primary calendar as busy time (others see
 * only "Busy"; you see your own titles) and writes the meetings and shoots you
 * are on into a "Flowzen" calendar in your Google. Nobody who does not connect
 * sees any difference.
 *
 * Absent entirely when the organisation has not switched it on, or the server
 * has no Google keys.
 */

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CalendarDays } from 'lucide-react';
import { api, ApiError } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Button, buttonClass } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/empty-state';
import { useConfirmStore } from '@/stores/confirm';
import { formatRelativeDate } from '@/lib/utils';

export function GoogleCalendarCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirmStore((st) => st.confirm);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { data, refetch } = useQuery({ queryKey: ['google-status'], queryFn: () => api.google.status() });

  // Back from Google: say how it went, once, and take it out of the address.
  const outcome = searchParams.get('google');
  useEffect(() => {
    if (!outcome) return;
    if (outcome === 'connected') toast.success('Google Calendar connected');
    else setProblem("Google Calendar didn't connect. Try again — and use your company Google account.");
    router.replace('/profile', { scroll: false });
    void refetch();
  }, [outcome, router, refetch]);

  if (!data?.enabled) return null;

  const connect = () => {
    window.location.href = api.google.connectUrl();
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect Google Calendar?',
      message:
        'Flowzen will stop reading your busy time and remove what it has stored, delete the "Flowzen" calendar it made in your Google account, and give up its access to your Google.',
      confirmText: 'Disconnect',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.google.disconnect();
      toast.success('Disconnected');
      await refetch();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not disconnect');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-secondary" strokeWidth={1.75} aria-hidden="true" />
          Google Calendar
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {problem && <ErrorNote onDismiss={() => setProblem(null)}>{problem}</ErrorNote>}

        {!data.connected ? (
          <>
            <p className="text-sm text-body">
              Optional. Connect your company Google account and Flowzen shows when you are busy — to others only as
              &ldquo;Busy&rdquo; — and puts the meetings and shoots you are on into a &ldquo;Flowzen&rdquo; calendar in
              your Google.
            </p>
            <button type="button" onClick={connect} className={buttonClass('primary')}>
              Connect Google Calendar
            </button>
          </>
        ) : data.status === 'NEEDS_RECONNECT' ? (
          <>
            <p className="text-sm text-body">
              Google stopped accepting Flowzen&apos;s access for <span className="font-medium">{data.googleEmail}</span>,
              so your busy time and meetings are not syncing. Connect again to pick up where it left off.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={connect} className={buttonClass('primary')}>
                Reconnect
              </button>
              <Button variant="danger" onClick={() => void disconnect()} loading={busy}>
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-body">
              Connected as <span className="font-medium">{data.googleEmail}</span>
              {data.lastSyncedAt ? (
                <span className="text-secondary"> · last synced {formatRelativeDate(data.lastSyncedAt)}</span>
              ) : null}
            </p>
            <p className="text-xs text-secondary">
              Your Google events show in Flowzen as busy time, and only you see their titles. Meetings and shoots you
              are on appear in the &ldquo;Flowzen&rdquo; calendar in your Google — change them in Flowzen.
            </p>
            <Button variant="danger" onClick={() => void disconnect()} loading={busy}>
              Disconnect
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}
