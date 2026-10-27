// SVGcinema — tools/pins
// Pin tool: click a path, image, text or group to add pins, drag a pin to bend it (keyed at the
// playhead), drag the ring of the selected pin to turn it, Alt+drag moves a pin at rest. Edit pins
// tool: moves pins at rest (the artwork shows its rest shape); a moved pin takes its motion with it.
// Paths bend through their own nodes; images, text and groups through a triangle mesh (model/mesh).
// Bind to bones (the Pin tool's options bar): clicking a bone adds a pin at its joint that follows the
// bone (its position and rotation), so the rig bends the artwork; bound pins mix with ordinary ones.
import type { Layer, PropKey, XY } from '../model/types';
import { plainPath } from '../core/plain-path';
import { H, ICON, byId, clone, esc, fmt, r2, r3, valueAt, xfp } from '../core/constants';
import { OV, svgEl } from '../core/dom';
import { beginEdit, select, setProp } from '../core/history';
import { S, doc, layerById, selLayer } from '../core/state';
import { ellNodes, rectNodes } from '../geometry/nodes';
import { nextPinNumber } from '../model/pins';
import { meshable, pinnable } from '../model/mesh';
import { meshLines } from '../render/mesh';
import { meshOf } from '../render/markup';
import { descendants, isHidden, isLocked } from '../model/tree';
import { toast } from '../io/open';
import { drawOverlay, gMatrix, localMatrix } from '../render/overlay';
import { frame } from '../render/stage';
import { hitChain } from './stage-input';
import { renderInspector } from '../ui/inspector';

const RING = 22; // screen px: the rotation ring around the selected pin
export const isPinTool = (t: string) => t === 'pin' || t === 'pinedit';

/** a pin at the playhead: [rest x, rest y, x, y, angle] (a bound pin follows its bone) */
function pinState(l: Layer, n: number) {
  const p = l.pins.find(q => q.n === n);
  return p ? H.pinAt(l, p, S.time) : null;
}
/** a pin's current position (layer space): at rest with the Edit pins tool, else at the playhead */
function pinAt(l: Layer, n: number) {
  const q = pinState(l, n);
  if (!q) return null;
  return S.tool === 'pinedit' ? [q[0], q[1]] : [q[2], q[3]];
}
function pinRot(l: Layer, n: number) {
  return S.tool === 'pinedit' ? 0 : (pinState(l, n) || [0, 0, 0, 0, 0])[4];
}
const isBound = (l: Layer, n: number) => {
  const p = l.pins && l.pins.find(q => q.n === n);
  return !!(p && p.bone && layerById(p.bone));
};
/** the bones the selected layer's pins follow */
export function boundBones() {
  const l = selLayer();
  return new Set<string>(((l && l.pins) || []).filter(p => p.bone).map(p => p.bone));
}
/** the layer whose pins are shown: the selected path, image, text or group */
function pinLayer(): Layer | null {
  const l = selLayer();
  return l && (l.type === 'path' || meshable(l)) && !isHidden(l) && byId('e-' + l.id + '-s') ? l : null;
}
/** a layer's pin space → document: a path's own coordinates, or the content space of a meshed layer */
export function pinMatrix(l: Layer): DOMMatrix {
  return meshable(l) ? gMatrix(l) : localMatrix(l);
}
const mtx = (M: DOMMatrix) => `matrix(${[M.a, M.b, M.c, M.d, M.e, M.f].map(v => r3(v)).join(',')})`;
/** is any pin away from its rest place or turned at the playhead */
function bent(l: Layer) {
  return (l.pins || []).some(p => {
    const q = pinState(l, p.n);
    return Math.hypot(q[2] - q[0], q[3] - q[1]) > 0.01 || Math.abs(q[4]) > 0.01;
  });
}
function animated(l: Layer) {
  return (l.pins || []).some(
    p => (p.bone && layerById(p.bone)) || ['pin' + p.n, 'pinr' + p.n].some(k => l.t[k] && l.t[k].length > 1),
  );
}
/** the Pin tool's chip above the canvas */
export function pinChip(): string | null {
  if (S.pinBind) {
    const s = selLayer();
    if (s && pinnable(s))
      return `<b>Bind to bones</b><span class="mu">· click bones to pin ${esc(s.name)} to them · click a bound bone again to unbind · Esc when done</span>`;
  }
  const l = pinLayer();
  if (!l || !l.pins || !l.pins.length) return null;
  if (S.pinRing != null && l.pins.some(p => p.n === S.pinRing))
    return `<b>Pin ${S.pinRing}</b><span class="mu">· drag the ring to turn it</span>`;
  const n = l.pins.length,
    nb = l.pins.filter(p => p.bone).length,
    pins = `${n} ${n > 1 ? 'pins' : 'pin'}${nb ? ` · ${nb} on bones` : ''}`,
    M = meshOf(l),
    kind = l.type === 'raw' ? 'artwork' : l.type,
    dot = animated(l) ? '<span class="dot key"></span>' : '';
  return M
    ? `${dot}<b>${esc(l.name)}</b><span class="mu">· ${kind} · mesh of ${M.t.length} triangles · ${pins}</span>`
    : `${dot}<b>${esc(l.name)}</b><span class="mu">· ${pins}</span>`;
}
/** the Pin tool: the chip names the pin whose ring is under the pointer */
export function pinHover(e: PointerEvent) {
  const t = e.target as any,
    r = t && t.closest && t.closest('[data-pinring]'),
    n = r ? +r.dataset.pinring : null,
    bn = S.pinBind && t && t.closest && t.closest('[data-bone]'),
    b = bn ? bn.dataset.bone : null;
  if (n !== S.pinRing || b !== S.pinBoneHover) {
    S.pinRing = n;
    S.pinBoneHover = b;
    drawOverlay();
  }
}

