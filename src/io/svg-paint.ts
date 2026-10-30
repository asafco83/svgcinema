// SVGcinema — io/svg-paint
// Helpers for reading SVG files: style cascade, colors, transforms (as matrices and as SVGcinema's
// position / rotate / skew / scale / origin), gradients in SVGcinema's model, and names.
import type { Layer } from '../model/types';
import { H, r3 } from '../core/constants';

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export type Mat = number[];
export const ID: Mat = [1, 0, 0, 1, 0, 0];
export function mul(A: Mat, B: Mat): Mat {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}
export function inv(M: Mat): Mat {
  const d = M[0] * M[3] - M[1] * M[2] || 1e-12;
  return [M[3] / d, -M[1] / d, -M[2] / d, M[0] / d, (M[2] * M[5] - M[3] * M[4]) / d, (M[1] * M[4] - M[0] * M[5]) / d];
}
export function apply(M: Mat, x: number, y: number): [number, number] {
  return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
}
export const tr = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const sc = (x: number, y: number): Mat => [x, 0, 0, y, 0, 0];
/** an SVG / CSS transform list as a matrix (CSS units like px and deg are accepted) */
export function parseTransform(s: string | null | undefined): Mat {
  if (!s) return ID.slice();
  return H.xfM(String(s).replace(/(-?[\d.]+(?:e[+-]?\d+)?)(px|deg)/gi, '$1')).slice();
}
export const isIdentity = (M: Mat) =>
  Math.abs(M[0] - 1) < 1e-9 &&
  Math.abs(M[1]) < 1e-9 &&
  Math.abs(M[2]) < 1e-9 &&
  Math.abs(M[3] - 1) < 1e-9 &&
  !M[4] &&
  !M[5];

/** A matrix's linear part as rotate · skewX · scale (SVGcinema's order; skewY stays 0). */
export function decompose(M: Mat) {
  const [a, b, c, d] = M,
    sx = Math.hypot(a, b);
  if (sx < 1e-12) return { r: 0, kx: 0, sx: 0, sy: Math.hypot(c, d) };
  const r = Math.atan2(b, a),
    cs = Math.cos(r),
    sn = Math.sin(r),
    n12 = cs * c + sn * d,
    sy = -sn * c + cs * d,
    kx = Math.abs(sy) > 1e-12 ? (Math.atan(n12 / sy) * 180) / Math.PI : 0;
  return { r: (r * 180) / Math.PI, kx, sx, sy };
}
/** Set a layer's transform so it draws with matrix M, turning around the origin `o` (layer space). */
export function placeLayer(l: Layer, M: Mat, o: [number, number] = [0, 0]) {
  const q = decompose(M),
    L = linOf(q.r, q.kx, 0, q.sx, q.sy),
    Lo = apply(L, o[0], o[1]);
  l.o = [r6(o[0]), r6(o[1])];
  l.b.rot = r6(q.r);
  l.b.scl = [r6(q.sx), r6(q.sy)];
  if (Math.abs(q.kx) > 1e-6) l.b.skw = [r6(q.kx), 0];
  else delete l.b.skw;
  // T(pos + o) · L · T(-o) has the translation pos + o − L·o
  l.b.pos = [r6(M[4] + Lo[0] - o[0]), r6(M[5] + Lo[1] - o[1])];
}
/** rotate · skewX · skewY · scale as a matrix (no translation) */
export function linOf(r: number, kx: number, ky: number, sx: number, sy: number): Mat {
  const a = (r * Math.PI) / 180;
  let M: Mat = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
  if (kx) M = mul(M, [1, 0, Math.tan((kx * Math.PI) / 180), 1, 0, 0]);
  if (ky) M = mul(M, [1, Math.tan((ky * Math.PI) / 180), 0, 1, 0, 0]);
  return mul(M, sc(sx, sy));
}
/** Move a layer's origin without moving it (its transform is unanimated). */
export function moveOrigin(l: Layer, o: [number, number]) {
  const old = l.o || [0, 0],
    sk = l.b.skw || [0, 0],
    L = linOf(l.b.rot || 0, sk[0] || 0, sk[1] || 0, l.b.scl[0], l.b.scl[1]),
    dx = old[0] - o[0],
    dy = old[1] - o[1],
    Ld = apply(L, dx, dy);
  l.b.pos = [r6(l.b.pos[0] + dx - Ld[0]), r6(l.b.pos[1] + dy - Ld[1])];
  l.o = [r6(o[0]), r6(o[1])];
}

/* ---------- styles ---------- */

export function parseStyle(s: unknown) {
  const o: Record<string, string> = {};
  String(s || '')
    .split(';')
    .forEach(p => {
      const i = p.indexOf(':');
      if (i > 0) o[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim();
    });
  return o;
}
/** properties children inherit */
export const INHERITED = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'letter-spacing',
  'text-decoration',
  'visibility',
  'paint-order',
  'color',
  'clip-rule',
];
/** properties that apply to the element only */
export const OWN = ['opacity', 'display', 'filter', 'clip-path', 'mask', 'mix-blend-mode', 'isolation', 'mask-type'];
export const PROPS_ALL = [...INHERITED, ...OWN];

