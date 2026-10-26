// SVGcinema — core/constants
import type { Layer, PropKey } from '../model/types';
import { fxKeys, fxName, fxOf } from '../model/filters';
import { isPinKey, isPinRot, pinBase, pinKeys, pinLabel } from '../model/pins';
import { CinEngine } from '../runtime/engine';

export function $(s: string): any {
  return document.querySelector(s);
}
export function byId(id: string): any {
  return document['getElementById'](id);
}
export const NS = 'http://www.w3.org/2000/svg';
export function clone<T>(o: T): T {
  return o == null ? o : JSON.parse(JSON.stringify(o));
}
export function r2(n: number) {
  return Math.round(n * 100) / 100;
}
export function r3(n: number) {
  return Math.round(n * 1000) / 1000;
}
export function fmt(n: number, d = 2) {
  return n == null || !isFinite(n) ? '' : String(Math.round(n * Math.pow(10, d)) / Math.pow(10, d));
}
export function esc(s: unknown) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
export function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
export const H = CinEngine({ L: [] }, null);
export function xfp(M: DOMMatrixInit, x: number, y: number) {
  return new DOMPoint(x, y).matrixTransform(M);
}
export const PROPS: Record<PropKey, [label: string, kind: 'v' | 'n' | 'c' | 'm' | 'a']> = {
  pos: ['Position', 'v'],
  org: ['Origin', 'v'],
  rot: ['Rotate', 'n'],
  scl: ['Scale', 'v'],
  skw: ['Skew', 'v'],
  op: ['Opacity', 'n'],
  fill: ['Fill', 'c'],
  fo: ['Fill opacity', 'n'],
  stk: ['Stroke', 'c'],
  so: ['Stroke opacity', 'n'],
  sw: ['Stroke width', 'n'],
  ts: ['Trim start', 'n'],
  te: ['Trim end', 'n'],
  to: ['Trim offset', 'n'],
  dof: ['Dash offset', 'n'],
  d: ['Morph', 'm'],
  p0: ['Line start', 'v'],
  p1: ['Line end', 'v'],
  rad: ['Corner radius', 'n'],
  sz: ['Size', 'v'],
  da: ['Dash pattern', 'a'],
};
export const PORDER: PropKey[] = [
  'pos',
  'org',
  'rot',
  'scl',
  'skw',
  'op',
  'fill',
  'fo',
  'stk',
  'so',
  'sw',
  'ts',
  'te',
  'to',
  'dof',
  'da',
  'sz',
  'rad',
  'p0',
  'p1',
  'd',
];
/** Human name of a property (filters read as "Drop shadow · X"). */
export function propLabel(l: Layer, k: string) {
  // a two-point open path is a line: its Morph track moves the line's ends
  const d0 = k === 'd' && l.type === 'path' && l.b.d;
  if (d0 && d0.length === 1 && !d0[0].c && d0[0].n.length === 2) return 'Line';
  if ((PROPS as any)[k]) return (PROPS as any)[k][0] as string;
  if (isPinKey(k)) return pinLabel(k);
  const f = fxOf(l, k);
  return f ? `${fxName(f.fx)} · ${f.param.label}` : k;
}
/** Value kind of a property: v = 2D vector, n = number, c = colour, m = path, a = number list. */
export function propKind(l: Layer, k: string): 'v' | 'n' | 'c' | 'm' | 'a' {
  if ((PROPS as any)[k]) return (PROPS as any)[k][1];
  if (isPinKey(k)) return isPinRot(k) ? 'n' : 'v';
  const f = fxOf(l, k);
  return f && typeof f.param.def === 'string' ? 'c' : 'n';
}
/** A layer's animated tracks in display order: standard properties, then filter parameters. */
/** Tracks shown in the timeline: active ones and frozen ones, in property order. */
export function layerTracks(l: Layer): PropKey[] {
  return [...PORDER, ...(fxKeys(l) as PropKey[]), ...(pinKeys(l) as PropKey[])].filter(
    k => (l.t[k] && l.t[k].length) || (l.ft && l.ft[k] && l.ft[k].length),
  );
}
export function isFrozen(l: Layer, k: string) {
  return !!(l.ft && l.ft[k] && l.ft[k].length);
}
/** Values of properties a layer may never have set. */
export const PDEF: Partial<Record<string, any>> = { skw: [0, 0], fo: 1, so: 1, dof: 0, ts: 0, te: 100, to: 0 };
/** A property's value at time t, falling back to its default. */
/** Properties whose resting value lives in the geometry: line ends in the path, corner radius in
 *  the rectangle or the polygon / star settings. */
