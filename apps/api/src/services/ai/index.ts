import { anthropic } from './anthropic.js';
import { gemini } from './gemini.js';
import { openai, openaiCompatible } from './openai.js';
import { AI_PROVIDER_IDS, type AiProvider, type AiProviderId } from './types.js';

export { AssistantFailed, AssistantNotConfigured } from './errors.js';
export { AI_PROVIDER_IDS } from './types.js';
export type {
  AiProvider,
  AiProviderId,
  AiReply,
  AiRequest,
  AiTool,
  AiToolCall,
  AiToolResult,
  AiTurn,
} from './types.js';

/**
 * Which models Zen can be pointed at.
 *
 * Four entries, three adapters: OpenAI and "OpenAI-compatible" share a protocol
 * and differ only in where they send it and what they default to. That last
 * entry is the one that makes this list open-ended rather than a list of the
 * integrations there was time for — OpenRouter, Groq, Together, DeepSeek,
 * Mistral, Azure, vLLM and Ollama all speak the same protocol.
 */
const PROVIDERS: Record<AiProviderId, AiProvider> = {
  GEMINI: gemini,
  OPENAI: openai,
  ANTHROPIC: anthropic,
  OPENAI_COMPATIBLE: openaiCompatible,
};

export const isProviderId = (v: unknown): v is AiProviderId =>
  typeof v === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(v);

/**
 * The adapter for a stored setting.
 *
 * Falls back to Gemini rather than throwing: the column is a string in the
 * database and a value that is not one of ours means a bad migration or a hand
 * edit, neither of which should take the assistant down. The answer will name
 * the wrong provider in its errors, which is a clearer symptom than a 500.
 */
export const providerFor = (id: string | null | undefined): AiProvider =>
  isProviderId(id) ? PROVIDERS[id] : gemini;

/** What Settings offers, in the order it should read. */
export const providerChoices = () =>
  AI_PROVIDER_IDS.map((id) => ({
    id,
    label: PROVIDERS[id].label,
    defaultModel: PROVIDERS[id].defaultModel,
    defaultBaseUrl: PROVIDERS[id].defaultBaseUrl,
    needsBaseUrl: Boolean(PROVIDERS[id].needsBaseUrl),
  }));