/* ---------- Bind to bones (the Pin tool's options bar) ---------- */

/** the options bar shows Bind to bones while a layer that takes pins is selected and there are bones */
export function pinBar() {
  const bar = document.getElementById('boneOpts');
  if (!bar || S.tool !== 'pin') return;
  const l = selLayer(),
    ok = !!l && pinnable(l) && !isLocked(l) && doc.layers.some(b => b.type === 'bone' && !isHidden(b));
  if (!ok) {
    if (S.pinBind) S.pinBind = false;
    bar.hidden = true;
    return;
  }
  bar.setAttribute('aria-label', 'Pin tool options');
  bar.innerHTML = `<button type="button" class="bo-tg${S.pinBind ? ' on' : ''}" data-pbind aria-pressed="${S.pinBind}">${ICON.bonebind}<span>Bind to bones</span></button>`;
  bar.hidden = false;
}
export function initPinBar() {
  const bar = document.getElementById('boneOpts');
  if (!bar) return;
  bar.addEventListener('click', e => {
    if (!(e.target as HTMLElement).closest('[data-pbind]')) return;
    S.pinBind = !S.pinBind;
    S.pinBoneHover = null;
    drawOverlay();
  });
}
/** Esc / Enter: leave Bind to bones */
export function endPinBind() {
  if (S.tool !== 'pin' || !S.pinBind) return false;
  S.pinBind = false;
  S.pinBoneHover = null;
  drawOverlay();
  return true;
}
/** clicking a bone while binding: a pin at its joint that follows it, or (bound already) unbinds it */
function bindBone(l: Layer, boneId: string) {
  const B = layerById(boneId);
  if (!B || B.type !== 'bone') return;
  if (l.type === 'group' && descendants(l).includes(B)) {
    toast('That bone is inside this group, so it already moves the artwork. Pin the group to bones outside it.');
    return;
  }
  const have = (l.pins || []).find(p => p.bone === boneId);
  if (have) return removePin(l, have.n);
  const ed = beginEdit();
  toPath(l);
  const n = nextPinNumber(l),
    q = H.pinAt(l, { n, x: 0, y: 0, bone: boneId }, S.time);
  l.pins = [...(l.pins || []), { n, x: r2(q[0]), y: r2(q[1]), bone: boneId }];
  S.pinSel = n;
  ed.end({ insp: true });
}

