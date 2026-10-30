// SVGcinema — help/topics/rigging: Rigging (scenes and tour steps; the words are in help/content.json)
import type { Layer } from '../../model/types';
import { S, doc, layerById, mkLayer } from '../../core/state';
import { H, NOFILL, r2 } from '../../core/constants';
import { select, setTool } from '../../core/history';
import { drawOverlay } from '../../render/overlay';
import { bonePts, boneTipL, keyRestRot } from '../../tools/bones';
import { restMat } from '../../tools/bone-edit';
import { pinMatrix } from '../../tools/pins';
import { drawOrder, rigArtwork } from '../../model/draw-order';
import { MESH_DEFAULT } from '../../model/mesh';
import { rigTimes } from '../../tools/rig';
import { moveLayers } from '../../ui/layers-panel';
import { centre, click, drag, hold, moveTo, press, type, type XY } from '../ghost';
import {
  type Scene,
  type TourStep,
  allLayers,
  artboard,
  byName,
  keyAt,
  lock,
  lpRow,
  onRuler,
  pause,
  playStep,
  playheadStep,
  q,
  screenBox,
  screenOf,
  svg640,
  trackBits,
} from '../kit';

/* ---------- helpers ---------- */

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** a click on the canvas at a screen point (a press and a release without moving) */
const tap = (p: XY) => drag(p, p, { ms: 120 });
const tool = (t: string) => {
  if (S.tool !== t) setTool(t as any);
};
const pick = (l: Layer | null) => {
  if (l && (S.sel !== l.id || S.selSet.size > 1)) select(l.id);
};
/** a rounded bar from a to b (an arm's part), as path data */
function capsule(a: number[], b: number[], r: number) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    L = Math.hypot(dx, dy),
    nx = (-dy / L) * r,
    ny = (dx / L) * r,
    p = (x: number, y: number) => `${r2(x)} ${r2(y)}`;
  return `M${p(a[0] + nx, a[1] + ny)}L${p(b[0] + nx, b[1] + ny)}A${r} ${r} 0 0 0 ${p(b[0] - nx, b[1] - ny)}L${p(a[0] - nx, a[1] - ny)}A${r} ${r} 0 0 0 ${p(a[0] + nx, a[1] + ny)}Z`;
}
const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;

const bones = () => allLayers().filter(l => l.type === 'bone');
const isBone = (l: Layer | null | undefined) => !!l && l.type === 'bone';
/** the rig's top bone (the first bone that doesn't hang on another) */
const topBone = () => bones().find(b => !isBone(b.parent && layerById(b.parent))) || null;
/** the bone hanging on b (its first child bone) */
const childBone = (b: Layer | null) => (b ? bones().find(x => x.parent === b.id) || null : null);
const onBone = (l: Layer | null) => !!l && isBone(l.parent && layerById(l.parent));
/** a bone's Rotate at the playhead */
const rotOf = (b: Layer | null) => (b ? (H.get(b, 'rot', S.time) as number) : 0);

/** a point on a bone, as a fraction of the way from its joint to its tip (screen) */
function alongBone(b: Layer | null, f = 0.4): XY {
  const p = b && bonePts(b);
  if (!p) return screenOf(320, 200);
  return screenOf(p.J.x + (p.T.x - p.J.x) * f, p.J.y + (p.T.y - p.J.y) * f);
}
/** a bone's tip (screen) */
function tipOf(b: Layer | null): XY {
  const p = b && bonePts(b);
  return p ? screenOf(p.T.x, p.T.y) : screenOf(320, 200);
}
/** a point on a bone turned by `deg` around the bone's joint (screen): where an FK drag goes */
function turned(b: Layer | null, f: number, deg: number): XY {
  const p = b && bonePts(b);
  if (!p) return screenOf(320, 200);
  const a = (deg * Math.PI) / 180,
    dx = (p.T.x - p.J.x) * f,
    dy = (p.T.y - p.J.y) * f;
  return screenOf(p.J.x + dx * Math.cos(a) - dy * Math.sin(a), p.J.y + dx * Math.sin(a) + dy * Math.cos(a));
}
/** the bone's body on the canvas (what a step lights) */
const boneEl = (b: Layer | null) => (b ? q(`#overlay [data-bone="${b.id}"][data-part="body"]`) : null);
const tipEl = (b: Layer | null) => (b ? q(`#overlay [data-bone="${b.id}"][data-part="tip"]`) : null);
const bonesBtn = () => q('#tools [data-group="bones"]');
const pinsBtn = () => q('#tools [data-group="pins"]');
/** the practice editor uses the person's own view settings: these steps need the bones (and pins) shown */
function showRig() {
  if (!S.showBones || !S.showPins) {
    S.showBones = true;
    S.showPins = true;
    drawOverlay();
  }
}

