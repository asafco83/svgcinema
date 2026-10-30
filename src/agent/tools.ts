// SVGcinema — agent/tools
// The design agent's tools. Each one is a thin wrapper over a function the editor already has, so
// what the agent does is exactly what the same action does by hand. Tools never push undo steps of
// their own that survive: the request they run in (agent/request) folds everything into one.
//
// A tool takes JSON arguments (checked against its schema first) and returns a small JSON result
// (ids, names, what changed), never the whole document. A ToolError is a refusal the model can read
// and correct; it never leaves the document half changed.
import type { Ease, Keyframe, Layer, PropKey } from '../model/types';
import { DEFAULT_EASE, FONTS, NOFILL, isFrozen, propKind, propLabel, r2, r3 } from '../core/constants';
import { ASSETS, S, doc, layerById, mkLayer, sortTrack } from '../core/state';
import { removeTrack, select, selectMany, setProp, setTime } from '../core/history';
import { propOK } from '../core/keyframes';
import { PRESETS, PRESET_GROUPS, presetById, presetJSOnly, presetTargets, writePreset } from '../core/presets';
import { N, alignTo, equalizeTrack } from '../geometry/nodes';
import { parsePath } from '../geometry/parse-path';
import { needsPlainPath, plainPath } from '../core/plain-path';
import { importSVGWith, lastImportNotes } from '../io/svg-import';
import { descendants, isBox, isLocked, kids, pidOf } from '../model/tree';
import { frame, renderStage } from '../render/stage';
import { darkBg } from '../tools/edit-tools';
import { addLayer, setShape } from '../tools/shapes';
import { arrangeEnd } from '../ui/layer-menu';
import { arrange, copyLayer, deleteSel, groupSel, moveLayers, ungroup } from '../ui/layers-panel';
import { addAsset, fileToAsset, renderAssets } from '../io/assets';
import { check, type Schema } from './schema';
import {
  ASPECTS,
  type Aspect,
  type ImageChoice,
  finishTransparency,
  generateImage,
  imageCatalog,
  imagePrice,
  imageProviderById,
  modelInfo,
} from './images';
import { canSee, confirmImages, getSettings, imageChoice, setConfirmImages, vectorChoice } from './settings';
import { SNAP_MAX, snapshotPNG } from './snapshot';
import { boxNow, layerDetail, sceneSummary } from './scene';

export class ToolError extends Error {}
const fail = (m: string): never => {
  throw new ToolError(m);
};

export interface ToolContext {
  /** ask the user before deleting layers; resolves true to go ahead */
  confirmDelete?: (names: string[]) => Promise<boolean>;
  /** ask the user before generating an image (while "Before generating images" is on) */
  confirmImage?: (ask: ImageAsk) => Promise<ImageAnswer>;
  /** an image is being made (null: done) */
  generating?: (g: { kind: 'image' | 'vector'; name: string; model: string } | null) => void;
  /** the user's Stop */
  signal?: AbortSignal;
  /** snapshots left in this request (at most 3: pictures cost the most tokens) */
  snapshots?: { left: number };
}

/** What the confirm card shows before an image is made. */
export interface ImageAsk {
  kind: 'image' | 'vector';
  name: string;
  prompt: string;
  model: string;
  /** the service, as shown ("OpenRouter") */
  service: string;
  size: string;
  transparent: boolean;
  /** about how much it costs (USD), null when unknown */
  price: number | null;
  /** an unclear request (vector or picture?): the user picks, for this request only. Vector is picked first. */
  choice?: { image: KindOption; vector: KindOption };
}
export interface KindOption {
  model: string;
  service: string;
  size: string;
  transparent?: boolean;
  price: number | null;
  /** vector drawn by the agent itself: no model, no cost */
  free?: boolean;
}
export interface ImageAnswer {
  go: boolean;
  /** the prompt as the user edited it */
  prompt?: string;
  /** don't ask again */
  dontAsk?: boolean;
  /** with a choice: what the user picked */
  kind?: 'image' | 'vector';
}

export interface Tool {
  name: string;
  description: string;
  parameters: Schema;
  /** false for tools that only read (they don't need the request's undo step) */
  mutates: boolean;
  run(args: any, ctx: ToolContext): any;
}

export type ToolResult =
  | { ok: true; result: any; image?: { mime: string; data: string } }
  | { ok: false; error: string };
/** A tool result that carries a picture for the model (a snapshot): the picture goes beside the JSON. */
export const IMAGE = Symbol('image');

/* ---------- shared checks ---------- */

/** Easing names the runtime knows (the ease on a key shapes the move to the next key). */
export const EASES = [
  'linear',
  'hold',
  'ease',
  'in',
  'out',
  'inOut',
  ...['Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Expo', 'Circ', 'Back', 'Elastic', 'Bounce'].flatMap(f => [
    'in' + f,
    'out' + f,
    'inOut' + f,
  ]),
];

function need(id: string): Layer {
  const l = layerById(id);
  if (!l) fail(`There is no layer with id "${id}". Call get_scene for the current ids.`);
  return l as Layer;
}
function editable(l: Layer) {
  if (isLocked(l)) fail(`"${l.name}" is locked. Ask the user whether to unlock it.`);
  return l;
}
const EASE_BY_KEY = new Map(EASES.map(e => [e.toLowerCase(), e]));
const FAMILY: Record<string, string> = { power1: 'Quad', power2: 'Cubic', power3: 'Quart', power4: 'Quint' };
/**
 * An easing name as the runtime spells it, from the names other tools use: CSS (ease-in-out, step-end),
 * Penner (easeInOutCubic), GSAP (power2.out, back.out(1.7), sine.inOut) and any case. null: unknown.
 */
