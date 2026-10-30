// SVGcinema — help/topics/rigging: Rigging (scenes and tour steps; the words are in help/content.json)
import type { Layer } from '../../model/types';
import { S, doc, layerById, mkLayer } from '../../core/state';
import { H, NOFILL, r2 } from '../../core/constants';
import { select, setTool } from '../../core/history';
import { drawOverlay } from '../../render/overlay';
import { bonePts, keyRestRot } from '../../tools/bones';
import { rigTimes } from '../../tools/rig';
import { moveLayers } from '../../ui/layers-panel';
import { centre, click, drag, hold, press, type, type XY } from '../ghost';
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
