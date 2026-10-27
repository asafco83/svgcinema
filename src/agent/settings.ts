// SVGcinema — agent/settings
// The design agent's settings and API keys, kept in this browser only (never in a project file).
// Keys live under their own storage key so Remove keys clears only them.
import { BATCH } from '../core/batch-mode';
import { type ModelChoice, type ProviderId, providerById } from './providers';
import { type ImageChoice, type ImageProviderId, defaultImageModel, imageProviderById } from './images';

export interface AgentSettings {
  provider: ProviderId;
  model: string;
  /** Custom: the service's base address */
  base: string;
  /** ask before the agent deletes layers */
  askDelete: boolean;
  /** most tool calls per request */
  maxSteps: number;
  /** the image service ('' = the agent's own provider when it makes images, else none) */
  imgProvider: ImageProviderId | 'none' | '';
  /** image model ('' = the service's first) */
  imgModel: string;
  /** Custom image service address ('' = the agent's Custom address) */
  imgBase: string;
  /** ask for transparent backgrounds */
  transparent: boolean;
  /** make artwork whose parts move as vector rather than a picture */
  preferVector: boolean;
  /** vector artwork: 'agent' (it writes SVG) or a vector model on the image service */
  vector: string;
  /** Custom images: use the agent's Custom address and key */
  imgSame: boolean;
  /** how the agent is used: the chat here with an API key, or the user's own AI assistant ('' = not chosen yet) */
  connect: '' | 'key' | 'assistant';
  /** let AI assistants edit the project through window.svgcinema (off: every call is refused) */
  assistOn: boolean;
  /** images an assistant asks for: its own, made with the image model of the API key settings, or vector only */
  assistImages: AssistImages;
}
export type AssistImages = 'own' | 'key' | 'vector';

const SKEY = 'svgcinema:agent.settings',
  KKEY = 'svgcinema:agent.keys';

export const DEFAULTS: AgentSettings = {
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-5.5',
  base: '',
  askDelete: true,
  maxSteps: 20,
  imgProvider: '',
  imgModel: '',
  imgBase: '',
  transparent: true,
  preferVector: true,
  vector: 'agent',
  imgSame: true,
  connect: '',
  assistOn: true,
  assistImages: 'own',
};

function read<T>(k: string, d: T): T {
  if (BATCH) return d;
  try {
    const s = localStorage.getItem(k);
    return s ? { ...d, ...JSON.parse(s) } : d;
  } catch (_) {
    return d;
  }
}
function write(k: string, v: unknown) {
  if (BATCH) return;
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (_) {
    /* storage full or blocked: the setting lasts for this visit */
  }
}

export function getSettings(): AgentSettings {
  const s = read<AgentSettings>(SKEY, { ...DEFAULTS });
  if (!providerById(s.provider)) s.provider = DEFAULTS.provider;
  if (s.imgProvider && s.imgProvider !== 'none' && !imageProviderById(s.imgProvider)) s.imgProvider = '';
  if (s.connect !== 'key' && s.connect !== 'assistant') s.connect = '';
  if (!['own', 'key', 'vector'].includes(s.assistImages)) s.assistImages = 'own';
  s.maxSteps = Math.max(1, Math.min(100, Math.round(Number(s.maxSteps) || DEFAULTS.maxSteps)));
  return s;
}
export function setSettings(p: Partial<AgentSettings>) {
  const s = { ...getSettings(), ...p };
  write(SKEY, s);
  return s;
}

export function getKeys(): Record<string, string> {
  return read<Record<string, string>>(KKEY, {});
}
export function setKey(p: ProviderId | string, key: string) {
  const k = getKeys();
  if (key) k[p] = key.trim();
  else delete k[p];
  write(KKEY, k);
}
export function removeKeys() {
  if (BATCH) return;
  try {
    localStorage.removeItem(KKEY);
  } catch (_) {
    /* nothing to remove */
  }
}

/** The model the agent should use now, or null when it isn't set up yet (no key, no model, no
 *  address for Custom). A Custom service may need no key (a local server). */
export function currentChoice(): ModelChoice | null {
  const s = getSettings(),
    key = getKeys()[s.provider] || '';
  if (!s.model) return null;
  if (s.provider === 'custom') return s.base ? { provider: 'custom', model: s.model, key, base: s.base } : null;
  return key ? { provider: s.provider, model: s.model, key } : null;
}

/** How the agent is used now: the chat with an API key, the user's AI assistant, or '' (first open: not
 *  chosen yet). Someone who set up a key before the choice existed uses the key. */