export function easeName(s: string): string | null {
  const raw = s.trim().replace(/\(.*\)$/, ''),
    key = raw.toLowerCase().replace(/[\s_.-]/g, '');
  if (EASE_BY_KEY.has(key)) return EASE_BY_KEY.get(key)!;
  if (/^(none|power0|linearnone)$/.test(key)) return 'linear';
  if (/^(step|steps|stepend|stepstart|constant|hold)$/.test(key)) return 'hold';
  // Penner / CSS: easeIn, easeInOutQuad, ease-in-out
  const k2 = key.replace(/^ease(?=in|out)/, '');
  if (EASE_BY_KEY.has(k2)) return EASE_BY_KEY.get(k2)!;
  // family first (GSAP): quad.in, back.out, power2.inOut, power3 (out by default)
  const m = /^(sine|quad|cubic|quart|quint|expo|circ|back|elastic|bounce|power[1-4])(inout|in|out)?$/.exec(k2);
  if (m) {
    const fam = FAMILY[m[1]] || m[1][0].toUpperCase() + m[1].slice(1),
      dir = m[2] === 'in' ? 'in' : m[2] === 'inout' ? 'inOut' : 'out';
    return dir + fam;
  }
  return null;
}
function easeOf(e: unknown): Ease {
  if (e === undefined) return DEFAULT_EASE;
  if (typeof e === 'string' && easeName(e)) return easeName(e)!;
  if (Array.isArray(e) && e.length === 4 && e.every(n => typeof n === 'number' && isFinite(n))) return e as number[];
  // CSS: cubic-bezier(x1, y1, x2, y2)
  const m = typeof e === 'string' && /^\s*cubic-bezier\(([^)]*)\)\s*$/i.exec(e);
  if (m) {
    const n = m[1].split(',').map(Number);
    if (n.length === 4 && n.every(isFinite) && n[0] >= 0 && n[0] <= 1 && n[2] >= 0 && n[2] <= 1) return n.map(r3);
  }
  return fail(`Unknown easing ${JSON.stringify(e)}. Use one of ${EASES.join(', ')} or a Bézier [x1, y1, x2, y2].`);
}
const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const isPaint = (v: unknown) =>
  typeof v === 'string' || (!!v && typeof v === 'object' && Array.isArray((v as any).s) && !!(v as any).g);

/** A Morph value: SVG path data (the d attribute) in the layer's own coordinates, as nodes. */
function morphValue(v: unknown) {
  const d = typeof v === 'string' ? parsePath(v) : [];
  if (!d.length || !d.some(sp => sp.n.length >= 2))
    fail(
      'Morph (d) takes SVG path data, such as "M0 0 C40 -20 80 20 120 0 L120 60 Z", in the coordinates get_layer gives as path.d.',
    );
  return d;
}
/** Write Morph keys or a new shape: the layer becomes a plain path first (rectangles, ellipses, stars), and
 *  every key gets the same nodes, each turned to line up with the one before, so the shapes blend. */
function evenMorph(l: Layer) {
  equalizeTrack(l);
  const tr = l.t.d || [];
  for (let i = 0; i < tr.length; i++) tr[i][1] = alignTo(i ? tr[i - 1][1] : l.b.d, tr[i][1]);
}

/** Is `v` the right kind of value for property `k` of `l`? Throws a readable reason when it isn't. */
function checkValue(l: Layer, k: string, v: unknown): void {
  if (k === 'd' && needsPlainPath(l)) {
    morphValue(v);
    return;
  }
  if (!propOK(l, k as PropKey)) fail(`${l.name} (${l.type}) has no "${k}" property to set.`);
  if (isFrozen(l, k)) fail(`${propLabel(l, k)} of "${l.name}" is frozen. Ask the user to unfreeze it in the timeline.`);
  const kind = propKind(l, k),
    label = `${propLabel(l, k)} (${k})`;
  if (kind === 'v' && !(Array.isArray(v) && v.length === 2 && v.every(isNum))) fail(`${label} takes [x, y].`);
  if (kind === 'n' && !isNum(v)) fail(`${label} takes a number.`);
  if (kind === 'c' && !isPaint(v)) fail(`${label} takes a color such as "#ff8800", "none", or a gradient.`);
  if (kind === 'a' && !(Array.isArray(v) && v.every(n => isNum(n) && n >= 0)))
    fail(`${label} takes a list of dash and gap lengths ([] for solid).`);
  if (kind === 'm') morphValue(v);
}

/** Re-render after a change, so boxes measured by later calls are current. */
function refresh() {
  renderStage();
  frame();
}
const names = (ls: Layer[]) => ls.map(l => l.name);

/* ---------- argument schemas ---------- */

const ID: Schema = { type: 'string', description: 'A layer id from get_scene' };
const IDS: Schema = { type: 'array', items: ID, minItems: 1, maxItems: 200 };
const NUM: Schema = { type: 'number' };
const XY: Schema = { type: 'array', items: NUM, minItems: 2, maxItems: 2 };
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const VALUE: Schema = { description: 'A number, [x, y], a color string, or a list of numbers' };
const EASE: Schema = {
  description: `How the move to the next key goes: ${EASES.join(', ')} (CSS / GSAP names like ease-in-out or power2.out work too), or a Bézier [x1, y1, x2, y2] (or "cubic-bezier(x1, y1, x2, y2)"; x1 and x2 between 0 and 1). get_layer lists each key's easing (a name, or [x1, y1, x2, y2] for a custom curve).`,
};

/* ---------- images ---------- */

/** A model's display name: the list's name without the maker ("OpenAI: GPT Image 2" → "GPT Image 2"). */
export function modelName(c: ImageChoice) {
  const m = modelInfo(c.provider, c.model);
  return m ? m.name.replace(/^[^:]+:\s*/, '') : c.model.split('/').pop() || c.model;
}

const soonP = <T>(p: Promise<T>) => Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), 4000))]);
const serviceOf = (c: ImageChoice) => (c.provider === 'custom' ? 'Custom' : imageProviderById(c.provider)!.label);

