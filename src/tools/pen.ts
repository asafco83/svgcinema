// SVGcinema — tools/pen
// The pen family, modelled on Adobe Illustrator:
//  Pen (P)          click = corner point, drag = smooth point. While dragging: Alt breaks the handle,
//                   Shift snaps to 45°, Space moves the point. Click the first point to close, click the
//                   last point to drop its outgoing handle (drag it to pull a new one). Enter / Esc /
//                   Ctrl+click ends the path, Backspace removes the last point.
//                   On the selected path: hover a segment to add a point, an anchor to delete it,
//                   Alt+anchor to convert it, an open end to continue the path.
//  Add node (+)     click a segment of the selected path.
//  Remove node (−)  click an anchor of the selected path.
//  Convert (⇧C)     click a point: corner · drag a point: smooth handles · drag a handle: move it alone
//                   (cusp) · drag a segment: reshape it. With the Pen, Alt gives the same on points and handles.
//  Pencil (N)       freehand; the stroke is simplified and smoothed. End near the start to close it.
import type { Layer, PathData, PathNode, XY } from '../model/types';
import { plainPath } from '../core/plain-path';
import { H, clone, r2, xfp } from '../core/constants';
import { WRAP } from '../core/dom';
import { beginEdit, select, setProp } from '../core/history';
import { S, doc, layerById, mkLayer, nextColor, selLayer } from '../core/state';
import {
  N,
  cubicAt,
  eachShapeValue,
  ellNodes,
  rectNodes,
  removeNodeAll,
  reshapeSeg,
  revSp,
  simplifyPts,
  smoothNodes,
  snap45,
  splitSegAt,
} from '../geometry/nodes';
import { toast } from '../io/open';
import { isHidden, isLocked } from '../model/tree';
import { drawOverlay, localMatrix } from '../render/overlay';
import { frame } from '../render/stage';
import { addLayer } from './shapes';

/** Pixel tolerances on screen. */
const NEAR_ANCHOR = 7,
  NEAR_SEG = 6;

interface PenState {
  /** nodes in document coordinates */
  nodes: PathNode[];
  hover: XY | null;
  /** continuing an open subpath of an existing layer */
  cont?: { lid: string; i: number; atStart: boolean; Mi: DOMMatrix };
}
type Hit =
  | { kind: 'anchor'; i: number; j: number; end: boolean; pt: XY }
  | { kind: 'seg'; i: number; j: number; t: number; pt: XY }
  | { kind: 'handle'; i: number; j: number; part: 1 | 2; pt: XY };

const pen = (): PenState | null => S.pen;
const px = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y) * S.scale;
const ptOf = (q: PathNode): XY => ({ x: q[0], y: q[1] });

/* ---------- cursors ---------- */

