// SVGcinema — ui/align
// Align / distribute bar at the top of the inspector, and "Set motion path" (turn a path into position keyframes).
// One selected layer aligns to the canvas; several align to the box around the selection.
import type { Keyframe, Layer, PathData } from '../model/types';
import { ellNodes, rectNodes } from '../geometry/nodes';
import { H, byId, clone, esc, ic, r2, r3, valueAt, xfp } from '../core/constants';
import { beginEdit, setProp } from '../core/history';
import { S, doc, layerById } from '../core/state';
import { parentMatrix, selectedRoots } from '../model/tree';
import { boxOf, localMatrix } from '../render/overlay';
import { BOOL_OPS, boolTargets } from '../core/booleans';

type Box = { x: number; y: number; w: number; h: number };
export const ALIGN: Array<[string, string, string]> = [
  [
    'left',
    'Align left',
    '<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>',
  ],
  [
    'hcenter',
    'Align horizontal centers',
    '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
  ],
  [
    'right',
    'Align right',
    '<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>',
  ],
  [
    'top',
    'Align top',
    '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>',
  ],
  [
    'vcenter',
    'Align vertical centers',
    '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
  ],
  [
    'bottom',
    'Align bottom',
    '<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>',
  ],
  ['disth', 'Distribute horizontally', '<path d="M3 4v16M21 4v16"/><rect x="9" y="7" width="6" height="10" rx="1"/>'],
  ['distv', 'Distribute vertically', '<path d="M4 3h16M4 21h16"/><rect x="7" y="9" width="10" height="6" rx="1"/>'],
];
function targets() {
  return selectedRoots().filter(l => !l.lock && byId('e-' + l.id + '-s'));
}
export function alignBar() {
  const n = targets().length,
    bools = !!boolTargets();
  return `<div class="align-bar" role="toolbar" aria-label="Align and distribute">${ALIGN.map(([k, label, p]) => {
    const dist = k.startsWith('dist'),
      off = n === 0 || (dist && n < 3),
      t = dist
        ? label + (off ? ' (select 3 or more layers)' : '')
        : label + (n > 1 ? ' (to selection)' : ' (to canvas)');
    return `<button class="btn ib" data-align="${k}" title="${t}" aria-label="${t}"${off ? ' disabled' : ''}>${ic(p)}</button>`;
  }).join('')}<span class="ab-sep"></span>${BOOL_OPS.map(([k, label, p]) => {
    const t = bools ? label : label + ' (select two or more shapes or paths)';
    return `<button class="btn ib" data-bool="${k}" title="${t}" aria-label="${t}"${bools ? '' : ' disabled'}>${ic(p)}</button>`;
  }).join('')}${bools ? '' : '<span class="ab-note">Booleans: select 2+ shapes</span>'}</div>`;
}
/** Move a layer by a delta given in document units. */
function nudge(l: Layer, dx: number, dy: number) {
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) return;
  const PMi = parentMatrix(l).inverse(),
    a = xfp(PMi, 0, 0),
    b = xfp(PMi, dx, dy),
    p = valueAt(l, 'pos', S.time) || [0, 0];
  setProp(l, 'pos', [r2(p[0] + b.x - a.x), r2(p[1] + b.y - a.y)]);
}
/* ---------- the selection's box (several layers) ---------- */

