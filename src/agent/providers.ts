// SVGcinema — agent/providers
// The model providers the agent can talk to, and how to build a client for each. Everything here is
// called from the browser with the user's own key; nothing goes through an SVGcinema server.
import { anthropicClient } from './clients/anthropic';
import { openAIClient } from './clients/openai';
import type { Client } from './clients/types';

export type ProviderId = 'openrouter' | 'openai' | 'anthropic' | 'gemini' | 'groq' | 'custom';

export interface Provider {
  id: ProviderId;
  label: string;
  /** chat endpoint ('' for Custom: the user gives the address) */
  chat: string;
  kind: 'openai' | 'anthropic';
  /** has image models the agent can use */
  images: boolean;
  /** a few models to start with; any other name can be typed. These are starting points: the
   *  panel's Test checks a model against the provider before it's used. */
  models: string[];
}

export const PROVIDERS: Provider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    chat: 'https://openrouter.ai/api/v1/chat/completions',
    kind: 'openai',
    images: true,
    models: ['anthropic/claude-sonnet-5.5', 'openai/gpt-5.5', 'google/gemini-3.8-flash'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    chat: 'https://api.openai.com/v1/chat/completions',
    kind: 'openai',
    images: true,
    models: ['gpt-5.5', 'gpt-5.5-mini'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    chat: 'https://api.anthropic.com/v1/messages',
    kind: 'anthropic',
    images: false,
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    chat: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    kind: 'openai',
    images: true,
    models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
  },
  {
    id: 'groq',
    label: 'Groq',
    chat: 'https://api.groq.com/openai/v1/chat/completions',
    kind: 'openai',
    images: false,
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  },
  { id: 'custom', label: 'Custom', chat: '', kind: 'openai', images: false, models: [] },
];

export const providerById = (id: string) => PROVIDERS.find(p => p.id === id);

export interface ModelChoice {
  provider: ProviderId;
  model: string;
  key: string;
  /** Custom: the service's base address, such as https://api.mistral.ai/v1 */
  base?: string;
}

/** The chat completions URL for a Custom base address (with or without the /chat/completions part). */
export function customChatUrl(base: string) {
  const b = base.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(b) ? b : b + '/chat/completions';
}

export function makeClient(c: ModelChoice): Client {
  const p = providerById(c.provider);
  if (!p) throw new Error(`Unknown provider ${c.provider}`);
  if (p.kind === 'anthropic') return anthropicClient({ key: c.key, model: c.model });
  const url = p.id === 'custom' ? customChatUrl(c.base || '') : p.chat;
  return openAIClient({
    provider: p.id === 'custom' ? 'the service' : p.label,
    url,
    key: c.key,
    model: c.model,
    // OpenRouter asks apps to name themselves (it shows on the user's activity page)
    headers:
      p.id === 'openrouter'
        ? { 'HTTP-Referer': typeof location !== 'undefined' ? location.origin : '', 'X-Title': 'SVGcinema' }
        : undefined,
  });
}
