'use client';

/**
 * "Sign in with Flowzen" — the consent screen (API Plan 2).
 *
 * Claude.ai (or ChatGPT) sends the browser here to ask whether it may act as
 * the person. They see who is asking, tick what it may do — the same boxes an
 * API key has, never more than they can do themselves — and are sent back to
 * the app with a code it exchanges for tokens. Everything the app then does
 * runs as them, and shows in the history as "via Claude connector".
 *
 * Outside the signed-in shell on purpose: a person arrives here from another
 * site, possibly signed out, and the API client's 401 handling takes them to
 * /login and back. The checks that matter are the server's; this screen only
 * shows what it is told and sends back the answer.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError, type OAuthAuthorizeInfo, type OAuthAuthorizeParams } from '@/lib/api-v2';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const PARAM_KEYS: (keyof OAuthAuthorizeParams)[] = [
  'client_id',
  'redirect_uri',
  'response_type',
  'state',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'resource',
];

/** The request as the app sent it, read once from the address. */
function readParams(): OAuthAuthorizeParams | null {
  const search = new URLSearchParams(window.location.search);
  const out: Partial<OAuthAuthorizeParams> = {};
  for (const k of PARAM_KEYS) {
    const v = search.get(k);
    if (v !== null) out[k] = v;
  }
  return out.client_id ? (out as OAuthAuthorizeParams) : null;
}

type Problem = { message: string; redirectTo: string | null };

export default function OAuthAuthorizePage() {
  usePageTitle('Connect an app');
  const [params, setParams] = useState<OAuthAuthorizeParams | null | undefined>(undefined);
  const [info, setInfo] = useState<OAuthAuthorizeInfo | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = readParams();
    setParams(p);
    if (!p) {
      setProblem({ message: 'This sign-in link is incomplete. Start again from the app.', redirectTo: null });
      return;
    }
    api.oauth
      .authorizeInfo(p)
      .then((i) => {
        setInfo(i);
        setTicked(i.scopes.map((s) => s.key));
      })
      .catch((e) => {
        const data = e instanceof ApiError ? (e.data as { redirectTo?: string | null } | undefined) : undefined;
        setProblem({ message: e instanceof ApiError ? e.message : 'Could not read the sign-in request.', redirectTo: data?.redirectTo ?? null });
      });
  }, []);

  const groups = useMemo(() => (info ? [...new Set(info.scopes.map((s) => s.group))] : []), [info]);

  const answer = async (decision: 'allow' | 'deny') => {
    if (!params) return;
    setBusy(true);
    try {
      const out = await api.oauth.decide({ decision, scopes: decision === 'allow' ? ticked : [], params });
      window.location.href = out.redirectTo;
    } catch (e) {
      const data = e instanceof ApiError ? (e.data as { redirectTo?: string | null } | undefined) : undefined;
      setProblem({ message: e instanceof ApiError ? e.message : 'Could not record your answer.', redirectTo: data?.redirectTo ?? null });
      setBusy(false);
    }
  };

  const toggle = (key: string, on: boolean) => setTicked((t) => (on ? [...t, key] : t.filter((k) => k !== key)));

  return (
    <div className="flex min-h-screen items-center justify-center bg-subtle px-4 py-10">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <img src="/logo_flowzen.png" alt="Flowzen" width={160} height={44} className="h-10 w-auto object-contain" />
        </div>

        <div className="rounded-2xl border border-line bg-white p-6">
          {problem ? (
            <Trouble problem={problem} />
          ) : !info ? (
            <p className="text-sm text-secondary">Checking who is asking…</p>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-primary">
                Let {info.app.name} use Flowzen as you?
              </h1>
              <p className="mt-1 text-sm text-secondary">
                {info.app.name} ({info.app.host}) wants to work in Flowzen as <span className="font-medium text-primary">{info.me.name}</span>.
                It will only be able to do what you tick, and never more than you can do yourself.
              </p>

              <fieldset className="mt-5">
                <legend className="eyebrow mb-2">It may</legend>
                <div className="space-y-4">
                  {groups.map((g) => (
                    <div key={g}>
                      <p className="mb-1.5 text-xs font-semibold text-primary">{g}</p>
                      <div className="space-y-2">
                        {info.scopes
                          .filter((s) => s.group === g)
                          .map((s) => (
                            <label key={s.key} className="flex cursor-pointer items-start gap-2.5">
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 rounded border-line text-primary focus:ring-primary"
                                checked={ticked.includes(s.key)}
                                onChange={(e) => toggle(s.key, e.target.checked)}
                              />
                              <span>
                                <span className="block text-sm text-body">{s.label}</span>
                                <span className="block text-micro text-secondary">{s.description}</span>
                              </span>
                            </label>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>

              {info.notYours.length > 0 && (
                <p className="mt-4 text-micro text-secondary">
                  It also asked for {info.notYours.join(', ')}, which you cannot do in Flowzen, so it will not get those.
                </p>
              )}

              <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-info/30 bg-info-tint px-3 py-2.5 text-xs text-info">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Everything it does shows in the history as you, via {info.app.name}. You can disconnect it any time in
                  Settings → API. Allowing sends you back to <span className="font-medium">{info.app.returnsTo}</span>.
                </p>
              </div>

              <div className={cn('mt-6 flex gap-2', busy && 'opacity-70')}>
                <Button type="button" variant="ghost" className="flex-1" onClick={() => void answer('deny')} disabled={busy}>
                  Don&rsquo;t allow
                </Button>
                <Button type="button" variant="primary" className="flex-1" onClick={() => void answer('allow')} loading={busy} disabled={ticked.length === 0}>
                  Allow
                </Button>
              </div>

              <p className="mt-4 text-center text-micro text-secondary">
                Signed in as {info.me.email}.{' '}
                <Link
                  href={`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`}
                  className="underline-offset-2 hover:text-primary hover:underline"
                >
                  Not you?
                </Link>
              </p>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/** Something was wrong with the request. If the app can be told, there is a way back to it. */
function Trouble({ problem }: { problem: Problem }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-primary">This sign-in cannot go ahead</h1>
      <p className="mt-2 text-sm text-body">{problem.message}</p>
      <div className="mt-6 flex gap-2">
        {problem.redirectTo ? (
          <Button type="button" variant="primary" onClick={() => (window.location.href = problem.redirectTo!)}>
            Back to the app
          </Button>
        ) : (
          <Link href="/my-work" className="text-sm text-secondary underline-offset-2 hover:text-primary hover:underline">
            Go to Flowzen
          </Link>
        )}
      </div>
    </div>
  );
}