/** A tiny stylesheet: simple selectors only (.class, #id, tag, tag.class, lists of them). */
export interface Rule {
  sel: string;
  spec: number;
  decl: Record<string, string>;
  order: number;
}
export function parseSheet(css: string): Rule[] {
  const out: Rule[] = [];
  let s = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!\[CDATA\[|\]\]>/g, '');
  // drop at-rules with blocks (@font-face, @keyframes, @media …)
  for (;;) {
    const i = s.search(/@[\w-]+[^{;]*\{/);
    if (i < 0) break;
    let j = s.indexOf('{', i) + 1,
      depth = 1;
    while (j < s.length && depth) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') depth--;
      j++;
    }
    s = s.slice(0, i) + s.slice(j);
  }
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null,
    n = 0;
  while ((m = re.exec(s))) {
    const decl = parseStyle(m[2]);
    m[1].split(',').forEach(raw => {
      const sel = raw.trim();
      if (!/^[a-zA-Z]*([.#][\w-]+)*$/.test(sel) || !sel) return;
      const ids = (sel.match(/#/g) || []).length,
        cls = (sel.match(/\./g) || []).length,
        tag = /^[a-zA-Z]/.test(sel) ? 1 : 0;
      out.push({ sel, spec: ids * 100 + cls * 10 + tag, decl, order: n++ });
    });
  }
  return out.sort((a, b) => a.spec - b.spec || a.order - b.order);
}
function matches(el: Element, sel: string) {
  const tag = /^[a-zA-Z]+/.exec(sel),
    rest = sel.slice(tag ? tag[0].length : 0);
  if (tag && el.localName !== tag[0]) return false;
  const cls = (el.getAttribute('class') || '').split(/\s+/);
  for (const part of rest.match(/[.#][\w-]+/g) || []) {
    if (part[0] === '#' && el.getAttribute('id') !== part.slice(1)) return false;
    if (part[0] === '.' && !cls.includes(part.slice(1))) return false;
  }
  return true;
}
/** An element's own declared properties: presentation attributes < stylesheet rules < style attribute. */
export function ownProps(el: Element, rules: Rule[]): Record<string, string> {
  const o: Record<string, string> = {};
  PROPS_ALL.forEach(p => {
    const v = el.getAttribute(p);
    if (v != null && v !== '') o[p] = v.trim();
  });
  rules.forEach(r => {
    if (matches(el, r.sel)) Object.assign(o, r.decl);
  });
  Object.assign(o, parseStyle(el.getAttribute('style')));
  for (const k in o) if (o[k] === 'inherit') delete o[k];
  return o;
}

/* ---------- colors ---------- */

let cctx: CanvasRenderingContext2D | null | undefined;
/** a CSS color as #rrggbb or rgba(…) (what the runtime parses); null when it isn't one */
export function normColor(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^#([0-9a-f]{3,4})$/i.test(s)) return s.replace(/[0-9a-f]/gi, '$&$&').toLowerCase();
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s.toLowerCase();
  if (/^rgba?\(/i.test(s)) return s.replace(/\s+/g, '').toLowerCase();
  if (s === 'transparent') return 'rgba(0,0,0,0)';
  if (cctx === undefined)
    try {
      cctx = document.createElement('canvas').getContext('2d');
    } catch (_) {
      cctx = null;
    }
  if (!cctx) return /^[a-z]+$/i.test(s) ? s.toLowerCase() : null;
  cctx.fillStyle = '#010203';
  cctx.fillStyle = s;
  const out = String(cctx.fillStyle);
  if (out === '#010203' && !/^#010203$/i.test(s)) return null;
  return out.replace(/\s+/g, '');
}
/** a color with an extra opacity folded into its alpha */
export function withAlpha(c: string, a: number): string {
  if (a >= 0.9995) return c;
  const q = H.pc(c);
  if (!q) return c;
  return `rgba(${Math.round(q[0])},${Math.round(q[1])},${Math.round(q[2])},${r3(q[3] * a)})`;
}
export function rgbaStr(c: { r: number; g: number; b: number; a?: number }): string {
  const a = c.a == null ? 1 : c.a;
  return a >= 0.9995
    ? '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
    : `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${r3(a)})`;
}

/* ---------- gradients ---------- */

/** A gradient's geometry, in its own units, with its transform. */
export interface GradSpec {
  kind: 'lin' | 'rad';
  /** linear: x1, y1, x2, y2 */
  p?: number[];
  /** radial: centre and radius */
  c?: number[];
  r?: number;
  M: Mat;
  /** stops [offset 0–1, color] */
  s: Array<[number, string]>;
  /** units are the shape's box (else user space) */
  bbox: boolean;
}
/** A gradient in SVGcinema's model (in the shape's box units). `box`: the shape's box, for user-space
 *  gradients. */
export function toGrad(g: GradSpec, box: number[] | null): any {
  // B maps the shape's box units (0–1) to the gradient's units
  let B: Mat = ID;
  if (!g.bbox) {
    if (!box || !box[2] || !box[3]) return null;
    B = [box[2], 0, 0, box[3], box[0], box[1]];
  }
  // T: from box units to the gradient's own space (before its gradientTransform)
  const T = mul(inv(g.M), B);
  const s = g.s.length ? g.s.map(q => [r3(q[0]), q[1]]) : [[0, '#000000']];
  if (g.kind === 'lin') {
    // a linear gradient is an affine function f(y) = (y − p1)·d / |d|²; written in box units it is
    // α·u + β, which is the linear gradient from p1' to p1' + α/|α|² there (exact under any transform)
    const p = g.p || [0, 0, 1, 0],
      d = [p[2] - p[0], p[3] - p[1]],
      dd = d[0] * d[0] + d[1] * d[1] || 1e-12,
      a = [(T[0] * d[0] + T[1] * d[1]) / dd, (T[2] * d[0] + T[3] * d[1]) / dd],
      b = ((T[4] - p[0]) * d[0] + (T[5] - p[1]) * d[1]) / dd,
      aa = a[0] * a[0] + a[1] * a[1] || 1e-12,
      P1 = [(-b * a[0]) / aa, (-b * a[1]) / aa],
      P = [P1[0], P1[1], P1[0] + a[0] / aa, P1[1] + a[1] / aa].map(r3);
    return { g: 'lin', a: r3((Math.atan2(P[3] - P[1], P[2] - P[0]) * 180) / Math.PI + 90), p: P, s };
  }
  // a radial gradient's circle, seen in box units, is an ellipse: its axes are the singular vectors
  const U = inv(T),
    c = g.c || [0.5, 0.5],
    r = g.r == null ? 0.5 : g.r,
    C = apply(U, c[0], c[1]),
    e = U[0] * U[0] + U[2] * U[2],
    f = U[0] * U[1] + U[2] * U[3],
    h = U[1] * U[1] + U[3] * U[3],
    m = (e + h) / 2,
    q = Math.sqrt(((e - h) / 2) ** 2 + f * f),
    s1 = Math.sqrt(Math.max(0, m + q)),
    s2 = Math.sqrt(Math.max(0, m - q)),
    th = 0.5 * Math.atan2(2 * f, e - h);
  const o: any = { g: 'rad', cx: r3(C[0]), cy: r3(C[1]), r: r3(r * s1), s };
  const ra = (th * 180) / Math.PI;
  if (Math.abs(ra) > 1e-3) o.ra = r3(ra);
  if (s1 > 1e-12 && Math.abs(s2 / s1 - 1) > 1e-3) o.rr = r3(s2 / s1);
  return o;
}
/** a length or percentage as a fraction (percentages of 1) or a number */
export function num(v: string | null | undefined, def: number, pct = 0.01) {
  if (v == null || v === '') return def;
  const s = String(v).trim();
  const n = parseFloat(s);
  if (!isFinite(n)) return def;
  return s.endsWith('%') ? n * pct : n;
}

/* ---------- names ---------- */

const KIND: Record<string, string> = {
  rect: 'Rectangle',
  circle: 'Ellipse',
  ellipse: 'Ellipse',
  path: 'Path',
  line: 'Line',
  polygon: 'Polygon',
  polyline: 'Polyline',
  text: 'Text',
  image: 'Image',
  use: 'Image',
  g: 'Group',
  group: 'Group',
  svg: 'Group',
  a: 'Link',
  clip: 'Clip group',
  mask: 'Mask group',
};
export function kindName(tag: string) {
  return KIND[tag] || tag.charAt(0).toUpperCase() + tag.slice(1);
}
/** "path1" → "Path 1", "rect2" → "Rectangle 2" (SVGator's automatic names) */
export function autoName(s: string) {
  const m = /^([a-z]+)[-_ ]?(\d+)$/i.exec(s);
  return m ? `${kindName(m[1].toLowerCase())} ${m[2]}` : s;
}
/** ids that carry no name: generated ones (path123, g12, SVGator's random ids) */
export function meaningless(id: string, rootId: string | null) {
  if (rootId && id.startsWith(rootId) && /^\d+$/.test(id.slice(rootId.length))) return true;
  if (
    /^(path|rect|circle|ellipse|g|text|tspan|line|polygon|polyline|image|use|svg|layer|group|shape|mask|clip[-_]?path|linearGradient|radialGradient)[-_]?\d+$/i.test(
      id,
    )
  )
    return true;
  return /^[a-z]{0,2}\d+$/i.test(id);
}
/** Illustrator writes special characters as _xHH_ */
export function decodeId(id: string) {
  return id.replace(/_x([0-9A-F]{2})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
