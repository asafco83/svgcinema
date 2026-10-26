// SVGcinema — agent/scene
// The compact picture of the project the design agent works from: sent with every request and
// returned by the get_scene tool. It names everything the model may refer to (ids, names, types,
// boxes, which properties are animated) and leaves out what it can't use, such as path nodes.
import type { Layer } from '../model/types';
import { PROPS, baseOf, r3 } from '../core/constants';
import { S, doc, layerById } from '../core/state';
import { descendants, isBox, kids } from '../model/tree';
import { fxName } from '../model/filters';
import { boxOf } from '../render/overlay';

/** Layers listed in full; past this, groups are listed without their children. */
export const SCENE_MAX = 150;

const round = (v: number) => Math.round(v);

export function paintOf(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v;
  return 'gradient';
}

/** [x, y, w, h] in document units at the current time, or undefined when it can't be measured. */
export function boxNow(l: Layer): number[] | undefined {
  try {
    const b = boxOf(l);
    if (b && isFinite(b.x) && isFinite(b.w)) return [round(b.x), round(b.y), round(b.w), round(b.h)];
  } catch (_) {
    /* not drawn (e.g. no stage in a test) */
  }
  return undefined;
}

/** property key → keyframe times, for the properties that are animated */
export function animatedOf(l: Layer): Record<string, number[]> | undefined {
  const out: Record<string, number[]> = {};
  for (const k of Object.keys(l.t)) if (l.t[k] && l.t[k].length) out[k] = l.t[k].map(q => r3(q[0]));
  return Object.keys(out).length ? out : undefined;
}

export function layerSummary(l: Layer) {
  const o: Record<string, any> = { id: l.id, name: l.name, type: l.type };
  if (l.parent) o.parent = l.parent;
  const box = boxNow(l);
  if (box) o.box = box;
  if (['rect', 'ellipse', 'path', 'text'].includes(l.type)) {
    const f = paintOf(l.b.fill),
      s = paintOf(l.b.stk);
    if (f !== undefined) o.fill = f;
    if (s && s !== 'none') o.stroke = s;
  }
  if (l.type === 'text') Object.assign(o, { text: l.geo.text, font: l.geo.family, size: l.geo.size });
  if (l.type === 'image' && l.geo.asset) o.asset = l.geo.asset;
  if (l.shape) o.shape = l.shape.kind;
  if (l.hid) o.hidden = true;
  if (l.lock) o.locked = true;
  if (l.mask) o.mask = l.mask;
  if (l.maskSrc) o.maskLayers = true;
  if (l.sym) o.symbol = (doc.symbols && doc.symbols[l.sym] && doc.symbols[l.sym].name) || l.sym;
  if (l.link) o.link = l.link.url;
  if (l.fx && l.fx.length) o.filters = l.fx.map(f => fxName(f as any));
  const anim = animatedOf(l);
  if (anim) o.animated = anim;
  return o;
}

/** Layers back to front, each group followed by its children. Groups past the limit are listed
 *  without their children; `more` counts what was left out. */
export function orderedLayers(limit = SCENE_MAX): { list: Layer[]; more: number } {
  const list: Layer[] = [];
  const walk = (pid: string | null) => {
    for (const l of kids(pid)) {
      if (list.length >= limit) return;
      list.push(l);
      // a group's children go in only while they fit; otherwise get_layer lists them
      if (isBox(l) && list.length + descendants(l).length <= limit) walk(l.id);
    }
  };
  walk(null);
  return { list, more: doc.layers.length - list.length };
}

export function sceneSummary(limit = SCENE_MAX) {
  const { list, more } = orderedLayers(limit);
  const out: Record<string, any> = {
    canvas: {
      w: doc.w,
      h: doc.h,
      bg: doc.bg || 'transparent',
      length: doc.dur,
      repeat: doc.it ? doc.it : 'forever',
      direction: doc.dir,
    },
    time: r3(S.time),
    selection: [...S.selSet],
    layers: list.map(layerSummary),
  };
  if (more > 0) out.more = more;
  return out;
}

/** Everything get_layer returns: the summary plus geometry, base values and every track. */
export function layerDetail(id: string) {
  const l = layerById(id);
  if (!l) return null;
  const o: Record<string, any> = layerSummary(l);
  const geo: Record<string, any> = { ...l.geo };
  delete geo.markup;
  o.geometry = geo;
  if (l.type === 'path' && l.b.d) o.path = { subpaths: l.b.d.length, nodes: l.b.d.reduce((n, s) => n + s.n.length, 0) };
  const base: Record<string, any> = {};
  for (const k of Object.keys(PROPS)) {
    if (k === 'd') continue;
    const v = baseOf(l, k as any);
    if (v !== undefined && v !== null) base[k] = paintOf(v) === 'gradient' ? 'gradient' : v;
  }
  o.base = base;
  o.origin = l.o || null;
  const tracks: Record<string, any[]> = {};
  for (const k of Object.keys(l.t))
    if (l.t[k] && l.t[k].length)
      tracks[k] = l.t[k].map(q => [
        r3(q[0]),
        k === 'd' ? 'shape' : paintOf(q[1]) === 'gradient' ? 'gradient' : q[1],
        q[2],
      ]);
  o.tracks = tracks;
  if (l.ft && Object.keys(l.ft).length) o.frozen = Object.keys(l.ft);
  if (l.sm) o.curvedPath = true;
  if (isBox(l)) o.children = kids(l.id).map(c => ({ id: c.id, name: c.name, type: c.type }));
  return o;
}
