import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';

export interface IntelligenceResult {
  success: boolean;
  dossier?: any;
  error?: string;
}

// Pull profile sections from the Apify LinkedIn scraper response, applying the
// character limits from the brief (§6.2) before sending to GPT-4o.
function extractProfileSections(profile: any) {
  // Field names tuned for harvestapi/linkedin-profile-scraper, with fallbacks for other actors.
  const name = profile?.fullName || [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || '';
  const company =
    profile?.currentPosition?.[0]?.companyName ||
    profile?.currentCompany?.name ||
    profile?.experience?.[0]?.companyName ||
    profile?.companyName || '';
  return {
    name,
    headline: profile?.headline || '',
    company,
    about: (profile?.summary || profile?.about || '').slice(0, 2000),
    experience: (
      (profile?.experience || profile?.experiences || [])
        .map((e: any) => `${e.position || e.title || ''} at ${e.companyName || e.company || ''} (${e.duration || ''}): ${e.description || ''}`)
        .join('\n')
    ).slice(0, 2500),
    education: (
      (profile?.education || [])
        .map((e: any) => `${[e.degree, e.fieldOfStudy].filter(Boolean).join(' ') || e.title || ''} at ${e.schoolName || e.school || ''} (${e.startDate?.year || e.year || ''})`.trim())
        .join('\n')
    ).slice(0, 1000),
    skills: ((profile?.skills || []).map((s: any) => (typeof s === 'string' ? s : s.name || s.title)).filter(Boolean).join(', ')).slice(0, 500),
    activity: ((profile?.posts || []).map((p: any) => p.text).filter(Boolean).join('\n')).slice(0, 1500),
  };
}

function buildPrompt(s: ReturnType<typeof extractProfileSections>): string {
  return `You are an expert B2B sales psychologist and behavioural analyst.

Analyse the LinkedIn profile text below and return ONLY valid JSON matching the schema exactly.
Do not add any explanation, markdown fences, or extra keys.

PROFILE TEXT:
Name: ${s.name}
Headline: ${s.headline}
Company: ${s.company}

ABOUT:
${s.about}

EXPERIENCE:
${s.experience}

EDUCATION:
${s.education}

SKILLS:
${s.skills}

ACTIVITY / RECENT POSTS:
${s.activity}

Return JSON with this exact structure:

{
  "disc": {
    "code": "DC",
    "confidence": 87,
    "name": "The Architect",
    "summary": "one sentence read on this person",
    "tags": ["#systems-thinker", "#direct", "#high-standards"]
  },
  "ocean": { "O": 72, "C": 85, "E": 38, "A": 45, "N": 55 },
  "traits": {
    "risk":           { "score": 35, "label": "Risk Averse" },
    "trust":          { "score": 40, "label": "Skeptical" },
    "optimism":       { "score": 45, "label": "Pragmatic" },
    "pace":           { "score": 50, "label": "Deliberate" },
    "expressiveness": { "score": 25, "label": "Matter-of-fact" },
    "autonomy":       { "score": 55, "label": "Collaborative" },
    "dominance":      { "score": 60, "label": "Supporting" }
  },
  "context": {
    "summary": "2-3 sentences on what this person is dealing with right now based on their posts and career moves",
    "signals": ["signal 1", "signal 2", "signal 3"]
  },
  "writing_style": {
    "tone": "formal",
    "participation": "lurker",
    "hooks": ["hook 1 tied to a real thing they posted or mentioned", "hook 2"]
  },
  "background": {
    "tenure_years": 3,
    "industry_depth": "Healthcare",
    "career_pattern": "operator"
  },
  "playbook": {
    "first_impression": "How to show up — energy, pace, format of the first interaction",
    "opener": "The exact type of opener that works for this personality type — with an example line",
    "discovery": "What questions to ask and in what order — what this person will and will not respond to",
    "value_prop": "How to frame EyeLevel's value for this specific person — what matters to them",
    "objection_handling": "The objections this profile typically raises and how to handle them",
    "closing_move": "How to move to next step — what this personality responds to",
    "follow_up": "How to follow up without annoying this type of person",
    "relationship_building": "Long-term: what builds trust with this profile over time"
  }
}

Method: Derive the DISC code from OCEAN scores internally. O and E drive I. C drives C and D. Low A and high C drives D. Do not show your reasoning — only output the final JSON.`;
}

export async function runIntelligence(linkedinUrl: string): Promise<IntelligenceResult> {
  if (!process.env.APIFY_TOKEN) return { success: false, error: 'APIFY_TOKEN is not configured on the server.' };
  if (!process.env.OPENAI_API_KEY) return { success: false, error: 'OPENAI_API_KEY is not configured on the server.' };
  if (!linkedinUrl) return { success: false, error: 'No LinkedIn URL provided for this lead.' };

  // Actor slug is configurable so you can swap to whichever LinkedIn scraper you have access to.
  const actorId = process.env.APIFY_LINKEDIN_ACTOR || 'harvestapi/linkedin-profile-scraper';
  // Input field name varies between actors (profileUrls / urls / startUrls). Override via env if needed.
  const inputKey = process.env.APIFY_LINKEDIN_INPUT_KEY || 'profileUrls';
  const isHarvest = actorId.includes('harvestapi');

  let profile: any;
  try {
    const apify = new ApifyClient({ token: process.env.APIFY_TOKEN });
    const input: any = isHarvest
      ? {
          // harvestapi expects `queries` + a required scraper mode.
          profileScraperMode: process.env.APIFY_LINKEDIN_MODE || 'Profile details no email ($4 per 1k)',
          queries: [linkedinUrl],
        }
      : inputKey === 'startUrls'
        ? { startUrls: [{ url: linkedinUrl }] }
        : { [inputKey]: [linkedinUrl] };
    const run = await apify.actor(actorId).call(input);
    const { items } = await apify.dataset(run.defaultDatasetId).listItems();
    profile = items?.[0];
    if (!profile) return { success: false, error: 'No profile data returned from LinkedIn. Check the URL.' };
  } catch (e: any) {
    return { success: false, error: `LinkedIn scrape failed (actor "${actorId}"): ${e?.message || 'unknown error'}` };
  }

  let raw: string;
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      messages: [{ role: 'user', content: buildPrompt(extractProfileSections(profile)) }],
    });
    raw = completion.choices[0]?.message?.content || '';
  } catch (e: any) {
    return { success: false, error: `Analysis failed: ${e?.message || 'unknown error'}` };
  }

  // Strip markdown fences if GPT-4o wraps the response, then parse.
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return { success: true, dossier: JSON.parse(raw) };
  } catch {
    return { success: false, error: 'Failed to parse intelligence response. Please retry.' };
  }
}