/** Binds an existing pin to a bone where it is: it keeps its place and from then on follows the bone
 *  (its own keys no longer apply, so they go). The offset from the bone's joint, in the bone's own
 *  space, is solved from three probes of the engine (the map is affine). No undo step of its own. */
export function bindPinTo(l: Layer, n: number, boneId: string) {
  const p = (l.pins || []).find(q => q.n === n),
    B = layerById(boneId);
  if (!p || !B || B.type !== 'bone') return false;
  if (l.type === 'group' && descendants(l).includes(B)) return false;
  const at = (o: number[]) => H.pinAt(l, { n, x: 0, y: 0, bone: boneId, bo: o }, S.time),
    r0 = at([0, 0]),
    rx = at([1, 0]),
    ry = at([0, 1]),
    a = rx[0] - r0[0],
    b = ry[0] - r0[0],
    c = rx[1] - r0[1],
    d = ry[1] - r0[1],
    det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return false;
  // the pin's rest place (unbound pins rest at x, y)
  const tx = p.x - r0[0],
    ty = p.y - r0[1],
    o: [number, number] = [r3((d * tx - b * ty) / det), r3((-c * tx + a * ty) / det)];
  p.bone = boneId;
  if (Math.abs(o[0]) > 1e-3 || Math.abs(o[1]) > 1e-3) p.bo = o;
  else delete p.bo;
  ['pin' + n, 'pinr' + n].forEach(k => {
    delete l.t[k];
    if (l.ft) delete l.ft[k];
    delete (l.b as Record<string, any>)[k];
  });
  return true;
}
/** where pin n of layer l is now, in document coordinates */
export function pinDocPoint(l: Layer, n: number): { x: number; y: number } | null {
  const c = l && (l.pins || []).some(p => p.n === n) ? pinAt(l, n) : null;
  if (!c) return null;
  try {
    return xfp(pinMatrix(l), c[0], c[1]);
  } catch (_) {
    return null;
  }
}
/** Unbinds a pin from its bone: it stays where it rests now, as an ordinary pin. No undo step. */
export function unbindPin(l: Layer, n: number) {
  const p = (l.pins || []).find(q => q.n === n);
  if (!p || !p.bone) return false;
  const q = H.pinAt(l, p, S.time);
  p.x = r2(q[0]);
  p.y = r2(q[1]);
  delete p.bone;
  delete p.bo;
  return true;
}

/* ---------- overlay ---------- */

/** tools that show pins when Show pins is on (Alt+P); Edit nodes doesn't (it shows the rest shape) */
const SHOW_TOOLS = ['select', 'pin', 'pinedit', 'bone', 'boneedit', 'bonescale', 'bonebind'];
/** Pins on the canvas. The Pin tools show the selected layer's pins with everything for editing them
 *  (as before). With Show pins on, every pinned layer's pins show too: the selected layer's at full
 *  size, the others smaller and fainter. With the Select tool they can be dragged (bending the layer,
 *  keyed at the playhead) and clicked (selecting the pin, and its layer); with the Bind tool clicked
 *  to bind them to a bone. Pins bound to a bone are red everywhere. */
