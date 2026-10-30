// SVGcinema — help/topics/interface: Interface (moving around the canvas, copy and paste, the document's settings,
// keyboard shortcuts, thumbnails): scenes and tour steps; the words are in help/content.json. (Snapping, guides and
// rulers is in this group too; its scene and steps are in help/topics/arrange.)
import type { Layer } from '../../model/types';
import { S, doc } from '../../core/state';
import { select } from '../../core/history';
import { valueAt } from '../../core/constants';
import { WRAP } from '../../core/dom';
import { bgPaint } from '../../model/background';
import { fitView, isFitView, zoomAt } from '../../tools/hand';
import { closeZoomMenu } from '../../ui/zoom-menu';
import { closeLayerMenu, copyLayers, hasLayerClip, pasteLayers } from '../../ui/layer-menu';
import { openShortcuts } from '../../ui/shortcuts';
import { closeModal } from '../../ui/topbar';
import { boxOf } from '../../render/overlay';
import { type XY, addBox, centre, click, drag, hover, moveTo, press, rightClick, type } from '../ghost';
import {
  type Scene,
  type TourStep,
  artboard,
  byName,
  lock,
  lpRow,
  offEditor,
  playStep,
  q,
  screenOf,
  shapeEl,
  svg640,
} from '../kit';
import { choose, keep, reveal, rowOf, selected, shown } from './style';

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** a word beside the pointer (the key held during a drag or a scroll), or none */
function tag(label: string | null) {
  const k = q('.tg-ghost .tg-key') as HTMLElement | null;
  if (!k) return;
  k.textContent = label || '';
  k.hidden = !label;
}
/** what is under a point, leaving out the tour's own card, light and pointer */
const under = (p: XY) =>
  document.elementsFromPoint(p.x, p.y).find(e => !e.closest('.tg-card, .tg-ghost, .tg-spot')) || WRAP;
/** Ctrl + scroll at a point: the wheel turned `n` notches (negative `dy` zooms in), as a mouse sends it */
async function ctrlScroll(p: XY, dy: number, n: number) {
  await moveTo(p);
  tag('Ctrl');
  await wait(300);
  for (let i = 0; i < n; i++) {
    under(p).dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: p.x,
        clientY: p.y,
        deltaY: dy,
        deltaMode: 0,
        ctrlKey: true,
      }),
    );
    addBox(new DOMRect(p.x - 30, p.y - 24, 60, 52));
    await wait(160);
  }
  await wait(300);
  tag(null);
}
/** hold Space, drag from a to b, let go of Space (the hand tool for as long as Space is down) */
async function spaceDrag(a: XY, b: XY) {
  await moveTo(a);
  tag('Space');
  const t = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
  t.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
  await wait(260);
  await drag(a, b, { ms: 1000 });
  t.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
  tag(null);
}
const ctrl = { ctrlKey: true };

