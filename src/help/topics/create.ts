// SVGcinema — help/topics/create: Create (scenes and tour steps; the words are in help/content.json)
import type { Layer, PathNode } from '../../model/types';
import { S, mkLayer } from '../../core/state';
import { H, valueAt } from '../../core/constants';
import { select, setTool } from '../../core/history';
import { N } from '../../geometry/nodes';
import { drawOverlay } from '../../render/overlay';
import { addAsset, renderAssets } from '../../io/assets';
import { addLayer, liveShape } from '../../tools/shapes';
import { startTextEdit, textEditing } from '../../tools/text-edit';
import { centre, click, drag, hold, press, trace, type, type XY } from '../ghost';
import { type Scene, type TourStep, allLayers, byName, lock, offCentre, q, screenOf, shapeEl, svg640 } from '../kit';

/** A light sheet of paper behind the drawing (new shapes and text read well on it). */
const PAPER = `<rect id="Paper" width="640" height="400" fill="#f4efe6"/>`;

/** a click on the canvas at a screen point (a press and a release without moving) */
const tap = (p: XY) => drag(p, p, { ms: 120 });
/** the last layer of a type (what the person drew last) */
const last = (f: (l: Layer) => boolean) => allLayers().filter(f).pop() || null;
const count = (f: (l: Layer) => boolean) => allLayers().filter(f).length;
/** selects the layer (when it isn't already) */
const pick = (l: Layer | null) => {
  if (l && (S.sel !== l.id || S.selSet.size > 1)) select(l.id);
};
const state = (l: Layer | null) => (l ? JSON.stringify([l.geo, l.b, l.t]) : '');
/** the screen box of a handle of the selection (Select tool): nw, se, rot, org… */
const handle = (h: string) => q(`#overlay [data-h="${h}"]`);
/** scrolls a field of the inspector into view, as a person would before using it */
const into = (sel: string) => {
  const e = q(sel);
  if (e) e.scrollIntoView({ block: 'nearest' });
};
const tool = (t: string) => () => {
  if (S.tool !== t) setTool(t);
};

/* ---------- Select and transform ---------- */

const box = () => byName('Box');
/** where the layer's origin is now */
const org = (l: Layer | null) => (l ? JSON.stringify(H.get(l, 'org', S.time)) : '');

/* ---------- Pen and pencil ---------- */

const closedPath = (l: Layer) => l.type === 'path' && !l.lock && !!(l.b.d && l.b.d[0] && l.b.d[0].c);
/** the pen's points so far, in the document */
const penPts = (): PathNode[] => (S.pen ? S.pen.nodes : []);
/** a step that starts while drawing with the Pen: when the person isn't drawing (yet), the path so far */
function penWith(n: number) {
  if (S.tool !== 'pen') setTool('pen');
  if (S.pen && S.pen.nodes.length >= n) return;
  const P = [
    [150, 280],
    [250, 120],
    [380, 150],
  ];
  S.pen = { nodes: P.slice(0, n).map(([x, y]) => N(x, y)), hover: null };
  drawOverlay();
}
/** the path the Pen closed (or one like it, when the step starts without one) */
function drawnPath() {
  let l = last(closedPath);
  if (!l) {
    l = mkLayer(
      'path',
      'Shape 1',
      {},
      {
        fill: '#5B7CFA',
        d: [
          {
            c: true,
            n: [N(150, 280), N(250, 120), [380, 150, 320, 110, 440, 190], N(330, 300)],
          },
        ],
      },
    );
    addLayer(l);
  }
  return l;
}
/** a wave across the lower part of the paper, in screen points */
const wave = () => Array.from({ length: 13 }, (_, i) => screenOf(140 + i * 30, 348 + Math.sin(i * 0.75) * 22));

/* ---------- Shapes ---------- */

const isStar = (l: Layer) => l.type === 'path' && !!liveShape(l) && liveShape(l)!.kind === 'star';
const shapesBtn = () => q('#tools [data-group="shapes"]');

