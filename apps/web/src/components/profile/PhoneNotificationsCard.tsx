'use client';

/**
 * Profile → Flowzen on your phone. Linked from My Work's Getting started card.
 *
 * Two parts. The app — always here: an Install button where the browser
 * offers one (Chrome and Edge, on Android and computers), the Share → Add to
 * Home Screen steps on an iPhone, and the address to open on a phone when
 * this is a computer.
 *
 * Then notifications — opt-in per person and per device: "Turn on" asks this
 * browser's permission and registers it; the list shows every device this
 * person turned on, each removable; three switches pick what is sent.
 * Bookings and task changes arrive on the phone even with Flowzen closed — in
 * working hours only, anything outside them waits for the next working
 * morning. Only offered when the organisation has them switched on and the
 * server has the keys; otherwise one line says so.
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/hooks/queries';
import toast from 'react-hot-toast';
import { Check, Download, Smartphone } from 'lucide-react';
import { api, ApiError, type PushPreferences } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { formatDate, formatRelativeDate } from '@/lib/utils';
import { currentSubscription, isInstalled, isIos, pushSupport, subscribeThisBrowser, type PushSupport } from '@/lib/pushDevice';
import { useInstallPrompt } from '@/lib/installPrompt';

const KINDS: { key: keyof PushPreferences; label: string; hint: string }[] = [
  {
    key: 'pushCalendar',
    label: 'Calendar',
    hint: 'When somebody books, moves, removes or cancels you — and the morning of.',
  },
  { key: 'pushTasks', label: 'My tasks', hint: 'A task somebody else gives you, or whose due date they change.' },
  { key: 'pushBell', label: 'Everything in my bell', hint: 'Every new alert your bell shows. It can be a lot.' },
];

/** What this device is: only knowable in the browser, so after mount. */
type ThisDevice = { ios: boolean; android: boolean; installed: boolean; host: string };

