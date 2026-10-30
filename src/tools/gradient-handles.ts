// SVGcinema — tools/gradient-handles
// While the color window edits a gradient, the canvas shows where it sits and lets you drag it:
//   linear  a bar from the start point (hollow) to the end point (filled); drag either end, or the
//           bar to move both. Shift keeps the bar at 15° steps.
//   radial  the centre (hollow), the radius handle (filled; sets size and direction) and a square
//           handle for the other radius (makes it an ellipse), with the ellipse drawn dashed.
// Gradients live in the shape's bounding box (0–1), so the handles map through that box.
import type { Layer } from '../model/types';
import { H, byId, clone, r3, xfp } from '../core/constants';
import { OV, svgEl } from '../core/dom';
import { layerById } from '../core/state';
import { S } from '../core/state';
import { localMatrix } from '../render/overlay';
import { type Grad, pickerApply, pickerPaint } from '../ui/color-picker';

type XY = { x: number; y: number };
interface Box {
  M: DOMMatrix;
  I: DOMMatrix;
  bb: DOMRect;
}
/** the gradient being edited on this layer, if any */
export function gradEditing(l: Layer): Grad | null {
  const pp = pickerPaint();
  return pp && pp.layer === l.id && H.isG(pp.val) ? (pp.val as Grad) : null;
}
function boxFor(l: Layer): Box | null {
  const s = byId('e-' + l.id + '-s') as unknown as SVGGraphicsElement;
  if (!s) return null;
  let bb: DOMRect;
  try {
    bb = s.getBBox();
  } catch (_) {
    return null;
  }
  if (bb.width < 1e-6 || bb.height < 1e-6) return null;
  const M = localMatrix(l);
  return { M, I: M.inverse(), bb };
}
const toDocB = (B: Box, u: number, v: number) => xfp(B.M, B.bb.x + u * B.bb.width, B.bb.y + v * B.bb.height);
function toBox(B: Box, p: XY): [number, number] {
  const q = xfp(B.I, p.x, p.y);
  return [(q.x - B.bb.x) / B.bb.width, (q.y - B.bb.y) / B.bb.height];
}
/** the radial gradient's handles in box units: centre, radius end, other-radius end */
function radPts(g: Grad) {
  const cx = g.cx ?? 0.5,
    cy = g.cy ?? 0.5,
    r = g.r ?? 0.5,
    rr = g.rr ?? 1,
    t = ((g.ra || 0) * Math.PI) / 180,
    c = Math.cos(t),
    s = Math.sin(t);
  return { cx, cy, r, rr, c, s, end: [cx + r * c, cy + r * s], q: [cx - r * rr * s, cy + r * rr * c] };
}
export function drawGradHandles(l: Layer, u: number): boolean {
  const g = gradEditing(l),
    B = g && boxFor(l);
  if (!g || !B) return false;
  if (g.g === 'lin') {
    const [x1, y1, x2, y2] = H.linP(g),
      a = toDocB(B, x1, y1),
      b = toDocB(B, x2, y2);
    OV.append(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'ov-gbar-o', 'stroke-width': 6 * u }));
    OV.append(
      svgEl('line', {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        class: 'ov-gbar',
        'stroke-width': 4 * u,
        'data-gh': 'line',
      }),
    );
    OV.append(svgEl('circle', { cx: a.x, cy: a.y, r: 6 * u, class: 'ov-gh ov-gh0', 'data-gh': 'p1' }));
    OV.append(svgEl('circle', { cx: b.x, cy: b.y, r: 6 * u, class: 'ov-gh ov-gh1', 'data-gh': 'p2' }));
    return true;
  }
  const R = radPts(g),
    pts: string[] = [];
  for (let i = 0; i <= 72; i++) {
    const t = (i / 72) * Math.PI * 2,
      x = R.cx + R.r * Math.cos(t) * R.c - R.r * R.rr * Math.sin(t) * R.s,
      y = R.cy + R.r * Math.cos(t) * R.s + R.r * R.rr * Math.sin(t) * R.c,
      p = toDocB(B, x, y);
    pts.push(r3(p.x) + ',' + r3(p.y));
  }
  OV.append(svgEl('polyline', { points: pts.join(' '), class: 'ov-gell-o' }));
  OV.append(svgEl('polyline', { points: pts.join(' '), class: 'ov-gell' }));
  const c = toDocB(B, R.cx, R.cy),
    e = toDocB(B, R.end[0], R.end[1]),
    q = toDocB(B, R.q[0], R.q[1]);
  OV.append(svgEl('line', { x1: c.x, y1: c.y, x2: e.x, y2: e.y, class: 'ov-gbar-o', 'stroke-width': 6 * u }));
  OV.append(svgEl('line', { x1: c.x, y1: c.y, x2: e.x, y2: e.y, class: 'ov-gbar', 'stroke-width': 4 * u }));
  OV.append(
    svgEl('rect', {
      x: q.x - 5 * u,
      y: q.y - 5 * u,
      width: 10 * u,
      height: 10 * u,
      class: 'ov-gh ov-gh1',
      'data-gh': 'q',
    }),
  );
  OV.append(svgEl('circle', { cx: e.x, cy: e.y, r: 6 * u, class: 'ov-gh ov-gh1', 'data-gh': 'r' }));
  OV.append(svgEl('circle', { cx: c.x, cy: c.y, r: 6.5 * u, class: 'ov-gh ov-gh0', 'data-gh': 'c' }));
  return true;
}
/** Start dragging a gradient handle. */
export function gradHandleDrag(kind: string, p0: XY): boolean {
  const l = S.sel && layerById(S.sel),
    g0 = l && gradEditing(l),
    B = g0 && boxFor(l);
  if (!g0 || !B) return false;
  const s0 = toBox(B, p0),
    lp0 = H.linP(g0),
    R0 = radPts(g0);
  S.drag = {
    move(p: XY, e: PointerEvent) {
      const m = toBox(B, p),
        g = clone(g0) as Grad;
      if (g.g === 'lin') {
        const q = lp0.slice();
        if (kind === 'line') {
          const dx = m[0] - s0[0],
            dy = m[1] - s0[1];
          q[0] += dx;
          q[2] += dx;
          q[1] += dy;
          q[3] += dy;
        } else {
          const i = kind === 'p1' ? 0 : 2,
            o = 2 - i;
          let x = m[0],
            y = m[1];
          if (e.shiftKey) {
            // 15° steps, measured on the canvas
            const A = toDocB(B, q[o], q[o + 1]),
              d = Math.hypot(p.x - A.x, p.y - A.y),
              t = Math.round(Math.atan2(p.y - A.y, p.x - A.x) / (Math.PI / 12)) * (Math.PI / 12);
            [x, y] = toBox(B, { x: A.x + Math.cos(t) * d, y: A.y + Math.sin(t) * d });
          }
          q[i] = x;
          q[i + 1] = y;
        }
        g.p = q.map(r3);
        delete g.a;
      } else if (kind === 'c') {
        g.cx = r3(R0.cx + m[0] - s0[0]);
        g.cy = r3(R0.cy + m[1] - s0[1]);
      } else if (kind === 'r') {
        const dx = m[0] - R0.cx,
          dy = m[1] - R0.cy;
        g.r = r3(Math.max(0.01, Math.hypot(dx, dy)));
        let a = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        g.ra = r3(a);
      } else if (kind === 'q') {
        // distance along the other axis, as a share of the radius
        const dx = m[0] - R0.cx,
          dy = m[1] - R0.cy;
        g.rr = r3(Math.max(0.01, Math.abs(-dx * R0.s + dy * R0.c) / R0.r));
      }
      pickerApply(g);
    },
    up() {},
  } as any;
  return true;
}
