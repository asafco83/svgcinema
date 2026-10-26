// SVGcinema — agent/images
// Image and vector generation for the design agent: the image services and their models, the call to
// each, the price shown before generating (read live from OpenRouter's public model list, so nothing
// here needs updating when prices change) and making the background transparent when the service
// can't. Everything is called from the browser with the user's own key, like the chat.
import { AgentError, guardedFetch, httpError } from './clients/types';

export type ImageProviderId = 'openrouter' | 'openai' | 'gemini' | 'custom';
export type Aspect = 'square' | 'landscape' | 'portrait';

export interface ImageModel {
  id: string;
  name: string;
  /** makes SVG (output_format svg) */
  vector?: boolean;
  /** asks for a transparent background itself */
  background?: boolean;
  /** aspect ratios it takes ('' = any / not listed) */
  aspects?: string[];
  /** output formats it takes (OpenRouter lists them) */
  formats?: string[];
  /** takes quality: medium (asked for, so the price is predictable) */
  quality?: boolean;
}

export interface ImageProvider {
  id: ImageProviderId;
  label: string;
  /** starting models when nothing better is known (OpenRouter's come from its live list) */
  models: ImageModel[];
  /** its own models' id on OpenRouter's price list (prefix), or null when it has none there */
  priceAs: string | null;
}

