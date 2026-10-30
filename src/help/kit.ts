// SVGcinema — help/kit
// What the guided tours (help/topics/*) are written with: the shape of a step, and small helpers to find
// things on the screen (a point of the document, a time on the timeline's ruler, a layer's shape) and to
// write the common steps (play it, move the playhead, a step with nothing to show).
import type { Layer } from '../model/types';
import { S, doc } from '../core/state';
import { togglePlay } from '../core/playback';
import { CONTENT } from '../core/dom';
import { centre, click, drag } from './ghost';

export interface Ctx {
  [k: string]: any;
}
/** What one step of a tour does in the editor (its words are in help/content.json, in the same order). */
export interface TourStep {
  /** the control the step points at (it stays lit while the rest of the editor dims) */
  target: () => Element | null;
  /** puts the editor in the state the step starts from (e.g. paused, for a "play it" step) */
  enter?: (c: Ctx) => void;
  /** true once the person has done the step: the tour moves on by itself */
  done: (c: Ctx) => boolean;
  /** "Show me": does the step with a pointer the person can watch (help/ghost) */
  show: (c: Ctx) => Promise<void>;
  /** what else the step's clip must show besides the control and the pointer's way (e.g. where the result
   *  appears): elements or screen boxes; the clip is cropped to all of them (site/captures.py) */
  clip?: () => Array<Element | DOMRect | null | undefined>;
}
/** A practice scene: plain SVG opened the way File › Open opens one (its ids become the layer names), then
 *  `setup` adds what plain SVG can't say (locks, the tracks a tutorial starts from). The animation's settings
 *  must stay a new project's defaults (3 s, loop forever, Normal direction). */
export interface Scene {
  /** the project's name in the top bar ("Practice: …") */
  name: string;
  svg: string;
  setup?: () => void;
  /** the tutorial uses the ☰ menu (File, Edit, View…): a practice editor shows it (it is hidden otherwise) */
  menu?: boolean;
  /** the tutorial uses the Agent panel: a practice editor shows the Agent button (it is hidden otherwise) */
  agent?: boolean;
  /** the timeline's height in this practice editor (184 px when not given; e.g. taller for the graph) */
  tl?: number;
}

export const q = (sel: string) => document.querySelector(sel);
/** Every layer of the document (the list is flat: groups are the layers' parents). */
export const allLayers = (): Layer[] => doc.layers;
export const byName = (n: string) => allLayers().find(l => l.name === n) || null;
export const lock = (...names: string[]) =>
  names.forEach(n => {
    const l = byName(n);
    if (l) l.lock = true;
  });
/** A layer's row in the Layers panel. */
export const lpRow = (name: string) => {
  const l = byName(name);
  return l ? q(`#lp [data-lid="${l.id}"]`) : null;
};
/** The sky behind most practice scenes (a layer named Sky). */
export const SKY = `<defs><linearGradient id="skyg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3a78"/><stop offset="1" stop-color="#e98a6d"/></linearGradient></defs>
<rect id="Sky" width="640" height="400" fill="url(#skyg)"/>`;
/** A 640 × 400 practice scene's SVG around the given markup. */
export const svg640 = (inner: string, sky = true) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400">${sky ? SKY : ''}\n${inner}\n</svg>`;

/** A point of the document (its own units) on the screen. */
export function screenOf(x: number, y: number) {
  const m = CONTENT.getScreenCTM();
  const p = new DOMPoint(x, y).matrixTransform(m || new DOMMatrix());
  return { x: p.x, y: p.y };
}
/** A box of the document (its own units) on the screen. */
export function screenBox(x: number, y: number, w: number, h: number) {
  const a = screenOf(x, y),
    b = screenOf(x + w, y + h);
  return new DOMRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
}
/** The artboard on the screen (a play step's clip shows it). */
export const artboard = () => {
  const r = doc ? screenBox(doc.vx || 0, doc.vy || 0, doc.w, doc.h) : null;
  return r && r.width ? r : null;
};
/** Where a time is on the timeline's ruler. */
export function onRuler(t: number) {
  const r = (q('#ruler') as HTMLElement).getBoundingClientRect();
  return { x: r.left + t * S.pps, y: r.top + r.height / 2 };
}
export const near = (t: number) => Math.abs(S.time - t) <= 0.1;
export const pause = () => S.playing && togglePlay();
/** the layer has a keyframe on `k` at time t (not at 0) */
export const keyAt = (l: Layer | null, k: string, t: number) =>
  !!(l && l.t[k] && l.t[k].some(f => Math.abs(f[0] - t) <= 0.1 && Math.abs(f[0]) > 0.05));
/** a layer's shape on the canvas, away from its centre (the centre is the origin handle) */
export function offCentre(l: Layer, fx = 0.68, fy = 0.68) {
  const s = document.getElementById('e-' + l.id + '-s') || document.getElementById('e-' + l.id);
  return s ? centre(s, fx, fy) : screenOf(320, 200);
}
/** a layer's drawn element on the canvas */
export const shapeEl = (l: Layer | null) =>
  l ? document.getElementById('e-' + l.id + '-s') || document.getElementById('e-' + l.id) : null;

/** A track on the timeline, for a step's clip: its name and its keyframes. */
export function trackBits(l: Layer | null, k: string): Element[] {
  if (!l) return [];
  const row = q(`#tlbody .tl-row[data-lid="${l.id}"][data-prop="${k}"]`);
  return [
    row && row.querySelector('.tl-name'),
    ...Array.from(document.querySelectorAll(`#tlbody .kf[data-lid="${l.id}"][data-prop="${k}"]`)),
  ].filter(Boolean) as Element[];
}
/** "Play it": the play button; done once it plays. The clip shows the artboard too. */
export const playStep = (): TourStep => ({
  target: () => q('#tPlay'),
  enter: () => pause(),
  done: () => S.playing,
  show: () => click(q('#tPlay')),
  clip: () => [artboard()],
});
/** "Move the playhead to …": drag the playhead along the ruler. */
export const playheadStep = (t = 2): TourStep => ({
  target: () => q('#ruler'),
  done: () => near(t),
  show: () => drag(onRuler(S.time), onRuler(t), { ms: 800 }),
});
/** A step that happens outside the editor (on your page, in your files): no light, nothing to show, and no
 *  clip (the step has "clip": false in content.json). */
export const offEditor = (): TourStep => ({
  target: () => null,
  done: c => !!c.shown,
  show: async c => {
    c.shown = true;
  },
});