/** The card for an unclear request: both kinds, with their models and prices. */
async function choiceAsk(a: any, img: ImageChoice): Promise<ImageAsk> {
  const aspect: Aspect = a.size || 'square',
    vec = vectorChoice();
  if (img.provider === 'openrouter' || (vec && vec.provider === 'openrouter')) await soonP(imageCatalog());
  const [ip, vp] = await Promise.all([soonP(imagePrice(img, aspect)), vec ? soonP(imagePrice(vec, 'square')) : null]);
  const image: KindOption = {
    model: modelName(img),
    service: serviceOf(img),
    size: ASPECTS[aspect].label,
    transparent: a.transparent ?? getSettings().transparent,
    price: ip,
  };
  const vector: KindOption = vec
    ? { model: modelName(vec), service: serviceOf(vec), size: 'Vector (SVG)', price: vp }
    : { model: 'Drawn by the agent', service: '', size: 'Vector (SVG)', price: 0, free: true };
  return {
    kind: 'vector',
    name: a.name,
    prompt: a.prompt,
    model: vector.model,
    service: vector.service,
    size: vector.size,
    transparent: false,
    price: vector.price,
    choice: { image, vector },
  };
}

/** Ask (when asking is on), then make the image or SVG. Returns null when the user cancelled.
 *  `pre`: the user already confirmed (the choice card), with this prompt. */
async function makeImage(kind: 'image' | 'vector', c: ImageChoice, a: any, ctx: ToolContext, pre?: { prompt: string }) {
  const aspect: Aspect = a.size || 'square',
    transparent = kind === 'image' && (a.transparent ?? getSettings().transparent),
    soon = soonP;
  // what the model takes (transparency, ratios) comes from OpenRouter's list; read it if it isn't cached
  if (c.provider === 'openrouter') await soon(imageCatalog());
  const price = await soon(imagePrice(c, aspect));
  let prompt: string = pre ? pre.prompt : a.prompt,
    asked = !!pre;
  if (!pre && confirmImages() && ctx.confirmImage) {
    const ans = await ctx.confirmImage({
      kind,
      name: a.name,
      prompt,
      model: modelName(c),
      service: serviceOf(c),
      size: kind === 'vector' ? 'Vector (SVG)' : ASPECTS[aspect].label,
      transparent,
      price,
    });
    if (!ans.go) return null;
    if (ans.prompt && ans.prompt.trim()) prompt = ans.prompt.trim();
    if (ans.dontAsk) setConfirmImages(false);
    asked = true;
  }
  if (ctx.generating) ctx.generating({ kind, name: a.name, model: modelName(c) });
  try {
    const r = await generateImage(c, { prompt, aspect, transparent, vector: kind === 'vector', signal: ctx.signal });
    const cost =
      r.cost !== undefined ? { usd: r.cost, exact: true } : price !== null ? { usd: price, exact: false } : null;
    return { r, cost, asked, prompt, transparent };
  } finally {
    if (ctx.generating) ctx.generating(null);
  }
}
/** Vector artwork: by the vector model (imported as layers), or, with none, the agent is told to draw it. */
async function makeVector(a: any, ctx: ToolContext, pre?: { prompt: string }, by = '') {
  const c = vectorChoice(),
    chosen = by ? { chosen: 'vector', by } : {};
  if (!c)
    return {
      ...chosen,
      drawn: false,
      prompt: a.prompt,
      next: `Make it as vector: write the SVG yourself (each part that should move its own element with an id that names it) and call import_svg with name "${a.name}". What to draw: ${a.prompt}`,
    };
  const m = await makeImage('vector', c, a, ctx, pre);
  if (!m) return CANCELLED;
  const svg = cleanSVG(new TextDecoder().decode(m.r.bytes));
  const before = new Set(doc.layers.map(l => l.id));
  const ok = await importSVGWith(svg, { name: a.name, at: isNum(a.x) && isNum(a.y) ? { x: a.x, y: a.y } : null });
  if (!ok) fail('The vector model sent SVG that could not be read.');
  const made = doc.layers.filter(l => !before.has(l.id)),
    top = made.filter(l => !l.parent || before.has(l.parent));
  refresh();
  return {
    ...chosen,
    ids: top.map(l => l.id),
    layers: made.length,
    prompt: m.prompt,
    model: modelName(c),
    cost: m.cost,
    asked: m.asked,
    notes: lastImportNotes.slice(0, 10),
  };
}
const CANCELLED = {
  cancelled: true,
  note: 'The user cancelled. Do not generate it again unless they ask; offer vector shapes instead if that fits.',
};

/* ---------- the tools ---------- */