const CUR: Record<string, string> = {};
function cursorSvg(kind: string) {
  const sym: Record<string, string> = {
    new: '<path d="M18 15.5v5M15.5 18h5M16.2 16.2l3.6 3.6M19.8 16.2l-3.6 3.6"/>',
    add: '<path d="M18 15v6M15 18h6"/>',
    del: '<path d="M15 18h6"/>',
    close: '<circle cx="18" cy="18" r="2.6"/>',
    cont: '<path d="M15.5 20.5l5-5"/>',
    corner: '<path d="M15 20l3-4 3 4"/>',
    convert: '<path d="M15 20l3-4 3 4"/>',
  };
  if (kind === 'anchor') return CONVERT_CURSOR;
  const nib =
    '<path d="M2 2l7.5 3.4 4.6 8.7-8.7-4.6z"/><path d="M2 2l5.6 5.6"/><circle cx="8.6" cy="8.6" r="1.1"/><path d="M14.1 14.1l2.4 2.4" stroke-width="2.4"/>';
  const draw = (stroke: string, w: number) =>
    `<g fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round">${nib}${sym[kind] || ''}</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">${draw('#fff', 3.2)}${draw('#111', 1.3)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 2, crosshair`;
}
/** The Convert Point tool's own cursor: a caret with its point at the hotspot. */
const CONVERT_CURSOR = (() => {
  const g = (s: string, w: number) =>
    `<g fill="none" stroke="${s}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"><path d="M3 15L9 3l6 12"/><path d="M9 3v7"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">${g('#fff', 3.2)}${g('#111', 1.3)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 9 3, crosshair`;
})();
const PENCIL_CURSOR = (() => {
  const g = (s: string, w: number) =>
    `<g fill="none" stroke="${s}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"><path d="M2 22l1.6-5.4L16.8 3.4a2 2 0 012.8 0l1 1a2 2 0 010 2.8L7.4 20.4z"/><path d="M14.6 5.6l3.8 3.8M3.6 16.6l3.8 3.8"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">${g('#fff', 3.2)}${g('#111', 1.3)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 22, crosshair`;
})();
function setCursor(kind: string) {
  if (S.tool === 'pencil') {
    WRAP.style.cursor = PENCIL_CURSOR;
    return;
  }
  WRAP.style.cursor = CUR[kind] || (CUR[kind] = cursorSvg(kind));
}
/** Reset to the tool's own cursor when the tool changes. */
export function toolCursor() {
  if (['pen', 'addnode', 'delnode', 'convert'].includes(S.tool))
    setCursor(S.tool === 'addnode' ? 'add' : S.tool === 'delnode' ? 'del' : S.tool === 'convert' ? 'anchor' : 'new');
  else if (S.tool === 'pencil') setCursor('');
  else WRAP.style.cursor = '';
}

/* ---------- hit testing on the selected path ---------- */

