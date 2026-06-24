// DISC archetype lookup — the model returns the code; the app supplies the label/summary.
export const DISC_ARCHETYPES: Record<string, { name: string; summary: string }> = {
  D:  { name: 'The Driver',       summary: 'Results-first, fast decisions, low patience for process' },
  DC: { name: 'The Architect',    summary: 'Analytical, exacting, skeptical of claims until proven' },
  DI: { name: 'The Trailblazer',  summary: 'Ambitious and persuasive, drives change through people' },
  DS: { name: 'The Producer',     summary: 'Delivers consistently, driven but values team stability' },
  I:  { name: 'The Influencer',   summary: 'Enthusiastic, relationship-first, needs to feel heard' },
  ID: { name: 'The Motivator',    summary: 'High energy, persuasive, pushes for results through people' },
  IS: { name: 'The Collaborator', summary: 'Warm, inclusive, builds trust before making decisions' },
  IC: { name: 'The Advisor',      summary: 'Persuasive but data-backed, wants to help and inform' },
  S:  { name: 'The Steady',       summary: 'Loyal, consistent, avoids conflict, needs trust before buying' },
  SD: { name: 'The Specialist',   summary: 'Quiet expert, reliable, decides slowly but commits fully' },
  SI: { name: 'The Harmonizer',   summary: 'People-oriented, warm, dislikes pressure tactics' },
  SC: { name: 'The Coordinator',  summary: 'Systematic, careful, values process and accuracy above all' },
  C:  { name: 'The Analyst',      summary: 'Data-driven, detail-oriented, cautious and precise' },
  CD: { name: 'The Perfectionist',summary: 'High standards, critical thinker, challenges before committing' },
  CI: { name: 'The Diplomat',     summary: 'Balanced, thoughtful, builds consensus before deciding' },
  CS: { name: 'The Examiner',     summary: 'Systematic, careful, accuracy and process above all else' },
};

// Each trait's score (0–100) positions a dot on a gradient: 0 = left label, 100 = right label.
export const TRAIT_LABELS: { key: string; left: string; right: string }[] = [
  { key: 'risk',           left: 'Risk Tolerant',   right: 'Risk Averse' },
  { key: 'trust',          left: 'Trusting',        right: 'Skeptical' },
  { key: 'optimism',       left: 'Optimistic',      right: 'Pragmatic' },
  { key: 'pace',           left: 'Deliberate',      right: 'Fast-paced' },
  { key: 'expressiveness', left: 'Matter-of-fact',  right: 'Expressive' },
  { key: 'autonomy',       left: 'Collaborative',   right: 'Autonomous' },
  { key: 'dominance',      left: 'Supporting',      right: 'Dominant' },
];

export const PLAYBOOK_STAGES: { key: string; label: string }[] = [
  { key: 'first_impression',     label: 'First Impression' },
  { key: 'opener',               label: 'Opener' },
  { key: 'discovery',            label: 'Discovery Questions' },
  { key: 'value_prop',           label: 'Value Proposition' },
  { key: 'objection_handling',   label: 'Objection Handling' },
  { key: 'closing_move',         label: 'Closing Move' },
  { key: 'follow_up',            label: 'Follow-up Approach' },
  { key: 'relationship_building',label: 'Relationship Building' },
];

export const OCEAN_LABELS: Record<string, string> = {
  O: 'Openness', C: 'Conscientiousness', E: 'Extraversion', A: 'Agreeableness', N: 'Neuroticism',
};