export const TOOLS: Tool[] = [
  // reading and selection
  {
    name: 'get_scene',
    description:
      'The project: canvas, length, playhead, selection and every layer (id, name, type, box [x, y, w, h], paint, which properties are animated and their key times). Back to front; children follow their group.',
    parameters: obj({}),
    mutates: false,
    run: () => sceneSummary(),
  },
  {
    name: 'get_layer',
    description:
      'One layer in full: geometry, base values, origin, and every keyframe track as [time, value, ease]. Use it before changing existing keyframes. For a group it lists the children.',
    parameters: obj({ id: ID }, ['id']),
    mutates: false,
    run: a => layerDetail(need(a.id).id),
  },
  {
    name: 'list_presets',
    description:
      'The animation presets (tested entrances, exits, emphasis, stroke, color and filter animations). Prefer a preset over hand-made keyframes when one fits. cssOk false: it only plays in the JS export.',
    parameters: obj({ group: { type: 'string', enum: PRESET_GROUPS.map(g => g[0]) } }),
    mutates: false,
    run: a =>
      PRESETS.filter(p => !a.group || p.group === a.group).map(p => ({
        id: p.id,
        name: p.name,
        group: p.group,
        length: p.dur,
        cssOk: !presetJSOnly(p),
      })),
  },
  {
    name: 'list_assets',
    description: 'The images and SVG files stored in the project (id, name, kind, pixel size).',
    parameters: obj({}),
    mutates: false,
    run: () => Object.values(ASSETS).map(x => ({ id: x.id, name: x.name, kind: x.kind, w: x.w, h: x.h })),
  },
  {
    name: 'select',
    description: 'Select layers so the user sees what you mean. mode add keeps the current selection.',
    parameters: obj({ ids: { ...IDS, minItems: 0 }, mode: { type: 'string', enum: ['replace', 'add'] } }, ['ids']),
    mutates: false,
    run: a => {
      a.ids.forEach(need);
      if (a.mode === 'add') a.ids.forEach((id: string) => S.selSet.has(id) || select(id, 'toggle'));
      else selectMany(a.ids);
      return { selection: [...S.selSet] };
    },
  },
  {
    name: 'seek',
    description: 'Move the playhead (seconds). Values written with update_layer on animated properties land here.',
    parameters: obj({ time: { type: 'number', minimum: 0 } }, ['time']),
    mutates: false,
    run: a => {
      setTime(a.time);
      return { time: S.time };
    },
  },

  // making and changing layers
  {
    name: 'add_shape',
    description:
      'Add a shape on top of its siblings. rect: x, y, w, h (+ cornerRadius). ellipse: cx, cy, rx, ry. polygon / star: cx, cy, r, n (sides or points; star: inner = inner radius 0–1). line: x1, y1, x2, y2. text: x, y (baseline), text, size, font, weight, anchor.',
    parameters: obj(
      {
        kind: { type: 'string', enum: ['rect', 'ellipse', 'polygon', 'star', 'line', 'text'] },
        name: { type: 'string', maxLength: 80 },
        x: NUM,
        y: NUM,
        w: { type: 'number', minimum: 0 },
        h: { type: 'number', minimum: 0 },
        cx: NUM,
        cy: NUM,
        rx: { type: 'number', minimum: 0 },
        ry: { type: 'number', minimum: 0 },
        r: { type: 'number', minimum: 0 },
        n: { type: 'integer', minimum: 3, maximum: 40 },
        inner: { type: 'number', minimum: 0.05, maximum: 1 },
        rotation: NUM,
        x1: NUM,
        y1: NUM,
        x2: NUM,
        y2: NUM,
        text: { type: 'string', maxLength: 2000 },
        size: { type: 'number', minimum: 1 },
        font: { type: 'string' },
        weight: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        anchor: { type: 'string', enum: ['start', 'middle', 'end'] },
        fill: { type: 'string' },
        stroke: { type: 'string' },
        strokeWidth: { type: 'number', minimum: 0 },
        cornerRadius: { type: 'number', minimum: 0 },
        parent: ID,
      },
      ['kind'],
    ),
    mutates: true,
    run: a => {
      const req = (...ks: string[]) =>
        ks.forEach(k => a[k] === undefined && fail(`A ${a.kind} needs ${ks.join(', ')}.`));
      const parent = a.parent ? need(a.parent) : null;
      if (parent && !isBox(parent)) fail(`"${parent.name}" is not a group, so it can't hold layers.`);
      if (parent) editable(parent);
      const fill = a.fill ?? undefined,
        paint: Record<string, any> = {};
      if (fill !== undefined) paint.fill = fill;
      if (a.stroke !== undefined) paint.stk = a.stroke;
      if (a.strokeWidth !== undefined) paint.sw = a.strokeWidth;
      const nm = (base: string) => a.name || `${base} ${doc.layers.filter(l => l.name.startsWith(base)).length + 1}`;
      let l: Layer;
      switch (a.kind) {
        case 'rect':
          req('x', 'y', 'w', 'h');
          l = mkLayer('rect', nm('Rectangle'), {
            x: r2(a.x),
            y: r2(a.y),
            w: r2(a.w),
            h: r2(a.h),
            rx: r2(a.cornerRadius || 0),
          });
          break;
        case 'ellipse':
          req('cx', 'cy', 'rx', 'ry');
          l = mkLayer('ellipse', nm('Ellipse'), { cx: r2(a.cx), cy: r2(a.cy), rx: r2(a.rx), ry: r2(a.ry) });
          break;
        case 'polygon':
        case 'star':
          req('cx', 'cy', 'r');
          l = mkLayer('path', nm(a.kind === 'star' ? 'Star' : 'Polygon'), {}, { d: [] });
          setShape(l, {
            kind: a.kind,
            cx: r2(a.cx),
            cy: r2(a.cy),
            r: r2(a.r),
            rot: r2(a.rotation || 0),
            n: a.n || (a.kind === 'star' ? 5 : 6),
            ...(a.kind === 'star' ? { ratio: a.inner || 0.45 } : {}),
            rad: a.cornerRadius || 0,
          });
          break;
        case 'line':
          req('x1', 'y1', 'x2', 'y2');
          l = mkLayer(
            'path',
            nm('Line'),
            {},
            {
              fill: 'none',
              stk: '#5B7CFA',
              sw: 4,
              d: [{ c: false, n: [N(r2(a.x1), r2(a.y1)), N(r2(a.x2), r2(a.y2))] }],
            },
          );
          l.extra = { 'stroke-linecap': 'round' };
          break;
        default:
          req('x', 'y', 'text');
          l = mkLayer(
            'text',
            a.name || 'Text',
            {
              x: r2(a.x),
              y: r2(a.y),
              text: a.text,
              size: a.size || 48,
              family: a.font || FONTS[0][0],
              weight: String(a.weight || '600'),
              anchor: a.anchor || 'start',
            },
            { fill: darkBg() ? '#F3EEE4' : '#1A2030' },
          );
      }
      Object.assign(l.b, paint);
      addLayer(l);
      if (parent) moveLayers([l.id], parent, 'into');
      refresh();
      return { id: l.id, name: l.name, box: boxNow(l) };
    },
  },
  {
    name: 'import_svg',
    description:
      'Bring in SVG markup you wrote (or got from a vector model) as editable layers, grouped under one new group named name. x, y: where to centre it (default: the canvas centre). Every element becomes its own layer, so parts can be animated separately: give parts ids or titles that name them.',
    parameters: obj(
      { svg: { type: 'string', maxLength: 300000 }, name: { type: 'string', maxLength: 80 }, x: NUM, y: NUM },
      ['svg', 'name'],
    ),
    mutates: true,
    run: async a => {
      const before = new Set(doc.layers.map(l => l.id));
      const ok = await importSVGWith(cleanSVG(a.svg), {
        name: a.name,
        at: isNum(a.x) && isNum(a.y) ? { x: a.x, y: a.y } : null,
      });
      if (!ok) fail('That is not valid SVG markup.');
      const made = doc.layers.filter(l => !before.has(l.id)),
        top = made.filter(l => !l.parent || before.has(l.parent));
      refresh();
      return { ids: top.map(l => l.id), layers: made.length, notes: lastImportNotes.slice(0, 10) };
    },
  },
  {
    name: 'update_layer',
    description:
      'Change a layer. values: property → value (pos [x, y], rot degrees, scl [x, y] with 1 = 100%, skw [x, y], op 0–1, fill / stk color, fo / so 0–1, sw, ts / te / to %, dof, da [dash, gap…], sz [w, h], rad, d: SVG path data for a new shape, in the coordinates get_layer gives as path.d; a rectangle, ellipse or star becomes a plain path). A property that is already animated gets a keyframe at the playhead instead of a new base value; `keyed` lists those. geometry: rect x, y, w, h, rx · ellipse cx, cy, rx, ry · text x, y, text, size, family, weight, anchor · image x, y, w, h · polygon / star cx, cy, r, n, inner, rotation.',
    parameters: obj(
      {
        id: ID,
        name: { type: 'string', maxLength: 80 },
        hidden: { type: 'boolean' },
        locked: { type: 'boolean' },
        values: { type: 'object', additionalProperties: VALUE },
        geometry: { type: 'object', additionalProperties: VALUE },
        origin: XY,
      },
      ['id'],
    ),
    mutates: true,
    run: a => {
      const l = need(a.id),
        changed: string[] = [],
        keyed: string[] = [];
      // locking and hiding work on a locked layer (so the user can ask for it); nothing else does.
      // Everything is checked before anything changes, so a refusal leaves the layer as it was.
      const rest = ['name', 'values', 'geometry', 'origin'].filter(k => a[k] !== undefined);
      if (rest.length) {
        const was = l.lock;
        if (a.locked === false) l.lock = false;
        try {
          editable(l);
        } finally {
          l.lock = was;
        }
      }
      for (const [k, v] of Object.entries(a.values || {})) checkValue(l, k, v);
      if (a.geometry) setGeometry(l, a.geometry);
      if (a.locked !== undefined) {
        l.lock = a.locked;
        changed.push('locked');
      }
      if (a.hidden !== undefined) {
        l.hid = a.hidden;
        changed.push('hidden');
      }
      if (a.name !== undefined) {
        l.name = a.name;
        changed.push('name');
      }
      for (const [k, v0] of Object.entries(a.values || {})) {
        let v = v0;
        if (k === 'd') {
          plainPath(l);
          v = morphValue(v0);
        }
        setProp(l, k as PropKey, v);
        if (k === 'd') evenMorph(l);
        (l.t[k] && l.t[k].length ? keyed : changed).push(k);
      }
      if (a.geometry) changed.push(...Object.keys(a.geometry));
      if (a.origin) {
        if (l.t.org && l.t.org.length) {
          setProp(l, 'org', a.origin);
          keyed.push('origin');
        } else {
          l.o = [r3(a.origin[0]), r3(a.origin[1])];
          changed.push('origin');
        }
      }
      refresh();
      return { id: l.id, changed, keyed, time: S.time };
    },
  },
  {
    name: 'group',
    description: 'Put layers into a new group (named name). Returns the group id.',
    parameters: obj({ ids: IDS, name: { type: 'string', maxLength: 80 } }, ['ids']),
    mutates: true,
    run: a => {
      a.ids.forEach((id: string) => editable(need(id)));
      S.selSet = new Set(a.ids);
      S.sel = a.ids[a.ids.length - 1];
      groupSel();
      const g = layerById(S.sel) as Layer;
      if (a.name) g.name = a.name;
      refresh();
      return { id: g.id, name: g.name };
    },
  },
  {
    name: 'ungroup',
    description: "Release a group's layers into its parent and remove the group.",
    parameters: obj({ id: ID }, ['id']),
    mutates: true,
    run: a => {
      const g = editable(need(a.id));
      if (g.type !== 'group') fail(`"${g.name}" is not a group.`);
      if (g.mask) fail(`"${g.name}" is a mask group; ungrouping it would drop the mask. Ask the user first.`);
      ungroup(g);
      refresh();
      return { ids: [...S.selSet] };
    },
  },
  {
    name: 'duplicate',
    description: 'Copy a layer (and everything inside it), placed just above it, 16 units down and right.',
    parameters: obj({ id: ID, name: { type: 'string', maxLength: 80 } }, ['id']),
    mutates: true,
    run: a => {
      const c = copyLayer(editable(need(a.id)), true);
      if (a.name) c.name = a.name;
      refresh();
      return { id: c.id, name: c.name };
    },
  },
  {
    name: 'reorder',
    description:
      'Change the stacking order. to: front, back, forward or backward among its siblings; or before / after another layer (drawn just under / above it), or into a group (on top inside it).',
    parameters: obj(
      {
        id: ID,
        to: { type: 'string', enum: ['front', 'back', 'forward', 'backward'] },
        before: ID,
        after: ID,
        into: ID,
      },
      ['id'],
    ),
    mutates: true,
    run: a => {
      const l = editable(need(a.id));
      if (a.to === 'front' || a.to === 'back') arrangeEnd(l, a.to === 'front');
      else if (a.to) arrange(l, a.to === 'forward' ? 1 : -1);
      else if (a.into) {
        const g = editable(need(a.into));
        if (!isBox(g)) fail(`"${g.name}" is not a group.`);
        if (g === l || descendants(l).includes(g)) fail(`"${l.name}" can't go inside itself.`);
        moveLayers([l.id], g, 'into');
      } else if (a.before || a.after) {
        const t = need(a.before || a.after);
        if (t === l) fail('A layer is already next to itself.');
        if (descendants(l).includes(t)) fail(`"${l.name}" can't go inside itself.`);
        // in the layer list "before" draws it under the target, "after" above it
        moveLayers([l.id], t, a.before ? 'after' : 'before');
      } else fail('Say where: to, before, after or into.');
      refresh();
      return { order: names(kids(pidOf(layerById(a.id) as Layer))) };
    },
  },
  {
    name: 'delete',
    description: 'Delete layers (and what is inside them). The user may be asked first.',
    parameters: obj({ ids: IDS }, ['ids']),
    mutates: true,
    run: async (a, ctx) => {
      const ls = (a.ids as string[]).map(need).map(editable);
      if (ctx.confirmDelete && !(await ctx.confirmDelete(names(ls))))
        return { cancelled: true, note: 'The user chose to keep them. Do not delete them again without asking.' };
      S.selSet = new Set(a.ids);
      S.sel = a.ids[a.ids.length - 1];
      deleteSel();
      refresh();
      return { deleted: names(ls) };
    },
  },

  // images and vector
  {
    name: 'generate_image',
    description:
      "Make a raster image (PNG) with the image model and store it in the project as an asset; then put it on the canvas with place_image. prompt: what to draw, in detail (subject, style, view). size: square (default), landscape or portrait. transparent: a transparent background (default from Settings). either: true when the request does not say or imply whether it should be a picture or vector artwork; then the app decides from the user's settings or asks them, and the result says which was made (follow its next). The user may be asked first, since it costs them money; if they cancel, do not retry.",
    parameters: obj(
      {
        prompt: { type: 'string', maxLength: 4000 },
        name: { type: 'string', maxLength: 80 },
        size: { type: 'string', enum: ['square', 'landscape', 'portrait'] },
        transparent: { type: 'boolean' },
        either: { type: 'boolean' },
        x: NUM,
        y: NUM,
      },
      ['prompt', 'name'],
    ),
    mutates: true,
    run: async (a, ctx) => {
      const c = imageChoice();
      if (!c) fail('No image model is set up (Settings › Images). Offer to draw it as vector shapes instead.');
      // an unclear request: vector when the user prefers it, else they pick (vector first)
      let kind: 'image' | 'vector' = 'image',
        pre: { prompt: string } | undefined,
        by = '';
      if (a.either) {
        if (getSettings().preferVector) [kind, by] = ['vector', 'the Prefer vector setting'];
        else if (ctx.confirmImage) {
          const ans = await ctx.confirmImage(await choiceAsk(a, c!));
          if (!ans.go) return CANCELLED;
          kind = ans.kind || 'vector';
          pre = { prompt: (ans.prompt && ans.prompt.trim()) || a.prompt };
          by = 'the user';
        }
      }
      if (kind === 'vector') return makeVector(pre ? { ...a, prompt: pre.prompt } : a, ctx, pre, by);
      const m = await makeImage('image', c!, a, ctx, pre);
      if (!m) return CANCELLED;
      const t = await finishTransparency(m.r, m.transparent),
        ext = /jpeg/.test(t.mime) ? 'jpg' : /webp/.test(t.mime) ? 'webp' : 'png';
      const asset = addAsset(await fileToAsset(new File([t.bytes as BlobPart], `${a.name}.${ext}`, { type: t.mime })));
      renderAssets();
      return {
        asset: asset.id,
        name: asset.name,
        w: asset.w,
        h: asset.h,
        transparent: t.transparent,
        model: modelName(c!),
        cost: m.cost,
        asked: m.asked,
        ...(by ? { chosen: 'image', by } : {}),
        next: 'Place it with place_image.',
      };
    },
  },
  {
    name: 'generate_vector',
    description:
      'Make detailed vector artwork with the vector model and bring it in as editable layers (like import_svg), grouped under name. x, y: where to centre it. Use it for illustrations; for simple shapes write the SVG yourself. The user may be asked first, since it costs them money; if they cancel, do not retry.',
    parameters: obj(
      { prompt: { type: 'string', maxLength: 4000 }, name: { type: 'string', maxLength: 80 }, x: NUM, y: NUM },
      ['prompt', 'name'],
    ),
    mutates: true,
    run: async (a, ctx) => {
      if (!vectorChoice()) fail('No vector model is set up: write the SVG yourself and call import_svg.');
      return makeVector(a, ctx);
    },
  },
  {
    name: 'place_image',
    description:
      'Put an asset (from generate_image or list_assets) on the canvas as a new layer on top. x, y: its centre (default: the canvas centre). width: its width in px (default: fits 70% of the canvas; the height follows the picture). An SVG asset comes in as editable layers.',
    parameters: obj(
      {
        asset: { type: 'string' },
        x: NUM,
        y: NUM,
        width: { type: 'number', minimum: 1 },
        name: { type: 'string', maxLength: 80 },
      },
      ['asset'],
    ),
    mutates: true,
    run: async a => {
      const x = ASSETS[a.asset];
      if (!x) fail(`There is no asset "${a.asset}". Call list_assets for the ids.`);
      const at = isNum(a.x) && isNum(a.y) ? { x: a.x, y: a.y } : null;
      if (x.kind === 'svg') {
        const before = new Set(doc.layers.map(l => l.id));
        if (!(await importSVGWith(x.text || '', { name: a.name || x.name, at })))
          fail('That SVG asset could not be read.');
        const top = doc.layers.filter(l => !before.has(l.id) && (!l.parent || before.has(l.parent)));
        refresh();
        return { ids: top.map(l => l.id) };
      }
      const s = isNum(a.width)
          ? a.width / (x.w || 1)
          : Math.min(1, (0.7 * doc.w) / (x.w || 1), (0.7 * doc.h) / (x.h || 1)),
        w = r2((x.w || 100) * s),
        h = r2((x.h || 100) * s),
        cx = at ? at.x : (doc.vx || 0) + doc.w / 2,
        cy = at ? at.y : (doc.vy || 0) + doc.h / 2;
      const l = mkLayer('image', a.name || x.name, { x: r2(cx - w / 2), y: r2(cy - h / 2), w, h, asset: x.id }, NOFILL);
      addLayer(l);
      refresh();
      return { id: l.id, name: l.name, box: boxNow(l) };
    },
  },

  {
    name: 'snapshot',
    description:
      'Look at your work: a picture of the canvas at `time` seconds (default: the playhead), the artwork only, at most `width` px wide (default and most 768). At most 3 per request, so look once near the end, at the most telling moment (for a launch: mid-launch).',
    parameters: obj({
      time: { type: 'number', minimum: 0 },
      width: { type: 'number', minimum: 64, maximum: SNAP_MAX },
    }),
    mutates: false,
    run: async (a, ctx) => {
      if (ctx.snapshots) {
        if (ctx.snapshots.left <= 0)
          fail('No snapshots left in this request (at most 3). Finish from what you have seen.');
        ctx.snapshots.left--;
      }
      const p = await snapshotPNG(isNum(a.time) ? a.time : S.time, a.width || SNAP_MAX);
      return {
        time: p.time,
        w: p.w,
        h: p.h,
        note: 'The picture follows. Text in web fonts may show in a fallback font.',
        [IMAGE]: { mime: p.mime, data: p.data },
      };
    },
  },

  // animation
  {
    name: 'apply_preset',
    description:
      'Apply an animation preset (ids from list_presets) to layers, starting at `at` seconds for `length` seconds (default: the preset length). stagger: each next layer starts that much later. strength 1 = 100%. Keys of the same properties inside the span are replaced. Grows the animation length when needed.',
    parameters: obj(
      {
        preset: { type: 'string' },
        ids: IDS,
        at: { type: 'number', minimum: 0, maximum: 600 },
        length: { type: 'number', minimum: 0.05, maximum: 60 },
        stagger: { type: 'number', minimum: 0, maximum: 10 },
        strength: { type: 'number', minimum: 0, maximum: 3 },
      },
      ['preset', 'ids', 'at'],
    ),
    mutates: true,
    run: a => {
      const p = presetById(a.preset);
      if (!p) return fail(`There is no preset "${a.preset}". Call list_presets for the ids.`);
      a.ids.forEach((id: string) => editable(need(id)));
      const ls = presetTargets(p, a.ids);
      if (!ls.length) fail(`${p.name} can't go on ${a.ids.length > 1 ? 'these layers' : 'that layer'}.`);
      const skipped = (a.ids as string[]).filter(id => !ls.some(l => l.id === id));
      const r = writePreset(p, a.at, a.length ?? p.dur, a.stagger || 0, a.strength ?? 1, a.ids);
      refresh();
      return {
        layers: names(ls),
        skipped: skipped.length ? names(skipped.map(need)) : undefined,
        replaced: r ? r.replaced : 0,
        length: doc.dur,
        grew: r ? r.grew : false,
        cssOk: !presetJSOnly(p),
      };
    },
  },
  {
    name: 'set_keyframes',
    description:
      'Write keyframes for one property: keys [{ t: seconds, v: value, ease? (default linear) }]. The ease on a key shapes the move to the next key. Morph (prop d): each v is SVG path data in the coordinates get_layer gives as path.d (start from that shape); a rectangle, ellipse or star becomes a plain path first, and every key gets the same number of nodes so the shapes blend. mode merge (default) keeps other keys and replaces ones at the same time; replace drops the old track. curved: for pos, make the motion path curved. Keys past the end grow the animation length.',
    parameters: obj(
      {
        id: ID,
        prop: { type: 'string' },
        keys: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          items: obj({ t: { type: 'number', minimum: 0, maximum: 600 }, v: VALUE, ease: EASE }, ['t', 'v']),
        },
        mode: { type: 'string', enum: ['merge', 'replace'] },
        curved: { type: 'boolean' },
      },
      ['id', 'prop', 'keys'],
    ),
    mutates: true,
    run: a => {
      const l = editable(need(a.id)),
        k = a.prop as string;
      a.keys.forEach((q: any) => checkValue(l, k, q.v));
      if (k === 'd') plainPath(l);
      const made: Keyframe[] = a.keys.map((q: any) => [r3(q.t), k === 'd' ? morphValue(q.v) : q.v, easeOf(q.ease)]);
      let tr: Keyframe[] = a.mode === 'replace' || !l.t[k] ? [] : l.t[k].slice();
      made.forEach(q => {
        tr = tr.filter(o => Math.abs(o[0] - q[0]) >= 0.005);
        tr.push(q);
      });
      sortTrack(tr);
      // keyframes that were replaced can't stay selected in the timeline
      (l.t[k] || []).forEach(q => tr.includes(q) || S.keys.delete(q));
      l.t[k] = tr;
      if (k === 'd') evenMorph(l);
      if (a.curved !== undefined) {
        if (k !== 'pos') fail('curved only applies to pos.');
        l.sm = a.curved;
      }
      const last = tr[tr.length - 1][0],
        grew = last > doc.dur;
      if (grew) doc.dur = r3(last);
      S.exp[l.id] = true;
      refresh();
      return { id: l.id, prop: k, keys: tr.length, length: doc.dur, grew, cssOk: !k.startsWith('fx.') };
    },
  },
  {
    name: 'clear_animation',
    description:
      "Remove a layer's keyframes (all, or only props). Each property keeps the value it has at the playhead.",
    parameters: obj({ id: ID, props: { type: 'array', items: { type: 'string' } } }, ['id']),
    mutates: true,
    run: a => {
      const l = editable(need(a.id)),
        ks = (a.props || Object.keys(l.t)).filter((k: string) => l.t[k] && l.t[k].length);
      ks.forEach((k: string) => removeTrack(l, k as PropKey));
      refresh();
      return { id: l.id, cleared: ks };
    },
  },
  {
    name: 'offset_animation',
    description:
      'Shift every keyframe of layers in time by `by` seconds; with stagger, each next layer moves that much more (for cascades). Grows the animation length when needed.',
    parameters: obj(
      {
        ids: IDS,
        by: { type: 'number', minimum: -600, maximum: 600 },
        stagger: { type: 'number', minimum: -60, maximum: 60 },
      },
      ['ids', 'by'],
    ),
    mutates: true,
    run: a => {
      const ls: Layer[] = (a.ids as string[]).map(need).map(editable);
      const d = (i: number) => a.by + i * (a.stagger || 0);
      ls.forEach((l, i) =>
        Object.values(l.t).forEach(tr =>
          tr.forEach(q => q[0] + d(i) < -0.0005 && fail(`That would move keys of "${l.name}" before 0 s.`)),
        ),
      );
      let moved = 0,
        end = doc.dur;
      ls.forEach((l, i) =>
        Object.values(l.t).forEach(tr => {
          tr.forEach(q => {
            q[0] = r3(Math.max(0, q[0] + d(i)));
            end = Math.max(end, q[0]);
            moved++;
          });
          sortTrack(tr);
        }),
      );
      const grew = end > doc.dur;
      if (grew) doc.dur = r3(end);
      refresh();
      return { moved, length: doc.dur, grew };
    },
  },
  {
    name: 'set_document',
    description:
      'Canvas and timing: length (seconds), repeat (number of plays, 0 = forever), direction, w and h (canvas size), background (a color or "transparent").',
    parameters: obj({
      length: { type: 'number', minimum: 0.1, maximum: 600 },
      repeat: { type: 'integer', minimum: 0, maximum: 1000 },
      direction: { type: 'string', enum: ['normal', 'reverse', 'alternate', 'alternate-reverse'] },
      w: { type: 'number', minimum: 1, maximum: 10000 },
      h: { type: 'number', minimum: 1, maximum: 10000 },
      background: { type: 'string' },
    }),
    mutates: true,
    run: a => {
      if (a.length !== undefined) {
        doc.dur = r3(a.length);
        if (S.time > doc.dur) setTime(doc.dur);
      }
      if (a.repeat !== undefined) doc.it = a.repeat;
      if (a.direction) doc.dir = a.direction;
      if (a.w) doc.w = r2(a.w);
      if (a.h) doc.h = r2(a.h);
      if (a.background !== undefined) doc.bg = a.background === 'transparent' ? '' : a.background;
      refresh();
      return {
        length: doc.dur,
        repeat: doc.it,
        direction: doc.dir,
        w: doc.w,
        h: doc.h,
        background: doc.bg || 'transparent',
      };
    },
  },
];

