// SVGcinema — agent/settings
// The design agent's settings and API keys, kept in this browser only (never in a project file).
// Keys live under their own storage key so Remove keys clears only them.
import { BATCH } from '../core/batch-mode';
import { type ModelChoice, type ProviderId, providerById } from './providers';

export interface AgentSettings {
  provider: ProviderId;
  model: string;
  /** Custom: the service's base address */
  base: string;
  /** ask before the agent deletes layers */
  askDelete: boolean;
  /** most tool calls per request */
  maxSteps: number;
}

const SKEY = 'svgcinema:agent.settings',
  KKEY = 'svgcinema:agent.keys';

export const DEFAULTS: AgentSettings = {
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-5.5',
  base: '',
  askDelete: true,
  maxSteps: 20,
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

/** The model's short name for the chips ("anthropic/claude-sonnet-5.5" → "claude-sonnet-5.5"). */
export function shortModel(m: string) {
  return m.split('/').pop() || m;
}