/** A bone drawn from a to b, as the Bone tool draws one (a Rotate key at 0 s holds its rest pose). */
function addBone(name: string, a: number[], b: number[], parent: Layer | null) {
  const l = mkLayer(
    'bone',
    name,
    {
      x: a[0],
      y: a[1],
      len: r2(Math.hypot(b[0] - a[0], b[1] - a[1])),
      ang: r2((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI),
    },
    NOFILL,
  );
  l.o = [a[0], a[1]];
  l.parent = parent ? parent.id : null;
  keyRestRot(l);
  doc.layers.push(l);
  if (parent) S.lexp[parent.id] = true;
  return l;
}
/** attaches a layer to a bone the way the Layers panel and Attach to bone do */
function attach(name: string, b: Layer | null) {
  const l = byName(name);
  if (l && b && l.parent !== b.id) moveLayers([l.id], b, 'into');
}

/* ---------- the arm (Build a rig, Pose and animate a rig, Limits and IK stops) ---------- */

/** shoulder, elbow, wrist and fingertips */
const SH = [250, 150],
  EL = [350, 230],
  WR = [462, 206],
  FT = [522, 196];
const PAPER = `<rect id="Paper" width="640" height="400" fill="#f4efe6"/>`;
const BODY = `<path id="Body" d="M150 340V170c0-30 20-50 50-50h20c30 0 50 20 50 50v170z" fill="#3f5bd8"/>
<circle id="Head" cx="210" cy="72" r="40" fill="#f2c9a0"/>`;
/** the arm in two parts: the hand is drawn with the forearm */
const ARM2 = svg640(
  `${PAPER}
${BODY}
<path id="Forearm" d="${capsule(EL, WR, 17)}${circle(WR[0] + 12, WR[1] - 3, 25)}" fill="#f2c9a0"/>
<path id="Upper arm" d="${capsule(SH, EL, 23)}" fill="#5b7cfa"/>`,
  false,
);
/** the arm in three parts, for a chain of three bones */
const ARM3 = svg640(
  `${PAPER}
${BODY}
<path id="Hand" d="${circle(WR[0] + 18, WR[1] - 3, 25)}" fill="#f2c9a0"/>
<path id="Forearm" d="${capsule(EL, WR, 17)}" fill="#f2c9a0"/>
<path id="Upper arm" d="${capsule(SH, EL, 23)}" fill="#5b7cfa"/>`,
  false,
);
/** the rig Build a rig makes: Bone 1 carries the upper arm, Bone 2 (on Bone 1's tip) the forearm */
function armRig(three: boolean) {
  const b1 = addBone('Bone 1', SH, EL, null),
    b2 = addBone('Bone 2', EL, WR, b1),
    b3 = three ? addBone('Bone 3', WR, FT, b2) : null;
  attach('Upper arm', b1);
  attach('Forearm', b2);
  if (b3) attach('Hand', b3);
}
const armBox = () => screenBox(140, 20, 420, 330);

/** Build a rig: when the person's own bones aren't there (they did a step their own way), the bones the
 *  steps before make */
function ensureBones() {
  let b1 = topBone();
  if (!b1) b1 = addBone('Bone 1', SH, EL, null);
  if (!childBone(b1)) {
    const p = bonePts(b1);
    addBone('Bone ' + (bones().length + 1), p ? [r2(p.T.x), r2(p.T.y)] : EL, WR, b1);
  }
  drawOverlay();
  return [b1, childBone(b1)!] as const;
}

/* ---------- Pose and animate a rig ---------- */

/** the rig's pose times, as the Pose row shows them */
/** the Pose row's diamonds (a pose step's clip shows the keys it makes) */
const poseDots = () => Array.from(document.querySelectorAll('#tlbody .sdot.pose'));
const poses = () => {
  const b = byName('Bone 1');
  return b ? rigTimes(b) : [];
};
/** the Pose row's diamond for the last pose */
function lastPoseDot(): Element | null {
  const b = byName('Bone 1');
  if (!b) return null;
  const ds = Array.from(document.querySelectorAll(`#tlbody .tl-pose[data-lid="${b.id}"] .sdot.pose`));
  let best: Element | null = null,
    t = -1;
  ds.forEach(d => {
    const v = +(d as HTMLElement).dataset.t!;
    if (v > t) {
      t = v;
      best = d;
    }
  });
  return best;
}
/** a whole pose at time t (every bone keyed), when the person skipped making it */
function ensurePose(t: number, r1: number, r2v: number) {
  const b1 = byName('Bone 1'),
    b2 = byName('Bone 2');
  if (!b1 || !b2 || (keyAt(b1, 'rot', t) && keyAt(b2, 'rot', t))) return;
  [
    [b1, r1],
    [b2, r2v],
  ].forEach(([b, v]: any) => {
    const tr = b.t.rot || (b.t.rot = [[0, 0, 'linear']]);
    if (!tr.some((k: any) => Math.abs(k[0] - t) < 0.05)) tr.push([t, v, 'linear']);
    tr.sort((a: any, c: any) => a[0] - c[0]);
  });
}

/* ---------- Pins and mesh warp ---------- */

const flag = () => byName('Flag');
const FLAG_AT = { x: 206, y: 90, w: 280, h: 168 };
const flagBox = () => screenBox(170, 60, 340, 280);
/** the flag's pin furthest from the pole */
function farPin(): number | null {
  const l = flag();
  if (!l || !l.pins || !l.pins.length) return null;
  return l.pins.reduce((a, p) => (p.x > a.x ? p : a), l.pins[0]).n;
}
/** the pins the steps before put on the flag, when the person's own aren't there */
function ensureFlagPins(k: number) {
  const l = flag();
  if (!l) return;
  const ps = l.pins || [];
  if (ps.length >= k) return;
  const at = [
    [222, 174],
    [470, 174],
  ].slice(ps.length, k);
  let n = ps.reduce((m, p) => Math.max(m, p.n), 0);
  l.pins = [...ps, ...at.map(([x, y]) => ({ n: ++n, x, y }))];
  select(l.id);
}
const pinEl = (n: number | null) => (n == null ? null : q(`#overlay [data-pin="${n}"]`));

/* ---------- Pins that follow bones ---------- */

const worm = () => byName('Worm');
/** the worm's outline: a tapered body with a round head on the right */
function wormD() {
  const top: number[][] = [],
    bot: number[][] = [];
  for (let x = 100; x <= 500; x += 16) {
    const k = (x - 100) / 400,
      h = 8 + 14 * Math.sqrt(k);
    top.push([x, 270 - h]);
    bot.push([x, 270 + h]);
  }
  const head: number[][] = [];
  for (let i = 1; i < 12; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 12;
    head.push([500 + 22 * Math.cos(a), 270 + 22 * Math.sin(a)]);
  }
  const pts = [...top, ...head, ...bot.reverse()];
  return 'M' + pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L') + 'Z';
}
const WORM_BONES = [
  [118, 270],
  [250, 270],
  [380, 270],
  [505, 270],
];
const wormBox = () => screenBox(80, 170, 480, 200);
const boundCount = () => ((worm() && worm()!.pins) || []).filter(p => p.bone && layerById(p.bone)).length;

export const scenes: Record<string, Scene> = {
  // Build a rig: an arm in two parts beside a body, no bones yet
  'rig-build': {
    name: 'Practice: build a rig',
    svg: ARM2,
    setup() {
      lock('Paper', 'Body', 'Head');
    },
  },
  // Pose and animate a rig: the same arm, rigged (what Build a rig makes)
  'rig-pose': {
    name: 'Practice: pose and animate a rig',
    svg: ARM2,
    tl: 230,
    setup() {
      lock('Paper', 'Body', 'Head');
      armRig(false);
    },
  },
  // Limits and IK stops: the arm in three parts, on a chain of three bones
  'rig-limits': {
    name: 'Practice: limits and IK stops',
    svg: ARM3,
    setup() {
      lock('Paper', 'Body', 'Head');
      armRig(true);
    },
  },
  // Pins and mesh warp: a striped flag (a group, so it bends through a mesh) on a pole
  pins: {
    name: 'Practice: pins and mesh warp',
    svg: svg640(`<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>
<rect id="Pole" x="194" y="78" width="10" height="290" rx="4" fill="#d9d3c7"/>
<g id="Flag">
<rect id="Top stripe" x="${FLAG_AT.x}" y="${FLAG_AT.y}" width="${FLAG_AT.w}" height="56" fill="#ff6b6b"/>
<rect id="Middle stripe" x="${FLAG_AT.x}" y="${FLAG_AT.y + 56}" width="${FLAG_AT.w}" height="56" fill="#ffffff"/>
<rect id="Bottom stripe" x="${FLAG_AT.x}" y="${FLAG_AT.y + 112}" width="${FLAG_AT.w}" height="56" fill="#ffd36e"/>
</g>`),
    setup() {
      lock('Sky', 'Hills', 'Pole');
    },
  },
  // Pins that follow bones: a worm, and a chain of three bones along it that already wiggles
  'pins-bones': {
    name: 'Practice: pins that follow bones',
    svg: svg640(`<path id="Ground" d="M0 292h640v108H0z" fill="#1f2b5c"/>
<path id="Worm" d="${wormD()}" fill="#ff8fb1"/>`),
    setup() {
      lock('Sky', 'Ground');
      const b1 = addBone('Bone 1', WORM_BONES[0], WORM_BONES[1], null),
        b2 = addBone('Bone 2', WORM_BONES[1], WORM_BONES[2], b1),
        b3 = addBone('Bone 3', WORM_BONES[2], WORM_BONES[3], b2);
      // whole poses (every bone keyed at the same times): a wiggle that ends where it starts
      const wig = (a: number) =>
        [
          [0, 0, 'inOutSine'],
          [0.75, a, 'inOutSine'],
          [1.5, 0, 'inOutSine'],
          [2.25, -a, 'inOutSine'],
          [3, 0, 'inOutSine'],
        ] as any;
      b1.t.rot = wig(-8);
      b2.t.rot = wig(18);
      b3.t.rot = wig(-22);
    },
  },
};

export const tours: Record<string, TourStep[]> = {
  'rig-build': [
    // B: the Bone tool
    {
      target: () => bonesBtn(),
      enter: () => {
        showRig();
        if (S.tool === 'bone') setTool('select');
      },
      done: () => S.tool === 'bone',
      show: () => press('B', 'b', 'KeyB'),
    },
    // drag from the shoulder to the elbow
    {
      target: () => q('#wrap'),
      enter: c => {
        showRig();
        tool('bone');
        c.n = bones().length;
      },
      done: c => bones().length > c.n,
      show: () => drag(screenOf(SH[0], SH[1]), screenOf(EL[0], EL[1]), { ms: 900 }),
      clip: () => [armBox()],
    },
    // start on its tip: a chained bone
    {
      target: () => q('#wrap'),
      enter: c => {
        showRig();
        tool('bone');
        if (!topBone()) addBone('Bone 1', SH, EL, null);
        drawOverlay();
        c.n = bones().filter(b => onBone(b)).length;
      },
      done: c => bones().filter(b => onBone(b)).length > c.n,
      show: () => drag(tipOf(topBone()), screenOf(WR[0], WR[1]), { ms: 900 }),
      clip: () => [armBox()],
    },
    // hold the bones button: Bind tool
    {
      target: () => {
        const f = q('#toolfly');
        return f && !(f as HTMLElement).hidden ? f : bonesBtn();
      },
      enter: () => {
        showRig();
        ensureBones();
        if (S.tool === 'bonebind') setTool('bone');
      },
      done: () => S.tool === 'bonebind',
      show: () => hold(bonesBtn(), () => q('#toolfly [data-tool="bonebind"]')),
    },
    // the upper arm on Bone 1
    {
      target: () => q('#wrap'),
      enter: () => {
        showRig();
        ensureBones();
        tool('bonebind');
      },
      done: () => onBone(byName('Upper arm')),
      show: async () => {
        // the upper arm beside its bone (the bone lies along its middle), then the bone
        await tap(screenOf(300 - 0.62 * 15, 190 + 0.78 * 15));
        await tap(alongBone(topBone(), 0.3));
      },
      clip: () => [armBox(), lpRow('Upper arm')],
    },
    // the forearm on Bone 2
    {
      target: () => q('#wrap'),
      enter: () => {
        showRig();
        const [b1] = ensureBones();
        attach('Upper arm', b1);
        tool('bonebind');
      },
      done: () => onBone(byName('Forearm')),
      show: async () => {
        await tap(screenOf(406 + 0.21 * 11, 218 + 0.98 * 11));
        await tap(alongBone(childBone(topBone()), 0.3));
      },
      clip: () => [armBox(), lpRow('Forearm')],
    },
    // V, then turn Bone 2
    {
      target: () => q('#wrap'),
      enter: c => {
        showRig();
        const [b1, b2] = ensureBones();
        attach('Upper arm', b1);
        attach('Forearm', b2);
        c.r = rotOf(b2);
      },
      done: c => S.tool === 'select' && Math.abs(rotOf(childBone(topBone())) - c.r) > 5,
      show: async () => {
        await press('V', 'v', 'KeyV');
        const b2 = childBone(topBone());
        await drag(alongBone(b2, 0.75), turned(b2, 0.75, -40), { ms: 1000 });
      },
      clip: () => [armBox()],
    },
  ],

  'rig-pose': [
    {
      ...playheadStep(1),
      enter: () => {
        showRig();
        pause();
        tool('select');
      },
    },
    // FK: turn Bone 1, the arm follows
    {
      target: () => boneEl(byName('Bone 1')),
      enter: () => {
        showRig();
        tool('select');
      },
      done: () => {
        const b = byName('Bone 1');
        return keyAt(b, 'rot', 1) && Math.abs(H.get(b!, 'rot', 1) as number) > 3;
      },
      show: () => {
        const b = byName('Bone 1');
        return drag(alongBone(b, 0.6), turned(b, 0.6, -32), { ms: 1000 });
      },
      clip: () => [armBox(), ...poseDots()],
    },
    playheadStep(2),
    // IK: drag the end of the chain
    {
      target: () => tipEl(byName('Bone 2')),
      enter: () => {
        showRig();
        tool('select');
        ensurePose(1, -32, 0);
      },
      done: () => keyAt(byName('Bone 1'), 'rot', 2) && keyAt(byName('Bone 2'), 'rot', 2),
      show: () => drag(tipOf(byName('Bone 2')), screenOf(438, 104), { ms: 1100 }),
      clip: () => [armBox(), ...poseDots()],
    },
    // the Pose row: drag the last pose later
    {
      target: () => lastPoseDot(),
      enter: c => {
        showRig();
        tool('select');
        ensurePose(1, -32, 0);
        ensurePose(2, -62, -38);
        const b = byName('Bone 1');
        if (b) S.exp[b.id] = true;
        const ts = poses();
        c.last = ts.length ? ts[ts.length - 1] : 0;
        c.n = ts.length;
      },
      done: c => {
        const ts = poses();
        return ts.length === c.n && ts[ts.length - 1] > c.last + 0.2;
      },
      show: async () => {
        const d = lastPoseDot();
        if (!d) return;
        const a = centre(d);
        await drag(a, { x: onRuler(2.5).x, y: a.y }, { ms: 800 });
      },
      clip: () => {
        const b = byName('Bone 1');
        return [
          b && q(`#tlbody .tl-pose[data-lid="${b.id}"] .tl-name`),
          ...Array.from(document.querySelectorAll('#tlbody .sdot.pose')),
          ...trackBits(b, 'rot'),
          ...trackBits(byName('Bone 2'), 'rot'),
        ];
      },
    },
    playStep(),
  ],

  'rig-limits': [
    // click Bone 2
    {
      target: () => boneEl(byName('Bone 2')),
      enter: () => {
        showRig();
        tool('select');
        select(null);
      },
      done: () => S.sel === byName('Bone 2')?.id,
      show: () => tap(alongBone(byName('Bone 2'), 0.35)),
      clip: () => [armBox()],
    },
    // Limit rotation
    {
      target: () => q('#fl-lim')?.closest('label') || null,
      enter: () => {
        tool('select');
        pick(byName('Bone 2'));
        q('#fl-lim')?.scrollIntoView({ block: 'nearest' });
      },
      done: () => !!byName('Bone 2')?.lim,
      show: () => click(q('#fl-lim')),
    },
    // max 0: it bends one way only
    {
      target: () => q('#bl-max')?.closest('.row') || null,
      enter: () => {
        tool('select');
        const b = byName('Bone 2');
        pick(b);
        if (b && !b.lim) {
          b.lim = true;
          b.lmin = b.lmin ?? -90;
          b.lmax = b.lmax ?? 90;
          select(b.id);
        }
        q('#bl-max')?.scrollIntoView({ block: 'nearest' });
      },
      done: () => {
        const b = byName('Bone 2');
        return !!b && !!b.lim && b.lmax != null && b.lmax < 90;
      },
      show: () => type(q('#bl-max') as HTMLInputElement, '0'),
    },
    // IK: the elbow keeps to its range, the shoulder turns instead
    {
      target: () => tipEl(byName('Bone 3')),
      enter: c => {
        showRig();
        tool('select');
        c.r = ['Bone 1', 'Bone 2', 'Bone 3'].map(n => rotOf(byName(n)));
      },
      done: c => ['Bone 1', 'Bone 2', 'Bone 3'].some((n, i) => Math.abs(rotOf(byName(n)) - c.r[i]) > 3),
      show: () => drag(tipOf(byName('Bone 3')), screenOf(560, 330), { ms: 1100 }),
      clip: () => [armBox()],
    },
    // Bone 2 becomes an IK stop
    {
      target: () => {
        const b = byName('Bone 2');
        return S.sel === b?.id ? q('#fl-pin')?.closest('label') || null : boneEl(b);
      },
      enter: () => {
        showRig();
        tool('select');
      },
      done: () => !!byName('Bone 2')?.pin,
      show: async () => {
        const b = byName('Bone 2');
        if (S.sel !== b?.id) await tap(alongBone(b, 0.35));
        await wait(200);
        const f = q('#fl-pin');
        if (f) f.scrollIntoView({ block: 'nearest' });
        await click(q('#fl-pin'));
      },
      clip: () => [boneEl(byName('Bone 2'))],
    },
    // IK again: the upper arm stays
    {
      target: () => tipEl(byName('Bone 3')),
      enter: c => {
        showRig();
        tool('select');
        const b = byName('Bone 2');
        if (b && !b.pin) b.pin = true;
        drawOverlay();
        c.r = ['Bone 1', 'Bone 2', 'Bone 3'].map(n => rotOf(byName(n)));
      },
      done: c =>
        Math.abs(rotOf(byName('Bone 1')) - c.r[0]) < 0.01 &&
        ['Bone 2', 'Bone 3'].some((n, i) => Math.abs(rotOf(byName(n)) - c.r[i + 1]) > 3),
      show: () => drag(tipOf(byName('Bone 3')), screenOf(420, 150), { ms: 1100 }),
      clip: () => [armBox()],
    },
  ],

  pins: [
    // W: the Pin tool
    {
      target: () => pinsBtn(),
      enter: () => {
        showRig();
        if (S.tool === 'pin') setTool('select');
      },
      done: () => S.tool === 'pin',
      show: () => press('W', 'w', 'KeyW'),
    },
    // a pin by the pole
    {
      target: () => q('#wrap'),
      enter: () => {
        showRig();
        tool('pin');
      },
      done: () => !!(flag()?.pins || []).length,
      show: () => tap(screenOf(222, 174)),
      clip: () => [flagBox()],
    },
    // a pin at the free end
    {
      target: () => q('#wrap'),
      enter: () => {
        showRig();
        tool('pin');
        pick(flag());
        ensureFlagPins(1);
      },
      done: () => (flag()?.pins || []).length >= 2,
      show: () => tap(screenOf(470, 174)),
      clip: () => [flagBox()],
    },
    {
      ...playheadStep(1.5),
      enter: () => {
        tool('pin');
        pick(flag());
      },
    },
    // drag the free end's pin: the flag bends, keyed at the playhead
    {
      target: () => pinEl(farPin()),
      enter: () => {
        showRig();
        tool('pin');
        const l = flag();
        ensureFlagPins(2);
        pick(l);
        drawOverlay();
      },
      done: () => {
        const l = flag();
        return !!l && (l.pins || []).some(p => keyAt(l, 'pin' + p.n, 1.5));
      },
      show: async () => {
        const e = pinEl(farPin());
        if (!e) return;
        const a = centre(e),
          b = screenOf(452, 236);
        await drag(a, b, { ms: 1000 });
      },
      clip: () => [flagBox(), ...trackBits(flag(), 'pin' + farPin())],
    },
    playStep(),
  ],

  'pins-bones': [
    // select the worm (beside its bones, which lie along its middle)
    {
      target: () => q('#wrap'),
      enter: () => {
        showRig();
        tool('select');
        select(null);
      },
      done: () => S.sel === worm()?.id && S.selSet.size === 1,
      show: () => tap(screenOf(315, 284)),
      clip: () => [wormBox()],
    },
    // W
    {
      target: () => pinsBtn(),
      enter: () => {
        showRig();
        if (S.tool === 'pin') setTool('select');
        pick(worm());
      },
      done: () => S.tool === 'pin',
      show: () => press('W', 'w', 'KeyW'),
    },
    // Bind to bones, above the canvas
    {
      target: () => q('#boneOpts [data-pbind]'),
      enter: () => {
        showRig();
        tool('pin');
        pick(worm());
        if (S.pinBind) S.pinBind = false;
        drawOverlay();
      },
      done: () => S.tool === 'pin' && !!S.pinBind,
      show: () => click(q('#boneOpts [data-pbind]')),
    },
    // click each bone: a pin at its joint that follows it
    {
      target: () => q('#wrap'),
      enter: () => {
        showRig();
        tool('pin');
        pick(worm());
        if (!S.pinBind) S.pinBind = true;
        drawOverlay();
      },
      done: () => boundCount() >= 3,
      show: async () => {
        for (const n of ['Bone 1', 'Bone 2', 'Bone 3']) {
          const b = byName(n),
            w = worm();
          if (b && w && (w.pins || []).some(p => p.bone === b.id)) continue;
          await tap(alongBone(b, 0.45));
        }
      },
      clip: () => [wormBox()],
    },
    {
      ...playStep(),
      clip: () => [artboard()],
    },
  ],
};

/* ---------- Edit bone tool ---------- */

/** a bone's rest pose matrix on the canvas (its base values, up its chain of bones) */
function restWorld(b: Layer): DOMMatrix {
  const p = b.parent ? layerById(b.parent) : null;
  return (p && p.type === 'bone' ? restWorld(p) : new DOMMatrix()).multiply(restMat(b));
}
/** a bone's joint and tip at rest (document units) */
function restPts(b: Layer | null) {
  if (!b) return null;
  const M = restWorld(b),
    tl = boneTipL(b.geo),
    J = new DOMPoint(b.geo.x, b.geo.y).matrixTransform(M),
    T = new DOMPoint(tl[0], tl[1]).matrixTransform(M);
  return { J, T };
}
const restJoint = (b: Layer | null): XY => {
  const p = restPts(b);
  return p ? screenOf(p.J.x, p.J.y) : screenOf(320, 200);
};
const restTip = (b: Layer | null): XY => {
  const p = restPts(b);
  return p ? screenOf(p.T.x, p.T.y) : screenOf(320, 200);
};
const dist = (p: { x: number; y: number } | undefined | null, q: number[]) =>
  p ? Math.hypot(p.x - q[0], p.y - q[1]) : Infinity;
const jointEl = (b: Layer | null) => (b ? q(`#overlay [data-bone="${b.id}"][data-part="joint"]`) : null);
/** the arm with bones drawn a little off: Bone 1 starts below the shoulder and ends short of the elbow, Bone 2
 *  (on its tip) reaches past the wrist. Both already wave (whole poses). */
const OFF_J = [270, 172],
  OFF_E = [322, 206],
  OFF_W = [506, 196];

/* ---------- Scale bone tool ---------- */

/** the flower: a stem on Bone 1 (from the ground up), the flower head on Bone 2 (on its tip) */
const ROOT = [320, 330],
  NECK = [320, 214],
  HEADTIP = [320, 150];
const petals = () => {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 2;
    d += circle(r2(320 + 22 * Math.cos(a)), r2(176 + 22 * Math.sin(a)), 16);
  }
  return d;
};
const flowerBox = () => screenBox(200, 30, 240, 320);
const sclOf = (b: Layer | null) => (b ? (H.get(b, 'scl', S.time) as number[]) || [1, 1] : [1, 1]);
const scaleOpt = (m: string) => q(`#boneOpts [data-bsm="${m}"]`);

