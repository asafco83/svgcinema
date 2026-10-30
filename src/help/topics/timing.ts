// SVGcinema — help/topics/timing: Timing (scenes and tour steps; the words are in help/content.json)
import type { Layer } from '../../model/types';
import { S } from '../../core/state';
import { beginEdit, select, setTime } from '../../core/history';
import { addInstance, makeSymbol, setOffset } from '../../core/symbols';
import { descendants } from '../../model/tree';
import { isEasePopOpen } from '../../ui/ease-pop';
import { GRAPH, toggleGraph } from '../../ui/graph';
import { ONION, toggleOnion } from '../../ui/onion';
import { renderTimeline } from '../../ui/timeline';
import { centre, click, drag, type } from '../ghost';
import {
  type Scene,
  type TourStep,
  artboard,
  byName,
  lock,
  lpRow,
  pause,
  playStep,
  playheadStep,
  q,
  shapeEl,
  svg640,
  trackBits,
} from '../kit';

export const scenes: Record<string, Scene> = {
  // Easing: a ball that drops at one even speed (Linear), ready to be given a bounce
  easing: {
    name: 'Practice: easing',
    svg: svg640(`<rect id="Floor" y="320" width="640" height="80" fill="#1f2b5c"/>
<circle id="Ball" cx="320" cy="70" r="30" fill="#ffb02e"/>`),
    setup() {
      lock('Sky', 'Floor');
      const b = byName('Ball');
      if (b) {
        const [x, y] = (b.b.pos as number[]) || [0, 0];
        b.t.pos = [
          [0, [x, y], 'linear'],
          [1.4, [x, y + 220], 'linear'],
        ];
      }
    },
  },
};

const ballSeg = () => {
  const b = byName('Ball');
  return b ? q(`.tl .seg[data-lid="${b.id}"][data-prop="pos"]`) : null;
};