function geoBase(l: Layer, k: string) {
  if (k === 'p0' || k === 'p1') {
    const q = l.b.d && l.b.d[0] && l.b.d[0].n[+k[1]];
    return q ? [q[0], q[1]] : null;
  }
  if (k === 'rad') return l.type === 'rect' ? l.geo.rx || 0 : l.shape ? l.shape.rad || 0 : 0;
  if (k === 'sz') {
    const b = sizeBox(l);
    return b ? [r3(b[2]), r3(b[3])] : null;
  }
  if (k === 'da') return parseDash(l.extra && l.extra['stroke-dasharray']);
  if (isPinKey(k)) return pinBase(l, k);
  return undefined;
}
/** A dash pattern from stroke-dasharray text ([] = solid). */
export function parseDash(s: unknown): number[] {
  const v = String(s == null ? '' : s)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(parseFloat);
  return v.length && v.every(x => isFinite(x) && x >= 0) && v.some(x => x > 0) ? v : [];
}
/** Layers that have a size: rectangles, ellipses, images and paths. */
export function hasSize(l: Layer) {
  return ['rect', 'ellipse', 'image', 'path'].includes(l.type);
}
/** A layer's resting box [x, y, w, h] in its own space (paths: the box of their base shape). */
export function sizeBox(l: Layer): number[] | null {
  const G = l.geo;
  if (l.type === 'rect' || l.type === 'image') return [G.x || 0, G.y || 0, G.w || 0, G.h || 0];
  if (l.type === 'ellipse')
    return [(G.cx || 0) - (G.rx || 0), (G.cy || 0) - (G.ry || 0), 2 * (G.rx || 0), 2 * (G.ry || 0)];
  if (l.type === 'path' && l.b.d) return H.pathBox(l.b.d);
  return null;
}
/** Resize a layer's resting geometry to [w, h] around its origin (paths: every shape key too). */
export function resizeBase(l: Layer, s: number[]) {
  const b = sizeBox(l);
  if (!b) return;
  const o = l.sa ? [b[0] + l.sa[0] * b[2], b[1] + l.sa[1] * b[3]] : l.o || [b[0] + b[2] / 2, b[1] + b[3] / 2],
    w = Math.max(0, s[0]),
    h = Math.max(0, s[1]),
    kx = b[2] ? w / b[2] : 1,
    ky = b[3] ? h / b[3] : 1,
    X = (x: number) => r3(o[0] - (o[0] - x) * kx),
    Y = (y: number) => r3(o[1] - (o[1] - y) * ky),
    G = l.geo;
  if (l.type === 'rect' || l.type === 'image') {
    G.x = X(G.x || 0);
    G.y = Y(G.y || 0);
    G.w = r3(w);
    G.h = r3(h);
  } else if (l.type === 'ellipse') {
    G.cx = X(G.cx || 0);
    G.cy = Y(G.cy || 0);
    G.rx = r3(w / 2);
    G.ry = r3(h / 2);
  } else if (l.type === 'path') {
    const sp = (d: any[]) =>
      d.map(p => ({ c: p.c, n: p.n.map((q: number[]) => q.map((v, i) => (i % 2 ? Y(v) : X(v)))) }));
    const uni = Math.abs(kx - ky) < 1e-9;
    l.b.d = sp(l.b.d);
    if (l.t.d) l.t.d.forEach(q => (q[1] = sp(q[1])));
    (['p0', 'p1'] as const).forEach(k => l.t[k] && l.t[k].forEach(q => (q[1] = [X(q[1][0]), Y(q[1][1])])));
    if (l.shape) {
      // a polygon / star stays one while it keeps its proportions; stretched, it is a plain path
      if (uni) {
        l.shape.cx = X(l.shape.cx);
        l.shape.cy = Y(l.shape.cy);
        l.shape.r = r3(l.shape.r * kx);
        if (l.shape.rad) l.shape.rad = r3(l.shape.rad * kx);
        if (l.t.rad) l.t.rad.forEach(q => (q[1] = r3(q[1] * kx)));
        l.shape.sig = JSON.stringify(l.b.d);
      } else {
        delete l.shape;
        delete l.t.rad;
      }
    }
  }
}
export function valueAt(l: Layer, k: string, t: number) {
  const tr = l.t[k],
    g = tr && tr.length ? undefined : geoBase(l, k);
  if (g !== undefined) return g;
  const v = H.get(l, k, t);
  return v == null && PDEF[k] != null ? clone(PDEF[k]) : v;
}
export function baseOf(l: Layer, k: PropKey) {
  const g = geoBase(l, k);
  if (g !== undefined) return g;
  return k === 'org' ? l.o || [0, 0] : l.b[k] != null ? l.b[k] : clone(PDEF[k]);
}
export function setBase(l: Layer, k: PropKey, v: any) {
  if (k === 'org') l.o = v;
  else if (k === 'p0' || k === 'p1') {
    const q = l.b.d && l.b.d[0] && l.b.d[0].n[+k[1]];
    if (!q) return;
    const dx = v[0] - q[0],
      dy = v[1] - q[1];
    for (let i = 0; i < 6; i += 2) {
      q[i] += dx;
      q[i + 1] += dy;
    }
  } else if (k === 'sz') resizeBase(l, v);
  else if (k === 'da') {
    l.extra = Object.assign({}, l.extra || {});
    const s = (v || []).map((x: number) => r3(x)).join(', ');
    if (s && (v || []).some((x: number) => x > 0)) l.extra['stroke-dasharray'] = s;
    else delete l.extra['stroke-dasharray'];
  } else if (k === 'rad') {
    if (l.type === 'rect') l.geo.rx = v;
    else if (l.shape) {
      // the path follows the polygon / star settings (and stays recognised as that shape)
      l.shape.rad = v;
      l.b.d = (H as any).poly(l.shape, v);
      l.shape.sig = JSON.stringify(l.b.d);
    }
  } else (l.b as Record<string, any>)[k] = v;
}
export const EZFAM = [
  'Standard',
  'Sine',
  'Quad',
  'Cubic',
  'Quart',
  'Quint',
  'Expo',
  'Circ',
  'Back',
  'Elastic',
  'Bounce',
];
export const FONTS = [
  ['system-ui, -apple-system, Segoe UI, sans-serif', 'Sans'],
  ['Georgia, Times New Roman, serif', 'Serif'],
  ['ui-monospace, Menlo, Consolas, monospace', 'Mono'],
  ['Impact, Arial Narrow, sans-serif', 'Condensed'],
];
export const SWATCH = ['#5B7CFA', '#F2B63D', '#2EC4A6', '#F25F5C', '#A07BFF', '#FF8A3D'];
export const KAPPA = 0.5523;
export const NOFILL: Record<'fill' | 'stk' | 'sw', null> = { fill: null, stk: null, sw: null };
export function ic(p: string, s = 16) {
  return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
/** A filled icon drawn in the 9.8-unit grid of the bone icons (the owner's SVGs), at `s` px tall. */
export function bic(paths: string, s = 16, w = 9.801) {
  return `<svg class="bic${w > 10 ? ' bic-w' : ''}" viewBox="0 0 ${w} 9.801" width="${Math.round(((s * w) / 9.801) * 10) / 10}" height="${s}" fill="currentColor" aria-hidden="true">${paths}</svg>`;
}
const BONE_P =
  '<path d="M7.52 0.391 C8.042 -0.13 8.888 -0.13 9.41 0.391 C9.931 0.913 9.931 1.759 9.41 2.281 C9.055 2.635 8.551 2.749 8.101 2.622 L4.26 7.608 L2.655 8.253 C2.721 8.662 2.596 9.095 2.281 9.41 C1.759 9.931 0.913 9.931 0.391 9.41 C-0.13 8.888 -0.13 8.042 0.391 7.52 C0.706 7.205 1.139 7.08 1.548 7.146 L2.193 5.541 L7.179 1.7 C7.052 1.25 7.166 0.746 7.52 0.391 Z M8.015 0.886 C7.423 1.478 8.323 2.378 8.915 1.786 C9.507 1.194 8.607 0.294 8.015 0.886 Z M7.343 2.458 L2.771 5.98 L2.187 7.435 C2.219 7.461 2.25 7.49 2.281 7.52 C2.311 7.551 2.34 7.582 2.366 7.614 L3.821 7.03 Z"/>';
export const ICON: Record<string, string> = {
  mask: ic(
    '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="12" cy="12" r="5" fill="currentColor" fill-opacity=".35"/>',
  ),
  unmask: ic(
    '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="12" cy="12" r="5"/><path d="M5.5 18.5l13-13"/>',
  ),
  eyedropper: ic(
    '<path d="M14.2 6.2l2.9-2.9a2.3 2.3 0 013.3 3.3l-2.9 2.9" fill="currentColor"/><path d="M12 6.8l5.2 5.2"/><path d="M13.6 8.4L5.7 16.3c-.4.4-.6.9-.6 1.4V19h1.3c.5 0 1-.2 1.4-.6l7.9-7.9"/><path d="M3.6 20.4l1.4-1.4"/>',
  ),
  bone: bic(BONE_P),
  boneedit: bic(
    `<path class="ic-dim" d="M10.14 3.372 C10.821 3.09 11.603 3.413 11.885 4.095 C12.167 4.777 11.844 5.558 11.162 5.841 C10.699 6.033 10.19 5.945 9.822 5.655 L4.365 8.792 L2.15 8.768 L2.157 8.125 L1.697 7.675 L3.247 6.092 L9.324 4.451 C9.378 3.986 9.676 3.564 10.14 3.372 Z M10.407 4.019 C9.634 4.339 10.121 5.515 10.894 5.194 C11.668 4.874 11.181 3.698 10.407 4.019 Z M9.185 5.213 L3.614 6.718 L2.29 8.07 L4.182 8.09 Z"/>${BONE_P}`,
    16,
    11.987,
  ),
  bonescale: bic(
    `${BONE_P}<path d="M6.221 7.94 L6.221 6.08 L9.801 6.08 L9.801 9.801 L8.011 9.801 L6.221 9.801 Z M6.921 6.78 L6.921 7.94 L8.011 7.94 L8.011 9.101 L9.101 9.101 L9.101 6.78 Z"/>`,
  ),
  bonebind: bic(
    `${BONE_P}<path d="M7.815 5.969 C8.748 5.036 10.315 6.052 9.811 7.304 C9.751 7.453 9.663 7.585 9.548 7.701 L8.715 8.534 L8.256 8.067 L9.088 7.241 C9.604 6.725 8.81 5.893 8.275 6.428 L7.449 7.26 L6.983 6.801 Z M6.824 8.227 L8.233 6.818 L8.698 7.284 L7.289 8.692 Z M5.974 7.81 L6.807 6.983 L7.266 7.443 L6.434 8.275 C5.904 8.805 6.72 9.609 7.247 9.082 L8.073 8.25 L8.539 8.716 L7.706 9.542 C6.771 10.478 5.191 9.447 5.708 8.206 C5.77 8.057 5.859 7.925 5.974 7.81 Z"/>`,
    16,
    9.909,
  ),
  pin: ic('<path d="M8.5 3.5h7"/><path d="M10 3.5l-.7 6L6.5 13.5h11l-2.8-4-.7-6"/><path d="M12 13.5v7"/>'),
  pinedit: ic(
    '<path class="ic-dims" d="M6.5 3h5.5l-1 4.6 2.7 2.9H4.8l2.7-2.9z"/><path class="ic-dims" d="M8.6 10.5V16"/><path d="M12.5 8.5h6l-1.1 4.8 2.9 3.1h-9.6l2.9-3.1z"/><path d="M15.5 16.4V22"/>',
  ),
  select: ic('<path d="M5 3.5l13 6.2-5.6 1.7-1.9 5.8z"/><path d="M12.4 11.4l5 5"/>'),
  node: ic(
    '<path d="M5 19C8 9 16 15 19 5"/><rect x="3" y="17" width="4" height="4" rx=".5"/><rect x="17" y="3" width="4" height="4" rx=".5"/>',
  ),
  rect: ic('<rect x="4" y="5" width="16" height="14" rx="1.5"/>'),
  ellipse: ic('<circle cx="12" cy="12" r="8"/>'),
  star: ic('<path d="M12 3.5l2.6 5.6 6.1.7-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.1 6.1-.7z"/>'),
  pen: ic('<path d="M12 21l-6-8 6-10 6 10z"/><circle cx="12" cy="13" r="1.6"/>'),
  addnode: ic(
    '<path d="M10 21l-5-7.5 5-9.5 5 9.5z"/><circle cx="10" cy="13.5" r="1.4"/><path d="M19 3.5v6M16 6.5h6"/>',
  ),
  delnode: ic('<path d="M10 21l-5-7.5 5-9.5 5 9.5z"/><circle cx="10" cy="13.5" r="1.4"/><path d="M16 6.5h6"/>'),
  convert: ic(
    '<path d="M4 20L12 5l8 15"/><path d="M12 5v8"/><rect x="10.3" y="3.3" width="3.4" height="3.4" rx=".5"/>',
  ),
  pencil: ic(
    '<path d="M4 20l1.2-4.4L16.5 4.3a2 2 0 012.8 0l.4.4a2 2 0 010 2.8L8.4 18.8z"/><path d="M14.5 6.3l3.2 3.2"/>',
  ),
  polygon: ic('<path d="M12 3.5l8.1 5.9-3.1 9.6H7L3.9 9.4z"/>'),
  line: ic('<path d="M5 19L19 5"/>'),
  hand: ic(
    '<path d="M8 13V6a1.5 1.5 0 013 0v5M11 10.5V4.5a1.5 1.5 0 013 0V11M14 10.5V6a1.5 1.5 0 013 0v7.5c0 4-2.6 6.5-6 6.5h-.6c-2 0-3.4-.9-4.6-2.5L3.7 14.2a1.5 1.5 0 012.3-1.9L8 14.5"/>',
  ),
  text: ic('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'),
  play: ic('<path d="M7.5 4.8v14.4L19 12z" fill="currentColor"/>'),
  pause: ic('<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor" stroke="none"/>'),
  start: ic('<path d="M6 5v14M19 5.5L9 12l10 6.5z"/>'),
  loop: ic('<path d="M4 11V9a3 3 0 013-3h12l-3-3M20 13v2a3 3 0 01-3 3H5l3 3"/>'),
  eye: ic('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  eyeoff: ic(
    '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" opacity=".45"/><path d="M4 4l16 16"/>',
  ),
  lock: ic('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
  unlock: ic(
    '<rect x="5" y="11" width="14" height="9" rx="1.5" opacity=".45"/><path d="M8 11V8a4 4 0 017.6-1.7" opacity=".45"/>',
  ),
  right: ic('<path d="M9 6l6 6-6 6"/>'),
  down: ic('<path d="M6 9l6 6 6-6"/>'),
  undo: ic('<path d="M8 6l-4 4 4 4"/><path d="M4 10h10.5a5 5 0 010 10H11"/>'),
  redo: ic('<path d="M16 6l4 4-4 4"/><path d="M20 10H9.5a5 5 0 000 10H13"/>'),
  x: ic('<path d="M6 6l12 12M18 6L6 18"/>'),
  freeze: ic(
    '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5M4.6 10.4L7.9 9.5 7 6.2M19.4 13.6l-3.3.9.9 3.3M4.6 13.6l3.3.9-.9 3.3M19.4 10.4l-3.3-.9.9-3.3"/>',
  ),
  moveUp: ic('<path d="M5 4.5h14M12 20V9M7.5 13.5L12 9l4.5 4.5"/>'),
  moveDown: ic('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>'),
  duplicate: ic(
    '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5"/>',
  ),
  group: ic('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>'),
  ungroup: ic(
    '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M3.5 4.5l17 15"/>',
  ),
  animate: ic('<path d="M12 4.5l7.5 7.5-7.5 7.5L4.5 12z"/>'),
  trash: ic('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
};
export const TICON: Record<string, string> = {
  moveUp: ic('<path d="M5 4.5h14M12 20V9M7.5 13.5L12 9l4.5 4.5"/>'),
  moveDown: ic('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>'),
  duplicate: ic(
    '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5"/>',
  ),
  group: ic('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>', 14),
  rect: ic('<rect x="4" y="5" width="16" height="14" rx="1.5"/>', 14),
  ellipse: ic('<circle cx="12" cy="12" r="8"/>', 14),
  path: ic('<path d="M4 18C8 6 16 18 20 6"/>', 14),
  text: ic('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>', 14),
  image: ic(
    '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
    14,
  ),
  raw: ic('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/>', 14),
  bone: bic(BONE_P, 14),
};
/** Every tool: label and its shortcut (shown in the UI; `keys` are the keys that select it). */
export const TOOL_INFO: Record<string, { label: string; key?: string; keys?: string[] }> = {
  select: { label: 'Select & transform', key: 'V', keys: ['v'] },
  node: { label: 'Edit path nodes', key: 'A', keys: ['a'] },
  pen: { label: 'Pen tool', key: 'P', keys: ['p'] },
  addnode: { label: 'Add node tool', key: '+', keys: ['+', '='] },
  delnode: { label: 'Remove node tool', key: '-', keys: ['-', '_'] },
  convert: { label: 'Convert point tool', key: '⇧C', keys: ['shift+c'] },
  pencil: { label: 'Pencil tool', key: 'N', keys: ['n'] },
  ellipse: { label: 'Ellipse', key: 'O', keys: ['o'] },
  rect: { label: 'Rectangle', key: 'M', keys: ['m'] },
  polygon: { label: 'Polygon' },
  star: { label: 'Star' },
  line: { label: 'Line', key: 'L', keys: ['l'] },
  text: { label: 'Text', key: 'T', keys: ['t'] },
  bone: { label: 'Bone tool', key: 'B', keys: ['b'] },
  boneedit: { label: 'Edit bone tool', key: 'E', keys: ['e'] },
  bonescale: { label: 'Scale bone tool', key: 'S', keys: ['s'] },
  bonebind: { label: 'Bind tool' },
  pin: { label: 'Pin tool', key: 'W', keys: ['w'] },
  pinedit: { label: 'Edit pins tool' },
  hand: { label: 'Hand (hold Space)', key: 'H', keys: ['h'] },
};
export interface ToolGroup {
  group: string;
  label: string;
  items: string[];
}
/** The tool rail, top to bottom. `null` is a separator. */
export const TOOLBAR: Array<string | ToolGroup | null> = [
  'select',
  'node',
  { group: 'pen', label: 'Pen tools', items: ['pen', 'addnode', 'delnode', 'convert', 'pencil'] },
  { group: 'shapes', label: 'Shape tools', items: ['ellipse', 'rect', 'polygon', 'star', 'line'] },
  'text',
  null,
  { group: 'bones', label: 'Bone tools', items: ['bone', 'boneedit', 'bonescale', 'bonebind'] },
  { group: 'pins', label: 'Pin tools', items: ['pin', 'pinedit'] },
  'hand',
];
export function groupOf(tool: string): ToolGroup | null {
  for (const e of TOOLBAR) if (e && typeof e !== 'string' && e.items.includes(tool)) return e;
  return null;
}
/** Hint text as HTML: segments split by ' · ' (each capitalised) and key names as <kbd>. */
export function hintHTML(s: string) {
  return esc(s)
    .split(' · ')
    .map(seg =>
      (seg.charAt(0).toUpperCase() + seg.slice(1)).replace(
        /\b(Ctrl|Alt|Shift|Space|Esc|Enter|Del)\b(\+)?/g,
        (_, k, plus) => `<kbd>${k}</kbd>${plus ? ' + ' : ''}`,
      ),
    )
    .map(seg => `<span>${seg}</span>`)
    .join('<i aria-hidden="true">·</i>');
}
export const HINTS: Record<string, string> = {
  select: 'Drag to move · corners scale · top dot rotates · Ctrl+click picks inside groups',
  node: 'Drag nodes and handles · double-click a node for smooth/corner · Del removes a node',
  pen: 'Click: corner · drag: curve (Alt breaks the handle, Shift 45°, Space moves the point) · click the first point to close · Enter/Esc ends · on a selected path: hover to add, delete or continue',
  addnode: 'Click a segment of the selected path to add a node',
  delnode: 'Click a node of the selected path to remove it',
  convert:
    'Click a point for a corner · drag a point for smooth handles · drag a handle to move it alone · drag a segment to reshape it',
  pencil: 'Drag to draw freehand · end near the start to close the shape',
  ellipse: 'Drag to draw · Shift for a circle · Alt from the center',
  rect: 'Drag to draw · Shift for a square · Alt from the center',
  polygon: 'Drag out from the center · ↑/↓ while dragging changes the sides · Shift keeps it upright',
  star: 'Drag out from the center · ↑/↓ while dragging changes the points · Shift keeps it upright',
  line: 'Drag to draw a line · Shift snaps to 45° · Alt from the center',
  text: 'Click on the canvas to place text',
  bone: 'Drag to draw a bone · start on a bone tip to chain a child bone · Esc to finish',
  boneedit:
    "Edits the rest pose · drag a tip to change length and angle · drag a joint to move it (Alt pulls it off the parent's tip) · drag the bone to move it · Ctrl carries the artwork · Shift snaps to 15°",
  bonescale:
    'Drag along a bone to scale it, keyed at the playhead · Tab while dragging switches Length, Thickness, Linked, Squash & stretch · Shift snaps to 10%',
  pin: 'Click a path, image, text or group to add a pin (Ctrl+click picks inside a group) · drag a pin to bend the artwork (keyed at the playhead) · Alt+drag moves a pin without bending · drag the ring of the selected pin to turn it · Bind to bones (above the canvas): click bones to add pins that follow them · Del removes the pin',
  pinedit:
    'Moves pins at rest: the artwork shows its rest shape, and a pin you drag takes its motion with it · Shift moves straight · Del removes the pin',
  bonebind:
    'Click a bone or layer, then its new parent bone · Shift+click adds more · click empty canvas to unbind · Alt keeps the offset · Esc cancels',
  hand: 'Drag to pan · wheel scrolls · Ctrl+wheel zooms · double-click the hand to fit · hold Space for the hand in any tool',
};