/* ---------- Text ---------- */

const lastText = () => last(l => l.type === 'text');
const editor = () => q('textarea.cin-tedit:not(.armed)') as HTMLTextAreaElement | null;

/* ---------- Images ---------- */

/** a small picture to place: a sunset over the sea, drawn here (a practice scene brings its own files) */
function sunsetPNG() {
  const w = 480,
    h = 320,
    c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  const sky = g.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#3b3f8f');
  sky.addColorStop(0.55, '#e0708a');
  sky.addColorStop(1, '#ffc27a');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffe3a1';
  g.beginPath();
  g.arc(w * 0.62, h * 0.6, 46, 0, Math.PI * 2);
  g.fill();
  const sea = g.createLinearGradient(0, h * 0.62, 0, h);
  sea.addColorStop(0, '#2d4f8a');
  sea.addColorStop(1, '#16264a');
  g.fillStyle = sea;
  g.fillRect(0, h * 0.62, w, h);
  g.fillStyle = 'rgba(255, 214, 150, 0.55)';
  for (let i = 0; i < 9; i++) {
    const y = h * 0.66 + i * 11,
      half = 60 - i * 5;
    g.fillRect(w * 0.62 - half, y, half * 2, 3);
  }
  g.fillStyle = '#1b1d3a';
  g.beginPath();
  g.moveTo(0, h * 0.64);
  g.quadraticCurveTo(w * 0.16, h * 0.46, w * 0.34, h * 0.64);
  g.fill();
  const data = c.toDataURL('image/png');
  return { data, w, h, size: Math.round(((data.length - data.indexOf(',') - 1) * 3) / 4) };
}
const isImage = (l: Layer) => l.type === 'image';
const assetThumb = () => q('#ag .at[data-aid] .th');

export const scenes: Record<string, Scene> = {
  // Select and transform: a box and a ball on the ground
  select: {
    name: 'Practice: select and transform',
    svg: svg640(`<path id="Ground" d="M0 312c140-12 260-14 360-6s190 10 280 0v94H0z" fill="#1f2b5c"/>
<rect id="Box" x="170" y="190" width="120" height="120" rx="6" fill="#ffb02e"/>
<circle id="Ball" cx="440" cy="262" r="46" fill="#5b7cfa"/>`),
    setup() {
      lock('Sky', 'Ground');
    },
  },
  // Pen and pencil: an empty sheet to draw on
  pen: {
    name: 'Practice: pen and pencil',
    svg: svg640(PAPER, false),
    setup() {
      lock('Paper');
    },
  },
  // Shapes: an empty stage
  shapes: {
    name: 'Practice: shapes',
    svg: svg640(`<path id="Ground" d="M0 330c120-10 230-12 340-6s210 10 300 0v76H0z" fill="#1f2b5c"/>`),
    setup() {
      lock('Sky', 'Ground');
    },
  },
  // Text and fonts: a sheet of paper for a title
  text: {
    name: 'Practice: text and fonts',
    svg: svg640(
      `${PAPER}
<rect id="Band" y="300" width="640" height="100" fill="#e6533c"/>`,
      false,
    ),
    setup() {
      lock('Paper', 'Band');
    },
  },
  // Images and assets: a frame on a wall, and a photo waiting in Assets
  images: {
    name: 'Practice: images and assets',
    svg: svg640(
      `<rect id="Wall" width="640" height="400" fill="#e9e1d3"/>
<rect id="Frame" x="362" y="62" width="260" height="180" rx="4" fill="#6b4a2b"/>
<rect id="Mat" x="372" y="72" width="240" height="160" fill="#f7f2e8"/>`,
      false,
    ),
    setup() {
      lock('Wall', 'Frame', 'Mat');
      const p = sunsetPNG();
      if (p) addAsset({ kind: 'image', name: 'Sunset', mime: 'image/png', data: p.data, w: p.w, h: p.h, size: p.size });
      renderAssets();
    },
  },
};

