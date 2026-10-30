// SVGcinema — tools/bones
import type { Geometry, Layer, XY } from '../model/types';
import { DEFAULT_EASE, H, NOFILL, byId, clamp, fmt, r2, xfp } from '../core/constants';
import { OV, svgEl } from '../core/dom';
import { beginEdit, select, setProp } from '../core/history';
import { S, doc, layerById, mkLayer } from '../core/state';
import { isHidden, kids, parentMatrix, pmOf } from '../model/tree';
import { drawOverlay, gMatrix } from '../render/overlay';
import { frame } from '../render/stage';
import { keyRig } from './rig';

export function boneTipL(G: Geometry): number[] {
  const a = (G.ang * Math.PI) / 180;
  return [G.x + G.len * Math.cos(a), G.y + G.len * Math.sin(a)];
}
export function bonePts(l: Layer): { J: DOMPoint; T: DOMPoint } | null {
  const g = byId('e-' + l.id);
  if (!g) return null;
  const M = gMatrix(l),
    tl = boneTipL(l.geo);
  return { J: xfp(M, l.geo.x, l.geo.y), T: xfp(M, tl[0], tl[1]) };
}
export function drawBone(l: Layer, u: number, sel: boolean, hover = false) {
  const bp = bonePts(l);
  if (!bp) return;
  const { J, T } = bp,
    dx = T.x - J.x,
    dy = T.y - J.y,
    L = Math.hypot(dx, dy) || 1,
    nx = -dy / L,
    ny = dx / L,
    w = Math.min(L * 0.14, 8 * u),
    mx = J.x + dx * 0.2,
    my = J.y + dy * 0.2,
    k = sel ? ' is-sel' : '',
    pts = `${r2(J.x)},${r2(J.y)} ${r2(mx + nx * w)},${r2(my + ny * w)} ${r2(T.x)},${r2(T.y)} ${r2(mx - nx * w)},${r2(my - ny * w)}`;
  if (hover) OV.append(svgEl('polygon', { points: pts, class: 'ov-bhover' }));
  OV.append(
    svgEl('polygon', {
      points: pts,
      class: 'ov-bone' + k,
      'data-bone': l.id,
      'data-part': 'body',
    }),
  );
  OV.append(
    svgEl(
      l.pin ? 'rect' : 'circle',
      l.pin
        ? {
            x: J.x - 4 * u,
            y: J.y - 4 * u,
            width: 8 * u,
            height: 8 * u,
            class: 'ov-bj' + k,
            'data-bone': l.id,
            'data-part': 'joint',
          }
        : { cx: J.x, cy: J.y, r: 4 * u, class: 'ov-bj' + k, 'data-bone': l.id, 'data-part': 'joint' },
    ),
  );
  OV.append(svgEl('circle', { cx: T.x, cy: T.y, r: 4 * u, class: 'ov-bt' + k, 'data-bone': l.id, 'data-part': 'tip' }));
}
export function limitRot(b: Layer, r: number) {
  return b.lim ? clamp(r, b.lmin != null ? b.lmin : -90, b.lmax != null ? b.lmax : 90) : r;
}
/** A new bone animates rotation from the start: a Rotate key at 0 s holds its rest value, so posing it
 *  with FK / IK adds keys instead of changing the rest pose (the Edit bone tool owns the rest pose). */
