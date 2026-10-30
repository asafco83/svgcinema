// SVGcinema — core/analytics
// Anonymous usage counts with Umami (cookieless, no IP addresses kept, data in the EU; see the website's
// Privacy page). Only on svgcinema.com: nowhere else (the GitHub Pages copy, a local copy, the dev server,
// tests), never in a practice editor or the batch converter (core/batch-mode EPHEMERAL), and not for a
// browser that asks not to be tracked (Do Not Track). Nothing loads or is sent otherwise.
//
// Events carry counts and categories only, never what someone makes: no project, file or layer names, no
// text, no prompts or keys, no image data. `track()` keeps only short plain values to enforce that.
import { EPHEMERAL } from './batch-mode';

export const UMAMI_SRC = 'https://cloud.umami.is/script.js';
export const UMAMI_ID = '3e441baa-e061-4501-8fff-9470c140b799';
export const ANALYTICS_HOSTS = ['svgcinema.com', 'www.svgcinema.com'];

type Value = string | number | boolean;
type Data = Record<string, Value | null | undefined>;

/** Analytics runs here: on svgcinema.com, in the real editor or website (not a practice or batch frame). */
export function analyticsOn(host = typeof location !== 'undefined' ? location.hostname : '') {
  return ANALYTICS_HOSTS.includes(host) && !EPHEMERAL;
}

const queue: Array<[string, Record<string, Value>]> = [];
let started = false;
const umami = () => (typeof window !== 'undefined' ? (window as any).umami : null);

/** Loads the Umami script (once), on svgcinema.com only. It counts the page view itself. */
export function startAnalytics() {
  if (started || !analyticsOn()) return;
  started = true;
  const s = document.createElement('script');
  s.defer = true;
  s.src = UMAMI_SRC;
  s.dataset.websiteId = UMAMI_ID;
  s.dataset.domains = ANALYTICS_HOSTS.join(',');
  s.dataset.doNotTrack = 'true';
  s.addEventListener('load', flush);
  document.head.appendChild(s);
}
function flush() {
  const u = umami();
  if (!u || typeof u.track !== 'function') return;
  while (queue.length) {
    const [n, d] = queue.shift()!;
    u.track(n, d);
  }
}

/** Only short plain values: an event never carries anything someone made or typed. */
export function clean(data?: Data): Record<string, Value> {
  const out: Record<string, Value> = {};
  if (!data) return out;
  for (const k of Object.keys(data).slice(0, 10)) {
    const v = data[k];
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === 'string' && /^[\w .:+-]{1,40}$/.test(v)) out[k] = v;
  }
  return out;
}

/** Sends one event (queued until the script has loaded). Does nothing where analytics is off. */
export function track(name: string, data?: Data) {
  if (!analyticsOn() || !/^[a-z][a-z0-9_]{1,39}$/.test(name)) return;
  const d = clean(data),
    u = umami();
  if (u && typeof u.track === 'function') u.track(name, d);
  else if (queue.length < 50) queue.push([name, d]);
}

const seen = new Set<string>();
/** `feature_used` once per visit for each feature (e.g. tool_pen, animate_rot, boolean, mask). */
export function featureUsed(feature: string) {
  if (seen.has(feature)) return;
  seen.add(feature);
  track('feature_used', { feature });
}

/** A count as a range, so events never carry exact sizes: 0, 1, 2-5, 6-20, 21-50, 51-100, 100+. */
export function bucket(n: number) {
  if (n <= 1) return String(Math.max(0, n));
  for (const [lo, hi] of [
    [2, 5],
    [6, 20],
    [21, 50],
    [51, 100],
  ])
    if (n <= hi) return `${lo}-${hi}`;
  return '100+';
}
