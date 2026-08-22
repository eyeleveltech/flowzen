/**
 * What every organisation needs before it can be used.
 *
 * This existed only in the seed, so an organisation created through /register got
 * modules and nothing else — no pipeline, so the board answered "No pipeline
 * configured"; no stages, so a deal had nothing to point at; no lost reasons, no
 * sources, no services. The app looked installed and was not.
 *
 * One definition, called from both the seed and registration. Idempotent, and it
 * takes a client so it can run inside the transaction that creates the
 * organisation — a half-configured organisation is worse than a failed signup.
 */

import { StageKind, CustomFieldType, CustomEntity, type Prisma } from '@prisma/client';

/** Anything that can run queries: the client, or a transaction. */
type Db = Prisma.TransactionClient;

export const DEFAULT_MODULES = ['CRM', 'PM', 'REVENUE'] as const;

/**
 * The default pipeline (§3.4).
 *
 * `requiresForecast`: from Negotiation onward a deal must carry a value and an
 * expected close date — a deal without both cannot appear in any forecast, so it
 * is invisible to planning while feeling like progress. A FLAG rather than a name
 * check, so renaming "Negotiation" cannot silently switch the rule off.
 */
export const STAGES = [
  { name: 'New Lead',    kind: StageKind.OPEN, probability: 0.10, rottingDays: 7,    requiresForecast: false },
  { name: 'Outreach',    kind: StageKind.OPEN, probability: 0.20, rottingDays: 7,    requiresForecast: false },
  { name: 'Meeting',     kind: StageKind.OPEN, probability: 0.40, rottingDays: 10,   requiresForecast: false },
  { name: 'Proposal',    kind: StageKind.OPEN, probability: 0.60, rottingDays: 14,   requiresForecast: false },
  { name: 'Negotiation', kind: StageKind.OPEN, probability: 0.75, rottingDays: 14,   requiresForecast: true  },
  { name: 'Contract',    kind: StageKind.OPEN, probability: 0.90, rottingDays: 10,   requiresForecast: true  },
  { name: 'Won',         kind: StageKind.WON,  probability: 1.00, rottingDays: null, requiresForecast: true  },
  { name: 'Lost',        kind: StageKind.LOST, probability: 0.00, rottingDays: null, requiresForecast: false },
];

export const CUSTOM_FIELDS = [
  {
    key: 'auditRequired',
    label: 'Audit required?',
    type: CustomFieldType.SELECT,
    options: ['No', 'Yes'],
    // Asked at Proposal, because that is when the scope is decided. Optional — a
    // form full of mandatory fields teaches people to type rubbish to get past it.
    stages: [{ stage: 'Proposal', required: false, position: 0 }],
  },
  {
    key: 'referredBy',
    label: 'Referred by',
    type: CustomFieldType.TEXT,
    options: null as string[] | null,
    stages: [{ stage: 'New Lead', required: false, position: 0 }],
  },
];

export const LOST_REASONS = [
  // The old enum carried both BUDGET and NO_BUDGET — two values nobody could
  // choose between, which is what an unmaintained enum looks like. One survives.
  'Price too high',
  'No budget',
  'Went with a competitor',
  'Timing was wrong',
  'Went unresponsive',
  'Scope mismatch',
  'Something changed internally',
  'Other',
];

export const LEAD_SOURCES = [
  'Referral',
  'Inbound enquiry',
  'Outbound',
  'LinkedIn',
  'Instagram',
  'WhatsApp',
  'Event',
  'Existing client',
  'Imported',
  'Other',
];

export const SERVICES = [
  { name: 'Social Media Management', unit: 'month', defaultRate: 40000 },
  { name: 'SEO',                     unit: 'month', defaultRate: 35000 },
  { name: 'Paid Ads Management',     unit: 'month', defaultRate: 30000 },
  { name: 'Content Production',      unit: 'month', defaultRate: 25000 },
  { name: 'Google Business Profile', unit: 'month', defaultRate: 10000 },
  { name: 'Email Marketing',         unit: 'month', defaultRate: 15000 },
  { name: 'Website Design & Build',  unit: 'project', defaultRate: 250000 },
  { name: 'Brand Identity',          unit: 'project', defaultRate: 150000 },
];

