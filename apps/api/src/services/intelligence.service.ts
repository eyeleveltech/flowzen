import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';

export type IntelligenceErrorCode =
  | 'TIMEOUT'
  | 'TOKEN_LIMIT'
  | 'INVALID_API_KEY'
  | 'RATE_LIMITED'
  | 'NO_DATA'
  | 'INVALID_URL'
  | 'PARSE_ERROR'
  | 'CONFIG_ERROR'
  | 'UNKNOWN';

export interface IntelligenceResult {
  success: boolean;
  dossier?: any;
  error?: string;
  code?: IntelligenceErrorCode;
  tokensUsed?: number;
  durationMs?: number;
}

const APIFY_TIMEOUT_MS = Number(process.env.APIFY_TIMEOUT_MS) || 120000;
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS) || 60000;
const OPENAI_MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS) || 2048;

function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(errorMessage);
      (err as any).isTimeout = true;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

// Pull profile sections from the Apify LinkedIn scraper response, applying the
// character limits from the brief (§6.2) before sending to GPT-4o.
function extractProfileSections(profile: any) {
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
  const startTime = Date.now();

  if (!process.env.APIFY_TOKEN) {
    return { success: false, code: 'CONFIG_ERROR', error: 'APIFY_TOKEN is not configured on the server.' };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { success: false, code: 'CONFIG_ERROR', error: 'OPENAI_API_KEY is not configured on the server.' };
  }
  if (!linkedinUrl) {
    return { success: false, code: 'INVALID_URL', error: 'No LinkedIn URL provided for this lead.' };
  }

  const actorId = process.env.APIFY_LINKEDIN_ACTOR || 'harvestapi/linkedin-profile-scraper';
  const inputKey = process.env.APIFY_LINKEDIN_INPUT_KEY || 'profileUrls';
  const isHarvest = actorId.includes('harvestapi');

  let profile: any;
  try {
    const apify = new ApifyClient({ token: process.env.APIFY_TOKEN });
    const input: any = isHarvest
      ? {
          profileScraperMode: process.env.APIFY_LINKEDIN_MODE || 'Profile details no email ($4 per 1k)',
          queries: [linkedinUrl],
        }
      : inputKey === 'startUrls'
        ? { startUrls: [{ url: linkedinUrl }] }
        : { [inputKey]: [linkedinUrl] };

    const runApify = async () => {
      const run = await apify.actor(actorId).call(input);
      const { items } = await apify.dataset(run.defaultDatasetId).listItems();
      return items?.[0];
    };

    profile = await withTimeout(runApify(), APIFY_TIMEOUT_MS, 'LinkedIn scraper timed out. Please try again.');
    if (!profile) {
      return { success: false, code: 'NO_DATA', error: 'No profile data returned from LinkedIn. Check the URL.' };
    }
  } catch (e: any) {
    if (e?.isTimeout || e?.message?.includes('timed out')) {
      return { success: false, code: 'TIMEOUT', error: 'LinkedIn scraper timed out. Please try again.' };
    }
    if (e?.status === 401 || e?.statusCode === 401 || e?.message?.includes('401') || e?.message?.includes('unauthorized') || e?.message?.includes('invalid')) {
      return { success: false, code: 'INVALID_API_KEY', error: 'Apify API key is invalid or unauthorized.' };
    }
    if (e?.status === 429 || e?.statusCode === 429) {
      return { success: false, code: 'RATE_LIMITED', error: 'Apify rate limit exceeded. Please wait and try again.' };
    }
    return { success: false, code: 'UNKNOWN', error: `LinkedIn scrape failed (actor "${actorId}"): ${e?.message || 'unknown error'}` };
  }

  let raw: string;
  let tokensUsed: number | undefined;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create(
      {
        model: 'gpt-4o',
        temperature: 0,
        max_tokens: OPENAI_MAX_TOKENS,
        messages: [{ role: 'user', content: buildPrompt(extractProfileSections(profile)) }],
      },
      { signal: controller.signal }
    );
    raw = completion.choices[0]?.message?.content || '';
    tokensUsed = completion.usage?.total_tokens;
  } catch (e: any) {
    if (e?.name === 'AbortError' || controller.signal.aborted) {
      return { success: false, code: 'TIMEOUT', error: 'OpenAI analysis timed out. Please try again.' };
    }
    if (e instanceof OpenAI.AuthenticationError || e?.status === 401) {
      return { success: false, code: 'INVALID_API_KEY', error: 'OpenAI API key is invalid or unauthorized.' };
    }
    if (e instanceof OpenAI.RateLimitError || e?.status === 429) {
      return { success: false, code: 'RATE_LIMITED', error: 'OpenAI rate limit exceeded. Please wait and try again.' };
    }
    if (e?.status === 400 && (e?.code === 'context_length_exceeded' || e?.message?.includes('context_length'))) {
      return { success: false, code: 'TOKEN_LIMIT', error: 'Profile is too large for the model. Try a shorter profile URL.' };
    }
    return { success: false, code: 'UNKNOWN', error: `Analysis failed: ${e?.message || 'unknown error'}` };
  } finally {
    clearTimeout(timeoutId);
  }

  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const dossier = JSON.parse(raw);
    const durationMs = Date.now() - startTime;
    return { success: true, dossier, tokensUsed, durationMs };
  } catch {
    return { success: false, code: 'PARSE_ERROR', error: 'Failed to parse intelligence response. Please retry.' };
  }
}