export const IMAGE_PROVIDERS: ImageProvider[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    priceAs: '',
    models: [
      { id: 'openai/gpt-image-2.5-flare', name: 'OpenAI: GPT Image Flare', background: true, quality: true },
      { id: 'openai/gpt-image-2', name: 'OpenAI: GPT Image 2', quality: true },
      { id: 'google/gemini-3.1-flash-image', name: 'Google: Gemini 3.1 Flash Image' },
      { id: 'black-forest-labs/flux.2-pro', name: 'Black Forest Labs: FLUX.2 Pro' },
      { id: 'recraft/recraft-v4.1-vector', name: 'Recraft: Recraft V4.1 Vector', vector: true, formats: ['svg'] },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    priceAs: 'openai/',
    models: [
      // gpt-image-2 can't make transparent backgrounds (its background is auto or opaque)
      { id: 'gpt-image-2', name: 'GPT Image 2', quality: true },
      { id: 'gpt-image-1', name: 'GPT Image 1', background: true, quality: true },
      { id: 'gpt-image-1-mini', name: 'GPT Image 1 Mini', background: true, quality: true },
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    priceAs: 'google/',
    models: [
      { id: 'gemini-3.1-flash-image', name: 'Gemini 3.1 Flash Image' },
      { id: 'gemini-3-pro-image', name: 'Gemini 3 Pro Image' },
      { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image' },
    ],
  },
  { id: 'custom', label: 'Custom', priceAs: null, models: [] },
];
export const imageProviderById = (id: string) => IMAGE_PROVIDERS.find(p => p.id === id);

export interface ImageChoice {
  provider: ImageProviderId;
  model: string;
  key: string;
  /** Custom: the service's base address */
  base?: string;
}

/* ---------- storage (cached lookups; never anything personal) ---------- */

const DAY = 24 * 3600 * 1000,
  CAT_KEY = 'svgcinema:agent.imageModels',
  PRICE_KEY = 'svgcinema:agent.prices';
const OR = 'https://openrouter.ai/api/v1';

function load<T>(k: string): T | null {
  try {
    const s = localStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch (_) {
    return null;
  }
}
function save(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (_) {
    /* the cache lasts for this visit */
  }
}

/* ---------- OpenRouter's image model list ---------- */

/** One model entry of OpenRouter's /images/models, as SVGcinema uses it. */
export function catalogEntry(m: any): ImageModel | null {
  if (!m || typeof m.id !== 'string') return null;
  const sp = m.supported_parameters || {},
    vals = (p: any): string[] => (p && Array.isArray(p.values) ? p.values.map(String) : []);
  const formats = vals(sp.output_format),
    bg = vals(sp.background),
    q = vals(sp.quality);
  return {
    id: m.id,
    name: typeof m.name === 'string' ? m.name : m.id,
    vector: formats.includes('svg') || /-vector$/.test(m.id),
    background: bg.includes('transparent'),
    aspects: vals(sp.aspect_ratio),
    formats,
    quality: q.includes('medium'),
  };
}

let catP: Promise<ImageModel[]> | null = null;
/** OpenRouter's image models: read from its public list (no key needed), cached for a day. Falls back
 *  to the built-in starting list when it can't be reached. */
export function imageCatalog(fresh = false): Promise<ImageModel[]> {
  const c = load<{ at: number; models: ImageModel[] }>(CAT_KEY);
  if (!fresh && c && Date.now() - c.at < DAY && Array.isArray(c.models) && c.models.length)
    return Promise.resolve(c.models);
  if (!catP)
    catP = fetch(`${OR}/images/models`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => {
        const models = ((j && j.data) || []).map(catalogEntry).filter(Boolean) as ImageModel[];
        if (!models.length) throw new Error('empty');
        save(CAT_KEY, { at: Date.now(), models });
        return models;
      })
      .catch(() => (c && c.models && c.models.length ? c.models : imageProviderById('openrouter')!.models))
      .finally(() => (catP = null));
  return catP;
}
const PREFERRED = ['openai/gpt-image-2.5-flare', 'openai/gpt-image-2', 'google/gemini-3.1-flash-image'];
/** The models to offer for a service now: OpenRouter's cached live list when there is one. */
export function modelsOf(p: ImageProviderId): ImageModel[] {
  const c = p === 'openrouter' ? load<{ models: ImageModel[] }>(CAT_KEY) : null;
  return (c && Array.isArray(c.models) && c.models.length ? c.models : imageProviderById(p)?.models) || [];
}
/** The image model used when none is chosen: a well-known one from the list, else its first picture model. */
export function defaultImageModel(p: ImageProviderId) {
  const raster = modelsOf(p).filter(m => !m.vector);
  return (PREFERRED.map(id => raster.find(m => m.id === id)).find(Boolean) || raster[0] || { id: '' }).id;
}
/** What is known about a model now, without waiting (the cached list, else the built-in one). */
export function modelInfo(p: ImageProviderId, id: string): ImageModel | undefined {
  return modelsOf(p).find(m => m.id === id) || imageProviderById(p)?.models.find(m => m.id === id);
}

/* ---------- prices ---------- */

/** The price lines of an OpenRouter endpoints answer that matter here: per image, or per output-image
 *  token (OpenAI's and Google's models) plus per input-text token. The cheapest service of each. */
export interface PriceLines {
  image?: number;
  token?: number;
  text?: number;
}
export function priceLines(j: unknown): PriceLines {
  const lines: Array<{ billable: string; unit: string; usd: number; variant: string }> = [];
  const walk = (v: any) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const usd = Number(v.cost_usd ?? v.costUsd);
    if (typeof v.billable === 'string' && typeof v.unit === 'string' && isFinite(usd))
      lines.push({ billable: v.billable, unit: v.unit, usd, variant: String(v.variant || '') });
    Object.values(v).forEach(walk);
  };
  walk(j);
  const min = (xs: typeof lines) => (xs.length ? xs.reduce((a, b) => (b.usd < a.usd ? b : a)).usd : undefined);
  const out = lines.filter(l => /output/.test(l.billable) && /image/.test(l.billable)),
    per = out.filter(l => /image/.test(l.unit)),
    // several per-image variants (sizes, qualities): the medium / 1K one, else the cheapest
    mid = per.find(l => !l.variant) || per.find(l => /medium|standard|1k|1024/i.test(l.variant));
  const r: PriceLines = {};
  if (per.length) r.image = mid ? mid.usd : min(per);
  const tok = min(out.filter(l => /token/.test(l.unit))),
    text = min(lines.filter(l => /input_text/.test(l.billable) && /token/.test(l.unit)));
  if (tok !== undefined) r.token = tok;
  if (text !== undefined) r.text = text;
  return r;
}

/** About how many output tokens one image takes, for models priced by token: OpenAI's image models at
 *  medium quality (which SVGcinema asks for), Google's and others at their 1K size. */
export function imageTokens(model: string, aspect: Aspect = 'square') {
  if (/(^|\/)gpt-|openai\//.test(model)) return aspect === 'square' ? 1056 : 1584;
  return 1290;
}

/** One image's price from its lines (null when it has none): per image, or by tokens. */
export function pickImagePrice(l: PriceLines, model = '', aspect: Aspect = 'square'): number | null {
  if (l.image !== undefined) return l.image;
  if (l.token !== undefined) return l.token * imageTokens(model, aspect) + (l.text || 0) * 150;
  return null;
}

type PriceCache = Record<string, { at: number; lines: PriceLines | null }>;
const priceP = new Map<string, Promise<PriceLines | null>>();
/** About how much one image from this model costs, in USD (null: price unknown). Read from OpenRouter's
 *  public list, cached for a day; OpenAI's and Google's own models are looked up under their names there. */
export async function imagePrice(
  c: Pick<ImageChoice, 'provider' | 'model'>,
  aspect: Aspect = 'square',
): Promise<number | null> {
  const p = imageProviderById(c.provider);
  if (!p || p.priceAs === null || !c.model) return null;
  const id = p.priceAs + c.model,
    hit = (load<PriceCache>(PRICE_KEY) || {})[id];
  let lines: PriceLines | null;
  if (hit && Date.now() - hit.at < DAY && 'lines' in hit) lines = hit.lines;
  else {
    if (!priceP.has(id))
      priceP.set(
        id,
        fetch(`${OR}/images/models/${id.split('/').map(encodeURIComponent).join('/')}/endpoints`)
          .then(r => (r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error(String(r.status)))))
          .then(j => {
            const ls = j ? priceLines(j) : null,
              all = load<PriceCache>(PRICE_KEY) || {};
            all[id] = { at: Date.now(), lines: ls };
            save(PRICE_KEY, all);
            return ls;
          })
          .catch(() => (hit && 'lines' in hit ? hit.lines : null))
          .finally(() => priceP.delete(id)),
      );
    lines = await priceP.get(id)!;
  }
  return lines ? pickImagePrice(lines, id, aspect) : null;
}

export function money(usd: number) {
  return '$' + (usd >= 1 ? usd.toFixed(2) : usd >= 0.1 ? usd.toFixed(2) : usd.toFixed(3).replace(/0$/, ''));
}

/* ---------- sizes ---------- */

export const ASPECTS: Record<Aspect, { ratio: string; openai: string; label: string }> = {
  square: { ratio: '1:1', openai: '1024x1024', label: '1024 × 1024' },
  landscape: { ratio: '3:2', openai: '1536x1024', label: '1536 × 1024' },
  portrait: { ratio: '2:3', openai: '1024x1536', label: '1024 × 1536' },
};
/** The model's own ratio closest to the one asked for ('' when it lists none). */
function nearRatio(want: string, have?: string[]) {
  if (!have || !have.length) return want;
  if (have.includes(want)) return want;
  const v = (r: string) => {
    const [a, b] = r.split(':').map(Number);
    return a && b ? Math.log(a / b) : 0;
  };
  return have.reduce((a, b) => (Math.abs(v(b) - v(want)) < Math.abs(v(a) - v(want)) ? b : a));
}

/* ---------- generating ---------- */

export interface GenRequest {
  prompt: string;
  aspect?: Aspect;
  /** ask for a transparent background */
  transparent?: boolean;
  /** SVG instead of a picture (OpenRouter's vector models, or a Custom service that makes SVG) */
  vector?: boolean;
  signal?: AbortSignal;
}
export interface GenResult {
  bytes: Uint8Array;
  mime: string;
  /** USD, when the service reported what it charged */
  cost?: number;
  /** the background was asked for as flat green, to be removed here */
  keyed?: boolean;
}

export const MAX_IMAGE = 4 * 1024 * 1024;
const GREEN = ' Place it on a plain, flat, solid #00FF00 green background with no shadow on the background.';

export function b64ToBytes(b64: string) {
  const s = atob(b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')),
    u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
function sniff(u: Uint8Array, fallback = 'image/png') {
  if (u[0] === 0x89 && u[1] === 0x50) return 'image/png';
  if (u[0] === 0xff && u[1] === 0xd8) return 'image/jpeg';
  if (u[0] === 0x52 && u[1] === 0x49 && u[8] === 0x57) return 'image/webp';
  const head = new TextDecoder().decode(u.slice(0, 200));
  if (/<svg|<\?xml/.test(head)) return 'image/svg+xml';
  return fallback;
}

/** Whether a picture from this choice needs its background removed here (the model can't ask for a
 *  transparent one itself). */
export function needsKeying(c: ImageChoice) {
  if (c.provider === 'gemini') return true;
  const m = modelInfo(c.provider, c.model);
  if (c.provider === 'openai') return !!m && !m.background;
  return c.provider === 'openrouter' ? !(m && m.background) : false;
}

/** Make one image (or SVG). Throws an AgentError the panel can explain. */
export async function generateImage(c: ImageChoice, g: GenRequest): Promise<GenResult> {
  const p = imageProviderById(c.provider);
  if (!p) throw new AgentError('provider', `Unknown image service ${c.provider}`);
  const label = c.provider === 'custom' ? 'the image service' : p.label,
    a = ASPECTS[g.aspect || 'square'],
    key = !g.vector && g.transparent && needsKeying(c),
    prompt = g.prompt + (key ? GREEN : ''),
    info = modelInfo(c.provider, c.model);
  let url: string,
    body: any,
    headers: Record<string, string> = { 'content-type': 'application/json' };
  if (c.key) headers.authorization = `Bearer ${c.key}`;
  if (c.provider === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`;
    headers = { 'content-type': 'application/json', 'x-goog-api-key': c.key };
    body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: a.ratio } },
    };
  } else if (c.provider === 'openrouter') {
    url = `${OR}/images`;
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : '';
    headers['X-Title'] = 'SVGcinema';
    body = { model: c.model, prompt, n: 1 };
    const ratio = nearRatio(a.ratio, info && info.aspects);
    if (!info || (info.aspects && info.aspects.length)) body.aspect_ratio = ratio;
    if (g.vector) body.output_format = 'svg';
    else if (info && info.formats && info.formats.includes('png')) body.output_format = 'png';
    if (!g.vector && g.transparent && info && info.background) body.background = 'transparent';
    if (!g.vector && info && info.quality) body.quality = 'medium';
  } else {
    // OpenAI, and Custom services that copy its images API
    url =
      c.provider === 'openai'
        ? 'https://api.openai.com/v1/images/generations'
        : (c.base || '')
            .trim()
            .replace(/\/+$/, '')
            .replace(/\/chat\/completions$/, '') + '/images/generations';
    body = { model: c.model, prompt, n: 1, size: a.openai };
    if (g.vector) body.output_format = 'svg';
    else if (c.provider === 'openai') {
      body.output_format = 'png';
      if (g.transparent && !key) body.background = 'transparent';
      if (!info || info.quality) body.quality = 'medium';
    } else body.response_format = 'b64_json';
  }
  const f = guardedFetch(url, { method: 'POST', headers, body: JSON.stringify(body) }, g.signal, 180000);
  let j: any;
  try {
    const res = await f.res;
    if (!res.ok) throw await httpError(res, label);
    j = await res.json();
  } catch (e) {
    throw f.why(e, label);
  } finally {
    f.done();
  }
  let b64 = '',
    mime = '',
    cost: number | undefined;
  if (c.provider === 'gemini') {
    const parts =
        (j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [],
      img = parts.map((x: any) => x.inlineData || x.inline_data).find((x: any) => x && x.data);
    if (!img) {
      const why =
        parts.map((x: any) => x.text).filter(Boolean)[0] || (j && j.promptFeedback && j.promptFeedback.blockReason);
      throw new AgentError('provider', `${label} sent no image${why ? `: ${String(why).slice(0, 300)}` : '.'}`);
    }
    b64 = img.data;
    mime = img.mimeType || img.mime_type || '';
  } else {
    const d = j && Array.isArray(j.data) && j.data[0];
    if (d && d.b64_json) b64 = d.b64_json;
    else if (d && d.url) {
      // a Custom service may answer with a link (it has to allow the page to read it)
      if (/^data:/.test(d.url)) b64 = d.url;
      else {
        const r = await fetch(d.url, { signal: g.signal }).catch(() => null);
        if (!r || !r.ok) throw new AgentError('network', `Couldn't download the image ${label} made.`);
        const u = new Uint8Array(await r.arrayBuffer());
        return check({ bytes: u, mime: r.headers.get('content-type') || sniff(u), keyed: key }, g);
      }
    }
    if (!b64) throw new AgentError('format', `${label} answered without an image.`);
    mime = (d && (d.media_type || d.mime_type)) || '';
    const u = j && j.usage && Number(j.usage.cost);
    if (u && isFinite(u)) cost = u;
  }
  const bytes = b64ToBytes(b64);
  return check({ bytes, mime: mime || sniff(bytes), cost, keyed: key }, g);
}
function check(r: GenResult, g: GenRequest): GenResult {
  if (r.bytes.length > MAX_IMAGE)
    throw new AgentError('format', `The image is ${Math.round(r.bytes.length / 1048576)} MB; the most is 4 MB.`);
  if (g.vector && !/svg/.test(r.mime) && sniff(r.bytes) !== 'image/svg+xml')
    throw new AgentError('format', 'The vector model sent a picture, not SVG.');
  return r;
}

/* ---------- transparent backgrounds ---------- */

/**
 * Remove a flat background in place: a flood fill from the edges takes every connected pixel close
 * to the edge colour (the corners must agree on it), and a 1 px soft edge with the colour's tint taken
 * out. Works on raw RGBA, so it runs in tests too. Returns how much of the picture it cleared (0–1),
 * or 0 when the background isn't flat.
 */
export function removeBackground(px: Uint8ClampedArray, w: number, h: number, tol = 48): number {
  const at = (x: number, y: number) => (y * w + x) * 4;
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)].map(i => [px[i], px[i + 1], px[i + 2]]);
  const d = (i: number, c: number[]) =>
    Math.max(Math.abs(px[i] - c[0]), Math.abs(px[i + 1] - c[1]), Math.abs(px[i + 2] - c[2]));
  // the key colour: the one most corners share
  let key: number[] | null = null;
  for (const c of corners) {
    const n = corners.filter(o => Math.max(...o.map((v, k) => Math.abs(v - c[k]))) <= tol).length;
    if (n >= 3) {
      key = c;
      break;
    }
  }
  if (!key) return 0;
  const seen = new Uint8Array(w * h),
    stack: number[] = [];
  const push = (x: number, y: number) => {
    const k = y * w + x;
    if (seen[k] || d(k * 4, key!) > tol) return;
    seen[k] = 1;
    stack.push(k);
  };
  for (let x = 0; x < w; x++) push(x, 0), push(x, h - 1);
  for (let y = 0; y < h; y++) push(0, y), push(w - 1, y);
  let n = 0;
  while (stack.length) {
    const k = stack.pop()!,
      x = k % w,
      y = (k - x) / w;
    px[k * 4 + 3] = 0;
    n++;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  // the soft edge: pixels touching the cleared area, made partly clear by how close they are to the
  // key colour, with the key's tint taken out
  const kmax = key.indexOf(Math.max(...key));
  for (let k = 0; k < w * h; k++) {
    if (seen[k]) continue;
    const x = k % w,
      y = (k - x) / w;
    const touch =
      (x > 0 && seen[k - 1]) || (x < w - 1 && seen[k + 1]) || (y > 0 && seen[k - w]) || (y < h - 1 && seen[k + w]);
    if (!touch) continue;
    const i = k * 4,
      dist = d(i, key),
      a = Math.min(1, Math.max(0.25, (dist - tol) / (2 * tol)));
    px[i + 3] = Math.round(px[i + 3] * a);
    const others = [0, 1, 2].filter(c => c !== kmax).map(c => px[i + c]);
    if (key[kmax] > 200 && px[i + kmax] > Math.max(...others)) px[i + kmax] = Math.max(...others);
  }
  return n / (w * h);
}

/** Make a generated picture transparent when it was asked to be and isn't. Returns the (possibly new)
 *  PNG bytes and whether the background is transparent, was removed here, or stayed. */
export async function finishTransparency(
  r: GenResult,
  want: boolean,
): Promise<{ bytes: Uint8Array; mime: string; transparent: boolean | 'removed' }> {
  if (!want || /svg/.test(r.mime)) return { bytes: r.bytes, mime: r.mime, transparent: false };
  let img: ImageBitmap;
  try {
    img = await createImageBitmap(new Blob([r.bytes as BlobPart], { type: r.mime }));
  } catch (_) {
    return { bytes: r.bytes, mime: r.mime, transparent: false };
  }
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const x = cv.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, cv.width, cv.height);
  // already transparent somewhere at the edges: keep it as it came
  const a = data.data,
    W = cv.width,
    H = cv.height;
  if (a[3] < 250 || a[(W - 1) * 4 + 3] < 250 || a[(H - 1) * W * 4 + 3] < 250 || a[(H * W - 1) * 4 + 3] < 250)
    return { bytes: r.bytes, mime: r.mime, transparent: true };
  const cleared = removeBackground(a, W, H);
  if (cleared < 0.02 || cleared > 0.98) return { bytes: r.bytes, mime: r.mime, transparent: false };
  x.putImageData(data, 0, 0);
  const blob: Blob | null = await new Promise(res => cv.toBlob(res, 'image/png'));
  if (!blob) return { bytes: r.bytes, mime: r.mime, transparent: false };
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', transparent: 'removed' };
}