/**
 * Give an organisation everything it needs to work.
 *
 * Safe to run repeatedly — it upserts, so re-running it on a live organisation
 * restores anything missing without duplicating what is there.
 */
export async function bootstrapOrganization(
  db: Db,
  organizationId: string,
): Promise<{ pipelineId: string; stagesByName: Map<string, string> }> {
  for (const key of DEFAULT_MODULES) {
    await db.organizationModule.upsert({
      where: { organizationId_key: { organizationId, key } },
      update: {},
      create: { organizationId, key, enabled: true },
    });
  }

  for (const [position, name] of LOST_REASONS.entries()) {
    await db.lostReason.upsert({
      where: { organizationId_name: { organizationId, name } },
      update: { position },
      create: { organizationId, name, position },
    });
  }

  for (const [position, name] of LEAD_SOURCES.entries()) {
    await db.leadSource.upsert({
      where: { organizationId_name: { organizationId, name } },
      update: { position },
      create: { organizationId, name, position },
    });
  }

  for (const [position, s] of SERVICES.entries()) {
    await db.service.upsert({
      where: { organizationId_name: { organizationId, name: s.name } },
      update: { position },
      create: { organizationId, name: s.name, unit: s.unit, defaultRate: s.defaultRate, position },
    });
  }

  // Nobody's first experience should be a blank configuration screen (§4.3), and
  // a deal cannot exist without a stage to point at.
  let pipeline = await db.pipeline.findFirst({ where: { organizationId, isDefault: true } });
  if (!pipeline) {
    pipeline = await db.pipeline.create({
      data: { organizationId, name: 'Sales Pipeline', isDefault: true, position: 0 },
    });
  }

  const stagesByName = new Map<string, string>();

  for (const [position, s] of STAGES.entries()) {
    const existing = await db.stage.findFirst({ where: { pipelineId: pipeline.id, name: s.name } });
    const data = {
      position,
      kind: s.kind,
      probability: s.probability,
      rottingDays: s.rottingDays,
      requiresForecast: s.requiresForecast,
    };
    const stage = existing
      ? await db.stage.update({ where: { id: existing.id }, data })
      : await db.stage.create({ data: { ...data, pipelineId: pipeline.id, name: s.name } });
    stagesByName.set(s.name, stage.id);
  }

  // Partial unique indexes already enforce one WON and one LOST per pipeline, so
  // a bad edit above fails at the database. Assert it here too, for a message a
  // person can read.
  const won = STAGES.filter((s) => s.kind === StageKind.WON).length;
  const lost = STAGES.filter((s) => s.kind === StageKind.LOST).length;
  if (won !== 1 || lost !== 1) {
    throw new Error(`A pipeline needs exactly one WON and one LOST stage. Found ${won} won, ${lost} lost.`);
  }
  if (STAGES.at(-1)?.kind !== StageKind.LOST || STAGES.at(-2)?.kind !== StageKind.WON) {
    throw new Error('Won and Lost must be the last two stages — nothing may come after them.');
  }

  for (const [position, f] of CUSTOM_FIELDS.entries()) {
    const field = await db.customField.upsert({
      where: { organizationId_entity_key: { organizationId, entity: CustomEntity.DEAL, key: f.key } },
      update: { label: f.label, type: f.type, options: f.options ?? undefined, position },
      create: {
        organizationId,
        entity: CustomEntity.DEAL,
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options ?? undefined,
        position,
      },
    });

    for (const prompt of f.stages) {
      const stageId = stagesByName.get(prompt.stage);
      if (!stageId) throw new Error(`Stage "${prompt.stage}" not found for field "${f.key}"`);
      await db.stageField.upsert({
        where: { stageId_fieldId: { stageId, fieldId: field.id } },
        update: { required: prompt.required, position: prompt.position },
        create: { stageId, fieldId: field.id, required: prompt.required, position: prompt.position },
      });
    }
  }

  return { pipelineId: pipeline.id, stagesByName };
}