/* ---------- Edit pins tool ---------- */

/** the flag's pins: Pin 1 by the pole, Pin 2 in the middle (it swings down at 1.5 s) */
const MID_PIN = [346, 174],
  END_PIN = [470, 174];
const pin2 = () => (flag()?.pins || []).find(p => p.n === 2) || null;

Object.assign(scenes, {
  // Edit bone tool: the arm of Build a rig, rigged with bones drawn a little off, already waving
  'bone-edit': {
    name: 'Practice: edit bone tool',
    svg: ARM2,
    setup() {
      lock('Paper', 'Body', 'Head');
      const b1 = addBone('Bone 1', OFF_J, OFF_E, null),
        b2 = addBone('Bone 2', OFF_E, OFF_W, b1);
      attach('Upper arm', b1);
      attach('Forearm', b2);
      const wave = (a: number) =>
        [
          [0, 0, 'inOutSine'],
          [1.5, a, 'inOutSine'],
          [3, 0, 'inOutSine'],
        ] as any;
      b1.t.rot = wave(-30);
      b2.t.rot = wave(-50);
    },
  },
  // Scale bone tool: a flower on two bones (the stem's bone carries the flower's bone on its tip)
  'bone-scale': {
    name: 'Practice: scale bone tool',
    svg: svg640(`<path id="Ground" d="M0 330h640v70H0z" fill="#1f2b5c"/>
<path id="Leaf" d="M328 290c16-24 48-30 64-20c-14 22-44 30-64 20z" fill="#5fbf7a"/>
<path id="Stem" d="M309 330V214a11 11 0 0 1 22 0V330z" fill="#3e9a5a"/>
<path id="Petals" d="${petals()}" fill="#ff8fb1"/>
<circle id="Centre" cx="320" cy="176" r="14" fill="#ffd36e"/>`),
    setup() {
      lock('Sky', 'Ground');
      const b1 = addBone('Bone 1', ROOT, NECK, null),
        b2 = addBone('Bone 2', NECK, HEADTIP, b1);
      attach('Stem', b1);
      attach('Leaf', b1);
      attach('Petals', b2);
      attach('Centre', b2);
    },
  },
  // Edit pins tool: the flag of Pins and mesh warp, with a pin in the wrong place (the middle)
  'pins-edit': {
    name: 'Practice: edit pins tool',
    svg: scenes.pins.svg,
    setup() {
      lock('Sky', 'Hills', 'Pole');
      const l = byName('Flag');
      if (!l) return;
      l.pins = [
        { n: 1, x: 222, y: 174 },
        { n: 2, x: MID_PIN[0], y: MID_PIN[1] },
      ];
      l.t.pin2 = [
        [0, [MID_PIN[0], MID_PIN[1]], 'inOutSine'],
        [1.5, [MID_PIN[0], MID_PIN[1] + 62], 'inOutSine'],
      ] as any;
    },
  },
} as Record<string, Scene>);

