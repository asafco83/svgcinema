// SVGcinema — tools/rig
// Rig-wide pose keys: with "Key whole rig" on (the default, set on the rig's top bone), posing any bone
// keys every bone of the rig at the playhead, so each pose is stored whole. Keys are inserted without
// changing the motion: the easing of the segment they split is split with them.
import type { Ease, Keyframe } from '../runtime/engine';
import type { Layer } from '../model/types';
import { DEFAULT_EASE, H, clone, r3 } from '../core/constants';
import { S, layerById } from '../core/state';
import { descendants } from '../model/tree';
import { beginEdit } from '../core/history';

const EPS = 0.004;
/** the top bone of the rig a bone belongs to (its bone ancestors, up to the first non-bone) */
export function rigRoot(b: Layer): Layer {
  let r = b,
    p = b.parent && layerById(b.parent),
    g = 0;
  while (p && p.type === 'bone' && g++ < 100) {
    r = p;
    p = p.parent && layerById(p.parent);
  }
  return r;
}
export function rigBones(root: Layer): Layer[] {
  return [root, ...descendants(root).filter(l => l.type === 'bone')];
}
/** "Key whole rig" is on unless the rig's top bone turns it off */
export function rigKeysOn(b: Layer) {
  return rigRoot(b).kr !== false;
}

/* ---------- inserting a key without changing the motion ---------- */

function bezPt(c: number[], s: number) {
  const u = 1 - s;
  return {
    x: 3 * u * u * s * c[0] + 3 * u * s * s * c[2] + s * s * s,
    y: 3 * u * u * s * c[1] + 3 * u * s * s * c[3] + s * s * s,
  };
}
/** splits a timing curve [x1, y1, x2, y2] at time fraction u: the two halves, each as a timing curve,
 *  or null when it can't be split exactly */
export function splitEase(e: Ease, u: number): [Ease, Ease] | null {
  if (!e || e === 'linear') return ['linear', 'linear'];
  if (e === 'hold') return ['hold', 'hold'];
  const c = typeof e === 'string' ? H.EZ[e] : e;
  if (!c || c.length !== 4) return null;
  // the curve parameter where x = u
  let lo = 0,
    hi = 1,
    s = u;
  for (let i = 0; i < 40; i++) {
    s = (lo + hi) / 2;
    if (bezPt(c, s).x < u) lo = s;
    else hi = s;
  }
  const P0 = { x: 0, y: 0 },
    P1 = { x: c[0], y: c[1] },
    P2 = { x: c[2], y: c[3] },
    P3 = { x: 1, y: 1 },
    L = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: a.x + (b.x - a.x) * s,
      y: a.y + (b.y - a.y) * s,
    }),
    A = L(P0, P1),
    B = L(P1, P2),
    C = L(P2, P3),
    D = L(A, B),
    E = L(B, C),
    M = L(D, E);
  if (Math.abs(M.y) < 1e-6 || Math.abs(1 - M.y) < 1e-6 || M.x < 1e-6 || 1 - M.x < 1e-6) return null;
  const q = (v: number) => Math.round(v * 1e4) / 1e4,
    left = [q(A.x / M.x), q(A.y / M.y), q(D.x / M.x), q(D.y / M.y)],
    right = [
      q((E.x - M.x) / (1 - M.x)),
      q((E.y - M.y) / (1 - M.y)),
      q((C.x - M.x) / (1 - M.x)),
      q((C.y - M.y) / (1 - M.y)),
    ];
  return [left, right];
}
/** adds a key at time t to a layer's track holding the value it has there; the motion stays the same
 *  (the eased segment is split in two). Returns the key at t. */
export function insertKey(l: Layer, k: string, t: number): Keyframe {
  const tr = l.t[k] as Keyframe[];
  const have = tr.find(q => Math.abs(q[0] - t) < EPS);
  if (have) return have;
  const v = clone(H.get(l, k, t)),
    i = tr.findIndex(q => q[0] > t);
  if (i < 0) {
    const q: Keyframe = [r3(t), v, DEFAULT_EASE];
    tr.push(q);
    return q;
  }
  if (i === 0) {
    const q: Keyframe = [r3(t), v, DEFAULT_EASE];
    tr.unshift(q);
    return q;
  }
  const a = tr[i - 1],
    b = tr[i],
    sp = splitEase(a[2], (t - a[0]) / (b[0] - a[0])),
    q: Keyframe = [r3(t), v, sp ? sp[1] : a[2]];
  if (sp) a[2] = sp[0];
  tr.splice(i, 0, q);
  return q;
}

/* ---------- pose keys ---------- */

/** keys every bone of `b`'s rig at the playhead for property k (rotation on every bone, scale and
 *  position on bones that already animate them), when the rig keys whole poses */
