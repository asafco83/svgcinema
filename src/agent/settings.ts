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
}

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
  s.maxSteps = Math.max(1, Math.min(100, Math.round(Number(s.maxSteps) || DEFAULTS.maxSteps)));
  return s;
}
export function setSettings(p: Partial<AgentSettings>) {
  const s = { ...getSettings(), ...p };
  write(SKEY, s);
  return s;
}

export function getKeys(): Partial<Record<ProviderId, string>> {
  return read<Partial<Record<ProviderId, string>>>(KKEY, {});
}
export function setKey(p: ProviderId, key: string) {
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

/** The image service in use: the one chosen, else the agent's provider when it makes images. */
export function imageProviderOf(s = getSettings()): ImageProviderId | null {
  if (s.imgProvider === 'none') return null;
  if (s.imgProvider) return s.imgProvider;
  return s.provider === 'openrouter' || s.provider === 'openai' || s.provider === 'gemini' ? s.provider : null;
}
/** The image model to use now, or null when images aren't set up (no service, key, model or address). */
export function imageChoice(): ImageChoice | null {
  const s = getSettings(),
    id = imageProviderOf(s);
  if (!id) return null;
  const model = s.imgModel || defaultImageModel(id),
    key = getKeys()[id] || '';
  if (!model) return null;
  if (id === 'custom') {
    const base = s.imgBase || s.base;
    return base ? { provider: id, model, key, base } : null;
  }
  return key ? { provider: id, model, key } : null;
}
/** The vector model to use, or null when the agent draws vector itself. Vector models run on the image
 *  service (OpenRouter's Recraft models, or a Custom service). */
export function vectorChoice(): ImageChoice | null {
  const s = getSettings(),
    c = imageChoice();
  if (!c || s.vector === 'agent' || !s.vector || (c.provider !== 'openrouter' && c.provider !== 'custom')) return null;
  return { ...c, model: s.vector };
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
