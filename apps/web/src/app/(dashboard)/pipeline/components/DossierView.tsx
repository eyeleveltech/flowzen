'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { DISC_ARCHETYPES, TRAIT_LABELS, PLAYBOOK_STAGES, OCEAN_LABELS } from '../lib/intelligence-config';

// Renders a behavioural dossier (DISC / OCEAN / traits / context / playbook). Shared by the
// lead-level Intelligence tab and the per-contact dossier panel (Module G).
export function DossierView({ d }: { d: any }) {
  const [openStage, setOpenStage] = useState<string | null>(PLAYBOOK_STAGES[0].key);
  if (!d) return null;

  const oceanData = Object.entries(d?.ocean || {}).map(([k, v]) => ({ trait: OCEAN_LABELS[k] || k, value: Number(v) || 0 }));
  const archetype = d?.disc?.code ? DISC_ARCHETYPES[d.disc.code] : undefined;

  return (
    <div className="space-y-6">
      {/* DISC card */}
      <div className="rounded-xl border border-border bg-gray-50/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-primary">{d.disc?.name || archetype?.name || d.disc?.code}</span>
              <span className="text-[11px] font-mono font-semibold bg-primary text-white px-1.5 py-0.5 rounded">{d.disc?.code}</span>
            </div>
            <p className="text-sm text-secondary mt-1">{d.disc?.summary || archetype?.summary}</p>
          </div>
          {typeof d.disc?.confidence === 'number' && (
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold text-primary leading-none">{d.disc.confidence}%</p>
              <p className="text-[10px] text-secondary uppercase tracking-wider">confidence</p>
            </div>
          )}
        </div>
        {Array.isArray(d.disc?.tags) && d.disc.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {d.disc.tags.map((t: string, i: number) => (
              <span key={i} className="text-[11px] font-medium bg-white border border-border text-[#4B5563] px-2 py-0.5 rounded-full">{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* OCEAN + Traits */}
      <div className="grid md:grid-cols-2 gap-6">
        {oceanData.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2">OCEAN Profile</p>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={oceanData}>
                <PolarGrid stroke="#E5E7EB" />
                <PolarAngleAxis dataKey="trait" tick={{ fontSize: 10, fill: '#6B7280' }} />
                <Radar dataKey="value" stroke="#111827" fill="#111827" fillOpacity={0.15} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div>
          <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3">Behavioural Traits</p>
          <div className="space-y-3">
            {TRAIT_LABELS.map((t) => {
              const score = Math.max(0, Math.min(100, Number(d.traits?.[t.key]?.score) || 50));
              return (
                <div key={t.key}>
                  <div className="flex justify-between text-[11px] text-secondary mb-1">
                    <span>{t.left}</span>
                    <span className="font-medium text-[#374151]">{d.traits?.[t.key]?.label || ''}</span>
                    <span>{t.right}</span>
                  </div>
                  <div className="relative h-2 rounded-full bg-gradient-to-r from-gray-200 via-gray-300 to-gray-400">
                    <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-white shadow" style={{ left: `calc(${score}% - 6px)` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Current Context */}
      {d.context && (
        <div className="rounded-xl border border-border p-4">
          <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2">Current Context</p>
          <p className="text-sm text-[#374151]">{d.context.summary}</p>
          {Array.isArray(d.context.signals) && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {d.context.signals.map((s: string, i: number) => (
                <span key={i} className="text-[11px] font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{s}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Writing Style + Background */}
      <div className="grid md:grid-cols-2 gap-4">
        {d.writing_style && (
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2">Writing Style</p>
            <p className="text-sm text-[#374151]">Tone: <span className="font-medium">{d.writing_style.tone}</span></p>
            <p className="text-sm text-[#374151]">Participation: <span className="font-medium">{d.writing_style.participation}</span></p>
            {Array.isArray(d.writing_style.hooks) && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {d.writing_style.hooks.map((h: string, i: number) => (
                  <span key={i} className="text-[11px] bg-gray-100 text-[#4B5563] px-2 py-0.5 rounded-full">{h}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {d.background && (
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2">Background</p>
            <p className="text-sm text-[#374151]">Tenure: <span className="font-medium">{d.background.tenure_years} yrs</span></p>
            <p className="text-sm text-[#374151]">Industry depth: <span className="font-medium">{d.background.industry_depth}</span></p>
            <p className="text-sm text-[#374151]">Career pattern: <span className="font-medium">{d.background.career_pattern}</span></p>
          </div>
        )}
      </div>

      {/* Sales Playbook accordion */}
      {d.playbook && (
        <div>
          <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2">Sales Playbook</p>
          <div className="space-y-2">
            {PLAYBOOK_STAGES.map((s) => (
              <div key={s.key} className="border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenStage(openStage === s.key ? null : s.key)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-primary hover:bg-gray-50 transition-colors"
                >
                  {s.label}
                  <ChevronDown className={`w-4 h-4 text-secondary transition-transform ${openStage === s.key ? 'rotate-180' : ''}`} />
                </button>
                {openStage === s.key && (
                  <div className="px-4 pb-3 text-sm text-secondary leading-relaxed">{d.playbook[s.key] || '—'}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
