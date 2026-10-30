// SVGcinema — render/overlay
import { meshBox } from './mesh';
import type { Layer, PathData, PathNode } from '../model/types';
import { H, byId, fmt, r2, xfp } from '../core/constants';
import { CONTENT, OV, svgEl } from '../core/dom';
import { S, doc, layerById, selLayer } from '../core/state';
import { isHidden, isLocked, parentMatrix } from '../model/tree';
import { bonePts, drawBone } from '../tools/bones';
import { boneChips, drawBindLines, scaleBar } from '../tools/bone-edit';
import { boundBones, drawPins, pinBar } from '../tools/pins';
import { cursorFor } from '../tools/edit-tools';
import { ellNodes, rectNodes } from '../geometry/nodes';
import { currentNode, segCtrl } from '../tools/motion-path';
import { editBox, followTextEdit, textEditing } from '../tools/text-edit';
import { drawGuides } from './guides';
import { drawGradHandles } from '../tools/gradient-handles';
import { onPicker } from '../ui/color-picker';
import { groupBox, groupMode, groupTargets } from '../tools/group-xform';

export function toDoc(x: number, y: number) {
  return new DOMPoint(x, y).matrixTransform(CONTENT.getScreenCTM().inverse());
}
export function docPt(e: { clientX: number; clientY: number }) {
  return toDoc(e.clientX, e.clientY);
}
export function localMatrix(l: Layer): DOMMatrix {
  const s = byId('e-' + l.id + '-s');
  return CONTENT.getScreenCTM().inverse().multiply(s.getScreenCTM());
}
export function boxOf(l: Layer) {
  const s = byId('e-' + l.id + '-s');
  if (!s) return null;
  // pinned images, text and groups: the box of their warped mesh
  const mb = meshBox(l);
  if (mb) {
    const M = gMatrix(l),
      pts = [
        [mb.x, mb.y],
        [mb.x + mb.width, mb.y],
        [mb.x, mb.y + mb.height],
        [mb.x + mb.width, mb.y + mb.height],
      ].map(([x, y]) => xfp(M, x, y)),
      xs = pts.map(p => p.x),
      ys = pts.map(p => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  const rc = s.getBoundingClientRect();
  if (!rc.width && !rc.height) {
    // not drawn (e.g. a mask's layers): measure from its geometry instead
    let bb: DOMRect;
    try {
      bb = (s as any).getBBox();
    } catch (_) {
      return null;
    }
    const M = localMatrix(l),
      pts = [
        [bb.x, bb.y],
        [bb.x + bb.width, bb.y],
        [bb.x, bb.y + bb.height],
        [bb.x + bb.width, bb.y + bb.height],
      ].map(([x, y]) => xfp(M, x, y)),
      xs = pts.map(p => p.x),
      ys = pts.map(p => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  const a = toDoc(rc.left, rc.top),
    b = toDoc(rc.right, rc.bottom);
  return { x: a.x, y: a.y, w: Math.max(0, b.x - a.x), h: Math.max(0, b.y - a.y) };
}
export function gMatrix(l: Layer): DOMMatrix {
  const g = byId('e-' + l.id);
  return CONTENT.getScreenCTM().inverse().multiply(g.getScreenCTM());
}
export function obbOf(l: Layer): DOMPoint[] | null {
  const s = byId('e-' + l.id);
  if (!s) return null;
  let b;
  try {
    b = meshBox(l) || s.getBBox();
  } catch (e) {
    return null;
  }
  const M = gMatrix(l);
  return [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x + b.width, b.y + b.height],
    [b.x, b.y + b.height],
  ].map(([x, y]) => xfp(M, x, y));
}
export function quadPts(q: DOMPointReadOnly[]) {
  return q.map(p => r2(p.x) + ',' + r2(p.y)).join(' ');
}
onPicker(() => drawOverlay());
/** Dotted links between bones bound with the Bind tool, drawn with the bones (and hidden with them;
 *  the overlay is never exported): from the parent bone's joint (its start) to the child bone's joint.
 *  A child bone that starts on its parent's tip (a connected chain) needs no link. */
export function drawBoneLinks(u: number) {
  const seg = new Map<string, { J: DOMPoint; T: DOMPoint } | null>();
  const bone = (id: string) => {
    if (!seg.has(id)) {
      const b = layerById(id);
      seg.set(id, b && b.type === 'bone' && !isHidden(b) ? bonePts(b) : null);
    }
    return seg.get(id);
  };
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 4 * u;
  doc.layers.forEach(k => {
    const s = k.type === 'bone' && k.parent ? bone(k.parent) : null,
      c = s && bone(k.id);
    if (!c || near(c.J, s.T) || near(c.J, s.J)) return;
    OV.append(
      svgEl('line', {
        x1: r2(s.J.x),
        y1: r2(s.J.y),
        x2: r2(c.J.x),
        y2: r2(c.J.y),
        class: 'ov-blink',
        'data-blink': k.parent,
        'data-child': k.id,
      }),
    );
  });
}
/** Redraws the canvas overlay. Pins go last, on top of the selection box: on a small layer they sit
 *  on its handles, and a pin is the more specific thing to grab. */
export function drawOverlay() {
  drawOverlayBody();
  drawPins(1 / S.scale);
}
function drawOverlayBody() {
  OV.replaceChildren();
  followTextEdit();
  drawGuides();
  if (S.snapLines) {
    const big = 100000;
    S.snapLines.x.forEach(x => OV.append(svgEl('line', { x1: x, y1: -big, x2: x, y2: big, class: 'ov-snap' })));
    S.snapLines.y.forEach(y => OV.append(svgEl('line', { x1: -big, y1: y, x2: big, y2: y, class: 'ov-snap' })));
  }
  const u = 1 / S.scale;
  if (S.marquee) {
    const { a, b, hits } = S.marquee;
    hits.forEach(id => {
      const l = layerById(id),
        q = l && obbOf(l);
      if (q) OV.append(svgEl('polygon', { points: quadPts(q), class: 'ov-box', 'stroke-dasharray': '3 3' }));
    });
    OV.append(
      svgEl('rect', {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
        class: 'ov-marq',
      }),
    );
  }
  if (S.pen || S.pencil || S.penHint) drawPen(u);
  if (S.tool !== 'select') drawLabel(u);
  boneChips();
  scaleBar();
  pinBar();
  const boneTool = S.tool === 'boneedit' || S.tool === 'bonebind' || S.tool === 'bonescale';
  if (S.tool === 'pin' && (S.pinBind || S.showBones)) {
    // the Pin tool: bones to bind pins to (the ones the layer's pins follow are highlighted)
    const bound = boundBones();
    drawBoneLinks(u);
    doc.layers.forEach(b => {
      if (b.type === 'bone' && !isHidden(b)) drawBone(b, u, bound.has(b.id), S.pinBind && S.pinBoneHover === b.id);
    });
  } else if (
    (S.showBones || boneTool) &&
    ['select', 'bone', 'node', 'boneedit', 'bonebind', 'bonescale'].includes(S.tool)
  ) {
    drawBoneLinks(u);
    doc.layers.forEach(b => {
      if (b.type === 'bone' && !isHidden(b))
        drawBone(
          b,
          u,
          S.selSet.has(b.id),
          S.tool === 'bonebind' && (S.bindPick.length > 0 || S.bindPins.length > 0) && S.bindHover === b.id,
        );
    });
  }
  drawBindLines(
    el => OV.append(el),
    (tag, a) => svgEl(tag, a),
  );
  if (S.boneDraft) {
    const A = S.boneDraft.a,
      B = S.boneDraft.b;
    OV.append(svgEl('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: 'ov-bdraft' }));
    OV.append(svgEl('circle', { cx: A.x, cy: A.y, r: 4.5 * u, class: 'ov-bj is-sel' }));
  }
  // several layers: one box around them all, with handles that transform the whole selection
  if (groupMode()) return drawGroupBox(u);
  S.selSet.forEach(id => {
    if (id === S.sel) return;
    const o = layerById(id);
    const q = o && !isHidden(o) && obbOf(o);
    if (q) OV.append(svgEl('polygon', { points: quadPts(q), class: 'ov-box', 'stroke-dasharray': '3 3' }));
  });
  const l = selLayer();
  if (!l || isHidden(l)) return;
  const Q = obbOf(l);
  if (!Q) return;
  const PM = parentMatrix(l),
    mp = (x: number, y: number) => xfp(PM, x, y),
    tr = l.t.pos,
    o = H.get(l, 'org', S.time) || [0, 0];
  if (tr && tr.length > 1) {
    const t0 = tr[0][0],
      t1 = tr[tr.length - 1][0],
      pts = [];
    for (let i = 0; i <= 90; i++) {
      const p = H.get(l, 'pos', t0 + ((t1 - t0) * i) / 90),
        q = mp(p[0] + o[0], p[1] + o[1]);
      pts.push(r2(q.x) + ',' + r2(q.y));
    }
    OV.append(svgEl('polyline', { points: pts.join(' '), class: 'ov-path' }));
    if (S.tool === 'select' && !isLocked(l))
      for (let i = 0; i < tr.length - 1; i++) {
        const c = segCtrl(l, i).map(v => mp(v[0] + o[0], v[1] + o[1]));
        OV.append(
          svgEl('path', {
            d: `M${r2(c[0].x)} ${r2(c[0].y)}C${r2(c[1].x)} ${r2(c[1].y)} ${r2(c[2].x)} ${r2(c[2].y)} ${r2(c[3].x)} ${r2(c[3].y)}`,
            class: 'ov-mseg',
            'data-mseg': i,
            'stroke-width': 10,
          }),
        );
        if (tr[i][3])
          [1, 2].forEach(j => {
            const e = c[j === 1 ? 0 : 3];
            OV.append(svgEl('line', { x1: e.x, y1: e.y, x2: c[j].x, y2: c[j].y, class: 'ov-mhl' }));
            OV.append(
              svgEl('circle', { cx: c[j].x, cy: c[j].y, r: 3.5 * u, class: 'ov-mh', 'data-mh': i + ',' + (j - 1) }),
            );
          });
      }
    const cn = currentNode(l);
    tr.forEach((k, ki) => {
      const q = mp(k[1][0] + o[0], k[1][1] + o[1]);
      OV.append(
        svgEl('circle', {
          cx: q.x,
          cy: q.y,
          r: (ki === cn ? 4.5 : 3.5) * u,
          class: 'ov-kdot' + (ki === cn ? ' cur' : ''),
        }),
      );
    });
  }
  if (l.type === 'bone') {
    if (S.drag && S.drag.lbl && S.drag.lp) {
      const t = svgEl('text', {
        x: S.drag.lp.x + 14 * u,
        y: S.drag.lp.y - 12 * u,
        class: 'ov-ang',
        'font-size': 11 * u,
        'stroke-width': 2.5 * u,
      });
      t.textContent = S.drag.lbl;
      OV.append(t);
    }
    return;
  }
  if (l.type === 'text' && textEditing() === l.id) return drawEditBox(l, u);
  OV.append(svgEl('polygon', { points: quadPts(Q), class: 'ov-box' }));
  // the color window is editing a gradient of this layer: show its handles instead
  if (S.tool === 'select' && !isLocked(l) && drawGradHandles(l, u)) return;
  const nodeTool =
    S.tool === 'node' || S.tool === 'pen' || S.tool === 'addnode' || S.tool === 'delnode' || S.tool === 'convert';
  if (nodeTool && (l.type === 'path' || (S.tool !== 'node' && (l.type === 'rect' || l.type === 'ellipse')))) {
    drawNodes(l, u);
    return;
  }
  if (isLocked(l) || S.tool !== 'select') return;
  const c = H.comp(l, S.time),
    C = mp(c.x, c.y),
    hs = 8 * u;
  OV.append(svgEl('circle', { cx: C.x, cy: C.y, r: 4 * u, class: 'ov-org' }));
  OV.append(
    svgEl('path', { d: `M${C.x - 8 * u} ${C.y}H${C.x + 8 * u}M${C.x} ${C.y - 8 * u}V${C.y + 8 * u}`, class: 'ov-org' }),
  );
  const ang = (Math.atan2(Q[1].y - Q[0].y, Q[1].x - Q[0].x) * 180) / Math.PI,
    mx = (Q[0].x + Q[2].x) / 2,
    my = (Q[0].y + Q[2].y) / 2;
  const mid2 = (a: DOMPointReadOnly, b: DOMPointReadOnly) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const H8: any[] = [
    ['nw', Q[0]],
    ['n', mid2(Q[0], Q[1])],
    ['ne', Q[1]],
    ['e', mid2(Q[1], Q[2])],
    ['se', Q[2]],
    ['s', mid2(Q[2], Q[3])],
    ['sw', Q[3]],
    ['w', mid2(Q[3], Q[0])],
  ];
  H8.forEach(([k, p]) => {
    const edge = k.length === 1,
      sz = edge ? hs * 0.8 : hs;
    OV.append(
      svgEl('rect', {
        x: p.x - sz / 2,
        y: p.y - sz / 2,
        width: sz,
        height: sz,
        class: 'ov-h' + (edge ? ' ov-he' : ''),
        'data-h': k,
        transform: `rotate(${r2(ang)} ${r2(p.x)} ${r2(p.y)})`,
        style: `cursor:${cursorFor(p.x - mx, p.y - my)}`,
      }),
    );
  });
  const tm = { x: (Q[0].x + Q[1].x) / 2, y: (Q[0].y + Q[1].y) / 2 },
    bm = { x: (Q[3].x + Q[2].x) / 2, y: (Q[3].y + Q[2].y) / 2 };
  let nx = tm.x - bm.x,
    ny = tm.y - bm.y,
    nl = Math.hypot(nx, ny);
  if (nl < 1e-6) {
    const a = ((ang - 90) * Math.PI) / 180;
    nx = Math.cos(a);
    ny = Math.sin(a);
    nl = 1;
  }
  nx /= nl;
  ny /= nl;
  const rx = tm.x + nx * 24 * u,
    ry = tm.y + ny * 24 * u;
  OV.append(svgEl('line', { x1: tm.x, y1: tm.y, x2: rx, y2: ry, class: 'ov-box' }));
  OV.append(svgEl('circle', { cx: rx, cy: ry, r: 5 * u, class: 'ov-h ov-rot', 'data-h': 'rot' }));
  OV.append(svgEl('circle', { cx: C.x, cy: C.y, r: 4.5 * u, class: 'ov-orgh', 'data-h': 'org' }));
  if (S.drag && S.drag.rot) {
    const t = svgEl('text', {
      x: rx + 10 * u,
      y: ry - 8 * u,
      class: 'ov-ang',
      'font-size': 11 * u,
      'stroke-width': 2.5 * u,
    });
    t.textContent = fmt(H.get(l, 'rot', S.time), 1) + '°';
    OV.append(t);
  }
  if (S.drag && S.drag.lbl && S.drag.lp) {
    const t = svgEl('text', {
      x: S.drag.lp.x + 14 * u,
      y: S.drag.lp.y - 12 * u,
      class: 'ov-ang',
      'font-size': 11 * u,
      'stroke-width': 2.5 * u,
    });
    t.textContent = S.drag.lbl;
    OV.append(t);
  }
}
/** The selection's box (several layers): each layer's own box dashed, the box around them all with
 *  side and corner handles and a rotate handle (while rotating, the box turns with the layers). */
function drawGroupBox(u: number) {
  groupTargets().forEach(o => {
    const q = !isHidden(o) && obbOf(o);
    if (q) OV.append(svgEl('polygon', { points: quadPts(q), class: 'ov-box', 'stroke-dasharray': '3 3' }));
  });
  const g = S.drag && S.drag.gbox,
    B = g || groupBox();
  if (!B) return;
  const C = { x: B.x + B.w / 2, y: B.y + B.h / 2 },
    a = ((g ? g.ang : 0) * Math.PI) / 180,
    P = (x: number, y: number) => ({
      x: C.x + (x - C.x) * Math.cos(a) - (y - C.y) * Math.sin(a),
      y: C.y + (x - C.x) * Math.sin(a) + (y - C.y) * Math.cos(a),
    }),
    Q = [P(B.x, B.y), P(B.x + B.w, B.y), P(B.x + B.w, B.y + B.h), P(B.x, B.y + B.h)];
  OV.append(svgEl('polygon', { points: Q.map(p => r2(p.x) + ',' + r2(p.y)).join(' '), class: 'ov-box ov-gbox' }));
  const mid2 = (p: { x: number; y: number }, q: { x: number; y: number }) => ({
      x: (p.x + q.x) / 2,
      y: (p.y + q.y) / 2,
    }),
    hs = 8 * u;
  if (!g)
    (
      [
        ['nw', Q[0]],
        ['n', mid2(Q[0], Q[1])],
        ['ne', Q[1]],
        ['e', mid2(Q[1], Q[2])],
        ['se', Q[2]],
        ['s', mid2(Q[2], Q[3])],
        ['sw', Q[3]],
        ['w', mid2(Q[3], Q[0])],
      ] as Array<[string, { x: number; y: number }]>
    ).forEach(([k, p]) => {
      const edge = k.length === 1,
        sz = edge ? hs * 0.8 : hs;
      OV.append(
        svgEl('rect', {
          x: p.x - sz / 2,
          y: p.y - sz / 2,
          width: sz,
          height: sz,
          class: 'ov-h' + (edge ? ' ov-he' : ''),
          'data-gx': k,
          style: `cursor:${cursorFor(p.x - C.x, p.y - C.y)}`,
        }),
      );
    });
  const tm = mid2(Q[0], Q[1]),
    nx = Math.sin(a),
    ny = -Math.cos(a),
    rx = tm.x + nx * 24 * u,
    ry = tm.y + ny * 24 * u;
  OV.append(svgEl('line', { x1: tm.x, y1: tm.y, x2: rx, y2: ry, class: 'ov-box' }));
  OV.append(svgEl('circle', { cx: rx, cy: ry, r: 5 * u, class: 'ov-h ov-rot', 'data-gx': 'rot' }));
  OV.append(
    svgEl('path', { d: `M${C.x - 6 * u} ${C.y}H${C.x + 6 * u}M${C.x} ${C.y - 6 * u}V${C.y + 6 * u}`, class: 'ov-org' }),
  );
  if (S.drag && S.drag.lbl && S.drag.lp) {
    const t = svgEl('text', {
      x: S.drag.lp.x + 14 * u,
      y: S.drag.lp.y - 12 * u,
      class: 'ov-ang',
      'font-size': 11 * u,
      'stroke-width': 2.5 * u,
    });
    t.textContent = S.drag.lbl;
    OV.append(t);
  }
}
/** Text being typed: its box, with a handle on each side to set the width. */
function drawEditBox(l: Layer, u: number) {
  const M = localMatrix(l),
    b = editBox(l),
    P = (x: number, y: number) => xfp(M, x, y),
    q = [P(b.x, b.y), P(b.x + b.w, b.y), P(b.x + b.w, b.y + b.h), P(b.x, b.y + b.h)];
  OV.append(svgEl('polygon', { points: quadPts(q), class: 'ov-box' }));
  const ang = (Math.atan2(q[1].y - q[0].y, q[1].x - q[0].x) * 180) / Math.PI,
    hw = 5 * u,
    hh = Math.min(22 * u, Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y) * 0.7);
  (
    [
      ['tbw', P(b.x, b.y + b.h / 2)],
      ['tbe', P(b.x + b.w, b.y + b.h / 2)],
    ] as Array<[string, DOMPoint]>
  ).forEach(([k, p]) =>
    OV.append(
      svgEl('rect', {
        x: p.x - hw / 2,
        y: p.y - hh / 2,
        width: hw,
        height: hh,
        rx: hw / 2,
        class: 'ov-h ov-tbh',
        'data-h': k,
        transform: `rotate(${r2(ang)} ${r2(p.x)} ${r2(p.y)})`,
        style: 'cursor:ew-resize',
      }),
    ),
  );
}
export function drawNodes(l: Layer, u: number) {
  const M = localMatrix(l),
    d: PathData =
      l.type === 'rect' ? rectNodes(l.geo) : l.type === 'ellipse' ? ellNodes(l.geo) : H.get(l, 'd', S.time) || [],
    P = (x: number, y: number) => xfp(M, x, y);
  d.forEach((sp, i) =>
    sp.n.forEach((q, j) => {
      const A = P(q[0], q[1]),
        I = P(q[2], q[3]),
        O = P(q[4], q[5]);
      (
        [
          [I, 1],
          [O, 2],
        ] as any[]
      ).forEach(([p, part]) => {
        if (Math.hypot(p.x - A.x, p.y - A.y) > 0.01) {
          OV.append(svgEl('line', { x1: A.x, y1: A.y, x2: p.x, y2: p.y, class: 'ov-hl' }));
          OV.append(
            svgEl('circle', { cx: p.x, cy: p.y, r: 3.5 * u, class: 'ov-hd', 'data-node': `${i},${j},${part}` }),
          );
        }
      });
      const sel = S.node && S.node[0] === i && S.node[1] === j;
      OV.append(
        svgEl('rect', {
          x: A.x - 4 * u,
          y: A.y - 4 * u,
          width: 8 * u,
          height: 8 * u,
          class: 'ov-an' + (sel ? ' is-sel' : ''),
          'data-node': `${i},${j},0`,
        }),
      );
    }),
  );
}
export function drawPen(u: number) {
  const P = S.pen,
    sq = (x: number, y: number, cls: string, r = 4) =>
      svgEl('rect', { x: x - r * u, y: y - r * u, width: 2 * r * u, height: 2 * r * u, class: cls });
  if (P && P.nodes.length) {
    const n: PathNode[] = P.nodes,
      l = n[n.length - 1],
      hv = P.hover;
    OV.append(svgEl('path', { d: H.dstr([{ c: false, n }]), class: 'ov-pen' }));
    // rubber band: the next segment as it would be drawn from the last point's handle
    if (hv && !S.drag) {
      const curved = l[4] !== l[0] || l[5] !== l[1];
      OV.append(
        svgEl('path', {
          d: curved
            ? `M${l[0]} ${l[1]}C${l[4]} ${l[5]} ${hv.x} ${hv.y} ${hv.x} ${hv.y}`
            : `M${l[0]} ${l[1]}L${hv.x} ${hv.y}`,
          class: 'ov-rub',
        }),
      );
    }
    n.forEach((q, j) => {
      const recent = j >= n.length - 2 || j === 0;
      if (recent)
        [
          [q[2], q[3]],
          [q[4], q[5]],
        ].forEach(([hx, hy]) => {
          if (Math.hypot(hx - q[0], hy - q[1]) < 0.01) return;
          OV.append(svgEl('line', { x1: q[0], y1: q[1], x2: hx, y2: hy, class: 'ov-hl' }));
          OV.append(svgEl('circle', { cx: hx, cy: hy, r: 3 * u, class: 'ov-hd' }));
        });
      OV.append(sq(q[0], q[1], 'ov-an' + (j === n.length - 1 ? ' is-sel' : '')));
    });
  }
  if (S.pencil && S.pencil.length > 1)
    OV.append(svgEl('polyline', { points: S.pencil.map(q => r2(q.x) + ',' + r2(q.y)).join(' '), class: 'ov-pen' }));
  const h = S.penHint;
  if (h && !S.drag) {
    if (h.kind === 'add') {
      OV.append(svgEl('circle', { cx: h.x, cy: h.y, r: 4 * u, class: 'ov-hint-add' }));
    } else OV.append(sq(h.x, h.y, 'ov-hint-del', 6));
  }
}
function drawLabel(u: number) {
  if (!(S.drag && S.drag.lbl && S.drag.lp)) return;
  const t = svgEl('text', {
    x: S.drag.lp.x + 14 * u,
    y: S.drag.lp.y - 12 * u,
    class: 'ov-ang',
    'font-size': 11 * u,
    'stroke-width': 2.5 * u,
  });
  t.textContent = S.drag.lbl;
  OV.append(t);
}