export function keyRestRot(b: Layer) {
  b.t.rot = [[0, b.b.rot || 0, DEFAULT_EASE]];
}
export function newBoneName() {
  return 'Bone ' + (doc.layers.filter(x => x.type === 'bone').length + 1);
}
export function boneCreate(p0: XY) {
  const u = 1 / S.scale;
  let best: [Layer, { J: DOMPoint; T: DOMPoint }] | null = null,
    bd = 10 * u;
  doc.layers.forEach(b => {
    if (b.type !== 'bone' || isHidden(b)) return;
    const bp = bonePts(b);
    if (!bp) return;
    const d = Math.hypot(bp.T.x - p0.x, bp.T.y - p0.y);
    if (d < bd) {
      bd = d;
      best = [b, bp];
    }
  });
  const start = best ? best[1].T : p0;
  S.boneDraft = { a: start, b: p0 };
  S.drag = {
    move(p) {
      S.boneDraft.b = p;
      drawOverlay();
    },
    up() {
      const A = S.boneDraft.a,
        p = S.boneDraft.b;
      S.boneDraft = null;
      if (Math.hypot(p.x - A.x, p.y - A.y) * S.scale < 6) {
        if (best) select(best[0].id);
        else drawOverlay();
        return;
      }
      const ed = beginEdit(),
        pid = best ? best[0].id : null,
        Mi = pmOf(pid).inverse(),
        J = xfp(Mi, A.x, A.y),
        E = xfp(Mi, p.x, p.y);
      const b = mkLayer(
        'bone',
        newBoneName(),
        {
          x: r2(J.x),
          y: r2(J.y),
          len: r2(Math.hypot(E.x - J.x, E.y - J.y)),
          ang: r2((Math.atan2(E.y - J.y, E.x - J.x) * 180) / Math.PI),
        },
        NOFILL,
      );
      b.o = [b.geo.x, b.geo.y];
      b.parent = pid;
      keyRestRot(b);
      doc.layers.push(b);
      S.sel = b.id;
      S.selSet = new Set<any>([b.id]);
      if (pid) S.lexp[pid] = true;
      ed.end({ insp: true });
    },
  };
  drawOverlay();
}
export function addChildBone(p: Layer) {
  const ed = beginEdit(),
    tl = boneTipL(p.geo),
    b = mkLayer(
      'bone',
      newBoneName(),
      { x: r2(tl[0]), y: r2(tl[1]), len: r2(Math.max(10, p.geo.len * 0.75)), ang: p.geo.ang },
      NOFILL,
    );
  b.o = [b.geo.x, b.geo.y];
  b.parent = p.id;
  keyRestRot(b);
  doc.layers.push(b);
  S.lexp[p.id] = true;
  S.sel = b.id;
  S.selSet = new Set<any>([b.id]);
  ed.end({ insp: true });
}
export function fkDrag(b: Layer, p0: XY) {
  const J = bonePts(b).J,
    r0 = H.get(b, 'rot', S.time),
    a0 = Math.atan2(p0.y - J.y, p0.x - J.x),
    PM = parentMatrix(b),
    sg = PM.a * PM.d - PM.b * PM.c < 0 ? -1 : 1,
    ed = beginEdit();
  let moved = false;
  S.drag = {
    move(p, e) {
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) * S.scale < 3) return;
      if (!moved) keyRig(b, 'rot');
      moved = true;
      let r = r0 + (sg * (Math.atan2(p.y - J.y, p.x - J.x) - a0) * 180) / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      r = limitRot(b, r);
      setProp(b, 'rot', r2(r));
      S.drag.lbl = `${fmt(r, 1)}°`;
      S.drag.lp = p;
      frame();
    },
    up() {
      ed.end();
    },
  };
}
export function ikChain(b: Layer): Layer[] {
  const ch = [b];
  let x = b;
  while (!x.pin) {
    const p = x.parent && layerById(x.parent);
    if (!p || p.type !== 'bone') break;
    ch.unshift(p);
    x = p;
  }
  return ch;
}
/** prepends a child bone's counter scale (it cancels its parent bone's scale around its joint) */
export function counterMat(q: number[] | null) {
  const M = new DOMMatrix();
  if (!q) return M;
  return M.translate(q[3], q[4])
    .rotate(q[0])
    .scale(1 / q[1], 1 / q[2])
    .rotate(-q[0])
    .translate(-q[3], -q[4]);
}
export function localMat(l: Layer, t: number, rot?: number) {
  const c = H.comp(l, t);
  return counterMat(c.cp)
    .translate(c.x, c.y)
    .rotate(rot != null ? rot : c.r)
    .skewX(c.kx || 0)
    .skewY(c.ky || 0)
    .rotate(c.ba || 0)
    .scale(c.sx, c.sy)
    .rotate(-(c.ba || 0))
    .translate(-c.ox, -c.oy);
}
export function ikDrag(b: Layer, p0: XY) {
  const ch = ikChain(b),
    PM = DOMMatrix.fromMatrix(parentMatrix(ch[0])), // getScreenCTM gives an SVGMatrix, whose multiply() refuses a DOMMatrix
    t = S.time,
    rots = ch.map(x => H.get(x, 'rot', t)),
    tip = boneTipL(b.geo),
    ed = beginEdit();
  let moved = false;
  const solve = (tg: XY) => {
    for (let it = 0; it < 20; it++) {
      let err = 0;
      for (let i = ch.length - 1; i >= 0; i--) {
        const W: DOMMatrix[] = [];
        let M = PM;
        ch.forEach((x, k) => {
          M = M.multiply(localMat(x, t, rots[k]));
          W.push(M);
        });
        const above = i ? W[i - 1] : PM,
          sg = above.a * above.d - above.b * above.c < 0 ? -1 : 1,
          j = xfp(W[i], ch[i].geo.x, ch[i].geo.y),
          ef = xfp(W[ch.length - 1], tip[0], tip[1]);
        err = Math.hypot(ef.x - tg.x, ef.y - tg.y);
        let d = Math.atan2(tg.y - j.y, tg.x - j.x) - Math.atan2(ef.y - j.y, ef.x - j.x);
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        rots[i] = limitRot(ch[i], rots[i] + (sg * d * 180) / Math.PI);
      }
      if (err < 0.25) break;
    }
  };
  S.drag = {
    move(p) {
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) * S.scale < 3) return;
      if (!moved) keyRig(b, 'rot');
      moved = true;
      solve(p);
      ch.forEach((x, k) => setProp(x, 'rot', r2(rots[k])));
      S.drag.lbl = `IK · ${ch.length} bone${ch.length > 1 ? 's' : ''}`;
      S.drag.lp = p;
      frame();
    },
    up() {
      ed.end();
    },
  };
}
export function shiftChildBones(l: Layer, oldTip: number[]) {
  const nt = boneTipL(l.geo),
    dx = nt[0] - oldTip[0],
    dy = nt[1] - oldTip[1];
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
  kids(l.id).forEach(c => {
    if (c.type !== 'bone' || Math.hypot(c.geo.x - oldTip[0], c.geo.y - oldTip[1]) > 0.6) return;
    if (c.t.pos && c.t.pos.length) c.t.pos.forEach(q => (q[1] = [r2(q[1][0] + dx), r2(q[1][1] + dy)]));
    else c.b.pos = [r2(c.b.pos[0] + dx), r2(c.b.pos[1] + dy)];
  });
}