/** Geometry keys a tool may write, per layer type. */
const GEO: Record<string, string[]> = {
  rect: ['x', 'y', 'w', 'h', 'rx'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  text: ['x', 'y', 'text', 'size', 'family', 'weight', 'anchor', 'italic', 'ls', 'lh'],
  image: ['x', 'y', 'w', 'h'],
};
function setGeometry(l: Layer, g: Record<string, any>) {
  if (l.shape) {
    const ok = ['cx', 'cy', 'r', 'n', 'inner', 'rotation'];
    for (const k of Object.keys(g)) if (!ok.includes(k)) fail(`A ${l.shape.kind} takes geometry ${ok.join(', ')}.`);
    const s = l.shape;
    setShape(l, {
      kind: s.kind,
      cx: g.cx ?? s.cx,
      cy: g.cy ?? s.cy,
      r: g.r ?? s.r,
      rot: g.rotation ?? s.rot,
      n: g.n ?? s.n,
      ...(s.kind === 'star' ? { ratio: g.inner ?? s.ratio } : {}),
      rad: s.rad || 0,
    });
    return;
  }
  const ok = GEO[l.type];
  if (!ok) fail(`The geometry of a ${l.type} layer can't be set directly; use values (pos, scl, sz) instead.`);
  for (const [k, v] of Object.entries(g)) {
    if (!ok.includes(k)) fail(`A ${l.type} takes geometry ${ok.join(', ')}.`);
    if (k === 'text' || k === 'family' || k === 'anchor') {
      if (typeof v !== 'string') fail(`${k} must be text.`);
    } else if (k === 'weight') {
      if (typeof v !== 'string' && !isNum(v)) fail('weight must be a number such as 400 or 700.');
    } else if (k === 'italic') {
      if (typeof v !== 'boolean') fail('italic must be true or false.');
    } else if (!isNum(v)) fail(`${k} must be a number.`);
  }
  for (const [k, v] of Object.entries(g)) l.geo[k] = k === 'weight' ? String(v) : isNum(v) ? r2(v) : v;
}

/** SVG markup from a model, before the importer sees it: no scripts, event handlers, embedded HTML or
 *  links to other sites. (The importer already skips <script>; this also covers what it keeps as-is.) */
export function cleanSVG(s: string) {
  return s
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("|')\s*(?:https?:|javascript:|\/\/)[^"']*\1/gi, '');
}

export const toolByName = (n: string) => TOOLS.find(t => t.name === n);

/** The tool list in the shape providers take: name, description, JSON Schema parameters. */
export function toolSpecs(only?: string[]) {
  return TOOLS.filter(t => !only || only.includes(t.name)).map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/** Run one tool call. Never throws: a refusal or a failure comes back as { ok: false, error }. */
export async function runTool(name: string, args: unknown, ctx: ToolContext = {}): Promise<ToolResult> {
  const t = toolByName(name);
  if (!t) return { ok: false, error: `There is no tool called ${name}.` };
  const a = args === undefined || args === null ? {} : args;
  const bad = check(a, t.parameters);
  if (bad) return { ok: false, error: bad };
  try {
    const result = await t.run(a, ctx);
    if (result && result[IMAGE]) {
      const { [IMAGE]: image, ...rest } = result;
      return { ok: true, result: rest, image };
    }
    return { ok: true, result };
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, error: e.message };
    return { ok: false, error: `${name} failed: ${(e && (e as Error).message) || e}` };
  }
}

/** A result as the text sent back to the model, cut to `max` characters. */
export function resultText(r: ToolResult, max = 8192) {
  const s = JSON.stringify('error' in r ? { error: r.error } : (r.result ?? { done: true }));
  return s.length <= max ? s : s.slice(0, max - 60) + `… (cut: ${s.length - max + 60} more characters)`;
}

/** The tools to offer now: image and vector generation only when Settings has a model for them. */
export function offeredTools(): string[] {
  const img = !!imageChoice(),
    vec = !!vectorChoice();
  const see = canSee();
  return TOOLS.map(t => t.name).filter(
    n => (n !== 'generate_image' || img) && (n !== 'generate_vector' || vec) && (n !== 'snapshot' || see),
  );
}
