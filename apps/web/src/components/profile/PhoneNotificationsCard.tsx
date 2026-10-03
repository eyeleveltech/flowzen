'use client';

/**
 * Profile → Phone notifications.
 *
 * Opt-in per person and per device: "Turn on" asks this browser's permission
 * and registers it; the list shows every device this person turned on, each
 * removable; four switches pick what is sent. Approvals, bookings and task
 * changes arrive on the phone even with Flowzen closed — in working hours only,
 * anything outside them waits for the next working morning.
 *
 * Absent entirely when the organisation has it switched off, or the server has
 * no keys for it.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Smartphone } from 'lucide-react';
import { api, ApiError, type PushPreferences } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { formatDate, formatRelativeDate } from '@/lib/utils';
import { currentSubscription, pushSupport, subscribeThisBrowser, type PushSupport } from '@/lib/pushDevice';

const KINDS: { key: keyof PushPreferences; label: string; hint: string }[] = [
  { key: 'pushApprovals', label: 'Approvals', hint: 'Work waiting for you to approve, and the answer on work you sent.' },
  {
    key: 'pushCalendar',
    label: 'Calendar',
    hint: 'When somebody books, moves, removes or cancels you — and the morning of.',
  },
  { key: 'pushTasks', label: 'My tasks', hint: 'A task somebody else gives you, or whose due date they change.' },
  { key: 'pushBell', label: 'Everything in my bell', hint: 'Every new alert your bell shows. It can be a lot.' },
];

export function PhoneNotificationsCard() {
  const { data: config } = useQuery({ queryKey: ['push-config'], queryFn: () => api.push.config() });
  const enabled = Boolean(config?.enabled && config.publicKey);
  const devicesQuery = useQuery({ queryKey: ['push-devices'], queryFn: () => api.push.devices(), enabled });
  const prefsQuery = useQuery({ queryKey: ['push-preferences'], queryFn: () => api.push.preferences(), enabled });

  // What this browser is: only knowable in the browser, so after mount.
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState<'on' | 'test' | string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PushPreferences | null>(null);

  useEffect(() => {
    const s = pushSupport();
    setSupport(s);
    if (s !== 'supported') return;
    setPermission(Notification.permission);
    void currentSubscription().then((sub) => setThisEndpoint(sub?.endpoint ?? null));
  }, []);

  useEffect(() => {
    if (prefsQuery.data) setPrefs(prefsQuery.data.preferences);
  }, [prefsQuery.data]);

  if (!enabled || !support) return null;

  const devices = devicesQuery.data?.devices ?? [];
  // On here: this browser has a subscription AND the server still has it — a
  // device removed from another phone shows as off, not as on.
  const onHere = Boolean(thisEndpoint && devices.some((d) => d.endpoint === thisEndpoint));

  const turnOn = async () => {
    setProblem(null);
    setBusy('on');
    try {
      // First thing in the tap: iOS only shows the prompt for a direct tap.
      const answer = await Notification.requestPermission();
      setPermission(answer);
      if (answer !== 'granted') {
        setProblem(
          answer === 'denied'
            ? 'Notifications are blocked for Flowzen in this browser. Allow them in its site settings, then try again.'
            : 'Flowzen needs your permission to show notifications. Tap Turn on again and choose Allow.',
        );
        return;
      }
      const sub = await subscribeThisBrowser(config!.publicKey!);
      await api.push.subscribe(sub);
      setThisEndpoint(sub.endpoint);
      await devicesQuery.refetch();
      toast.success('Phone notifications on for this device');
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "This device couldn't turn them on. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, endpoint: string) => {
    setProblem(null);
    setBusy(id);
    try {
      await api.push.removeDevice(id);
      // This browser too: stop it holding a subscription nobody sends to.
      if (endpoint === thisEndpoint) {
        const sub = await currentSubscription();
        await sub?.unsubscribe().catch(() => undefined);
        setThisEndpoint(null);
      }
      await devicesQuery.refetch();
      toast.success('Device removed');
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Couldn't remove that device");
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setProblem(null);
    setBusy('test');
    try {
      const { devices: n } = await api.push.test();
      toast.success(n === 1 ? 'Test sent. It should arrive in a few seconds.' : `Test sent to your ${n} devices.`);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Couldn't send a test");
    } finally {
      setBusy(null);
    }
  };

  const setKind = async (key: keyof PushPreferences, value: boolean) => {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });
    try {
      const res = await api.push.setPreferences({ [key]: value });
      setPrefs(res.preferences);
    } catch (e) {
      setPrefs(before);
      setProblem(e instanceof ApiError ? e.message : "Couldn't save that");
    }
  };

  return (
    <Card padding="none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-secondary" strokeWidth={1.75} aria-hidden="true" />
          Phone notifications
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-5">
        {problem && <ErrorNote onDismiss={() => setProblem(null)}>{problem}</ErrorNote>}

        <p className="text-sm text-body">
          Approvals, bookings and task changes on your phone, even when Flowzen is closed. Only in working hours —
          anything outside them waits for the next working morning.
        </p>

        {/* ── This device ───────────────────────────────────────────── */}
        {support === 'ios-not-installed' ? (
          <Note tone="info">
            <span className="font-medium">On an iPhone, Flowzen has to be on your Home Screen first.</span> Tap Share →
            Add to Home Screen, open Flowzen from there, then turn this on.
          </Note>
        ) : support === 'unsupported' ? (
          <Note>
            This browser can&apos;t show phone notifications. On Android, use Chrome; on an iPhone, add Flowzen to the
            Home Screen and open it from there.
          </Note>
        ) : onHere ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-primary">On for this device</p>
            <Button size="sm" onClick={() => void sendTest()} loading={busy === 'test'}>
              Send a test
            </Button>
          </div>
        ) : permission === 'denied' ? (
          <Note tone="warn">
            Notifications are blocked for Flowzen in this browser. Allow them in its site settings, then come back and
            turn this on.
          </Note>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-secondary">Off for this device.</p>
            <Button variant="primary" onClick={() => void turnOn()} loading={busy === 'on'}>
              Turn on
            </Button>
          </div>
        )}

        {/* ── Every device this person turned on ────────────────────── */}
        {devices.length > 0 && (
          <div className="space-y-2">
            <p className="eyebrow">Your devices</p>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm text-primary">{d.deviceLabel ?? 'Device'}</p>
                      {d.endpoint === thisEndpoint && (
                        <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-micro font-semibold text-secondary">
                          This device
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-secondary">
                      Added {formatDate(d.createdAt)}
                      {d.lastUsedAt ? ` · last notified ${formatRelativeDate(d.lastUsedAt)}` : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void remove(d.id, d.endpoint)}
                    loading={busy === d.id}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── What is sent ──────────────────────────────────────────── */}
        {devices.length > 0 && prefs && (
          <div className="space-y-2">
            <p className="eyebrow">Send me</p>
            <ul className="space-y-3">
              {KINDS.map((k) => (
                <li key={k.key} className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-primary">{k.label}</p>
                    <p className="text-xs text-secondary">{k.hint}</p>
                  </div>
                  <Toggle
                    checked={prefs[k.key]}
                    onChange={(v) => void setKind(k.key, v)}
                    label={k.label}
                    labelClassName="sr-only"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