/** The selected layer when it can be edited with the pen family (paths, plus rectangles and ellipses, which convert). */
export function editableShape(): Layer | null {
  const l = selLayer();
  if (!l || isLocked(l) || isHidden(l)) return null;
  return l.type === 'path' || l.type === 'rect' || l.type === 'ellipse' ? l : null;
}
function shapeData(l: Layer): PathData {
  if (l.type === 'rect') return rectNodes(l.geo);
  if (l.type === 'ellipse') return ellNodes(l.geo);
  return H.get(l, 'd', S.time) || [];
}
/** What is under `p` on the selected path: an anchor, a handle (when `handles`), or a segment. */
export function penHit(l: Layer, p: XY, handles = false): Hit | null {
  const M = localMatrix(l),
    d = shapeData(l),
    T = (x: number, y: number): XY => {
      const q = xfp(M, x, y);
      return { x: q.x, y: q.y };
    };
  let best: Hit | null = null,
    bd = NEAR_ANCHOR;
  d.forEach((sp, i) =>
    sp.n.forEach((q, j) => {
      const a = T(q[0], q[1]),
        dd = px(a, p);
      if (dd < bd) {
        bd = dd;
        best = { kind: 'anchor', i, j, end: !sp.c && (j === 0 || j === sp.n.length - 1), pt: a };
      }
    }),
  );
  if (best) return best;
  if (handles) {
    bd = NEAR_ANCHOR;
    d.forEach((sp, i) =>
      sp.n.forEach((q, j) => {
        ([1, 2] as const).forEach(part => {
          const k = part === 1 ? 2 : 4;
          if (q[k] === q[0] && q[k + 1] === q[1]) return;
          const a = T(q[k], q[k + 1]),
            dd = px(a, p);
          if (dd < bd) {
            bd = dd;
            best = { kind: 'handle', i, j, part, pt: a };
          }
        });
      }),
    );
    if (best) return best;
  }
  bd = NEAR_SEG;
  d.forEach((sp, i) => {
    const segs = sp.c ? sp.n.length : sp.n.length - 1;
    for (let j = 0; j < segs; j++) {
      const a = sp.n[j],
        b = sp.n[(j + 1) % sp.n.length];
      let bt = 0,
        bdd = Infinity;
      const probe = (t: number) => {
        const c = cubicAt(a, b, t),
          dd = px(T(c[0], c[1]), p);
        if (dd < bdd) {
          bdd = dd;
          bt = t;
        }
      };
      for (let k = 0; k <= 32; k++) probe(k / 32);
      for (let s = 1 / 64; s > 1e-4; s /= 4) {
        const c = bt;
        for (let k = -3; k <= 3; k++) probe(Math.min(1, Math.max(0, c + k * s)));
      }
      if (bdd < bd && bt > 0.001 && bt < 0.999) {
        bd = bdd;
        const c = cubicAt(a, b, bt);
        best = { kind: 'seg', i, j, t: bt, pt: T(c[0], c[1]) };
      }
    }
  });
  return best;
}
/** Rectangles and ellipses become paths before their nodes are edited. */
function ensurePath(l: Layer) {
  if (l.type === 'rect' || l.type === 'ellipse') plainPath(l);
}
export function addNodeAt(l: Layer, h: Extract<Hit, { kind: 'seg' }>) {
  const ed = beginEdit();
  const conv = l.type !== 'path';
  ensurePath(l);
  eachShapeValue(l, v => v[h.i] && v[h.i].n.length > h.j && splitSegAt(v[h.i], h.j, h.t));
  S.node = [h.i, h.j + 1];
  ed.end({ insp: true });
  if (conv) toast('Converted to a path to add the node.');
}
export function deleteNodeAt(l: Layer, h: Extract<Hit, { kind: 'anchor' }>) {
  const ed = beginEdit();
  ensurePath(l);
  if (!removeNodeAll(l, h.i, h.j)) toast('A path needs at least two nodes.');
  S.node = null;
  ed.end({ insp: true });
}
/** Alt+click an anchor: make it a corner. Alt+drag: pull out new smooth handles. */
function convertDrag(l: Layer, h: Extract<Hit, { kind: 'anchor' }>, p0: XY) {
  const ed = beginEdit();
  ensurePath(l);
  const Mi = localMatrix(l).inverse(),
    base = clone(H.get(l, 'd', S.time));
  let moved = false;
  S.node = [h.i, h.j];
  const apply = (q: PathNode) => {
    const d = clone(base);
    d[h.i].n[h.j] = q;
    setProp(l, 'd', d);
    frame();
  };
  S.drag = {
    move(p, e) {
      if (!moved && px(p, p0) < 3) return;
      moved = true;
      const q = base[h.i].n[h.j].slice(),
        A: [number, number] = [q[0], q[1]];
      let m = xfp(Mi, p.x, p.y),
        o: number[] = [m.x, m.y];
      if (e.shiftKey) o = snap45(A, o);
      q[4] = r2(o[0]);
      q[5] = r2(o[1]);
      q[2] = r2(2 * A[0] - o[0]);
      q[3] = r2(2 * A[1] - o[1]);
      apply(q);
    },
    up() {
      if (!moved) {
        const q = base[h.i].n[h.j].slice();
        q[2] = q[4] = q[0];
        q[3] = q[5] = q[1];
        apply(q);
      }
      ed.end({ insp: true });
    },
  };
}

/** Drag one handle on its own, breaking a smooth point into a cusp. Shift snaps its angle to 45°. */
function handleDrag(l: Layer, h: Extract<Hit, { kind: 'handle' }>) {
  const ed = beginEdit();
  ensurePath(l);
  const Mi = localMatrix(l).inverse(),
    base = clone(H.get(l, 'd', S.time)),
    k = h.part === 1 ? 2 : 4;
  S.node = [h.i, h.j];
  S.drag = {
    move(p, e) {
      const d = clone(base),
        q = d[h.i].n[h.j],
        m = xfp(Mi, p.x, p.y);
      let o: number[] = [m.x, m.y];
      if (e.shiftKey) o = snap45([q[0], q[1]], o);
      q[k] = r2(o[0]);
      q[k + 1] = r2(o[1]);
      setProp(l, 'd', d);
      frame();
    },
    up() {
      ed.end({ insp: true });
    },
  };
}
/** Drag a segment to reshape the curve between its two points (only their handles move). */
function segDrag(l: Layer, h: Extract<Hit, { kind: 'seg' }>, p0: XY) {
  const ed = beginEdit();
  ensurePath(l);
  const Mi = localMatrix(l).inverse(),
    base = clone(H.get(l, 'd', S.time)),
    s0 = xfp(Mi, p0.x, p0.y);
  let moved = false;
  S.drag = {
    move(p) {
      if (!moved && px(p, p0) < 3) return;
      moved = true;
      const d = clone(base),
        sp = d[h.i],
        a = sp.n[h.j],
        b = sp.n[(h.j + 1) % sp.n.length],
        m = xfp(Mi, p.x, p.y);
      reshapeSeg(a, b, h.t, m.x - s0.x, m.y - s0.y);
      setProp(l, 'd', d);
      frame();
    },
    up() {
      ed.end({ insp: true });
    },
  };
}
/** Convert Point tool (Shift+C): click a point to make it a corner, drag a point to pull smooth
 *  handles, drag a handle to move it on its own, drag a segment to reshape it. */