export function drawPins(u: number) {
  const pinTool = isPinTool(S.tool),
    cur = pinLayer(),
    // the Select tool edits the selected layer's pins as the Pin tool does (with Show pins on)
    edit = pinTool || (S.tool === 'select' && S.showPins && S.selSet.size === 1);
  if (edit && cur && cur.pins && cur.pins.length) drawEditPins(cur, u);
  pinLabel(u);
  if (!S.showPins || !SHOW_TOOLS.includes(S.tool)) return;
  const live = S.tool === 'select' || S.tool === 'bonebind';
  doc.layers.forEach(l => {
    if (!l.pins || !l.pins.length || (edit && l === cur) || isHidden(l) || !byId('e-' + l.id)) return;
    const mine = !pinTool && (l.id === S.sel || S.selSet.has(l.id));
    drawShownPins(l, u, mine, live && !isLocked(l));
  });
}
/** while a pin is dragged: what the drag does, beside the pointer */
function pinLabel(u: number) {
  if (S.drag && S.drag.lbl && S.drag.lp && S.drag.pin) {
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
/** a pinned layer's pins, shown (and, with `live`, picked) outside the Pin tools */
function drawShownPins(l: Layer, u: number, mine: boolean, live: boolean) {
  let M: DOMMatrix;
  try {
    M = pinMatrix(l);
  } catch (_) {
    return;
  }
  const picked = (n: number) => S.tool === 'bonebind' && (S.bindPins || []).some(q => q.lid === l.id && q.n === n);
  l.pins.forEach(p => {
    const c = pinAt(l, p.n);
    if (!c) return;
    const P = xfp(M, c[0], c[1]),
      bound = isBound(l, p.n),
      sel = mine && S.pinSel === p.n,
      r = (mine ? 5.5 : 4) * u,
      cls =
        'ov-pin' +
        (bound ? ' is-bound' : '') +
        (sel || picked(p.n) ? ' is-sel' : '') +
        (mine ? '' : ' is-other') +
        (live ? '' : ' is-static'),
      a: Record<string, any> = { cx: P.x, cy: P.y, r: sel ? 6 * u : r, class: cls };
    if (live) a['data-spin'] = l.id + ':' + p.n;
    if (bound)
      OV.append(svgEl('circle', { cx: P.x, cy: P.y, r: r + 4 * u, class: 'ov-pinbound' + (mine ? '' : ' is-other') }));
    OV.append(svgEl('circle', a));
    if (!sel && !picked(p.n))
      OV.append(
        svgEl('circle', {
          cx: P.x,
          cy: P.y,
          r: (mine ? 1.8 : 1.4) * u,
          class: 'ov-pindot' + (bound ? ' is-bound' : ''),
        }),
      );
  });
}
/** Select tool: a press on a shown pin selects it (and its layer) and drags it, bending the layer and
 *  keying the pin at the playhead; a pin bound to a bone is only picked (the bone moves it). */
export function shownPinDown(spin: string, p0: XY) {
  const [lid, ns] = spin.split(':'),
    l = layerById(lid),
    n = +ns;
  if (!l || isLocked(l) || !(l.pins || []).some(p => p.n === n)) return;
  if (S.sel !== l.id || S.selSet.size > 1) select(l.id);
  S.pinSel = n;
  S.pinFocus = true;
  if (isBound(l, n)) {
    drawOverlay();
    renderInspector();
    return;
  }
  renderInspector();
  pinDrag(l, n, p0, false);
}
/** the selected layer's pins with the Pin tools: mesh, rest marks, rotation ring */
function drawEditPins(l: Layer, u: number) {
  if (S.pinSel != null && !l.pins.some(p => p.n === S.pinSel)) S.pinSel = null;
  const M = pinMatrix(l);
  // the mesh, as it bends
  const tris = meshLines(l);
  if (tris.length) {
    const seen = new Set<string>();
    let d = '';
    tris.forEach(T =>
      T.forEach((a, i) => {
        const b = T[(i + 1) % 3],
          k = [a, b]
            .map(q => q.map(v => v.toFixed(2)).join(','))
            .sort()
            .join(' ');
        if (seen.has(k)) return;
        seen.add(k);
        d += `M${r2(a[0])} ${r2(a[1])}L${r2(b[0])} ${r2(b[1])}`;
      }),
    );
    OV.append(svgEl('path', { d, transform: mtx(M), class: 'ov-mesh' }));
  }
  // the artwork at rest, while it is bent
  if ((S.tool === 'pin' || S.tool === 'select') && bent(l)) {
    if (meshOf(l)) {
      const s = byId('e-' + l.id + '-s') as unknown as SVGGraphicsElement;
      try {
        const b = s.getBBox(),
          Q = gMatrix(l).inverse().multiply(localMatrix(l)),
          q = [
            [b.x, b.y],
            [b.x + b.width, b.y],
            [b.x + b.width, b.y + b.height],
            [b.x, b.y + b.height],
          ].map(([x, y]) => xfp(Q, x, y));
        OV.append(
          svgEl('path', {
            d: 'M' + q.map(p => `${r2(p.x)} ${r2(p.y)}`).join('L') + 'Z',
            transform: mtx(M),
            class: 'ov-pinout',
          }),
        );
      } catch (_) {
        /* not measurable */
      }
    } else {
      const was = H.restPins(true),
        d = H.comp(l, S.time).d;
      H.restPins(was);
      if (d) OV.append(svgEl('path', { d: H.dstr(d), transform: mtx(M), class: 'ov-pinout' }));
    }
  }
  l.pins.forEach(p => {
    const q = pinState(l, p.n),
      c = pinAt(l, p.n),
      P = xfp(M, c[0], c[1]),
      R = xfp(M, q[0], q[1]),
      sel = S.pinSel === p.n,
      bound = isBound(l, p.n);
    // a pin bound to a bone: a ring around it, and no rest mark or rotation ring (the bone moves it)
    if (bound) OV.append(svgEl('circle', { cx: P.x, cy: P.y, r: 9.5 * u, class: 'ov-pinbound' }));
    if (!bound && (S.tool === 'pin' || S.tool === 'select') && Math.hypot(P.x - R.x, P.y - R.y) > 0.5 / S.scale) {
      // where the pin sits at rest
      OV.append(svgEl('line', { x1: R.x, y1: R.y, x2: P.x, y2: P.y, class: 'ov-pinrest' }));
      OV.append(svgEl('circle', { cx: R.x, cy: R.y, r: 4 * u, class: 'ov-pinrest' }));
    }
    if (sel && (S.tool === 'pin' || S.tool === 'select') && !bound) {
      const a = (pinRot(l, p.n) * Math.PI) / 180,
        kx = P.x + RING * u * Math.cos(a),
        ky = P.y + RING * u * Math.sin(a);
      OV.append(svgEl('circle', { cx: P.x, cy: P.y, r: RING * u, class: 'ov-pinring' }));
      OV.append(svgEl('line', { x1: P.x, y1: P.y, x2: kx, y2: ky, class: 'ov-pinarm' }));
      OV.append(svgEl('circle', { cx: kx, cy: ky, r: 4.5 * u, class: 'ov-pinknob', 'data-pinring': p.n }));
    }
    const bc = bound ? ' is-bound' : '';
    if (sel) OV.append(svgEl('circle', { cx: P.x, cy: P.y, r: 6 * u, class: 'ov-pin is-sel' + bc, 'data-pin': p.n }));
    else {
      OV.append(svgEl('circle', { cx: P.x, cy: P.y, r: 5.5 * u, class: 'ov-pin' + bc, 'data-pin': p.n }));
      OV.append(svgEl('circle', { cx: P.x, cy: P.y, r: 1.8 * u, class: 'ov-pindot' + bc }));
    }
  });
}

/* ---------- editing ---------- */

/** a track for a pin property, made on its first drag: it starts from where the pin was at 0 s, so
 *  the drag animates from there to the playhead */
function ensureTrack(l: Layer, k: string) {
  if (l.t[k] && l.t[k].length) return;
  const v = clone(valueAt(l, k, S.time));
  l.t[k] =
    S.time > 0.0005
      ? [
          [0, clone(v), 'ease'],
          [r3(S.time), v, 'ease'],
        ]
      : [[0, v, 'ease']];
}
/** moves pin n at rest by (dx, dy): its keyed positions move with it, so its motion is kept */
function moveRest(l: Layer, n: number, dx: number, dy: number) {
  const p = l.pins.find(q => q.n === n),
    k = 'pin' + n;
  p.x = r2(p.x + dx);
  p.y = r2(p.y + dy);
  if (l.t[k]) l.t[k].forEach(q => (q[1] = [r2(q[1][0] + dx), r2(q[1][1] + dy)]));
  if (l.ft && l.ft[k]) l.ft[k].forEach(q => (q[1] = [r2(q[1][0] + dx), r2(q[1][1] + dy)]));
  const b = l.b as Record<string, any>;
  if (b[k]) b[k] = [r2(b[k][0] + dx), r2(b[k][1] + dy)];
}
export function removePin(l: Layer, n: number) {
  const ed = beginEdit();
  l.pins = l.pins.filter(p => p.n !== n);
  ['pin' + n, 'pinr' + n].forEach(k => {
    delete l.t[k];
    if (l.ft) delete l.ft[k];
    delete (l.b as Record<string, any>)[k];
  });
  if (!l.pins.length) {
    delete l.pins;
    delete l.reach;
    delete l.mesh;
  }
  if (S.pinSel === n) S.pinSel = null;
  ed.end({ insp: true });
}
export function removeAllPins(l: Layer) {
  const ed = beginEdit();
  (l.pins || []).forEach(p =>
    ['pin' + p.n, 'pinr' + p.n].forEach(k => {
      delete l.t[k];
      if (l.ft) delete l.ft[k];
      delete (l.b as Record<string, any>)[k];
    }),
  );
  delete l.pins;
  delete l.reach;
  delete l.mesh;
  S.pinSel = null;
  ed.end({ insp: true });
}
/** Delete / Backspace with a pin selected in the pin tools */
export function deleteSelectedPin() {
  // the Pin tools; with the Select tool, only right after a pin was picked (else Delete is the layer's)
  if (!(isPinTool(S.tool) || (S.tool === 'select' && S.pinFocus)) || S.pinSel == null) return false;
  const l = pinLayer();
  if (!l || !l.pins || !l.pins.some(p => p.n === S.pinSel)) return false;
  removePin(l, S.pinSel);
  return true;
}
/** rectangles and ellipses become paths first (pins bend a path through its nodes) */
function toPath(l: Layer) {
  if (l.type === 'rect' || l.type === 'ellipse') plainPath(l);
}
function addPin(l: Layer, p: XY) {
  const ed = beginEdit();
  toPath(l);
  if (S.sel !== l.id || S.selSet.size > 1) {
    S.sel = l.id;
    S.selSet = new Set<any>([l.id]);
  }
  const M = pinMatrix(l).inverse(),
    q = xfp(M, p.x, p.y),
    n = nextPinNumber(l);
  l.pins = [...(l.pins || []), { n, x: r2(q.x), y: r2(q.y) }];
  S.pinSel = n;
  ed.end({ insp: true });
}
/** A press on one of the selected layer's pins or on the selected pin's rotation ring (Pin tools, and
 *  the Select tool): pick it, then drag it (Alt: at rest) or turn it. Returns false when the press
 *  wasn't on one. */
export function pinHandleDown(e: PointerEvent, p0: XY): boolean {
  const t = e.target as any,
    ring = t.closest && t.closest('[data-pinring]'),
    pe = t.closest && t.closest('[data-pin]'),
    l = pinLayer();
  if (!(ring || pe) || !l || isLocked(l)) return false;
  const n = +(ring || pe).dataset[ring ? 'pinring' : 'pin'];
  S.pinSel = n;
  S.pinFocus = true;
  // a pin bound to a bone follows the bone: it can be picked (and deleted), not dragged
  if (isBound(l, n)) {
    drawOverlay();
    renderInspector();
    return true;
  }
  renderInspector();
  if (ring) rotateDrag(l, n, p0);
  else pinDrag(l, n, p0, S.tool === 'pinedit' || e.altKey);
  return true;
}
export function pinsDown(e: PointerEvent, p0: XY) {
  const t = e.target as any,
    bone = S.tool === 'pin' && S.pinBind && t.closest && t.closest('[data-bone]');
  if (bone) {
    const s = selLayer();
    if (s && pinnable(s) && !isLocked(s)) bindBone(s, bone.dataset.bone);
    return;
  }
  if (pinHandleDown(e, p0)) return;
  if (S.pinBind) return;
  if (S.tool === 'pinedit') {
    S.pinSel = null;
    drawOverlay();
    return;
  }
  // the Pin tool: a click on artwork adds a pin there. As with Select, a click picks the outermost
  // layer (Ctrl/Cmd picks inside groups), and the selected layer keeps the pins it is getting.
  const chain = hitChain(e.target)
      .map(id => layerById(id))
      .filter(x => x && pinnable(x)),
    sel = selLayer(),
    hit = sel && chain.includes(sel) ? sel : e.ctrlKey || e.metaKey ? chain[0] : chain[chain.length - 1];
  if (!hit) {
    S.pinSel = null;
    drawOverlay();
    return;
  }
  if (isLocked(hit)) return;
  addPin(hit, p0);
}
function pinDrag(l: Layer, n: number, p0: XY, rest: boolean) {
  const M = pinMatrix(l),
    Mi = M.inverse(),
    k = ('pin' + n) as PropKey,
    q0 = xfp(Mi, p0.x, p0.y),
    start = clone(pinAt(l, n)),
    ed = beginEdit();
  let moved = false,
    last = [0, 0];
  S.drag = {
    pin: true,
    move(p: XY, ev: PointerEvent) {
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) * S.scale < 3) return;
      const q = xfp(Mi, p.x, p.y);
      let dx = q.x - q0.x,
        dy = q.y - q0.y;
      if (ev.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (!moved && !rest) ensureTrack(l, k);
      moved = true;
      if (rest) {
        moveRest(l, n, dx - last[0], dy - last[1]);
        last = [dx, dy];
        S.drag.lbl = `Pin ${n} · rest moved`;
      } else {
        setProp(l, k, [r2(start[0] + dx), r2(start[1] + dy)]);
        S.drag.lbl = `Pin ${n} · key at ${fmt(S.time, 2)}s`;
      }
      S.drag.lp = p;
      frame();
    },
    up() {
      ed.end({ insp: true });
    },
  };
  drawOverlay();
}
function rotateDrag(l: Layer, n: number, p0: XY) {
  const M = pinMatrix(l),
    c = pinAt(l, n),
    C = xfp(M, c[0], c[1]),
    a0 = Math.atan2(p0.y - C.y, p0.x - C.x),
    r0 = pinRot(l, n),
    k = ('pinr' + n) as PropKey,
    ed = beginEdit();
  let moved = false;
  S.drag = {
    pin: true,
    move(p: XY, ev: PointerEvent) {
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) * S.scale < 3) return;
      if (!moved) ensureTrack(l, k);
      moved = true;
      let r = r0 + ((Math.atan2(p.y - C.y, p.x - C.x) - a0) * 180) / Math.PI;
      if (ev.shiftKey) r = Math.round(r / 15) * 15;
      setProp(l, k, r2(r));
      S.drag.lbl = `∠ ${fmt(r, 0).replace('-', '−')}°`;
      S.drag.lp = p;
      frame();
    },
    up() {
      ed.end({ insp: true });
    },
  };
  drawOverlay();
}