export const scenes: Record<string, Scene> = {
  // Moving around the canvas: a house on the hills at night, with a small cat in its window to zoom in on
  'canvas-nav': {
    name: 'Practice: moving around the canvas',
    svg: svg640(`<circle id="Moon" cx="510" cy="92" r="30" fill="#fff4c9"/>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>
<rect id="House" x="150" y="228" width="110" height="78" fill="#e9eefb"/>
<path id="Roof" d="M138 232l67-54 67 54z" fill="#e5484d"/>
<rect id="Window" x="188" y="246" width="34" height="28" rx="2" fill="#ffd36e"/>
<path id="Cat" d="M199 274c0-7 2.4-11 6-11s6 4 6 11zM201.6 259.5L202 254.2l2 2.1h2l2-2.1.4 5.3a3.4 3.4 0 01-6.8 0z" fill="#141a33"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
  // Copy, paste and the right-click menu: a fish in the sea, to copy
  'copy-paste': {
    name: 'Practice: copy, paste and the right-click menu',
    svg: svg640(
      `<defs><linearGradient id="seag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a7fb8"/><stop offset="1" stop-color="#123a6b"/></linearGradient></defs>
<rect id="Sea" width="640" height="400" fill="url(#seag)"/>
<path id="Sand" d="M0 344c120-16 250-18 360-8s200 10 280 0v64H0z" fill="#e8d3a2"/>
<g id="Fish">
<path id="Tail" d="M232 190l-46-36v72z" fill="#ff9a62" stroke="#a8381f" stroke-width="4" stroke-linejoin="round"/>
<path id="Body" d="M222 190c34-50 128-58 170 0-42 58-136 50-170 0z" fill="#ff7a59" stroke="#a8381f" stroke-width="4"/>
<circle id="Eye" cx="356" cy="180" r="7" fill="#141a33"/>
</g>`,
      false,
    ),
    setup() {
      lock('Sea', 'Sand');
      ORIG = byName('Fish')?.id || '';
    },
  },
  // Canvas and animation settings: a ball that rolls along the ground, on a transparent background
  'doc-settings': {
    name: 'Practice: canvas and animation settings',
    svg: svg640(
      `<rect id="Ground" y="320" width="640" height="80" fill="#1f2b5c"/>
<circle id="Ball" cx="90" cy="290" r="30" fill="#ffb02e"/>`,
      false,
    ),
    setup() {
      lock('Ground');
      const b = byName('Ball');
      if (b) {
        const [x, y] = (b.b.pos as number[]) || [0, 0];
        b.t.pos = [
          [0, [x, y], 'ease'],
          [3, [x + 460, y], 'ease'],
        ];
      }
    },
  },
  // Keyboard shortcuts: a small scene (the steps are in the shortcuts window)
  shortcuts: {
    name: 'Practice: keyboard shortcuts',
    svg: svg640(`<circle id="Sun" cx="470" cy="128" r="44" fill="#ffd36e"/>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
  // Thumbnails for Windows and Linux: done outside the editor (a small scene all the same)
  thumbnails: {
    name: 'Practice: thumbnails for windows and linux',
    svg: svg640(`<circle id="Sun" cx="470" cy="128" r="44" fill="#ffd36e"/>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
};

/* ---------- Moving around the canvas ---------- */

const cat = () => byName('Cat');
/** the selection is in the middle of the canvas and fills it (Fit selection) */
function fitsSelection() {
  const e = shapeEl(cat()),
    w = WRAP.getBoundingClientRect();
  if (!e) return false;
  const r = e.getBoundingClientRect();
  return (
    Math.abs(r.left + r.width / 2 - (w.left + w.width / 2)) < 4 &&
    Math.abs(r.top + r.height / 2 - (w.top + w.height / 2)) < 4 &&
    Math.max(r.width / (w.width - 96), r.height / (w.height - 96)) > 0.9
  );
}
const zoomMenu = () => q('#zoomMenu:not([hidden])');

/* ---------- Copy, paste and the right-click menu ---------- */

/** the fish the scene starts with */
let ORIG = '';
const fish = () => doc.layers.find(l => l.id === ORIG) || byName('Fish');
/** the copies of the fish (pasted ones keep its name; duplicates add "copy") */
const copies = () => doc.layers.filter(l => l.type === 'group' && !l.parent && /^Fish/.test(l.name) && l.id !== ORIG);
/** the copy the steps work on: the selected one, else the newest */
const copy = (): Layer | null => copies().find(l => S.selSet.has(l.id)) || copies().pop() || null;
/** a copy to work on, selected (made the way Copy and Paste make it, when the person went another way) */
function ensureCopy() {
  if (!copies().length) {
    const f = fish();
    if (!f) return;
    select(f.id);
    if (!hasLayerClip()) copyLayers();
    pasteLayers();
  }
  const c = copy();
  if (c && !(S.sel === c.id && S.selSet.size === 1)) select(c.id);
}
const order = (l: Layer | null) => (l ? doc.layers.indexOf(l) : -1);
const layerMenu = () => q('#layermenu:not([hidden])');
const lmItem = (id: string) => q(`#layermenu:not([hidden]) [data-lm="${id}"]`);
const subMenu = () => q('#layermenu:not([hidden]) .lm-it.open > .lm-sub');
/** the copy on the canvas (the steps press it at its lower right, off its centre, where the origin handle is, and
 *  away from the first fish) */
const onCopy = (): Element | null => shapeEl(copy());
const AT = 0.72;
/** how far apart the two fish are (document units, between their middles) */
function apart() {
  const a = fish() && boxOf(fish()!),
    b = copy() && boxOf(copy()!);
  return a && b ? Math.hypot(b.x + b.w / 2 - a.x - a.w / 2, b.y + b.h / 2 - a.y - a.h / 2) : 0;
}

/* ---------- Canvas and animation settings ---------- */

const docSec = () => q('#d-w')?.closest('.sec') || null;
/** a step on a field of the Document section: nothing selected, and the field in view */
const docEnter = (sel: string) => () => {
  if (S.sel || S.selSet.size) select(null);
  reveal(q(sel));
};

/* ---------- Keyboard shortcuts ---------- */

const keysOpen = () => !(q('#mKeys') as HTMLElement).hidden;
const tabOn = () => (q('#skTabs [aria-selected="true"]') as HTMLElement | null)?.dataset.tab || '';

export const tours: Record<string, TourStep[]> = {
  'canvas-nav': [
    // + in the canvas bar
    {
      target: () => q('#zIn'),
      enter: c => {
        closeZoomMenu();
        if (!isFitView()) fitView();
        c.s = S.scale;
      },
      done: c => S.scale > c.s * 1.2,
      show: async () => {
        await click(q('#zIn'));
        await click(q('#zIn'));
      },
      clip: () => [q('#zVal'), q('#wrap')],
    },
    // Ctrl + scroll over the cat
    {
      target: () => q('#wrap'),
      enter: c => {
        closeZoomMenu();
        c.s = S.scale;
      },
      done: c => Math.abs(S.scale / c.s - 1) > 0.2,
      show: () => {
        const c = shapeEl(cat());
        return ctrlScroll(c ? centre(c) : screenOf(205, 262), -30, 4);
      },
      clip: () => [q('#zVal'), q('#wrap')],
    },
    // hold Space and drag
    {
      target: () => q('#wrap'),
      enter: c => (c.p = { ...S.pan }),
      done: c => Math.hypot(S.pan.x - c.p.x, S.pan.y - c.p.y) > 40,
      show: () => {
        const w = WRAP.getBoundingClientRect(),
          a = { x: w.left + w.width * 0.42, y: w.top + w.height * 0.55 };
        return spaceDrag(a, { x: a.x + 150, y: a.y - 70 });
      },
      clip: () => [q('#wrap')],
    },
    // Fit selection: the cat, then 2
    {
      target: () => lpRow('Cat'),
      enter: c => {
        closeZoomMenu();
        c.z = S.zoom;
      },
      done: () => selected('Cat') && fitsSelection(),
      show: async () => {
        if (!selected('Cat')) await click(lpRow('Cat'), 0.3, 0.5);
        await press('2', '2', 'Digit2');
      },
      clip: () => [q('#wrap')],
    },
    // Fit, from the zoom menu
    {
      target: () => zoomMenu() || q('#zVal'),
      enter: () => {
        closeZoomMenu();
        if (isFitView()) zoomAt(3);
      },
      done: () => isFitView(),
      show: async () => {
        if (!zoomMenu()) await click(q('#zVal'));
        await click(q('#zoomMenu [data-z="fit"]'));
      },
      clip: () => [zoomMenu(), q('#wrap')],
    },
  ],

  'copy-paste': [
    // select the fish, Ctrl C
    {
      target: () => q('#wrap'),
      enter: () => {
        closeLayerMenu();
        if (S.sel) select(null);
      },
      done: () => hasLayerClip(),
      show: async () => {
        const f = fish(),
          b = byName('Body');
        if (f && !S.selSet.has(f.id)) await click(b ? shapeEl(b) : shapeEl(f), 0.3, 0.6);
        await press('Ctrl C', 'c', 'KeyC', ctrl);
      },
      clip: () => [shapeEl(fish())],
    },
    // Ctrl V
    {
      target: () => q('#wrap'),
      enter: c => {
        closeLayerMenu();
        const f = fish();
        if (!hasLayerClip() && f) {
          select(f.id);
          copyLayers();
        }
        c.n = copies().length;
      },
      done: c => copies().length > c.n,
      show: () => press('Ctrl V', 'v', 'KeyV', ctrl),
      clip: () => [shapeEl(fish()), shapeEl(copy())],
    },
    // drag the copy to the right
    {
      target: () => q('#wrap'),
      enter: () => {
        closeLayerMenu();
        ensureCopy();
      },
      done: () => apart() > 80,
      show: async () => {
        const e = onCopy();
        if (!e) return;
        const a = centre(e, AT, AT),
          d = screenOf(110, 20),
          o = screenOf(0, 0);
        await drag(a, { x: a.x + d.x - o.x, y: a.y + d.y - o.y }, { ms: 900 });
      },
      clip: () => [shapeEl(fish()), shapeEl(copy())],
    },
    // right-click the copy
    {
      target: onCopy,
      enter: () => {
        closeLayerMenu();
        ensureCopy();
      },
      done: () => !!layerMenu(),
      show: () => rightClick(onCopy(), AT, AT),
      clip: () => [layerMenu(), shapeEl(fish())],
    },
    // Flip horizontal
    {
      target: () => lmItem('fliph') || onCopy(),
      enter: () => ensureCopy(),
      done: () => {
        const c = copy();
        return !!c && (valueAt(c, 'scl', S.time) || [1, 1])[0] < 0;
      },
      show: async () => {
        if (!layerMenu()) await rightClick(onCopy(), AT, AT);
        await click(lmItem('fliph'));
      },
      clip: () => [layerMenu(), shapeEl(fish()), shapeEl(copy())],
    },
    // Arrange › Send backward
    {
      target: () => (layerMenu() ? subMenu() || lmItem('arr') : onCopy()),
      enter: c => {
        if (!lmItem('arr')) closeLayerMenu();
        ensureCopy();
        c.c = copy()?.id;
      },
      done: c => {
        const k = doc.layers.find(l => l.id === c.c) || copy();
        return !!k && order(k) < order(fish());
      },
      show: async () => {
        if (!layerMenu()) await rightClick(onCopy(), AT, AT);
        await hover(lmItem('arr'));
        await click(lmItem('bwd'));
      },
      clip: () => [layerMenu(), subMenu(), shapeEl(fish()), shapeEl(copy())],
    },
  ],

  'doc-settings': [
    // nothing selected: the inspector shows the Document section
    {
      target: () => q('#wrap'),
      enter: () => keep('Ball'),
      done: () => !S.sel && !S.selSet.size && !!q('#d-w'),
      show: () => click(q('#wrap'), 0.5, 0.36),
      clip: () => [docSec(), artboard()],
    },
    // Canvas W
    {
      target: () => rowOf('#d-w'),
      enter: docEnter('#d-w'),
      done: () => doc.w !== 640,
      show: async () => type((await shown(() => q('#d-w'))) as HTMLInputElement, '800'),
      clip: () => [artboard()],
    },
    // Background
    {
      target: () => rowOf('#d-bg'),
      enter: docEnter('#d-bg'),
      done: () => bgPaint(doc).alpha > 0 && !!doc.bg,
      show: async () => type((await shown(() => q('#d-bg'))) as HTMLInputElement, '#a8d8f0'),
      clip: () => [artboard()],
    },
    // Length
    {
      target: () => rowOf('#d-dur'),
      enter: docEnter('#d-dur'),
      done: () => Math.abs(doc.dur - 3) > 0.001,
      show: async () => type((await shown(() => q('#d-dur'))) as HTMLInputElement, '4'),
      clip: () => [docSec()],
    },
    // Repeat
    {
      target: () => rowOf('#d-it'),
      enter: docEnter('#d-it'),
      done: () => (doc.it || 0) !== 0,
      show: async () => choose((await shown(() => q('#d-it'))) as HTMLSelectElement, '2'),
      clip: () => [docSec()],
    },
    // Direction
    {
      target: () => rowOf('#d-dir'),
      enter: docEnter('#d-dir'),
      done: () => doc.dir !== 'normal',
      show: async () => choose((await shown(() => q('#d-dir'))) as HTMLSelectElement, 'alternate'),
      clip: () => [docSec()],
    },
    playStep(),
  ],

  shortcuts: [
    // the keyboard button (or F1)
    {
      target: () => q('#bKeys'),
      enter: () => keysOpen() && closeModal(q('#mKeys') as HTMLElement),
      done: () => keysOpen(),
      show: () => click(q('#bKeys')),
      clip: () => [keysOpen() ? q('#mKeys .dlg') : null],
    },
    // a tab
    {
      target: () => q('#sk-animation'),
      enter: c => {
        if (!keysOpen()) openShortcuts();
        if (tabOn() === 'animation') (q('#sk-general') as HTMLElement).click();
        c.t = tabOn();
      },
      done: c => keysOpen() && !!tabOn() && tabOn() !== c.t,
      show: () => click(q('#sk-animation')),
      clip: () => [q('#mKeys .dlg')],
    },
    // search
    {
      target: () => q('#skFind'),
      enter: () => {
        if (!keysOpen()) openShortcuts();
      },
      done: () => keysOpen() && !!(q('#skFind') as HTMLInputElement).value.trim() && !!q('#skBody .sk-list'),
      show: () => type(q('#skFind') as HTMLInputElement, 'zoom'),
      clip: () => [q('#mKeys .dlg')],
    },
    // close it
    {
      target: () => q('#mKeys [data-close]'),
      enter: () => {
        if (!keysOpen()) openShortcuts();
      },
      done: () => !keysOpen(),
      show: () => click(q('#mKeys [data-close]')),
      clip: () => [q('#mKeys .dlg')],
    },
  ],

  thumbnails: [offEditor(), offEditor(), offEditor(), offEditor()],
};