Object.assign(tours, {
  'bone-edit': [
    // E: the Edit bone tool (the rest pose)
    {
      target: () => bonesBtn(),
      enter: () => {
        showRig();
        pause();
        if (S.tool === 'boneedit') setTool('select');
      },
      done: () => S.tool === 'boneedit',
      show: () => press('E', 'e', 'KeyE'),
      clip: () => [q('#boneChip'), armBox()],
    },
    // the joint onto the shoulder
    {
      target: () => jointEl(byName('Bone 1')),
      enter: () => {
        showRig();
        pause();
        tool('boneedit');
      },
      done: () => dist(restPts(byName('Bone 1'))?.J, SH) < 14,
      show: () => drag(restJoint(byName('Bone 1')), screenOf(SH[0], SH[1]), { ms: 900 }),
      clip: () => [armBox()],
    },
    // Bone 1's tip onto the elbow (Bone 2's joint comes along)
    {
      target: () => tipEl(byName('Bone 1')),
      enter: () => {
        showRig();
        pause();
        tool('boneedit');
      },
      done: () => dist(restPts(byName('Bone 1'))?.T, EL) < 14,
      show: () => drag(restTip(byName('Bone 1')), screenOf(EL[0], EL[1]), { ms: 900 }),
      clip: () => [armBox()],
    },
    // Bone 2's tip back to the wrist
    {
      target: () => tipEl(byName('Bone 2')),
      enter: () => {
        showRig();
        pause();
        tool('boneedit');
      },
      done: () => dist(restPts(byName('Bone 2'))?.T, WR) < 14,
      show: () => drag(restTip(byName('Bone 2')), screenOf(WR[0], WR[1]), { ms: 900 }),
      clip: () => [armBox()],
    },
    // V, then play: the same keys, turning at the right joints
    {
      target: () => q('#tPlay'),
      enter: () => {
        showRig();
        pause();
      },
      done: () => S.playing && S.tool === 'select',
      show: async () => {
        await press('V', 'v', 'KeyV');
        await click(q('#tPlay'));
      },
      clip: () => [artboard()],
    },
  ],

  'bone-scale': [
    // select Bone 1, the stem's bone
    {
      target: () => boneEl(byName('Bone 1')),
      enter: () => {
        showRig();
        pause();
        tool('select');
        select(null);
      },
      done: () => S.sel === byName('Bone 1')?.id && S.selSet.size === 1,
      show: () => tap(alongBone(byName('Bone 1'), 0.4)),
      clip: () => [flowerBox()],
    },
    // ◆ Scale: a key at 0 s
    {
      target: () => q('#insp .kb[data-kb="scl"]'),
      enter: () => {
        pause();
        pick(byName('Bone 1'));
        q('#insp .kb[data-kb="scl"]')?.scrollIntoView({ block: 'nearest' });
      },
      done: () => !!byName('Bone 1')?.t.scl?.length,
      show: () => click(q('#insp .kb[data-kb="scl"]')),
      clip: () => trackBits(byName('Bone 1'), 'scl'),
    },
    {
      ...playheadStep(1.5),
      enter: () => pause(),
    },
    // S: the Scale bone tool and its bar
    {
      target: () => q('#tools [data-group="bones"]'),
      enter: () => {
        showRig();
        pause();
        if (S.tool === 'bonescale') setTool('select');
      },
      done: () => S.tool === 'bonescale',
      show: () => press('S', 's', 'KeyS'),
      clip: () => [q('#boneOpts')],
    },
    // Squash & stretch, in the bar
    {
      target: () => scaleOpt('squash'),
      enter: () => {
        showRig();
        tool('bonescale');
        if (S.boneScaleMode === 'squash') S.boneScaleMode = 'length';
        drawOverlay();
      },
      done: () => S.tool === 'bonescale' && S.boneScaleMode === 'squash',
      show: () => click(scaleOpt('squash')),
      clip: () => [q('#boneOpts')],
    },
    // drag along Bone 1: the stem stretches and thins, the flower rides on its tip
    {
      target: () => boneEl(byName('Bone 1')),
      enter: c => {
        showRig();
        pause();
        tool('bonescale');
        S.boneVolume = 'area';
        drawOverlay();
        c.w = sclOf(byName('Bone 1'))[0];
      },
      done: c => {
        const b = byName('Bone 1');
        return !!b && keyAt(b, 'scl', S.time) && Math.abs(sclOf(b)[0] - c.w) > 0.15;
      },
      show: () => {
        const b = byName('Bone 1'),
          a = alongBone(b, 0.6),
          z = screenOf(ROOT[0], ROOT[1] - (ROOT[1] - NECK[1]) * 0.6 * 1.6);
        return drag(a, z, { ms: 1100 });
      },
      clip: () => [flowerBox(), ...trackBits(byName('Bone 1'), 'scl')],
    },
    playStep(),
  ],

  'pins-edit': [
    // select the flag: its pins show
    {
      target: () => q('#wrap'),
      enter: () => {
        showRig();
        pause();
        tool('select');
        select(null);
      },
      done: () => S.sel === flag()?.id && S.selSet.size === 1,
      show: () => tap(screenOf(300, 120)),
      clip: () => [flagBox()],
    },
    // hold the pins button: Edit pins tool
    {
      target: () => {
        const f = q('#toolfly');
        return f && !(f as HTMLElement).hidden ? f : pinsBtn();
      },
      enter: () => {
        showRig();
        pause();
        if (S.tool === 'pinedit') setTool('select');
        pick(flag());
      },
      done: () => S.tool === 'pinedit',
      show: () => hold(pinsBtn(), () => q('#toolfly [data-tool="pinedit"]')),
      clip: () => [q('#boneChip')],
    },
    // drag Pin 2 to the free end: the flag keeps its shape, the pin's keys move with it
    {
      target: () => pinEl(2),
      enter: c => {
        showRig();
        pause();
        tool('pinedit');
        pick(flag());
        drawOverlay();
        c.x = pin2()?.x ?? 0;
      },
      done: c => (pin2()?.x ?? 0) > Math.max(c.x, MID_PIN[0]) + 60,
      show: async () => {
        const e = pinEl(2);
        if (!e) return;
        await drag(centre(e), screenOf(END_PIN[0], END_PIN[1]), { ms: 1000 });
      },
      clip: () => [flagBox(), ...trackBits(flag(), 'pin2')],
    },
    // V, then play
    {
      target: () => q('#tPlay'),
      enter: () => {
        showRig();
        pause();
      },
      done: () => S.playing && S.tool !== 'pinedit',
      show: async () => {
        await press('V', 'v', 'KeyV');
        await click(q('#tPlay'));
      },
      clip: () => [artboard()],
    },
  ],
} as Record<string, TourStep[]>);