export function connectMode(): '' | 'key' | 'assistant' {
  const s = getSettings();
  return s.connect || (currentChoice() ? 'key' : '');
}
/** What assistants do for images now: 'key' only while an image model is set up (else their own). */
export function assistImages(): AssistImages {
  const m = getSettings().assistImages;
  return m === 'key' && !imageChoice() ? 'own' : m;
}

/** The image service in use: the one chosen, else the agent's provider when it makes images. */
export function imageProviderOf(s = getSettings()): ImageProviderId | null {
  if (s.imgProvider === 'none') return null;
  if (s.imgProvider) return s.imgProvider;
  return s.provider === 'openrouter' || s.provider === 'openai' || s.provider === 'gemini' ? s.provider : null;
}
/** Where a Custom image service's key is kept: the agent's own when it shares the agent's Custom
 *  address, else a key of its own. */
export function imageKeyId(s = getSettings()): string {
  const id = imageProviderOf(s);
  if (id !== 'custom') return id || '';
  return s.provider === 'custom' && s.imgSame ? 'custom' : 'customImages';
}
/** The image setup in Settings, whether or not it has passed its Test (null: incomplete). */
export function imageSetup(): ImageChoice | null {
  const s = getSettings(),
    id = imageProviderOf(s);
  if (!id) return null;
  const model = s.imgModel || defaultImageModel(id),
    key = getKeys()[imageKeyId(s)] || '';
  if (!model) return null;
  if (id === 'custom') {
    const base = s.provider === 'custom' && s.imgSame ? s.base : s.imgBase;
    return base ? { provider: id, model, key, base } : null;
  }
  return key ? { provider: id, model, key } : null;
}
/** The image model to use now, or null when images aren't set up. A Custom service is used only once
 *  its Test has passed (the panel says so). */
export function imageChoice(): ImageChoice | null {
  const c = imageSetup();
  if (!c) return null;
  if (c.provider === 'custom') {
    const t = imageTest(c);
    if (!t || !t.ok) return null;
  }
  return c;
}
/** The vector model to use, or null when the agent draws vector itself. Vector models run on the image
 *  service (OpenRouter's Recraft models, or a Custom service). */
export function vectorChoice(): ImageChoice | null {
  const s = getSettings(),
    c = imageChoice();
  if (!c || s.vector === 'agent' || !s.vector || (c.provider !== 'openrouter' && c.provider !== 'custom')) return null;
  const v = { ...c, model: s.vector };
  // a Custom vector model needs its Test to have found SVG
  if (c.provider === 'custom' && (imageTest(c) || { vector: '' }).vector !== s.vector) return null;
  return v;
}

/* ---------- what the Test found ---------- */

const TKEY = 'svgcinema:agent.tested';
interface Tested {
  /** provider:model → can see images */
  vision: Record<string, boolean>;
  /** image service signature → its last image Test */
  images: Record<string, { ok: boolean; vector?: string; at: number }>;
  /** (vector: the vector model whose Test returned SVG) */
}
function tested(): Tested {
  const t = read<Tested>(TKEY, { vision: {}, images: {} });
  return { vision: t.vision || {}, images: t.images || {} };
}
/** Whether the agent's model can see images: what its Test found, else the provider's list. */
export function canSee(c = currentChoice()): boolean {
  if (!c) return false;
  const t = tested().vision[`${c.provider}:${c.model}`];
  if (t !== undefined) return t;
  return (providerById(c.provider)?.vision || []).includes(c.model);
}
export function setCanSee(c: ModelChoice, ok: boolean) {
  const t = tested();
  t.vision[`${c.provider}:${c.model}`] = ok;
  write(TKEY, t);
}
/** One image setup, so a Test result belongs to exactly the setup it tested. */
export const imageSig = (c: ImageChoice) => [c.provider, c.base || '', c.model].join('|');
export function imageTest(c: ImageChoice) {
  return tested().images[imageSig(c)];
}
export function setImageTest(c: ImageChoice, r: { ok: boolean; vector?: string }) {
  const t = tested();
  t.images[imageSig(c)] = { ...r, at: Date.now() };
  write(TKEY, t);
}

const CKEY = 'svgcinema:agent.confirmImages';
/** Ask before generating images (on unless the user chose “Don’t ask again”). */
export function confirmImages() {
  if (BATCH) return true;
  try {
    return localStorage.getItem(CKEY) !== 'false';
  } catch (_) {
    return true;
  }
}
export function setConfirmImages(on: boolean) {
  write(CKEY, on);
}

/** The model's short name for the chips ("anthropic/claude-sonnet-5.5" → "claude-sonnet-5.5"). */
export function shortModel(m: string) {
  return m.split('/').pop() || m;
}
