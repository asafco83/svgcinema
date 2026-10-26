// SVGcinema — model/sample
// The scene a new editor opens with. It doubles as a tour of what SVGcinema can animate: every layer
// shows at least one feature (named in the comment above it). The browser tests rely on some of its
// layers (Title on top with Landscape right below it, Sunrise › Sun / Rays, Landscape › Horizon /
// Ground, Blob), so keep those names and that order when changing it.
import type { Layer, PathData } from './types';
import { FONTS, NOFILL, clone } from '../core/constants';
import { blankDoc, mkLayer, setIdc } from '../core/state';
import { N, type ShapeParams, ellNodes, radial, shapeD, smoothNodes, starNodes } from '../geometry/nodes';
import { addFilter } from './filters';
import { buildMesh } from './mesh';

/** A path layer that keeps polygon / star settings (so sides, points and corner radius stay editable).
 *  The path keeps two nodes per corner, so the corner radius can be animated. */
function shapeLayer(name: string, p: ShapeParams, b: Record<string, unknown>): Layer {
  const d = shapeD({ ...p, rad: p.rad || 0 }, true),
    l = mkLayer('path', name, {}, { ...b, d });
  l.shape = { ...p, rad: p.rad || 0, sig: JSON.stringify(d) };
  return l;
}
/** An open two-node path: a line, whose ends (p0 / p1) can be animated. */
function lineLayer(name: string, a: number[], b: number[], stk: string, sw: number): Layer {
  const l = mkLayer('path', name, {}, { fill: 'none', stk, sw, d: [{ c: false, n: [N(a[0], a[1]), N(b[0], b[1])] }] });
  l.extra = { 'stroke-linecap': 'round' };
  return l;
}
function bone(name: string, x: number, y: number, len: number, ang: number): Layer {
  const b = mkLayer('bone', name, { x, y, len, ang }, NOFILL);
  b.o = [x, y];
  return b;
}
const lin = (a: number, s: Array<[number, string]>) => ({ g: 'lin', a, s });