export const tours: Record<string, TourStep[]> = {
  easing: [
    {
      ...playStep(),
      enter: () => {
        pause();
        setTime(0);
      },
    },
    {
      target: ballSeg,
      done: () => S.keys.size > 0,
      show: () => click(ballSeg(), 0.5, 0.5),
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

/* ---------- helpers for the topics below ---------- */

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** Drag a slider's thumb to a value: the pointer drags it, and the slider follows the pointer as it does
 *  under a person's hand (a slider doesn't move for script pointer events, so its value follows the
 *  pointer's place, with the input events the editor handles). */
async function slide(r: HTMLInputElement | null, to: number) {
  if (!r) return;
  const min = +r.min || 0,
    max = +r.max || 100,
    b = r.getBoundingClientRect(),
    xOf = (v: number) => b.left + 8 + ((b.width - 16) * (v - min)) / (max - min),
    y = b.top + b.height / 2,
    a = { x: xOf(+r.value), y };
  let live = true,
    held = false;
  const follow = (async () => {
    while (live) {
      const g = document.querySelector('.tg-ghost') as HTMLElement | null,
        m = g && /translate\(([-\d.]+)px/.exec(g.style.transform),
        x = m ? +m[1] : NaN;
      if (!held && Math.abs(x - a.x) < 0.5) held = true;
      if (held && isFinite(x)) {
        const v = String(Math.round(min + ((x - b.left - 8) / (b.width - 16)) * (max - min)));
        if (v !== r.value) {
          r.value = v;
          r.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      await wait(20);
    }
  })();
  await drag(a, { x: xOf(to), y }, { ms: 900 });
  live = false;
  await follow;
  r.dispatchEvent(new Event('change', { bubbles: true }));
}
/** the part of an element inside the timeline's scrolling area (a wide lane or graph is cut to what shows) */
function inTimeline(el: Element | null): DOMRect | null {
  const v = q('#tlscroll');
  if (!el || !v) return null;
  const a = el.getBoundingClientRect(),
    b = v.getBoundingClientRect(),
    x = Math.max(a.left, b.left),
    y = Math.max(a.top, b.top),
    r = Math.min(a.right, b.right),
    btm = Math.min(a.bottom, b.bottom);
  return r > x && btm > y ? new DOMRect(x, y, r - x, btm - y) : null;
}
const isSel = (name: string) => () => S.sel === byName(name)?.id && S.selSet.size === 1;
const pick = (name: string) => () => {
  const l = byName(name);
  if (l && (S.sel !== l.id || S.selSet.size > 1)) select(l.id);
};
const posLane = () => {
  const l = bird();
  return l ? q(`#tlbody .tl-row[data-lid="${l.id}"][data-prop="pos"] .tl-lane`) : null;
};
const kfEl = (l: Layer | null, k: string, i: number) =>
  l ? q(`#tlbody .kf[data-lid="${l.id}"][data-prop="${k}"][data-i="${i}"]`) : null;
/** start a scene layer's track: keyframes [time, offset from where it is drawn, easing] */
function keys(name: string, k: string, ks: Array<[number, any, string, any?]>) {
  const l = byName(name);
  if (!l) return;
  const base = l.b[k];
  l.t[k] = ks.map(([t, v, e, c]) => {
    const val = Array.isArray(base) ? [base[0] + v[0], base[1] + v[1]] : (base || 0) + v;
    return (c ? [t, val, e, c] : [t, val, e]) as any;
  });
}
const GROUND = `<path id="Ground" d="M0 318c120-14 230-16 340-8s210 12 300 0v90H0z" fill="#1f2b5c"/>`;
/** four sails around (320, 160), as one path */
function sailsD() {
  const cx = 320,
    cy = 160,
    blade = [
      [-7, -14],
      [-14, -98],
      [14, -98],
      [7, -14],
    ];
  let d = '';
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2,
      c = Math.cos(a),
      s = Math.sin(a);
    d +=
      blade
        .map(([x, y], j) => (j ? 'L' : 'M') + (cx + x * c - y * s).toFixed(1) + ' ' + (cy + x * s + y * c).toFixed(1))
        .join('') + 'z';
  }
  return d + `M${cx - 14} ${cy}a14 14 0 1 0 28 0a14 14 0 1 0-28 0z`;
}

Object.assign(scenes, {
  // The timeline: a bird flies across in two seconds, a cloud drifts the whole three
  timeline: {
    name: 'Practice: the timeline',
    svg: svg640(`${GROUND}
<path id="Cloud" d="M400 120a24 24 0 0 1 44-14a20 20 0 0 1 34 18a16 16 0 0 1-6 30h-84a17 17 0 0 1 12-34z" fill="#ffffff" fill-opacity=".85"/>
<path id="Bird" d="M70 170q16-18 32-4q16-14 32 4q-17-7-32 7q-15-14-32-7z" fill="#161a33"/>`),
    setup() {
      lock('Sky', 'Ground');
      keys('Bird', 'pos', [
        [0, [0, 0], 'inOutSine'],
        [2, [420, -60], 'linear'],
      ]);
      keys('Cloud', 'pos', [
        [0, [0, 0], 'linear'],
        [3, [-90, 0], 'linear'],
      ]);
    },
  },
  // Graph editor: windmill sails that make a quarter turn in two seconds, slow at both ends
  graph: {
    name: 'Practice: graph editor',
    tl: 360,
    svg: svg640(`${GROUND}
<path id="Tower" d="M306 166l-28 154h84l-28-154z" fill="#161a33"/>
<path id="Sails" d="${sailsD()}" fill="#ffd9a0"/>`),
    setup() {
      lock('Sky', 'Ground', 'Tower');
      keys('Sails', 'rot', [
        [0, 0, 'inOut'],
        [2, 90, 'linear'],
      ]);
    },
  },
  // Onion skin: a ball that hops across in an arc
  onion: {
    name: 'Practice: onion skin',
    svg: svg640(`${GROUND}
<circle id="Ball" cx="110" cy="286" r="24" fill="#ffb02e"/>`),
    setup() {
      lock('Sky', 'Ground');
      keys('Ball', 'pos', [
        [0, [0, 0], 'linear', [0, -230, 0, -230]],
        [2, [420, 0], 'linear'],
      ]);
    },
  },
} as Record<string, Scene>);

const bird = () => byName('Bird');
const sails = () => byName('Sails');
const grKey = (i: number) => q(`#tlbody .gr-svg .gr-key[data-gi="${i}"]`);
const grHandle = (h: number) => q(`#tlbody .gr-svg .gr-hd[data-gh="${h}"]`);

Object.assign(tours, {
  timeline: [
    { ...playheadStep(1.5), enter: () => pause() },
    {
      target: () => q('#tZoom'),
      enter: c => (c.pps = S.pps),
      done: c => S.pps >= Math.min(400, c.pps + 40),
      show: () => slide(q('#tZoom') as HTMLInputElement, 420),
      clip: () => [inTimeline(q('#ruler'))],
    },
    {
      target: () => posLane(),
      enter: () => {
        S.keys.clear();
        renderTimeline();
      },
      done: () => {
        const tr = bird()?.t.pos || [];
        return tr.length > 0 && tr.every(k => S.keys.has(k));
      },
      show: async () => {
        // from an empty spot after the last keyframe, left past the first one
        const lane = posLane(),
          tr = bird()?.t.pos || [],
          v = q('#tlscroll');
        if (!lane || !tr.length || !v) return;
        const r = lane.getBoundingClientRect(),
          right = v.getBoundingClientRect().right - 16,
          y = r.top + r.height / 2;
        await drag(
          { x: Math.min(right, r.left + (tr[tr.length - 1][0] + 0.25) * S.pps), y: y + 8 },
          { x: r.left - 10, y: y - 8 },
          { ms: 900 },
        );
      },
      clip: () => [inTimeline(posLane())],
    },
    {
      target: () => kfEl(bird(), 'pos', 0),
      enter: () => {
        const tr = bird()?.t.pos || [];
        if (!tr.every(k => S.keys.has(k))) {
          pick('Bird')();
          S.keys = new Set(tr);
          renderTimeline();
        }
      },
      done: () => (bird()?.t.pos?.[0]?.[0] || 0) >= 0.4,
      show: async () => {
        const k = kfEl(bird(), 'pos', 0);
        if (!k) return;
        const a = centre(k);
        await drag(a, { x: a.x + 0.5 * S.pps, y: a.y }, { ms: 900 });
      },
      clip: () => [inTimeline(posLane())],
    },
    {
      target: () => q('#tLoop'),
      done: () => !S.loop,
      show: () => click(q('#tLoop')),
    },
    {
      ...playStep(),
      enter: () => {
        pause();
        setTime(0);
      },
    },
  ],
  graph: [
    {
      target: () => lpRow('Sails'),
      enter: () => select(null),
      done: isSel('Sails'),
      show: () => click(lpRow('Sails'), 0.3, 0.5),
    },
    {
      target: () => q('#tGraph'),
      enter: () => {
        pick('Sails')();
        if (GRAPH.on) {
          toggleGraph(false);
          renderTimeline();
        }
      },
      done: () => GRAPH.on && !!q('#tlbody .tl-graph'),
      show: () => click(q('#tGraph')),
      clip: () => [inTimeline(q('#tlbody .tl-graph'))],
    },
    {
      target: () => grKey(1),
      enter: () => {
        pick('Sails')();
        if (!GRAPH.on) {
          toggleGraph(true);
          renderTimeline();
        }
      },
      done: () => (sails()?.t.rot?.[1]?.[0] || 0) >= 2.9,
      show: async () => {
        const k = grKey(1);
        if (!k) return;
        const a = centre(k);
        await drag(a, { x: a.x + (3 - (sails()?.t.rot?.[1]?.[0] || 2)) * S.pps, y: a.y }, { ms: 900 });
      },
      clip: () => [inTimeline(q('#tlbody .tl-graph .gr-svg'))],
    },
    {
      target: () => grHandle(1),
      enter: () => {
        pick('Sails')();
        if (!GRAPH.on) {
          toggleGraph(true);
          renderTimeline();
        }
      },
      done: () => Array.isArray(sails()?.t.rot?.[0]?.[2]),
      show: async () => {
        const h = grHandle(1);
        if (!h) return;
        const a = centre(h);
        await drag(a, { x: a.x + 10, y: a.y - 60 }, { ms: 800 });
      },
      clip: () => [inTimeline(q('#tlbody .tl-graph .gr-svg'))],
    },
    {
      ...playStep(),
      enter: () => {
        pause();
        setTime(0);
      },
    },
  ],
  onion: [
    {
      target: () => lpRow('Ball'),
      enter: () => select(null),
      done: isSel('Ball'),
      show: () => click(lpRow('Ball'), 0.3, 0.5),
    },
    {
      target: () => q('#tOnion'),
      enter: () => {
        pick('Ball')();
        if (ONION.on) toggleOnion(false);
      },
      done: () => ONION.on,
      show: () => click(q('#tOnion')),
      clip: () => [artboard()],
    },
    {
      ...playheadStep(1),
      enter: () => {
        pick('Ball')();
        if (!ONION.on) toggleOnion(true);
      },
      clip: () => [artboard()],
    },
    {
      target: () => q('#tOnionOpt'),
      enter: c => {
        pick('Ball')();
        if (!ONION.on) toggleOnion(true);
        c.s = ONION.step;
      },
      done: () => Math.abs(ONION.step - 0.2) < 0.001,
      show: async () => {
        if (!q('#onionPop')) await click(q('#tOnionOpt'));
        await type(q('#onionPop [data-onion="step"]') as HTMLInputElement, '0.2');
      },
      clip: () => [q('#onionPop'), artboard()],
    },
    playStep(),
  ],
} as Record<string, TourStep[]>);

/* ---------- Staggering instances: three instances of a hopping dot ---------- */

Object.assign(scenes, {
  stagger: {
    name: 'Practice: staggering instances',
    svg: svg640(`<rect id="Floor" y="256" width="640" height="144" fill="#1f2b5c"/>
<g id="Dot"><circle id="Ball" cx="180" cy="230" r="26" fill="#ffb02e"/></g>`),
    setup() {
      lock('Sky', 'Floor');
      const g = byName('Dot'),
        ball = byName('Ball');
      if (!g || !ball) return;
      const [x, y] = (ball.b.pos as number[]) || [0, 0];
      ball.t.pos = [
        [0, [x, y], 'outQuad'],
        [0.35, [x, y - 96], 'inQuad'],
        [0.7, [x, y], 'linear'],
      ];
      const id = makeSymbol(g, 'Dot');
      g.name = 'Dot 1';
      [2, 3].forEach(n => {
        const c = addInstance(id, 140 * (n - 1), 0);
        if (c) c.name = 'Dot ' + n;
      });
    },
  },
} as Record<string, Scene>);

const dot = (n: number) => byName('Dot ' + n);
const offOf = (n: number) => dot(n)?.symOff || 0;
/** an instance's hopping ball (its own copy of the symbol's contents) */
const ballOf = (n: number) => {
  const d = dot(n);
  return d ? descendants(d)[0] || null : null;
};
const offRow = () => q('#sym-off')?.closest('.row') || null;
/** set an instance's time offset (an enter for the steps after the one that does it) */
function ensureOff(n: number, v: number) {
  const d = dot(n);
  if (!d || Math.abs(offOf(n) - v) < 0.01) return;
  const ed = beginEdit();
  setOffset(d, v);
  ed.end({ insp: true });
}
const selDot = (n: number): TourStep => ({
  target: () => shapeEl(ballOf(n)),
  enter: () => {
    pause();
    if (S.time) setTime(0);
    select(null);
  },
  done: isSel('Dot ' + n),
  show: () => click(shapeEl(ballOf(n)), 0.3, 0.3),
});
const offStep = (n: number, v: number): TourStep => ({
  target: offRow,
  enter: pick('Dot ' + n),
  done: () => Math.abs(offOf(n) - v) < 0.01,
  show: () => type(q('#sym-off') as HTMLInputElement, String(v)),
  // the dot, and its keyframes as they move along the timeline
  clip: () => [shapeEl(ballOf(n)), ...trackBits(ballOf(n), 'pos').slice(1)],
});

Object.assign(tours, {
  stagger: [
    selDot(2),
    offStep(2, 0.3),
    { ...selDot(3), enter: () => (ensureOff(2, 0.3), selDot(3).enter!({})) },
    offStep(3, 0.6),
    {
      ...playStep(),
      enter: () => {
        pause();
        setTime(0);
        ensureOff(2, 0.3);
        ensureOff(3, 0.6);
      },
    },
  ],
} as Record<string, TourStep[]>);
