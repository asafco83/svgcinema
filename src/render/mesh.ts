// SVGcinema — render/mesh
// Builds and refreshes the meshes of pinned images, text and groups (see model/mesh) from what the
// canvas draws: the content's pieces, measured over the whole animation (content inside a group can
// move), plus margins for strokes and filters. A mesh is rebuilt when its content changes.
import type { Layer } from '../model/types';
import { H, byId } from '../core/constants';
import { S, doc, eng } from '../core/state';
import { fxKey, fxReach } from '../model/filters';
import { type Box, MESH_DEFAULT, buildMesh, hashStr, meshable } from '../model/mesh';
import { isPinKey } from '../model/pins';
import { descendants, isBox, isHidden } from '../model/tree';
import { meshOf } from './markup';

/** every value a property takes (base and keys) */
function values(l: Layer, k: string): any[] {
  const b = (l.b as Record<string, any>)[k],
    out = b != null ? [b] : [];
  (l.t[k] || []).forEach(q => out.push(q[1]));
  return out;
}
const maxNum = (vs: any[], def = 0) =>
  vs.reduce((m: number, v) => (typeof v === 'number' && isFinite(v) ? Math.max(m, Math.abs(v)) : m), def);
/** how far a layer's stroke reaches past its geometry */
function strokePad(l: Layer) {
  const stk = values(l, 'stk');
  if (!stk.some(v => v && v !== 'none')) return 0;
  return maxNum(values(l, 'sw')) * 0.75;
}
/** how far a layer's filters reach past it (blur and drop shadow) */
function fxPad(l: Layer) {
  let pad = 0;
  (l.fx || []).forEach(f => {
    pad += fxReach(f, (p, def) => maxNum(values(l, fxKey(f.id, p)), def));
  });
  return pad;
}
function boxOfEl(el: SVGGraphicsElement, toContent: DOMMatrix, pad: number): Box | null {
  let b: DOMRect;
  try {
    b = el.getBBox();
  } catch (_) {
    return null;
  }
  const M = toContent.multiply(el.getScreenCTM()),
    pts = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(M)),
    xs = pts.map(p => p.x),
    ys = pts.map(p => p.y),
    x0 = Math.min(...xs),
    y0 = Math.min(...ys);
  return { x: x0 - pad, y: y0 - pad, w: Math.max(...xs) - x0 + 2 * pad, h: Math.max(...ys) - y0 + 2 * pad };
}
const grow = (a: Box | null, b: Box | null): Box | null => {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
/** the pieces of a layer's content (in its content space), each over the whole animation */
export function contentBoxes(l: Layer): Box[] | null {
  const g = byId('e-' + l.id) as unknown as SVGGraphicsElement,
    s = byId('e-' + l.id + '-s') as unknown as SVGGraphicsElement;
  if (!g || !s || !g.getScreenCTM()) return null;
  const own = 2 + fxPad(l),
    inv = () => g.getScreenCTM().inverse();
  if (l.type !== 'group') {
    const b = boxOfEl(s, inv(), own + strokePad(l));
    return b ? [b] : null;
  }
  const leaves = descendants(l).filter(x => !isBox(x) && !isHidden(x));
  if (!leaves.length) return null;
  // pads: the leaf's stroke and filters, and those of the groups between it and the meshed group
  const pad = (x: Layer) => {
    let p = own + strokePad(x) + fxPad(x),
      q = x.parent && doc.layers.find(y => y.id === x.parent),
      n = 0;
    while (q && q.id !== l.id && n++ < 100) {
      p += fxPad(q);
      q = q.parent && doc.layers.find(y => y.id === q.parent);
    }
    return p;
  };
  // sample the animation when anything inside moves
  const inside = descendants(l),
    moving = inside.some(x => Object.keys(x.t).some(k => x.t[k] && x.t[k].length)),
    times = [S.time];
  if (moving && eng) {
    const N = 24;
    for (let i = 0; i <= N; i++) times.push((i / N) * doc.dur);
    inside.forEach(x =>
      Object.values(x.t).forEach(tr => (tr || []).forEach(q => times.length < 120 && times.push(q[0]))),
    );
  }
  const acc: Record<string, Box | null> = {};
  times.forEach(t => {
    if (moving && eng) eng.apply(t);
    const M = inv();
    leaves.forEach(x => {
      const e = byId('e-' + x.id + '-s') as unknown as SVGGraphicsElement;
      if (e) acc[x.id] = grow(acc[x.id] || null, boxOfEl(e, M, pad(x)));
    });
  });
  if (moving && eng) eng.apply(S.time);
  const out = Object.values(acc).filter(Boolean) as Box[];
  return out.length ? out : null;
}
/** what a layer's mesh depends on: its content (not its own transform or pins) and the density */
function meshSig(l: Layer) {
  const skip = new Set(['pos', 'rot', 'scl', 'org', 'skw', 'op']),
    own = (o: Record<string, any>) => {
      const r: Record<string, any> = {};
      Object.keys(o || {}).forEach(k => {
        if (!skip.has(k) && !isPinKey(k)) r[k] = o[k];
      });
      return r;
    };
  const kids = descendants(l).map(x => ({
    id: x.id,
    type: x.type,
    geo: x.geo,
    b: x.b,
    t: x.t,
    xf: x.xf,
    fx: x.fx,
    hid: x.hid,
    o: x.o,
    p: x.parent,
    m: x.mask,
    ms: x.maskSrc,
    ex: x.extra,
    pins: x.pins,
  }));
  return hashStr(
    JSON.stringify([
      l.type,
      l.geo,
      l.xf,
      l.fx,
      l.extra,
      own(l.b),
      own(l.t),
      l.mask,
      kids,
      doc.dur,
      (l.mesh && l.mesh.n) || MESH_DEFAULT,
    ]),
  );
}
/** builds the meshes that are missing or out of date; true when one changed (the canvas must then
 *  draw again) */
export function ensureMeshes(): boolean {
  let changed = false;
  doc.layers.forEach(l => {
    if (!(l.pins && l.pins.length) || !meshable(l) || isHidden(l)) return;
    const h = meshSig(l);
    if (l.mesh && l.mesh.h === h && l.mesh.t.length) return;
    const boxes = contentBoxes(l);
    if (!boxes) return;
    const n = l.mesh && l.mesh.n,
      m = buildMesh(boxes, n || MESH_DEFAULT);
    l.mesh = { ...(n ? { n } : {}), v: m.v, t: m.t, h };
    changed = true;
  });
  return changed;
}
/** a point of a meshed layer's content space, moved as its mesh moves it (null outside the mesh) */
function warpPt(M: NonNullable<Layer['mesh']>, ms: number[][], x: number, y: number): number[] | null {
  for (let k = 0; k < M.t.length; k++) {
    const [a, b, c] = M.t[k].map(i => M.v[i]),
      d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (!d) continue;
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d,
      v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
    if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
    const m = ms[k] || [1, 0, 0, 1, 0, 0];
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  return null;
}
/** a meshed layer's content box (in content space) as the mesh bends it; null for other layers */
export function meshBox(l: Layer): { x: number; y: number; width: number; height: number } | null {
  const M = meshOf(l),
    g = byId('e-' + l.id) as unknown as SVGGraphicsElement,
    s = byId('e-' + l.id + '-s') as unknown as SVGGraphicsElement;
  if (!M || !g || !s) return null;
  let b: DOMRect, Q: DOMMatrix;
  try {
    b = s.getBBox();
    Q = g.getScreenCTM().inverse().multiply(s.getScreenCTM());
  } catch (_) {
    return null;
  }
  const ms = H.meshMats(l, S.time),
    N = 12;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  // the content's edges, sampled and moved through the mesh
  for (let i = 0; i <= N; i++)
    [
      [b.x + (b.width * i) / N, b.y],
      [b.x + (b.width * i) / N, b.y + b.height],
      [b.x, b.y + (b.height * i) / N],
      [b.x + b.width, b.y + (b.height * i) / N],
    ].forEach(([px, py]) => {
      const c = new DOMPoint(px, py).matrixTransform(Q),
        w = warpPt(M, ms, c.x, c.y) || [c.x, c.y];
      x0 = Math.min(x0, w[0]);
      y0 = Math.min(y0, w[1]);
      x1 = Math.max(x1, w[0]);
      y1 = Math.max(y1, w[1]);
    });
  return isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}
/** a layer's box in its content space (the layer element's getBBox), with meshed layers measured from
 *  their warped triangles (getBBox would count the whole content once per triangle) */
export function layerBox(l: Layer): { x: number; y: number; width: number; height: number } | null {
  const mb = meshBox(l);
  if (mb) return mb;
  const g = byId('e-' + l.id) as unknown as SVGGraphicsElement;
  if (!g) return null;
  try {
    return g.getBBox();
  } catch (_) {
    return null;
  }
}
/** a meshed layer's warped triangles in content space (the Pin tool draws them) */
export function meshLines(l: Layer): number[][][] {
  const M = meshOf(l);
  if (!M) return [];
  const ms = H.meshMats(l, S.time);
  return M.t.map((T, k) => {
    const m = ms[k] || [1, 0, 0, 1, 0, 0];
    return T.map(i => {
      const [x, y] = M.v[i];
      return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    });
  });
}