/* ---------- A rig's own draw order ---------- */

/** a figure seen from the side: the torso and head on Bone 1, an arm on each of two bones chained to it */
const FIG = svg640(
  `${PAPER}
<path id="Back leg" d="${capsule([334, 258], [348, 350], 12)}${capsule([348, 350], [370, 352], 9)}" fill="#2b3a78"/>
<path id="Front leg" d="${capsule([320, 258], [310, 350], 12)}${capsule([310, 350], [332, 352], 9)}" fill="#1f2b5c"/>
<path id="Far arm" d="${capsule([326, 150], [326, 240], 10)}" fill="#c4946c"/>
<path id="Torso" d="M304 152c0-16 8-24 22-24s22 8 22 24v110h-44z" fill="#3f5bd8"/>
<path id="Head" d="${circle(330, 94, 28)}${circle(357, 101, 7)}" fill="#f2c9a0"/>
<path id="Near arm" d="${capsule([326, 150], [326, 240], 10)}" fill="#f2c9a0"/>`,
  false,
);
const figBox = () => screenBox(230, 50, 200, 320);
/** the rig's artwork, back to front, as the canvas draws it */
const artOrder = () => {
  const b = byName('Bone 1');
  return b ? drawOrder(b, doc.layers) || rigArtwork(b, doc.layers) : [];
};
const farBehind = () => {
  const ns = artOrder().map(l => l.name);
  return !!byName('Bone 1')?.dord && ns.indexOf('Far arm') >= 0 && ns.indexOf('Far arm') < ns.indexOf('Torso');
};
const farBack = () => {
  const l = byName('Far arm');
  return l ? q(`#insp .dord-mv[data-dir="back"][data-id="${l.id}"]`) : null;
};