/** The box around the selected layers, in document units (null when none can be measured). */
export function selectionBox(): Box | null {
  const boxes = targets()
    .map(l => boxOf(l) as Box)
    .filter(Boolean);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map(b => b.x)),
    y0 = Math.min(...boxes.map(b => b.y)),
    x1 = Math.max(...boxes.map(b => b.x + b.w)),
    y1 = Math.max(...boxes.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** Move the selection's box (every layer moves with it) or resize it (every layer is scaled from the
 *  box's top-left corner: its origin moves and its Scale grows). Layers that are animated are keyed. */
export function setSelectionBox(f: 'x' | 'y' | 'w' | 'h', v: number, keep: boolean) {
  const ls = targets(),
    B = selectionBox();
  if (!B || !ls.length || !isFinite(v)) return;
  const ed = beginEdit();
  if (f === 'x' || f === 'y') ls.forEach(l => nudge(l, f === 'x' ? v - B.x : 0, f === 'y' ? v - B.y : 0));
  else {
    const cur = f === 'w' ? B.w : B.h;
    if (cur < 1e-6 || v <= 0) return ed.end();
    const k = v / cur,
      kx = f === 'w' || keep ? k : 1,
      ky = f === 'h' || keep ? k : 1;
    ls.forEach(l => {
      const c = H.comp(l, S.time),
        P = xfp(parentMatrix(l), c.x, c.y);
      nudge(l, B.x + (P.x - B.x) * kx - P.x, B.y + (P.y - B.y) * ky - P.y);
      const s = clone(valueAt(l, 'scl', S.time) || [1, 1]);
      setProp(l, 'scl', [r3(s[0] * kx), r3(s[1] * ky)]);
    });
  }
  ed.end({ insp: true });
}
export function align(kind: string) {
  const ls = targets();
  if (!ls.length) return;
  const boxes = ls.map(l => boxOf(l) as Box);
  const ed = beginEdit();
  if (kind === 'disth' || kind === 'distv') {
    if (ls.length < 3) return ed.end();
    const h = kind === 'disth',
      order = ls.map((l, i) => ({ l, b: boxes[i] })).sort((p, q) => (h ? p.b.x - q.b.x : p.b.y - q.b.y)),
      first = order[0].b,
      last = order[order.length - 1].b,
      span = h ? last.x + last.w - first.x : last.y + last.h - first.y,
      total = order.reduce((s, o) => s + (h ? o.b.w : o.b.h), 0),
      gap = (span - total) / (order.length - 1);
    let at = h ? first.x : first.y;
    order.forEach(o => {
      const cur = h ? o.b.x : o.b.y;
      nudge(o.l, h ? at - cur : 0, h ? 0 : at - cur);
      at += (h ? o.b.w : o.b.h) + gap;
    });
    return ed.end({ insp: true });
  }
  let T: Box;
  if (ls.length === 1) T = { x: 0, y: 0, w: doc.w, h: doc.h };
  else {
    const x0 = Math.min(...boxes.map(b => b.x)),
      y0 = Math.min(...boxes.map(b => b.y)),
      x1 = Math.max(...boxes.map(b => b.x + b.w)),
      y1 = Math.max(...boxes.map(b => b.y + b.h));
    T = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  ls.forEach((l, i) => {
    const b = boxes[i];
    let dx = 0,
      dy = 0;
    if (kind === 'left') dx = T.x - b.x;
    else if (kind === 'hcenter') dx = T.x + T.w / 2 - (b.x + b.w / 2);
    else if (kind === 'right') dx = T.x + T.w - (b.x + b.w);
    else if (kind === 'top') dy = T.y - b.y;
    else if (kind === 'vcenter') dy = T.y + T.h / 2 - (b.y + b.h / 2);
    else if (kind === 'bottom') dy = T.y + T.h - (b.y + b.h);
    nudge(l, dx, dy);
  });
  ed.end({ insp: true });
}

/* ---------- Set motion path ---------- */

const PATHLIKE = ['path', 'rect', 'ellipse'];
export function motionPick(l: Layer) {
  const paths = doc.layers.filter(o => o !== l && PATHLIKE.includes(o.type));
  if (!paths.length) return '';
  return `<select class="sel" id="motionPath" aria-label="Set motion path" title="Make the layer follow a shape over the whole animation"><option value="">Set motion path…</option>${paths.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>`;
}
type N6 = number[];
/** The shape's first subpath as nodes [x, y, inX, inY, outX, outY] in the moving layer's position space. */
export function pathNodesFor(src: Layer, l: Layer): { n: N6[]; closed: boolean } | null {
  const d: PathData =
    src.type === 'rect' ? rectNodes(src.geo) : src.type === 'ellipse' ? ellNodes(src.geo) : H.get(src, 'd', S.time);
  const sp = d && d[0];
  if (!sp || sp.n.length < 2) return null;
  const M = parentMatrix(l).inverse().multiply(localMatrix(src)),
    o = valueAt(l, 'org', S.time) || [0, 0],
    map = (x: number, y: number) => {
      const q = xfp(M, x, y);
      return [q.x - o[0], q.y - o[1]];
    };
  return {
    closed: !!sp.c,
    n: sp.n.map(q => [...map(q[0], q[1]), ...map(q[2], q[3]), ...map(q[4], q[5])]),
  };
}
/** Replace the layer's position track with keyframes that follow the shape over the whole animation:
 *  one keyframe per node, curved segments, timed by length so the speed stays even. */
export function setMotionPath(l: Layer, srcId: string) {
  const src = layerById(srcId);
  if (!src) return false;
  const P = pathNodesFor(src, l);
  if (!P) return false;
  const n = P.closed ? [...P.n, P.n[0]] : P.n,
    segs: Array<[N6, N6]> = [];
  for (let i = 0; i < n.length - 1; i++) segs.push([n[i], n[i + 1]]);
  const len = segs.map(([a, b]) => {
      let L = 0,
        px = a[0],
        py = a[1];
      for (let k = 1; k <= 24; k++) {
        const t = k / 24,
          u = 1 - t,
          x = u * u * u * a[0] + 3 * u * u * t * a[4] + 3 * u * t * t * b[2] + t * t * t * b[0],
          y = u * u * u * a[1] + 3 * u * u * t * a[5] + 3 * u * t * t * b[3] + t * t * t * b[1];
        L += Math.hypot(x - px, y - py);
        px = x;
        py = y;
      }
      return L;
    }),
    total = len.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return false;
  const ed = beginEdit();
  let acc = 0;
  const keys: Keyframe[] = n.map((q, i) => {
    const k: Keyframe = [r3((doc.dur * acc) / total), [r2(q[0]), r2(q[1])], 'linear'];
    if (i < segs.length) {
      const b = n[i + 1],
        straight = Math.abs(q[4] - q[0]) + Math.abs(q[5] - q[1]) + Math.abs(b[2] - b[0]) + Math.abs(b[3] - b[1]) < 0.01;
      if (!straight) k[3] = [r2(q[4] - q[0]), r2(q[5] - q[1]), r2(b[2] - b[0]), r2(b[3] - b[1])];
      acc += len[i];
    }
    return k;
  });
  keys[keys.length - 1][0] = r3(doc.dur);
  l.t.pos = keys;
  l.sm = false;
  S.exp[l.id] = true;
  ed.end({ insp: true });
  return true;
}