export function convertDown(p: XY, e: PointerEvent, chain: string[]) {
  const l = editableShape(),
    h = l && penHit(l, p, true);
  if (l && h) {
    if (h.kind === 'anchor') return convertDrag(l, h, p);
    if (h.kind === 'handle') return handleDrag(l, h);
    return segDrag(l, h, p);
  }
  pickPathUnder(e, chain);
}

/* ---------- drawing ---------- */

function canContinue(l: Layer) {
  return l.type === 'path' && !(l.t.d && l.t.d.length);
}
function startContinue(l: Layer, h: Extract<Hit, { kind: 'anchor' }>, p: XY) {
  const M = localMatrix(l),
    sp = clone(l.b.d[h.i]),
    atStart = h.j === 0 && sp.n.length > 1;
  const map = (q: PathNode) => {
    const a = xfp(M, q[0], q[1]),
      i = xfp(M, q[2], q[3]),
      o = xfp(M, q[4], q[5]);
    return [a.x, a.y, i.x, i.y, o.x, o.y].map(r2);
  };
  const nodes = (atStart ? revSp(sp) : sp).n.map(map);
  S.pen = { nodes, hover: p, cont: { lid: l.id, i: h.i, atStart, Mi: M.inverse() } } as PenState;
  lastPointDrag(p, false);
}
/** Drag from the last point: set its outgoing handle. A plain click drops the handle (if `clickDrops`). */
function lastPointDrag(p0: XY, clickDrops: boolean) {
  const P = pen(),
    q = P.nodes[P.nodes.length - 1];
  let moved = false;
  S.drag = {
    move(p, e) {
      if (!moved && px(p, p0) < 3) return;
      moved = true;
      let o: number[] = [p.x, p.y];
      if (e.shiftKey) o = snap45([q[0], q[1]], o);
      q[4] = r2(o[0]);
      q[5] = r2(o[1]);
      drawOverlay();
    },
    up() {
      if (!moved && clickDrops) {
        q[4] = q[0];
        q[5] = q[1];
      }
      drawOverlay();
    },
  };
  drawOverlay();
}
/** Drag on the first point to close: shapes the first point's handles, then closes the path. */
function closeDrag(p0: XY) {
  const P = pen(),
    q = P.nodes[0];
  let moved = false;
  S.drag = {
    move(p, e) {
      if (!moved && px(p, p0) < 3) return;
      moved = true;
      let o: number[] = [p.x, p.y];
      if (e.shiftKey) o = snap45([q[0], q[1]], o);
      q[4] = r2(o[0]);
      q[5] = r2(o[1]);
      if (!e.altKey) {
        q[2] = r2(2 * q[0] - o[0]);
        q[3] = r2(2 * q[1] - o[1]);
      }
      drawOverlay();
    },
    up() {
      finishPen(true);
    },
  };
}
/** Place a new point and let a drag pull out its handles. */
function placeNode(p: XY, e: PointerEvent) {
  const P = pen(),
    n = P.nodes,
    last = n[n.length - 1];
  let a: number[] = [p.x, p.y];
  if (e.shiftKey && last) a = snap45([last[0], last[1]], a);
  const q = N(r2(a[0]), r2(a[1]));
  n.push(q);
  let moved = false,
    prev: XY = p,
    inLock: number[] | null = null;
  S.drag = {
    move(m, ev) {
      if (S.spaceHeld) {
        // Space: reposition the point (and its handles) while placing it
        S.spaceUsed = true;
        const dx = m.x - prev.x,
          dy = m.y - prev.y;
        for (let k = 0; k < 6; k += 2) {
          q[k] = r2(q[k] + dx);
          q[k + 1] = r2(q[k + 1] + dy);
        }
        prev = m;
        drawOverlay();
        return;
      }
      prev = m;
      if (!moved && Math.hypot(m.x - q[0], m.y - q[1]) * S.scale < 3) return;
      moved = true;
      let o: number[] = [m.x, m.y];
      if (ev.shiftKey) o = snap45([q[0], q[1]], o);
      q[4] = r2(o[0]);
      q[5] = r2(o[1]);
      if (ev.altKey) {
        // Alt: break the handle; the incoming side stays where it was
        if (!inLock) inLock = [q[2], q[3]];
        q[2] = inLock[0];
        q[3] = inLock[1];
      } else {
        inLock = null;
        q[2] = r2(2 * q[0] - o[0]);
        q[3] = r2(2 * q[1] - o[1]);
      }
      drawOverlay();
    },
    up() {
      drawOverlay();
    },
  };
  drawOverlay();
}
function nameFor(base: string) {
  const n = doc.layers.filter(l => l.name.startsWith(base)).length + 1;
  return base + ' ' + n;
}
export function penDown(p: XY, e: PointerEvent) {
  const P = pen();
  if (P) {
    const n = P.nodes;
    if (e.ctrlKey || e.metaKey) return finishPen(false);
    if (n.length >= 2 && px(ptOf(n[0]), p) < NEAR_ANCHOR) return closeDrag(p);
    if (n.length >= 1 && px(ptOf(n[n.length - 1]), p) < NEAR_ANCHOR) return lastPointDrag(p, true);
    return placeNode(p, e);
  }
  const l = editableShape(),
    h = l && penHit(l, p, e.altKey);
  if (l && h && h.kind === 'handle') return handleDrag(l, h);
  if (l && h && h.kind === 'anchor') {
    if (e.altKey) return convertDrag(l, h, p);
    if (h.end && canContinue(l)) return startContinue(l, h, p);
    return deleteNodeAt(l, h);
  }
  if (l && h && h.kind === 'seg' && !e.altKey) return addNodeAt(l, h);
  S.pen = { nodes: [], hover: p } as PenState;
  placeNode(p, e);
}
/** Remove the last placed point (Backspace while drawing). */
export function penBackspace() {
  const P = pen();
  if (!P) return false;
  if (P.cont) {
    const keep = P.nodes.length > 1;
    if (keep) P.nodes.pop();
    if (!keep || P.nodes.length < 1) S.pen = null;
  } else {
    P.nodes.pop();
    if (!P.nodes.length) S.pen = null;
  }
  drawOverlay();
  return true;
}
export function finishPen(closed: boolean) {
  const P = pen();
  S.pen = null;
  S.penHint = null;
  if (!P || P.nodes.length < (P.cont ? 1 : 2)) {
    drawOverlay();
    return;
  }
  if (P.cont) {
    const l = layerById(P.cont.lid);
    if (l && l.b.d && l.b.d[P.cont.i]) {
      const ed = beginEdit(),
        Mi = P.cont.Mi,
        map = (q: PathNode) => {
          const a = xfp(Mi, q[0], q[1]),
            i = xfp(Mi, q[2], q[3]),
            o = xfp(Mi, q[4], q[5]);
          return [a.x, a.y, i.x, i.y, o.x, o.y].map(r2);
        };
      let sp = { c: closed, n: P.nodes.map(map) };
      if (P.cont.atStart) sp = { c: closed, n: revSp(sp).n };
      l.b.d[P.cont.i] = sp;
      ed.end({ insp: true });
      return;
    }
  }
  const ed = beginEdit(),
    col = nextColor();
  const l = mkLayer(
    'path',
    nameFor(closed ? 'Shape' : 'Path'),
    {},
    { fill: closed ? col : 'none', stk: closed ? 'none' : col, sw: closed ? 0 : 4, d: [{ c: closed, n: P.nodes }] },
  );
  l.extra = { 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  addLayer(l);
  ed.end({ insp: true });
}

/* ---------- add / remove node tools ---------- */

function pickPathUnder(e: PointerEvent, chain: string[]) {
  const id = chain.find(c => {
    const x = layerById(c);
    return x && (x.type === 'path' || x.type === 'rect' || x.type === 'ellipse') && !isLocked(x);
  });
  if (id) select(id);
  else if (S.sel) select(null);
  return id;
}
export function addNodeDown(p: XY, e: PointerEvent, chain: string[]) {
  const l = editableShape(),
    h = l && penHit(l, p);
  if (l && h && h.kind === 'seg') return addNodeAt(l, h);
  if (!h) pickPathUnder(e, chain);
}
export function delNodeDown(p: XY, e: PointerEvent, chain: string[]) {
  const l = editableShape(),
    h = l && penHit(l, p);
  if (l && h && h.kind === 'anchor') return deleteNodeAt(l, h);
  if (!h) pickPathUnder(e, chain);
}

/* ---------- pencil ---------- */

export function pencilDown(p: XY) {
  S.pencil = [p];
  S.drag = {
    move(m) {
      const pts = S.pencil,
        last = pts[pts.length - 1];
      if (Math.hypot(m.x - last.x, m.y - last.y) * S.scale < 2) return;
      pts.push(m);
      drawOverlay();
    },
    up() {
      finishPencil();
    },
  };
}
function finishPencil() {
  const pts = (S.pencil || []).map(q => [q.x, q.y]);
  S.pencil = null;
  if (pts.length < 2) {
    drawOverlay();
    return;
  }
  let closed = false;
  if (pts.length > 6) {
    const a = pts[0],
      b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) * S.scale < 12) {
      closed = true;
      pts.pop();
    }
  }
  const simp = simplifyPts(pts, 1.6 / S.scale);
  if (simp.length < 2) {
    drawOverlay();
    return;
  }
  const ed = beginEdit(),
    col = nextColor(),
    l = mkLayer(
      'path',
      nameFor(closed ? 'Shape' : 'Stroke'),
      {},
      {
        fill: closed ? col : 'none',
        stk: closed ? 'none' : col,
        sw: closed ? 0 : 3,
        d: [{ c: closed, n: smoothNodes(simp, closed) }],
      },
    );
  l.extra = { 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  addLayer(l);
  ed.end({ insp: true });
}