/* ---------- Pins on images, text and groups ---------- */

const word = () => byName('Hello');
const PIN_L = [196, 196],
  PIN_R = [446, 196];
const wordBox = () => screenBox(130, 110, 380, 200);
/** the text's pin furthest to the right */
function rightPin(): number | null {
  const l = word();
  if (!l || !l.pins || !l.pins.length) return null;
  return l.pins.reduce((a, p) => (p.x > a.x ? p : a), l.pins[0]).n;
}
/** the pins the steps before put on the text, when the person's own aren't there */
function ensureWordPins(k: number) {
  const l = word();
  if (!l) return;
  const ps = l.pins || [];
  if (ps.length >= k) return;
  const M = pinMatrix(l).inverse(),
    at = [PIN_L, PIN_R].slice(ps.length, k).map(([x, y]) => new DOMPoint(x, y).matrixTransform(M));
  let n = ps.reduce((m, p) => Math.max(m, p.n), 0);
  l.pins = [...ps, ...at.map(p => ({ n: ++n, x: r2(p.x), y: r2(p.y) }))];
  select(l.id);
}
const meshN = () => {
  const l = word();
  return (l && l.mesh && l.mesh.n) || MESH_DEFAULT;
};
/** Drag a slider's thumb to a value: the pointer moves with it, and the slider gets the input events a
 *  drag gives (a native slider can't be dragged by script), then change. */
