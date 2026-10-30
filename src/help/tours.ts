// SVGcinema — help/tours
// What each guided tour's steps do in the editor. The words of every step (its title, the text on the
// website and in the Help panel, the short line on the tour card) are in help/content.json; this file has,
// for the same steps in the same order:
//   target  the control the step points at (it stays lit while the rest of the editor dims)
//   enter   puts the editor in the state the step starts from (e.g. paused, for a "play it" step)
//   done    true once the person has done the step: the tour moves on by itself
//   show    "Show me": does the step with a pointer the person can watch (help/ghost), through the same
//           pointer and key events a person would make
// tests/browser/help-tours.py runs every tour with Show me alone, so a change to the editor that breaks a
// step fails the tests.
import type { Layer } from '../model/types';
import { S, selLayer } from '../core/state';
import { select, setTime, setTool } from '../core/history';
import { togglePlay } from '../core/playback';
import { isEasePopOpen } from '../ui/ease-pop';
import { CONTENT } from '../core/dom';
import { allLayers, byName } from './scenes';
import { centre, click, drag, press, type } from './ghost';

export interface Ctx {
  [k: string]: any;
}
export interface TourStep {
  target: () => Element | null;
  enter?: (c: Ctx) => void;
  done: (c: Ctx) => boolean;
  show: (c: Ctx) => Promise<void>;
}

const q = (sel: string) => document.querySelector(sel);
/** A point of the document (its own units) on the screen. */
function screenOf(x: number, y: number) {
  const m = CONTENT.getScreenCTM();
  const p = new DOMPoint(x, y).matrixTransform(m || new DOMMatrix());
  return { x: p.x, y: p.y };
}
/** Where a time is on the timeline's ruler. */
function onRuler(t: number) {
  const r = (q('#ruler') as HTMLElement).getBoundingClientRect();
  return { x: r.left + t * S.pps, y: r.top + r.height / 2 };
}
const nearTwo = () => Math.abs(S.time - 2) <= 0.1;
const pause = () => S.playing && togglePlay();
const keyAt = (l: Layer | null, k: string, t: number) =>
  !!(l && l.t[k] && l.t[k].some(f => Math.abs(f[0] - t) <= 0.1 && Math.abs(f[0]) > 0.05));
/** the ball the person drew (the last ellipse) */
const ball = () =>
  allLayers()
    .filter(l => l.type === 'ellipse')
    .pop() || null;
/** a layer's shape on the canvas, away from its centre (the centre is the origin handle) */
function offCentre(l: Layer) {
  const s = document.getElementById('e-' + l.id + '-s');
  return s ? centre(s, 0.68, 0.68) : screenOf(320, 200);
}
const playStep = (): TourStep => ({
  target: () => q('#tPlay'),
  enter: () => pause(),
  done: () => S.playing,
  show: () => click(q('#tPlay')),
});
const playheadStep = (): TourStep => ({
  target: () => q('#ruler'),
  done: () => nearTwo(),
  show: () => drag(onRuler(S.time), onRuler(2), { ms: 800 }),
});

export const TOURS: Record<string, TourStep[]> = {
  'first-animation': [
    {
      target: () => q('#tools [data-group="shapes"]'),
      enter: () => S.tool === 'ellipse' && setTool('select'),
      done: () => S.tool === 'ellipse',
      show: () => press('O', 'o', 'KeyO'),
    },
    {
      target: () => q('#wrap'),
      enter: c => (c.n = allLayers().filter(l => l.type === 'ellipse').length),
      done: c => allLayers().filter(l => l.type === 'ellipse').length > c.n,
      show: () => drag(screenOf(150, 228), screenOf(214, 292), { shift: true }),
    },
    {
      target: () => q('#insp .kb[data-kb="pos"]'),
      enter: () => {
        const b = ball();
        if (b && S.sel !== b.id) select(b.id);
      },
      done: () => !!ball()?.t.pos,
      show: () => click(q('#insp .kb[data-kb="pos"]')),
    },
    playheadStep(),
    {
      target: () => q('#wrap'),
      done: () => keyAt(ball(), 'pos', S.time),
      show: async () => {
        await press('V', 'v', 'KeyV');
        const b = ball();
        if (!b) return;
        const a = offCentre(b),
          k = screenOf(330, 0).x - screenOf(0, 0).x;
        await drag(a, { x: a.x + k, y: a.y }, { ms: 900 });
      },
    },
    playStep(),
  ],

  keyframes: [
    {
      target: () => {
        const s = byName('Sun');
        return s ? q(`#lp [data-lid="${s.id}"]`) : null;
      },
      enter: () => select(null),
      done: () => selLayer()?.name === 'Sun',
      show: () => {
        const s = byName('Sun');
        return click(s ? q(`#lp [data-lid="${s.id}"]`) : null, 0.3, 0.5);
      },
    },
    {
      target: () => q('#insp .kb[data-kb="rot"]'),
      enter: () => {
        const s = byName('Sun');
        if (s && S.sel !== s.id) select(s.id);
      },
      done: () => !!byName('Sun')?.t.rot,
      show: () => click(q('#insp .kb[data-kb="rot"]')),
    },
    playheadStep(),
    {
      target: () => q('#rot-deg')?.closest('.row') || null,
      done: () => keyAt(byName('Sun'), 'rot', S.time),
      show: () => type(q('#rot-deg') as HTMLInputElement, '90'),
    },
    playStep(),
  ],

  easing: [
    {
      ...playStep(),
      enter: () => {
        pause();
        setTime(0);
      },
    },
    {
      target: () => {
        const b = byName('Ball');
        return b ? q(`.tl .seg[data-lid="${b.id}"][data-prop="pos"]`) : null;
      },
      done: () => S.keys.size > 0,
      show: () => {
        const b = byName('Ball');
        return click(b ? q(`.tl .seg[data-lid="${b.id}"][data-prop="pos"]`) : null, 0.5, 0.5);
      },
    },
    {
      target: () => q('#tEase'),
      done: () => isEasePopOpen(),
      show: () => click(q('#tEase')),
    },
    {
      target: () => q('#ezPop'),
      done: () => {
        const b = byName('Ball');
        return !!(b && b.t.pos && b.t.pos[0][2] === 'outBounce');
      },
      show: async () => {
        await click(q('#ezDir [data-v="out"]'));
        await click(q(`#ezGrid [data-ez='"outBounce"']`));
      },
    },
    playStep(),
  ],
};