export const tours: Record<string, TourStep[]> = {
  select: [
    // select it
    {
      target: () => shapeEl(box()),
      enter: () => {
        if (S.tool !== 'select') setTool('select');
        select(null);
      },
      done: () => S.sel === box()?.id,
      show: () => drag(offCentre(box()!), offCentre(box()!), { ms: 120 }),
    },
    // move it
    {
      target: () => q('#wrap'),
      enter: c => {
        pick(box());
        c.p = JSON.stringify(box()?.b.pos);
      },
      done: c => {
        const p = box()?.b.pos as number[] | undefined,
          p0 = JSON.parse(c.p || 'null');
        return !!p && !!p0 && Math.hypot(p[0] - p0[0], p[1] - p0[1]) > 10;
      },
      show: async () => {
        const a = offCentre(box()!),
          k = screenOf(110, 0).x - screenOf(0, 0).x;
        await drag(a, { x: a.x - k * 0.7, y: a.y - k * 0.35 }, { ms: 800 });
      },
      clip: () => [shapeEl(box())],
    },
    // scale it from a corner
    {
      target: () => handle('se'),
      enter: c => {
        pick(box());
        c.s = JSON.stringify(box()?.b.scl);
      },
      done: c => JSON.stringify(box()?.b.scl) !== c.s,
      show: async () => {
        const a = centre(handle('se')!),
          k = screenOf(50, 0).x - screenOf(0, 0).x;
        await drag(a, { x: a.x + k, y: a.y + k }, { shift: true, ms: 800 });
      },
      clip: () => [shapeEl(box())],
    },
    // move its origin to a corner
    {
      target: () => handle('org'),
      enter: c => {
        pick(box());
        c.o = org(box());
      },
      done: c => org(box()) !== c.o,
      show: async () => {
        const a = centre(handle('org')!),
          b = centre(handle('sw')!);
        await drag(a, b, { ms: 800 });
      },
      clip: () => [shapeEl(box())],
    },
    // rotate it around the origin
    {
      target: () => handle('rot'),
      enter: c => {
        pick(box());
        c.r = box()?.b.rot || 0;
      },
      done: c => Math.abs((box()?.b.rot || 0) - c.r) > 5,
      show: async () => {
        const a = centre(handle('rot')!),
          k = screenOf(120, 0).x - screenOf(0, 0).x;
        await drag(a, { x: a.x + k, y: a.y + k * 0.25 }, { ms: 900 });
      },
      clip: () => [shapeEl(box())],
    },
    // Shift+click to add the ball
    {
      target: () => shapeEl(byName('Ball')),
      enter: () => {
        const b = box();
        if (b && (S.sel !== b.id || S.selSet.size > 1)) select(b.id);
      },
      done: () => S.selSet.size >= 2,
      show: () => {
        const p = offCentre(byName('Ball')!, 0.3, 0.35);
        return drag(p, p, { shift: true, ms: 120 });
      },
      clip: () => [shapeEl(box()), shapeEl(byName('Ball'))],
    },
  ],

  pen: [
    // P: the Pen
    {
      target: () => q('#tools [data-group="pen"]'),
      enter: () => {
        if (S.tool === 'pen') setTool('select');
      },
      done: () => S.tool === 'pen',
      show: () => press('P', 'p', 'KeyP'),
    },
    // click twice: two corners
    {
      target: () => q('#wrap'),
      enter: tool('pen'),
      done: () => penPts().length >= 2,
      show: async () => {
        await tap(screenOf(150, 280));
        await tap(screenOf(250, 120));
      },
    },
    // drag: a curve
    {
      target: () => q('#wrap'),
      enter: () => penWith(2),
      done: () => penPts().some(n => n[4] !== n[0] || n[5] !== n[1]),
      show: () => {
        const k = screenOf(60, 0).x - screenOf(0, 0).x,
          a = screenOf(380, 150);
        return drag(a, { x: a.x + k, y: a.y + k * 0.66 }, { ms: 800 });
      },
    },
    // click the first point: closed
    {
      target: () => q('#wrap'),
      enter: c => {
        penWith(3);
        c.n = count(closedPath);
      },
      done: c => count(closedPath) > c.n,
      show: async () => {
        await tap(screenOf(330, 300));
        const f = penPts()[0];
        if (f) await tap(screenOf(f[0], f[1]));
      },
    },
    // A: drag a node
    {
      target: () => q('#wrap'),
      enter: c => {
        if (S.pen) S.pen = null;
        const l = drawnPath();
        pick(l);
        c.id = l.id;
        c.s = state(l);
      },
      done: c => S.tool === 'node' && state(allLayers().find(l => l.id === c.id) || null) !== c.s,
      show: async () => {
        await press('A', 'a', 'KeyA');
        const n = q('#overlay [data-node="0,1,0"]');
        if (!n) return;
        const a = centre(n),
          k = screenOf(40, 0).x - screenOf(0, 0).x;
        await drag(a, { x: a.x - k, y: a.y - k * 0.6 }, { ms: 700 });
      },
      clip: () => [shapeEl(last(closedPath))],
    },
    // N: the Pencil, drawn freehand
    {
      target: () => q('#wrap'),
      enter: c => (c.n = allLayers().length),
      done: c => allLayers().length > c.n,
      show: async () => {
        await press('N', 'n', 'KeyN');
        await trace(wave(), { ms: 1400 });
      },
    },
  ],

  shapes: [
    // M, then drag: a rectangle
    {
      target: () => shapesBtn(),
      enter: c => (c.n = count(l => l.type === 'rect')),
      done: c => count(l => l.type === 'rect') > c.n,
      show: async () => {
        await press('M', 'm', 'KeyM');
        await drag(screenOf(90, 170), screenOf(250, 300), { ms: 800 });
      },
    },
    // round its corners
    {
      target: () => q('#sh-rad')?.closest('.row') || null,
      enter: () => pick(last(l => l.type === 'rect')),
      done: () => {
        const r = last(l => l.type === 'rect');
        return !!r && (valueAt(r, 'rad', S.time) || 0) > 0;
      },
      show: () => type(q('#sh-rad') as HTMLInputElement, '24'),
      clip: () => [shapeEl(last(l => l.type === 'rect'))],
    },
    // hold the shapes button: Star
    {
      target: () => {
        const f = q('#toolfly');
        return f && !(f as HTMLElement).hidden ? f : shapesBtn();
      },
      enter: () => S.tool === 'star' && setTool('select'),
      done: () => S.tool === 'star',
      show: () => hold(shapesBtn(), () => q('#toolfly [data-tool="star"]')),
    },
    // drag out a star from its centre
    {
      target: () => q('#wrap'),
      enter: c => {
        if (S.tool !== 'star') setTool('star');
        c.n = count(isStar);
      },
      done: c => count(isStar) > c.n,
      show: () => drag(screenOf(440, 200), screenOf(440, 110), { ms: 800 }),
    },
    // more points
    {
      target: () => q('#sh-n')?.closest('.row') || null,
      enter: c => {
        pick(last(isStar));
        const s = last(isStar);
        c.n = s ? liveShape(s)!.n : 5;
      },
      done: c => {
        const s = last(isStar),
          sh = s && liveShape(s);
        return !!sh && sh.n !== c.n;
      },
      show: () => type(q('#sh-n') as HTMLInputElement, '8'),
      clip: () => [shapeEl(last(isStar))],
    },
  ],

  text: [
    // T: the Text tool
    {
      target: () => q('#tools [data-tool="text"]'),
      enter: () => S.tool === 'text' && setTool('select'),
      done: () => S.tool === 'text',
      show: () => press('T', 't', 'KeyT'),
    },
    // click on the canvas: a new text, ready to type
    {
      target: () => q('#wrap'),
      enter: c => {
        if (S.tool !== 'text') setTool('text');
        c.n = count(l => l.type === 'text');
      },
      done: c => count(l => l.type === 'text') > c.n,
      show: () => tap(screenOf(70, 150)),
    },
    // type, then Esc
    {
      target: () => editor() || q('#wrap'),
      enter: () => {
        const l = lastText();
        if (l && !textEditing() && l.geo.text === 'Text') {
          pick(l);
          startTextEdit(l, true);
        }
      },
      done: () => {
        const l = lastText();
        return !!l && l.geo.text !== 'Text' && !textEditing();
      },
      show: () => type(editor() as unknown as HTMLInputElement, 'Hello there'),
      clip: () => [shapeEl(lastText())],
    },
    // the font list
    {
      target: () => q('#g-family'),
      enter: c => {
        pick(lastText());
        into('#g-family');
        c.f = lastText()?.geo.family;
      },
      done: c => {
        const l = lastText();
        return !!l && l.geo.family !== c.f;
      },
      show: async () => {
        await click(q('#g-family'));
        await type(q('#fpFind') as HTMLInputElement, 'Pacifico');
      },
      clip: () => [shapeEl(lastText())],
    },
    // the size
    {
      target: () => q('#g-size')?.closest('.row') || null,
      enter: c => {
        pick(lastText());
        into('#g-size');
        c.s = lastText()?.geo.size;
      },
      done: c => {
        const l = lastText();
        return !!l && l.geo.size !== c.s;
      },
      show: () => type(q('#g-size') as HTMLInputElement, '72'),
      clip: () => [shapeEl(lastText())],
    },
  ],

  images: [
    // the Assets tab
    {
      target: () => q('#sideTabs [data-v="assets"]'),
      enter: () => {
        if (S.tab === 'assets') (q('#sideTabs [data-v="layers"]') as HTMLElement).click();
      },
      done: () => S.tab === 'assets',
      show: () => click(q('#sideTabs [data-v="assets"]')),
    },
    // click the picture: it goes on the canvas
    {
      target: () => q('#ag .at[data-aid]'),
      enter: c => {
        if (S.tab !== 'assets') (q('#sideTabs [data-v="assets"]') as HTMLElement).click();
        c.n = count(isImage);
      },
      done: c => count(isImage) > c.n,
      show: () => click(assetThumb()),
      clip: () => [shapeEl(last(isImage))],
    },
    // its size: the proportions stay
    {
      target: () => q('#i-sz_0')?.closest('.row') || null,
      enter: c => {
        pick(last(isImage));
        into('#i-sz_0');
        c.s = state(last(isImage));
      },
      done: c => state(last(isImage)) !== c.s,
      show: () => type(q('#i-sz_0') as HTMLInputElement, '240'),
      clip: () => [shapeEl(last(isImage))],
    },
    // drag it into the frame
    {
      target: () => q('#wrap'),
      enter: c => {
        if (S.tool !== 'select') setTool('select');
        pick(last(isImage));
        c.p = JSON.stringify(last(isImage)?.b.pos);
      },
      done: c => {
        const p = last(isImage)?.b.pos as number[] | undefined,
          p0 = JSON.parse(c.p || 'null');
        return !!p && !!p0 && Math.hypot(p[0] - p0[0], p[1] - p0[1]) > 20;
      },
      show: async () => {
        const l = last(isImage),
          el = shapeEl(l);
        if (!l || !el) return;
        const m = centre(el),
          a = offCentre(l, 0.3, 0.35),
          to = screenOf(492, 152);
        await drag(a, { x: a.x + to.x - m.x, y: a.y + to.y - m.y }, { ms: 900 });
      },
      clip: () => [byName('Frame') && shapeEl(byName('Frame'))],
    },
  ],
};