async function slide(r: HTMLInputElement | null, value: number, ms = 900) {
  if (!r) return;
  const min = +r.min || 0,
    max = +r.max || 100,
    box = r.getBoundingClientRect(),
    xOf = (v: number) => box.left + 8 + ((v - min) / (max - min)) * (box.width - 16),
    y = box.top + box.height / 2,
    v0 = +r.value;
  await moveTo({ x: xOf(v0), y });
  const n = Math.max(6, Math.round(ms / 40));
  for (let i = 1; i <= n; i++) {
    const v = v0 + ((value - v0) * i) / n;
    r.value = String(Math.round(v / (+r.step || 1)) * (+r.step || 1));
    r.dispatchEvent(new Event('input', { bubbles: true }));
    await moveTo({ x: xOf(v), y }, { ms: 30 });
  }
  r.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(400);
}

Object.assign(scenes, {
  // A rig's own draw order: the far arm hangs on a bone chained to the torso's, so nesting draws it in front
  'rig-order': {
    name: "Practice: a rig's own draw order",
    svg: FIG,
    setup() {
      lock('Paper', 'Back leg', 'Front leg');
      // the torso and head go on Bone 1 before the arms' bones are made: nesting then draws the arms in front
      const b1 = addBone('Bone 1', [326, 262], [326, 140], null);
      attach('Torso', b1);
      attach('Head', b1);
      const b2 = addBone('Bone 2', [326, 150], [326, 240], b1),
        b3 = addBone('Bone 3', [326, 150], [326, 240], b1);
      attach('Far arm', b2);
      attach('Near arm', b3);
      const swing = (a: number) =>
        [
          [0, a, 'inOutSine'],
          [1.5, -a, 'inOutSine'],
          [3, a, 'inOutSine'],
        ] as any;
      b1.t.rot = [
        [0, 0, 'inOutSine'],
        [1.5, 0, 'inOutSine'],
        [3, 0, 'inOutSine'],
      ] as any;
      b2.t.rot = swing(-32);
      b3.t.rot = swing(32);
    },
  },
  // Pins on images, text and groups: a word to bend through its mesh
  'pins-mesh': {
    name: 'Practice: pins on images, text and groups',
    svg: svg640(`<path id="Hills" d="M0 318c110-40 210-40 320-12s210 28 320-8v102H0z" fill="#1f2b5c"/>
<text id="Hello" x="320" y="230" text-anchor="middle" font-family="sans-serif" font-size="104" font-weight="700" fill="#ffd36e">Hello!</text>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
} as Record<string, Scene>);

Object.assign(tours, {
  'rig-order': [
    // Bone 1 in the Layers panel
    {
      target: () => lpRow('Bone 1'),
      enter: () => {
        showRig();
        pause();
        tool('select');
        select(null);
      },
      done: () => S.sel === byName('Bone 1')?.id && S.selSet.size === 1,
      show: () => click(lpRow('Bone 1'), 0.4, 0.5),
      clip: () => [figBox()],
    },
    // Own draw order
    {
      target: () => q('#fl-dord')?.closest('label') || null,
      enter: () => {
        pause();
        tool('select');
        pick(byName('Bone 1'));
        q('#fl-dord')?.scrollIntoView({ block: 'nearest' });
      },
      done: () => !!byName('Bone 1')?.dord,
      show: () => click(q('#fl-dord')),
      clip: () => [q('#insp .dord')],
    },
    // the far arm to the back, below the torso
    {
      target: () => farBack(),
      enter: () => {
        pause();
        tool('select');
        const b = byName('Bone 1');
        pick(b);
        if (b && !b.dord) {
          b.dord = rigArtwork(b, doc.layers).map(x => x.id);
          select(b.id);
        }
        q('#insp .dord')?.scrollIntoView({ block: 'nearest' });
      },
      done: () => farBehind(),
      show: async () => {
        for (let i = 0; i < 4 && !farBehind(); i++) await click(farBack());
      },
      clip: () => [q('#insp .dord'), figBox()],
    },
    playStep(),
  ],

  'pins-mesh': [
    // W
    {
      target: () => pinsBtn(),
      enter: () => {
        showRig();
        pause();
        if (S.tool === 'pin') setTool('select');
      },
      done: () => S.tool === 'pin',
      show: () => press('W', 'w', 'KeyW'),
    },
    // a pin at the start of the word: the mesh appears
    {
      target: () => q('#wrap'),
      enter: () => {
        showRig();
        pause();
        tool('pin');
      },
      done: () => !!(word()?.pins || []).length,
      show: () => tap(screenOf(PIN_L[0], PIN_L[1])),
      clip: () => [wordBox(), q('#boneChip')],
    },
    // a pin at its end
    {
      target: () => q('#wrap'),
      enter: () => {
        showRig();
        pause();
        tool('pin');
        pick(word());
        ensureWordPins(1);
      },
      done: () => (word()?.pins || []).length >= 2,
      show: () => tap(screenOf(PIN_R[0], PIN_R[1])),
      clip: () => [wordBox()],
    },
    // Mesh: a finer mesh
    {
      target: () => q('#pinMesh')?.closest('.row') || null,
      enter: c => {
        pause();
        tool('pin');
        pick(word());
        ensureWordPins(2);
        drawOverlay();
        q('#pinMesh')?.scrollIntoView({ block: 'nearest' });
        c.n = meshN();
      },
      done: c => meshN() >= c.n + 24,
      show: () => slide(q('#pinMesh') as HTMLInputElement | null, Math.min(240, meshN() + 92)),
      clip: () => [wordBox()],
    },
    {
      ...playheadStep(1.5),
      enter: () => {
        pause();
        tool('pin');
        pick(word());
      },
    },
    // drag the end's pin down: the word bends, keyed at the playhead
    {
      target: () => pinEl(rightPin()),
      enter: () => {
        showRig();
        pause();
        tool('pin');
        ensureWordPins(2);
        pick(word());
        drawOverlay();
      },
      done: () => {
        const l = word();
        return !!l && (l.pins || []).some(p => keyAt(l, 'pin' + p.n, 1.5));
      },
      show: async () => {
        const e = pinEl(rightPin());
        if (!e) return;
        await drag(centre(e), screenOf(PIN_R[0] - 10, PIN_R[1] + 70), { ms: 1000 });
      },
      clip: () => [wordBox(), ...trackBits(word(), 'pin' + rightPin())],
    },
    playStep(),
  ],
} as Record<string, TourStep[]>);