/* ---------- hover feedback ---------- */

/** Update the cursor and the overlay hint while the pointer moves without a drag. */
export function penHover(p: XY, e: { altKey: boolean }) {
  const t = S.tool;
  let kind = '',
    hint: { kind: string; x: number; y: number } | null = null;
  const P = pen();
  if (t === 'pen' && P) {
    P.hover = p;
    const n = P.nodes;
    if (n.length >= 2 && px(ptOf(n[0]), p) < NEAR_ANCHOR) kind = 'close';
    else if (n.length && px(ptOf(n[n.length - 1]), p) < NEAR_ANCHOR) kind = 'corner';
  } else if (t === 'convert') {
    kind = 'anchor';
  } else if (t === 'pen' || t === 'addnode' || t === 'delnode') {
    const l = editableShape(),
      h = l && penHit(l, p, e.altKey);
    if (t === 'pen') {
      kind = 'new';
      if (h && h.kind === 'handle') kind = 'convert';
      else if (h && h.kind === 'anchor') kind = e.altKey ? 'convert' : h.end && canContinue(l) ? 'cont' : 'del';
      else if (h && h.kind === 'seg' && !e.altKey) kind = 'add';
    } else kind = t === 'addnode' ? 'add' : 'del';
    if (h && ((h.kind === 'seg' && kind === 'add') || (h.kind === 'anchor' && kind === 'del')))
      hint = { kind: h.kind === 'seg' ? 'add' : 'del', x: h.pt.x, y: h.pt.y };
  } else return;
  setCursor(kind);
  const changed = JSON.stringify(hint) !== JSON.stringify(S.penHint || null);
  S.penHint = hint;
  if (P || changed) drawOverlay();
}
