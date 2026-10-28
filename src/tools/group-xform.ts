// SVGcinema — tools/group-xform
// Several layers selected: one transform box around the whole selection on the canvas. Its handles
// scale every layer from the opposite side (Shift keeps proportions, Alt scales from the centre) and
// its rotate handle turns them all around the box's centre (Shift: 15° steps). Each layer's position,
// scale and rotation change as if the layers were one; animated properties get a keyframe at the
// playhead, as with one layer. The whole drag is one undo step.
import type { Layer, XY } from '../model/types';
import { H, byId, clone, r2, r3, valueAt, xfp } from '../core/constants';
import { beginEdit, commit, setProp } from '../core/history';
import { copyLayer } from '../ui/layers-panel';
import { clearSnap, selfAndKids, snapMove, snapTargets } from './snap';
import { S } from '../core/state';
import { isLocked, parentMatrix, selectedRoots } from '../model/tree';
import { boxOf } from '../render/overlay';
import { frame } from '../render/stage';

export interface GBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The layers the box moves: the selected top-most layers that are unlocked and drawn. */
export function groupTargets(): Layer[] {
  return selectedRoots().filter(l => !isLocked(l) && !!byId('e-' + l.id + '-s'));
}
/** Is the selection several layers, so the canvas shows one box around them? */
export function groupMode() {
  return S.tool === 'select' && S.selSet.size > 1 && groupTargets().length > 1;
}
/** The box around the selected layers, in document units. */
export function groupBox(ls = groupTargets()): GBox | null {
  const bs = ls.map(l => boxOf(l)).filter(Boolean) as GBox[];
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map(b => b.x)),
    y0 = Math.min(...bs.map(b => b.y)),
    x1 = Math.max(...bs.map(b => b.x + b.w)),
    y1 = Math.max(...bs.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const UV: Record<string, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

interface Start {
  l: Layer;
  /** the layer's position point (its origin) in document units */
  P: XY;
  pos: number[];
  scl: number[];
  rot: number;
  PMi: DOMMatrix;
}

/** Drag a handle of the selection's box: a side or corner ('nw' … 'w'), or 'rot'. */
export function groupHandleDrag(kind: string, p0: XY) {
  const ls = groupTargets(),
    B = groupBox(ls);
  if (!B || ls.length < 2) return;
  const ed = beginEdit();
  const st: Start[] = ls.map(l => {
    const c = H.comp(l, S.time),
      PM = parentMatrix(l),
      P = xfp(PM, c.x, c.y);
    return {
      l,
      P: { x: P.x, y: P.y },
      pos: clone(valueAt(l, 'pos', S.time) || [0, 0]),
      scl: clone(valueAt(l, 'scl', S.time) || [1, 1]),
      rot: Number(valueAt(l, 'rot', S.time)) || 0,
      PMi: PM.inverse(),
    };
  });
  /** move a layer so its position point lands on `Q` (document units) */
  const place = (s: Start, Q: XY) => {
    const a = xfp(s.PMi, s.P.x, s.P.y),
      b = xfp(s.PMi, Q.x, Q.y);
    setProp(s.l, 'pos', [r2(s.pos[0] + b.x - a.x), r2(s.pos[1] + b.y - a.y)]);
  };
  if (kind === 'rot') {
    const C = { x: B.x + B.w / 2, y: B.y + B.h / 2 },
      a0 = Math.atan2(p0.y - C.y, p0.x - C.x);
    S.drag = {
      rot: true,
      gbox: { ...B, ang: 0 },
      move(p: XY, e: PointerEvent) {
        let d = ((Math.atan2(p.y - C.y, p.x - C.x) - a0) * 180) / Math.PI;
        if (e.shiftKey) d = Math.round(d / 15) * 15;
        const r = (d * Math.PI) / 180,
          cs = Math.cos(r),
          sn = Math.sin(r);
        st.forEach(s => {
          const dx = s.P.x - C.x,
            dy = s.P.y - C.y;
          place(s, { x: C.x + dx * cs - dy * sn, y: C.y + dx * sn + dy * cs });
          setProp(s.l, 'rot', r2(s.rot + d));
        });
        S.drag.gbox.ang = d;
        S.drag.lbl = `${r2(d)}°`;
        S.drag.lp = p;
        frame();
      },
      up() {
        ed.end({ insp: true });
      },
    };
    return;
  }
  const uv = UV[kind];
  if (!uv) return ed.end();
  const at = (u: number, v: number) => ({ x: B.x + B.w * u, y: B.y + B.h * v }),
    Hd = at(uv[0], uv[1]),
    ax = uv[0] !== 0.5,
    ay = uv[1] !== 0.5;
  S.drag = {
    move(p: XY, e: PointerEvent) {
      // the opposite side stays put; Alt scales from the centre
      const A = e.altKey ? at(0.5, 0.5) : at(1 - uv[0], 1 - uv[1]);
      const span = (h: number, a: number) => (Math.abs(h - a) < 1e-6 ? 1 : h - a);
      let kx = ax ? (p.x - A.x) / span(Hd.x, A.x) : 1,
        ky = ay ? (p.y - A.y) / span(Hd.y, A.y) : 1;
      if (e.shiftKey) {
        // keep proportions: the larger change wins (a side handle scales both ways)
        const k = !ax ? ky : !ay ? kx : Math.abs(kx) > Math.abs(ky) ? kx : ky;
        kx = Math.sign(kx || 1) * Math.abs(k);
        ky = Math.sign(ky || 1) * Math.abs(k);
        if (!ax) kx = Math.abs(k);
        if (!ay) ky = Math.abs(k);
      }
      st.forEach(s => {
        place(s, { x: A.x + (s.P.x - A.x) * kx, y: A.y + (s.P.y - A.y) * ky });
        setProp(s.l, 'scl', [r3(s.scl[0] * kx), r3(s.scl[1] * ky)]);
      });
      S.drag.lbl = `${Math.round(Math.abs(B.w * kx))} × ${Math.round(Math.abs(B.h * ky))}`;
      S.drag.lp = p;
      frame();
    },
    up() {
      ed.end({ insp: true });
    },
  };
}

/** Drag one of the selected layers (or inside the selection's box): every selected layer moves with it,
 *  snapping the box around them all against the rest (Ctrl/Cmd: no snapping; Shift: one direction).
 *  Alt drags copies of them all, leaving the originals. One undo step. */
export function groupMoveDrag(p0: XY, e0: PointerEvent, onClick?: () => void) {
  const ed = beginEdit();
  let ls = groupTargets();
  if (e0.altKey) {
    const copies = ls.map(l => copyLayer(l, false));
    S.selSet = new Set(copies.map(c => c.id));
    S.sel = copies[copies.length - 1].id;
    commit({ insp: true });
    ls = groupTargets();
  }
  if (!ls.length) return ed.end();
  const ex = new Set<string>();
  ls.forEach(l => selfAndKids(l).forEach(id => ex.add(id)));
  const T = snapTargets(ex),
    B = groupBox(ls),
    st = ls.map(l => ({ l, pos: clone(valueAt(l, 'pos', S.time) || [0, 0]), PMi: parentMatrix(l).inverse() }));
  let moved = false;
  S.drag = {
    move(p: XY, e: PointerEvent) {
      let dx = p.x - p0.x,
        dy = p.y - p0.y;
      if (!moved && Math.hypot(dx, dy) * S.scale < 3) return;
      moved = true;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (B && !e.ctrlKey && !e.metaKey) {
        const [sx, sy] = snapMove(B, dx, dy, T);
        dx = e.shiftKey && dx === 0 ? 0 : sx;
        dy = e.shiftKey && dy === 0 ? 0 : sy;
      } else clearSnap();
      st.forEach(s => {
        const a = xfp(s.PMi, 0, 0),
          b = xfp(s.PMi, dx, dy);
        setProp(s.l, 'pos', [r2(s.pos[0] + b.x - a.x), r2(s.pos[1] + b.y - a.y)]);
      });
      frame();
    },
    up() {
      clearSnap();
      ed.end({ insp: true });
      // a press on another layer inside the box that didn't move: it picks that layer instead
      if (!moved && onClick) onClick();
    },
  };
}
/** Is the point inside the box around the selected layers? */
export function insideGroupBox(p: XY) {
  const B = groupBox();
  return !!B && p.x >= B.x && p.x <= B.x + B.w && p.y >= B.y && p.y <= B.y + B.h;
}