export function PhoneNotificationsCard() {
  const configQuery = useQuery({ queryKey: ['push-config'], queryFn: () => api.push.config() });
  const config = configQuery.data;
  const queryClient = useQueryClient();
  const enabled = Boolean(config?.enabled && config.publicKey);
  const devicesQuery = useQuery({ queryKey: ['push-devices'], queryFn: () => api.push.devices(), enabled });
  const prefsQuery = useQuery({ queryKey: ['push-preferences'], queryFn: () => api.push.preferences(), enabled });
  const { canInstall, justInstalled, install } = useInstallPrompt();

  const [device, setDevice] = useState<ThisDevice | null>(null);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState<'on' | 'test' | string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PushPreferences | null>(null);

  useEffect(() => {
    setDevice({
      ios: isIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0),
      android: /Android/i.test(navigator.userAgent),
      installed: isInstalled(),
      host: window.location.host,
    });
    const s = pushSupport();
    setSupport(s);
    if (s !== 'supported') return;
    setPermission(Notification.permission);
    void currentSubscription().then((sub) => setThisEndpoint(sub?.endpoint ?? null));
  }, []);

  useEffect(() => {
    if (prefsQuery.data) setPrefs(prefsQuery.data.preferences);
  }, [prefsQuery.data]);

  /*
   * Getting started links to /profile#phone-notifications, but Profile loads
   * behind a skeleton and this card waits for its config: the browser's own
   * jump finds nothing to land on. So once the card is drawn, go to it.
   */
  const ready = support !== null && device !== null && !configQuery.isPending;
  const jumped = useRef(false);
  useEffect(() => {
    if (!ready || jumped.current || window.location.hash !== '#phone-notifications') return;
    jumped.current = true;
    document.getElementById('phone-notifications')?.scrollIntoView({ block: 'start' });
  }, [ready]);

  if (!support || !device) return null;

  const phone = device.ios || device.android;
  const installed = device.installed || justInstalled;
  const devices = devicesQuery.data?.devices ?? [];
  // On here: this browser has a subscription AND the server still has it — a
  // device removed from another phone shows as off, not as on.
  const onHere = Boolean(thisEndpoint && devices.some((d) => d.endpoint === thisEndpoint));

  const installHere = async () => {
    const outcome = await install();
    if (outcome === 'accepted') toast.success(phone ? 'Installed. Open Flowzen from your home screen.' : 'Installed. Open Flowzen from your apps.');
  };

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
      // "Get Flowzen on your phone" on My Work's Getting started card.
      void queryClient.invalidateQueries({ queryKey: qk.gettingStarted });
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
          Flowzen on your phone
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-5">
        {problem && <ErrorNote onDismiss={() => setProblem(null)}>{problem}</ErrorNote>}

        {/* ── The app ───────────────────────────────────────────────── */}
        <div className="space-y-2" data-part="app">
          <p className="eyebrow">The app</p>
          {installed ? (
            <p className="flex items-center gap-2 text-sm font-medium text-primary">
              <Check className="h-4 w-4 text-success" strokeWidth={2.5} aria-hidden="true" />
              {justInstalled && !device.installed
                ? `Installed. Open Flowzen from your ${phone ? 'home screen' : 'apps'}.`
                : `Installed on this ${phone ? 'phone' : 'device'}.`}
            </p>
          ) : canInstall ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-body">
                {phone
                  ? 'Put Flowzen on your home screen, so it opens like an app.'
                  : 'Install Flowzen on this computer, so it opens in its own window.'}
              </p>
              <Button variant={phone ? 'primary' : 'secondary'} icon={Download} onClick={() => void installHere()}>
                Install app
              </Button>
            </div>
          ) : device.ios ? (
            <p className="text-sm text-body">
              In Safari, tap <span className="font-medium">Share</span> (the square with an arrow), then{' '}
              <span className="font-medium">Add to Home Screen</span>. Open Flowzen from the new icon.
            </p>
          ) : device.android ? (
            <p className="text-sm text-body">
              In Chrome, tap <span className="font-medium">⋮</span> (top right), then{' '}
              <span className="font-medium">Install app</span> — or <span className="font-medium">Add to Home screen</span>.
            </p>
          ) : null}
          {!phone && (
            <p className="text-sm text-secondary">
              On your phone, open <span className="font-medium text-primary">{device.host}</span>, then:
              <br />
              Android — in Chrome, tap <span className="font-medium">⋮</span> then{' '}
              <span className="font-medium">Install app</span>.
              <br />
              iPhone — in Safari, tap <span className="font-medium">Share</span> then{' '}
              <span className="font-medium">Add to Home Screen</span>, and open Flowzen from there.
            </p>
          )}
        </div>

        {/* ── Notifications ─────────────────────────────────────────── */}
        <div className="space-y-4 border-t border-border pt-4" data-part="notifications">
          <p className="eyebrow">Notifications</p>
          {!enabled ? (
            <p className="text-sm text-secondary">Phone notifications aren&apos;t switched on for Flowzen yet.</p>
          ) : (
            <>
              <p className="text-sm text-body">
                Bookings and task changes on your phone, even when Flowzen is closed. Only in working hours — anything
                outside them waits for the next working morning.
              </p>

              {/* This device */}
              {support === 'ios-not-installed' ? (
                <Note tone="info">
                  <span className="font-medium">On an iPhone, Flowzen has to be on your Home Screen first</span>{' '}
                  (above). Open it from there, then turn these on.
                </Note>
              ) : support === 'unsupported' ? (
                <Note>
                  This browser can&apos;t show notifications. On Android, use Chrome; on an iPhone, add Flowzen to the
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
                  Notifications are blocked for Flowzen in this browser. Allow them in its site settings, then come
                  back and turn this on.
                </Note>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-secondary">Off for this device.</p>
                  <Button variant="primary" onClick={() => void turnOn()} loading={busy === 'on'}>
                    Turn on
                  </Button>
                </div>
              )}

              {/* Every device this person turned on */}
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

              {/* What is sent */}
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
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