export function keyRig(b: Layer, k: 'rot' | 'scl' | 'pos') {
  if (!rigKeysOn(b)) return;
  rigBones(rigRoot(b)).forEach(x => {
    if (!(x.t[k] && x.t[k].length)) {
      if (k !== 'rot') return;
      x.t.rot = [[0, x.b.rot || 0, DEFAULT_EASE]];
    }
    insertKey(x, k, S.time);
  });
}
/** every key time of a rig, and whether some bone misses a key at one of them */
export function rigTimes(root: Layer) {
  const ts: number[] = [];
  rigBones(root).forEach(x =>
    (['rot', 'scl', 'pos'] as const).forEach(k =>
      (x.t[k] || []).forEach(q => {
        if (!ts.some(t => Math.abs(t - q[0]) < EPS)) ts.push(q[0]);
      }),
    ),
  );
  return ts.sort((a, b) => a - b);
}
function missing(x: Layer, k: string, ts: number[]) {
  const tr = x.t[k] || [];
  return ts.filter(t => !tr.some(q => Math.abs(q[0] - t) < EPS));
}
export function rigGaps(root: Layer) {
  const ts = rigTimes(root);
  if (ts.length < 1) return false;
  return rigBones(root).some(
    x => missing(x, 'rot', ts).length || (x.t.scl && x.t.scl.length && missing(x, 'scl', ts).length),
  );
}
/** adds the missing keys: every bone gets rotation (and its scale, if animated) at every key time */
export function fillRig(root: Layer) {
  const ts = rigTimes(root);
  rigBones(root).forEach(x => {
    if (!(x.t.rot && x.t.rot.length)) x.t.rot = [[0, x.b.rot || 0, DEFAULT_EASE]];
    missing(x, 'rot', ts).forEach(t => insertKey(x, 'rot', t));
    if (x.t.scl && x.t.scl.length) missing(x, 'scl', ts).forEach(t => insertKey(x, 'scl', t));
  });
}

/* ---------- the timeline's Pose row ---------- */

/** the top bones with a rig below them, for the Pose row under them in the timeline */
export function poseRowFor(l: Layer) {
  if (l.type !== 'bone') return null;
  if (l.parent && layerById(l.parent)?.type === 'bone') return null;
  const bones = rigBones(l);
  return bones.length > 1 ? bones : null;
}
/** the keys of a rig at time t (what a Pose diamond stands for) */
export function poseKeys(root: Layer, t: number): Keyframe[] {
  return rigBones(root).flatMap(x =>
    Object.values(x.t).flatMap(tr => (tr || []).filter(q => Math.abs(q[0] - t) < EPS)),
  ) as Keyframe[];
}
export function poseLabel(n: number) {
  return `Pose · ${n} bones`;
}

/* ---------- the popover offered when "Key whole rig" is turned on ---------- */

let popClose: (() => void) | null = null;
/** "Add keys to every bone?" under the Key whole rig checkbox. Add keys fills the poses as part of the
 *  same undo step as turning the switch on. */
export function rigPopover(root: Layer) {
  if (popClose) popClose();
  const box = document.getElementById('fl-kr'),
    lab = box && box.closest('label');
  if (!lab) return;
  const n = rigTimes(root).length,
    el = document.createElement('div');
  el.className = 'rig-pop';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Add rig keys');
  el.innerHTML = `<span class="rig-pop-arrow" aria-hidden="true"></span><p class="rp-t">Add keys to every bone?</p><p class="rp-d">This rig has keyframes on some bones only. Every bone gets a key at each of the rig’s ${n} key times, holding its current value, so nothing moves.</p><div class="rp-b"><button type="button" class="btn" data-rp="no">Not now</button><button type="button" class="btn pri" data-rp="yes">Add keys</button></div>`;
  document.body.appendChild(el);
  const r = lab.getBoundingClientRect();
  el.style.left = Math.round(r.left + 6) + 'px';
  el.style.top = Math.round(r.bottom + 8) + 'px';
  const close = () => {
    el.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc, true);
    document.removeEventListener('scroll', close, true);
    popClose = null;
  };
  const outside = (e: Event) => {
    if (!el.contains(e.target as Node)) close();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rp]');
    if (!b) return;
    if (b.dataset.rp === 'yes') fillAsOneStep(root);
    close();
  });
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
    // it stays under its checkbox: scrolling the panel closes it
    document.addEventListener('scroll', close, true);
  });
  popClose = close;
  (el.querySelector('[data-rp="yes"]') as HTMLElement).focus();
}
/** fills the rig's poses and folds that into the undo step that turned the switch on */
function fillAsOneStep(root: Layer) {
  const n = S.undo.length,
    ed = beginEdit();
  fillRig(root);
  ed.end({ insp: true });
  if (S.undo.length > n && n > 0) S.undo.pop();
}