export function sampleDoc(): any {
  setIdc(0);
  const d = blankDoc(640, 400);
  d.name = 'Sunrise badge';
  d.bg = '#14213D';
  d.dur = 3;
  d.it = 0;

  // Sky — an animated linear gradient (night to dawn)
  const sky = mkLayer('rect', 'Sky', { x: 0, y: 0, w: 640, h: 400, rx: 0 }, {});
  sky.b.fill = lin(180, [
    [0, '#0B1026'],
    [0.62, '#14213D'],
    [1, '#2A2F5B'],
  ]) as any;
  sky.t.fill = [
    [0, sky.b.fill, 'inOutSine'],
    [
      2.2,
      lin(180, [
        [0, '#2E3B73'],
        [0.62, '#B9617F'],
        [1, '#F2A65E'],
      ]),
      'ease',
    ],
  ];

  // Night sky — star shapes: animated corner radius, a blink with hold keyframes, an elastic pulse;
  // the group fades out as the day comes
  const night = mkLayer('group', 'Night sky', {}, NOFILL);
  night.t.op = [
    [1, 1, 'inOutSine'],
    [2.2, 0, 'ease'],
  ];
  const starA = shapeLayer(
    'Star',
    { kind: 'star', cx: 46, cy: 46, r: 9, rot: 0, n: 5, ratio: 0.45 },
    { fill: '#FFF4CF', stk: 'none', sw: 0 },
  );
  starA.parent = night.id;
  starA.t.rad = [
    [0, 0, 'inOutSine'],
    [1.2, 2.2, 'ease'],
  ];
  const starB = shapeLayer(
    'Twinkle',
    { kind: 'star', cx: 300, cy: 26, r: 6, rot: 0, n: 4, ratio: 0.35 },
    { fill: '#FFF4CF', stk: 'none', sw: 0 },
  );
  starB.parent = night.id;
  starB.t.op = [
    [0, 1, 'hold'],
    [0.3, 0.25, 'hold'],
    [0.6, 1, 'hold'],
    [0.9, 0.25, 'hold'],
    [1.2, 1, 'hold'],
  ];
  const starC = shapeLayer(
    'Spark',
    { kind: 'star', cx: 604, cy: 36, r: 8, rot: 0, n: 6, ratio: 0.5 },
    { fill: '#FFF4CF', stk: 'none', sw: 0 },
  );
  starC.parent = night.id;
  starC.o = [604, 36];
  starC.t.rot = [
    [0, 0, 'linear'],
    [3, 120, 'linear'],
  ];
  starC.t.scl = [
    [0, [0.4, 0.4], 'outElastic'],
    [1, [1, 1], 'ease'],
  ];

  // Sparkle — a symbol: two instances share the same pulsing dot, the second one starts 0.15 s later
  const sparkle = (name: string, x: number, y: number, off: number) => {
    const g = mkLayer('group', name, {}, NOFILL);
    g.parent = night.id;
    g.sym = 'sparkle';
    g.b.pos = [x, y];
    if (off) g.symOff = off;
    const dot = mkLayer(
      'ellipse',
      'Sparkle dot',
      { cx: 0, cy: 0, rx: 2.5, ry: 2.5 },
      { fill: '#FFF4CF', stk: 'none', sw: 0 },
    );
    dot.parent = g.id;
    dot.o = [0, 0];
    dot.t.scl = [
      [off, [1, 1], 'inOutSine'],
      [off + 0.4, [1.8, 1.8], 'inOutSine'],
      [off + 0.8, [1, 1], 'ease'],
    ];
    return [g, dot];
  };
  const spark1 = sparkle('Sparkle', 150, 60, 0),
    spark2 = sparkle('Sparkle 2', 470, 70, 0.15);
  d.symbols = { sparkle: { name: 'Sparkle' } };

  // Sunrise — a group moved up as one; Glow: radial gradient, animated blur filter, screen blending
  const sunG = mkLayer('group', 'Sunrise', {}, NOFILL);
  const glow = mkLayer(
    'ellipse',
    'Glow',
    { cx: 170, cy: 215, rx: 100, ry: 100 },
    {
      fill: {
        g: 'rad',
        s: [
          [0, '#FFD27ACC'],
          [0.55, '#FF9F6B55'],
          [1, '#FF7A5900'],
        ],
      } as any,
    },
  );
  glow.parent = sunG.id;
  glow.blend = 'screen';
  const blur = addFilter(glow, 'blur');
  glow.b['fx.' + blur.id + '.sd'] = 6;
  glow.t['fx.' + blur.id + '.sd'] = [
    [0, 4, 'inOutSine'],
    [1.6, 14, 'ease'],
  ];
  glow.t.op = [
    [0, 0, 'outQuad'],
    [1.2, 1, 'ease'],
  ];
  const rays = mkLayer('path', 'Rays', {}, { fill: '#FFD27A', op: 0.9, d: starNodes(170, 215, 96, 62, 12) });
  rays.parent = sunG.id;
  rays.t.rot = [
    [0, 0, 'linear'],
    [3, 60, 'linear'],
  ];
  rays.t.scl = [
    [0, [0.35, 0.35], 'outBack'],
    [1.2, [1, 1], 'ease'],
  ];
  rays.t.op = [
    [0, 0, 'outQuad'],
    [0.7, 0.9, 'ease'],
  ];
  const sun = mkLayer('ellipse', 'Sun', { cx: 170, cy: 215, rx: 54, ry: 54 }, { fill: '#FF7A59' });
  sun.parent = sunG.id;
  sun.t.fill = [
    [0, '#FF5F6D', 'inOutSine'],
    [1.6, '#FFC24B', 'ease'],
  ];
  sunG.t.pos = [
    [0, [0, 150], 'outBack'],
    [1.2, [0, 0], 'ease'],
  ];

  // Blob — morphing between shapes, with a custom easing curve
  const circle = radial(470, 175, [52, 52, 52, 52], [28.7, 28.7, 28.7, 28.7]),
    leaf = radial(470, 175, [72, 40, 72, 40], [8, 44, 8, 44]),
    petal = radial(470, 175, [44, 66, 44, 66], [48, 10, 48, 10]);
  const blob = mkLayer('path', 'Blob', {}, { fill: '#6C8CFF', d: clone(circle) });
  blob.t.d = [
    [0, clone(circle), 'inOutBack'],
    [1.1, leaf, [0.7, 0, 0.2, 1.4]],
    [2.1, petal, 'inOutCubic'],
    [3, clone(circle), 'ease'],
  ];
  blob.t.fill = [
    [0, '#6C8CFF', 'inOut'],
    [1.5, '#C77DFF', 'inOut'],
    [3, '#6C8CFF', 'ease'],
  ];
  blob.t.rot = [
    [0, 0, 'inOutQuart'],
    [3, 180, 'ease'],
  ];

  // Comet trail — travelling dashes (an animated dash offset) that stretch and shrink (dash pattern)
  const route = [
    [50, 130],
    [230, 52],
    [420, 58],
    [600, 140],
  ];
  const trail = mkLayer(
    'path',
    'Comet trail',
    {},
    { fill: 'none', stk: '#F3EEE4', sw: 2, op: 0.35, d: [{ c: false, n: smoothNodes(route, false) }] },
  );
  trail.extra = { 'stroke-linecap': 'round', 'stroke-dasharray': '1 11' };
  trail.t.dof = [
    [0, 0, 'linear'],
    [3, -48, 'linear'],
  ];
  trail.t.da = [
    [0, [1, 11], 'inOutSine'],
    [1.5, [5, 7], 'inOutSine'],
    [3, [1, 11], 'ease'],
  ];
  // Comet — a curved motion path, rotating along it
  const comet = mkLayer(
    'path',
    'Comet',
    {},
    { fill: '#F3EEE4', d: [{ c: true, n: [N(-10, -6), N(12, 0), N(-10, 6)] }] },
  );
  comet.o = [0, 0];
  comet.sm = true;
  comet.or = true;
  comet.t.pos = route.map((p, i) => [i, [p[0], p[1]], 'linear']) as any;
  comet.t.op = [
    [0, 0, 'linear'],
    [0.4, 1, 'linear'],
    [2.6, 1, 'linear'],
    [3, 0, 'ease'],
  ];

  // Hills — a clipping group: the drifting mist only shows inside the hill silhouette
  const hills = mkLayer('group', 'Hills', {}, NOFILL);
  hills.mask = 'clip';
  const hillFill = mkLayer('rect', 'Hill colour', { x: 0, y: 220, w: 640, h: 110, rx: 0 }, {});
  hillFill.b.fill = lin(180, [
    [0, '#2B4C6F'],
    [1, '#162A45'],
  ]) as any;
  hillFill.parent = hills.id;
  // Mist: an ellipse whose size grows as it drifts (Size), along an arc at an even speed
  const mist = mkLayer('ellipse', 'Mist', { cx: 120, cy: 262, rx: 120, ry: 14 }, { fill: '#DCE7FF', op: 0.22 });
  mist.parent = hills.id;
  mist.o = [120, 262];
  mist.t.sz = [
    [0, [240, 28], 'inOutSine'],
    [3, [330, 40], 'ease'],
  ];
  const haze = addFilter(mist, 'blur');
  mist.b['fx.' + haze.id + '.sd'] = 6;
  // it drifts along a gentle arc (a curved motion path) at an even speed
  mist.t.pos = [
    [0, [-60, 0], 'inOutSine', [160, -24, -160, -24]],
    [3, [420, 0], 'ease'],
  ];
  mist.ev = true;
  const clipF = mkLayer('group', 'Clip path', {}, NOFILL);
  clipF.maskSrc = true;
  clipF.parent = hills.id;
  const ridge: PathData = [
    {
      c: true,
      n: [
        ...smoothNodes(
          [
            [-10, 300],
            [130, 244],
            [300, 290],
            [482, 238],
            [650, 298],
          ],
          false,
        ),
        N(650, 330),
        N(-10, 330),
      ],
    },
  ];
  const ridgeL = mkLayer('path', 'Ridge', {}, { fill: '#FFFFFF', d: ridge });
  ridgeL.parent = clipF.id;

  // Sprout — a bone rig: three bones, each carrying its stem part, leaf or flower; the group grows
  // in, then the bones sway with follow-through and the top bone squashes and stretches; the Leaf
  // bends with pins, and the Tendril's pins follow the bones; the rig draws in its own order
  const sprout = mkLayer('group', 'Sprout', {}, NOFILL);
  sprout.o = [592, 300];
  sprout.t.scl = [
    [0.6, [0, 0], 'outBack'],
    [1.4, [1, 1], 'ease'],
  ];
  const b1 = bone('Stem', 592, 300, 32, -90),
    b2 = bone('Stem 2', 592, 268, 28, -90),
    b3 = bone('Stem 3', 592, 240, 24, -90);
  b1.parent = sprout.id;
  b2.parent = b1.id;
  b3.parent = b2.id;
  const stem = (n: string, y0: number, y1: number, p: Layer) => {
    const s = lineLayer(n, [592, y0], [592, y1], '#7FD4C1', 5);
    s.parent = p.id;
    return s;
  };
  const seg1 = stem('Stalk', 300, 268, b1),
    seg2 = stem('Stalk 2', 268, 240, b2),
    seg3 = stem('Stalk 3', 240, 216, b3);
  // the Leaf is pinned (Pin tool): pin 1 holds its base on the stalk, pin 2 flutters its tip
  const leafL = mkLayer(
    'path',
    'Leaf',
    {},
    { fill: '#5FBF9F', rot: -30, d: ellNodes({ cx: 579, cy: 262, rx: 13, ry: 5 }) },
  );
  leafL.parent = b2.id;
  leafL.o = [579, 262];
  leafL.pins = [
    { n: 1, x: 590, y: 262 },
    { n: 2, x: 568, y: 262 },
  ];
  leafL.t.pin2 = [
    [1.3, [568, 262], 'inOutSine'],
    [1.8, [569, 255], 'inOutSine'],
    [2.3, [568, 268], 'inOutSine'],
    [2.8, [568, 262], 'ease'],
  ] as any;
  const leafR = mkLayer('ellipse', 'Leaf 2', { cx: 605, cy: 236, rx: 12, ry: 5 }, { fill: '#5FBF9F', rot: 30 });
  leafR.parent = b3.id;
  const bloom = mkLayer(
    'path',
    'Bloom',
    {},
    { fill: '#FF8FB1', d: radial(592, 210, [11, 11, 11, 11, 11], [9, 9, 9, 9, 9]) },
  );
  bloom.parent = b3.id;
  // a tendril beside the stalk, bent by the rig: its pins are bound to the three bones (Pin tool ›
  // Bind to bones), so it follows their joints and turns with them
  const side = (x: number) => Array.from({ length: 11 }, (_, i) => [x, 298 - i * 7.6]);
  const tendril = mkLayer(
    'path',
    'Tendril',
    {},
    {
      fill: '#5FBF9F',
      d: [{ c: true, n: [...side(596.5), ...side(599).reverse()].map(([x, y]) => N(x, y)) }],
    },
  );
  tendril.parent = sprout.id;
  tendril.pins = [b1, b2, b3].map((b, i) => ({ n: i + 1, x: b.geo.x, y: b.geo.y, bone: b.id }));
  // the rig's own draw order (back to front): the Leaf hangs on Stem 2 but sits behind the Stalk
  b1.dord = [leafL, seg1, seg2, seg3, leafR, bloom].map(l => l.id);
  const sway = (deg: number, lag: number) => [
    [1.2 + lag, 0, 'inOutSine'],
    [1.9 + lag, -deg, 'inOutSine'],
    [2.6 + lag, deg * 0.6, 'inOutSine'],
    [3, 0, 'ease'],
  ];
  b1.t.rot = sway(5, 0) as any;
  b2.t.rot = sway(9, 0.1) as any;
  b3.t.rot = sway(14, 0.2) as any;
  // the top bone squashes and stretches along itself as it swings (W × H stays about 1)
  b3.t.scl = [
    [1.4, [1, 1], 'inOutSine'],
    [1.75, [1.18, 0.85], 'inOutSine'],
    [2.1, [0.9, 1.11], 'inOutSine'],
    [2.5, [1, 1], 'ease'],
  ] as any;

  // Flag — a line whose end grows (the pole) and a polygon with a gradient, a skew wave and an
  // animated corner radius (the pennant); the group bends in the wind with pins
  const flag = mkLayer('group', 'Flag', {}, NOFILL);
  const pole = lineLayer('Pole', [54, 300], [54, 214], '#F3EEE4', 3);
  pole.parent = flag.id;
  pole.t.p1 = [
    [0.2, [54, 300], 'outCubic'],
    [1, [54, 214], 'ease'],
  ];
  const pennant = shapeLayer(
    'Pennant',
    { kind: 'polygon', cx: 64, cy: 226, r: 14, rot: 90, n: 3 },
    {
      fill: lin(90, [
        [0, '#FF5F6D'],
        [1, '#FFC24B'],
      ]),
      stk: 'none',
      sw: 0,
    },
  );
  pennant.parent = flag.id;
  pennant.o = [56, 226];
  pennant.t.op = [
    [0.9, 0, 'outQuad'],
    [1.2, 1, 'ease'],
  ];
  pennant.t.skw = [
    [1.2, [0, 0], 'inOutSine'],
    [1.8, [0, 14], 'inOutSine'],
    [2.4, [0, -10], 'inOutSine'],
    [3, [0, 0], 'ease'],
  ];
  pennant.t.rad = [
    [1.2, 0, 'inOutSine'],
    [2, 3, 'ease'],
  ];
  // a colour filter: the pennant brightens as the wind catches it
  const bright = addFilter(pennant, 'bright');
  pennant.b['fx.' + bright.id + '.a'] = 1;
  pennant.t['fx.' + bright.id + '.a'] = [
    [1.2, 1, 'inOutSine'],
    [1.8, 1.25, 'inOutSine'],
    [2.4, 1, 'ease'],
  ];
  // the whole flag bends in the wind through a triangle mesh (Pin tool): pin 1 holds the foot of the
  // pole, pin 2 sways its top
  flag.pins = [
    { n: 1, x: 54, y: 298 },
    { n: 2, x: 54, y: 216 },
  ];
  flag.t.pin2 = [
    [1.2, [54, 216], 'inOutSine'],
    [1.8, [58.5, 215], 'inOutSine'],
    [2.4, [50.5, 216.5], 'inOutSine'],
    [3, [54, 216], 'ease'],
  ] as any;
  // the pole and the pennant (with its skew wave), plus margins; the editor rebuilds it from the canvas
  flag.mesh = {
    n: 24,
    ...buildMesh(
      [
        { x: 49, y: 209, w: 10, h: 96 },
        { x: 50, y: 204, w: 34, h: 42 },
      ],
      24,
    ),
  };

  // Landscape — Horizon draws on with Trim path (animate End); Signature is a mask group: a soft
  // gradient wipe reveals the line, which links to the editor
  const land = mkLayer('group', 'Landscape', {}, NOFILL);
  const ground = mkLayer('rect', 'Ground', { x: 0, y: 296, w: 640, h: 104, rx: 0 }, { fill: '#14213D' });
  ground.parent = land.id;
  const wave = mkLayer(
    'path',
    'Horizon',
    {},
    {
      fill: 'none',
      stk: '#7FD4C1',
      sw: 6,
      d: [
        {
          c: false,
          n: [
            [30, 300, 30, 300, 76, 300],
            [175, 288, 129, 288, 221, 288],
            [320, 304, 274, 304, 366, 304],
            [465, 288, 419, 288, 511, 288],
            [610, 300, 564, 300, 610, 300],
          ],
        },
      ],
    },
  );
  wave.parent = land.id;
  wave.extra = { 'stroke-linecap': 'round' };
  wave.t.te = [
    [0.2, 0, 'inOutCubic'],
    [1.8, 100, 'ease'],
  ];
  // Signature: a mask group that masks by brightness (Mask mode)
  const sig = mkLayer('group', 'Signature', {}, NOFILL);
  sig.mask = 'mask';
  sig.mm = 'lum';
  sig.parent = land.id;
  const credit = mkLayer(
    'text',
    'Made with SVGcinema',
    {
      x: 320,
      y: 389,
      // letter case: typed in mixed case, shown in capitals
      text: 'Made with SVGcinema',
      tcase: 'upper',
      size: 10,
      family: FONTS[0][0],
      weight: '600',
      anchor: 'middle',
      ls: 3,
    },
    { fill: '#9FB3D9' },
  );
  credit.parent = sig.id;
  credit.link = { url: 'https://asafco83.github.io/svgcinema/', target: '_blank' };
  const maskF = mkLayer('group', 'Masks', {}, NOFILL);
  maskF.maskSrc = true;
  maskF.parent = sig.id;
  const wipe = mkLayer('rect', 'Wipe', { x: 200, y: 376, w: 240, h: 18, rx: 0 }, {});
  wipe.b.fill = lin(90, [
    [0, '#FFFFFF'],
    [0.8, '#FFFFFF'],
    [1, '#FFFFFF00'],
  ]) as any;
  wipe.parent = maskF.id;
  wipe.o = [200, 385];
  wipe.t.scl = [
    [1.8, [0, 1], 'outCubic'],
    [2.6, [1, 1], 'ease'],
  ];

  // Title — text sliding and fading in, with an animated drop shadow
  const title = mkLayer(
    'text',
    'Title',
    { x: 320, y: 362, text: 'Good morning', size: 40, family: FONTS[1][0], weight: '700', anchor: 'middle' },
    { fill: '#F3EEE4' },
  );
  title.t.op = [
    [1, 0, 'outQuad'],
    [1.8, 1, 'ease'],
  ];
  title.t.pos = [
    [1, [0, 26], 'outBack'],
    [1.8, [0, 0], 'ease'],
  ];
  const shadow = addFilter(title, 'shadow');
  title.b['fx.' + shadow.id + '.col'] = '#05070F';
  title.t['fx.' + shadow.id + '.dy'] = [
    [1, 0, 'outQuad'],
    [1.8, 4, 'ease'],
  ];

  // back to front; a mask or clip folder sits above the layers it applies to
  d.layers = [
    sky,
    night,
    starA,
    starB,
    starC,
    ...spark1,
    ...spark2,
    sunG,
    glow,
    rays,
    sun,
    blob,
    trail,
    comet,
    hills,
    hillFill,
    mist,
    clipF,
    ridgeL,
    sprout,
    tendril,
    b1,
    seg1,
    b2,
    seg2,
    leafL,
    b3,
    seg3,
    leafR,
    bloom,
    flag,
    pole,
    pennant,
    land,
    ground,
    wave,
    sig,
    credit,
    maskF,
    wipe,
    title,
  ];
  return d;
}
