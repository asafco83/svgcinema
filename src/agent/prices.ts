// SVGcinema — agent/prices
// Chat model prices for the Settings menus, read from OpenRouter's public model list (no key needed)
// and cached for a day, so nothing here needs updating when prices change. Models of the other
// providers are looked up under their OpenRouter names. Prices are per million tokens, input · output.
import type { ProviderId } from './providers';

const DAY = 24 * 3600 * 1000,
  KEY = 'svgcinema:agent.chatPrices',
  URL_ = 'https://openrouter.ai/api/v1/models';

type Table = Record<string, [number, number]>;

function load(): { at: number; t: Table } | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) : null;
  } catch (_) {
    return null;
  }
}

/** The OpenRouter model list's prices: id → [input, output] in USD per token. */
export function priceTable(j: any): Table {
  const t: Table = {};
  for (const m of (j && j.data) || []) {
    const p = m && m.pricing,
      i = p && Number(p.prompt),
      o = p && Number(p.completion);
    if (typeof m.id === 'string' && isFinite(i) && isFinite(o) && (i > 0 || o > 0)) t[m.id] = [i, o];
  }
  return t;
}

let P: Promise<Table> | null = null;
/** Read the prices (cached for a day; the old table, or none, when the list can't be reached). */
export function loadChatPrices(): Promise<Table> {
  const c = load();
  if (c && Date.now() - c.at < DAY) return Promise.resolve(c.t);
  if (!P)
    P = fetch(URL_)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => {
        const t = priceTable(j);
        if (!Object.keys(t).length) throw new Error('empty');
        try {
          localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), t }));
        } catch (_) {
          /* lasts for this visit */
        }
        return t;
      })
      .catch(() => (c ? c.t : {}))
      .finally(() => (P = null));
  return P;
}

/** A provider's model under its OpenRouter name (null for Custom). */
export function openRouterId(provider: ProviderId, model: string): string | null {
  if (!model) return null;
  switch (provider) {
    case 'openrouter':
    case 'groq':
      return model;
    case 'openai':
      return 'openai/' + model;
    case 'gemini':
      return 'google/' + model;
    case 'anthropic':
      // claude-sonnet-5-5 → anthropic/claude-sonnet-5.5
      return 'anthropic/' + model.replace(/-(\d+)-(\d+)$/, '-$1.$2');
    default:
      return null;
  }
}

/** [input, output] per million tokens, from the cached list (null: not known). */
export function chatPrice(provider: ProviderId, model: string): [number, number] | null {
  const id = openRouterId(provider, model),
    c = load();
  const p = id && c ? c.t[id] : undefined;
  return p ? [p[0] * 1e6, p[1] * 1e6] : null;
}

/** "$2 · $10 /M" */
export function perMillion(p: [number, number]) {
  const f = (n: number) => '$' + (n >= 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n * 100) / 100));
  return `${f(p[0])} · ${f(p[1])} /M`;
}
