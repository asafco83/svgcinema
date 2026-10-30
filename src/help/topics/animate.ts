// SVGcinema — help/topics/animate: Animate (scenes and tour steps; the words are in help/content.json)
import type { Layer } from '../../model/types';
import { S, selLayer } from '../../core/state';
import { isFrozen, valueAt } from '../../core/constants';
import { select, selectMany, setTime, setTool, toggleFreeze } from '../../core/history';
import { openPresets, presetsOpen } from '../../ui/presets-panel';
import { centre, click, drag, hover, type } from '../ghost';
import {
  type Scene,
  type TourStep,
  byName,
  keyAt,
  lock,
  lpRow,
  pause,
  playStep,
  playheadStep,
  q,
  screenBox,
  screenOf,
  shapeEl,
  svg640,
  trackBits,
} from '../kit';

export const scenes: Record<string, Scene> = {
  // Keyframes and tracks: a sun with a face (a rotation reads), over hills
  keyframes: {
    name: 'Practice: keyframes and tracks',
    svg: svg640(`<g id="Sun">
<path id="Rays" d="M320 92l14 52 47-26-26 47 52 14-52 14 26 47-47-26-14 52-14-52-47 26 26-47-52-14 52-14-26-47 47 26z" fill="#ffd36e"/>
<circle id="Disc" cx="320" cy="180" r="50" fill="#ffb02e"/>
<g id="Face" fill="#7a3e12"><circle id="Left eye" cx="303" cy="170" r="5.5"/><circle id="Right eye" cx="337" cy="170" r="5.5"/><path id="Smile" d="M300 192q20 18 40 0" fill="none" stroke="#7a3e12" stroke-width="5" stroke-linecap="round"/></g>
</g>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
};

export const tours: Record<string, TourStep[]> = {
  keyframes: [
    {
      target: () => lpRow('Sun'),
      enter: () => select(null),
      done: () => selLayer()?.name === 'Sun',
      show: () => click(lpRow('Sun'), 0.3, 0.5),
    },
    {
      target: () => q('#insp .kb[data-kb="rot"]'),
      enter: () => {
        const s = byName('Sun');
        if (s && S.sel !== s.id) select(s.id);
      },
      done: () => !!byName('Sun')?.t.rot,
      show: () => click(q('#insp .kb[data-kb="rot"]')),
      clip: () => trackBits(byName('Sun'), 'rot'),
    },
    playheadStep(),
    {
      target: () => q('#rot-deg')?.closest('.row') || null,
      done: () => keyAt(byName('Sun'), 'rot', S.time),
      show: () => type(q('#rot-deg') as HTMLInputElement, '90'),
      clip: () => [shapeEl(byName('Sun'))],
    },
    playStep(),
  ],
};

/* ---------- helpers for the topics below ---------- */

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** Pick an option of a drop-down the way a person does: click it, then the choice (a native list can't be
 *  opened by script, so the pick itself is the value changing, with the change event the editor handles). */
export async function choose(sel: HTMLSelectElement | null, value: string) {
  if (!sel) return;
  await click(sel);
  await wait(250);
  sel.value = value;
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(350);
}
/** Brings a control in the inspector into view (a person scrolls to it). */
export async function reveal(el: Element | null) {
  if (!el) return;
  const r = el.getBoundingClientRect(),
    p = (el.closest('#insp') as HTMLElement) || null;
  if (p && (r.top < p.getBoundingClientRect().top + 40 || r.bottom > innerHeight - 20)) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await wait(500);
  }
}
/** Scrolls the inspector to a control at once (a step's enter: the step starts with it in view). */
function inView(el: Element | null) {
  if (!el) return;
  const r = el.getBoundingClientRect(),
    p = el.closest('#insp');
  if (p && (r.top < p.getBoundingClientRect().top + 40 || r.bottom > innerHeight - 20))
    el.scrollIntoView({ block: 'center' });
}
/** an enter that selects the named layer and brings a control into view */
const pickAnd = (name: string, el: () => Element | null) => () => {
  pick(name)();
  inView(el());
};
/** an inspector field (by its data-f) */
const field = (f: string) => q(`#insp [data-f="${f}"]`) as HTMLInputElement | null;
const fieldRow = (f: string) => field(f)?.closest('.row') || null;
const kb = (k: string) => q(`#insp .kb[data-kb="${k}"]`);
/** select the named layer when it isn't (an enter for steps after the first) */
const pick = (name: string) => () => {
  const l = byName(name);
  if (l && (S.sel !== l.id || S.selSet.size > 1)) select(l.id);
};
const isSel = (name: string) => () => S.sel === byName(name)?.id && S.selSet.size === 1;
/** a 5-pointed star's path data */
function starD(cx: number, cy: number, r: number, ri = r * 0.45) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5,
      rr = i % 2 ? ri : r;
    d += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1);
  }
  return d + 'z';
}
const HILLS = `<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>`;
/** the node handle on the canvas nearest the top of the shape (Edit nodes) */
function topNode(): Element | null {
  const ns = Array.from(document.querySelectorAll('#overlay .ov-an[data-node]'));
  let best: Element | null = null,
    y = Infinity;
  ns.forEach(n => {
    const r = n.getBoundingClientRect();
    if (r.top < y) {
      y = r.top;
      best = n;
    }
  });
  return best;
}

Object.assign(scenes, {
  // Shape morphing: a round blob, and a star for it to become
  morph: {
    name: 'Practice: shape morphing',
    svg: svg640(`${HILLS}
<path id="Blob" d="M110 190c0-42 30-70 70-70s70 28 70 70-30 70-70 70-70-28-70-70z" fill="#ffb02e"/>
<path id="Star" d="${starD(450, 186, 82)}" fill="#ffd36e"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
  // Motion paths: a paper plane, and the dashed line it will fly along
  'motion-paths': {
    name: 'Practice: motion paths',
    svg: svg640(`${HILLS}
<path id="Flight path" d="M70 300C150 110 270 110 320 210S500 330 570 110" fill="none" stroke="#ffffff" stroke-opacity=".6" stroke-width="3" stroke-dasharray="8 9" stroke-linecap="round"/>
<path id="Plane" d="M296 52l52 18-52 18 11-18z" fill="#ffffff"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
  // Trim path: a winding trail to draw on
  trim: {
    name: 'Practice: trim path',
    svg: svg640(`${HILLS}
<path id="Trail" d="M60 250C140 120 220 330 320 200S480 90 580 160" fill="none" stroke="#ffd36e" stroke-width="8" stroke-linecap="round"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
  // Animation presets: three balloons to pop in, one after another
  presets: {
    name: 'Practice: animation presets',
    svg: svg640(`${HILLS}
<ellipse id="Red balloon" cx="200" cy="190" rx="46" ry="56" fill="#ff6b6b"/>
<ellipse id="Yellow balloon" cx="320" cy="160" rx="46" ry="56" fill="#ffd36e"/>
<ellipse id="Blue balloon" cx="440" cy="190" rx="46" ry="56" fill="#6ea8ff"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
  // Editing many layers: five stars, three yellow and two white
  multi: {
    name: 'Practice: editing many layers',
    svg: svg640(`${HILLS}
<path id="Star 1" d="${starD(110, 130, 40)}" fill="#ffd36e"/>
<path id="Star 2" d="${starD(215, 200, 30)}" fill="#ffffff"/>
<path id="Star 3" d="${starD(320, 110, 46)}" fill="#ffd36e"/>
<path id="Star 4" d="${starD(425, 200, 30)}" fill="#ffffff"/>
<path id="Star 5" d="${starD(530, 130, 40)}" fill="#ffd36e"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
} as Record<string, Scene>);

const blob = () => byName('Blob');
const plane = () => byName('Plane');
const trail = () => byName('Trail');
const BALLOONS = ['Red balloon', 'Yellow balloon', 'Blue balloon'];
const balloons = () => BALLOONS.map(byName).filter(Boolean) as Layer[];
const YELLOW = ['Star 1', 'Star 3', 'Star 5'];
const yellow = () => YELLOW.map(byName).filter(Boolean) as Layer[];
const selIs = (ls: Layer[]) => ls.length > 0 && S.selSet.size === ls.length && ls.every(l => S.selSet.has(l.id));
/** the Presets window's tile, and whether it is the chosen one */
const tile = (id: string) => q(`#presetPop [data-preset="${id}"]`);

Object.assign(tours, {
  morph: [
    {
      target: () => lpRow('Blob'),
      enter: () => select(null),
      done: isSel('Blob'),
      show: () => click(lpRow('Blob'), 0.3, 0.5),
    },
    { ...playheadStep(1.5), enter: pick('Blob') },
    {
      target: () => q('#morphTo')?.closest('.row') || null,
      enter: pickAnd('Blob', () => q('#morphTo')),
      done: () => keyAt(blob(), 'd', 1.5) && !!byName('Star')?.hid,
      show: async () => {
        await reveal(q('#morphTo'));
        await choose(q('#morphTo') as HTMLSelectElement, byName('Star')?.id || '');
      },
      clip: () => [shapeEl(blob()), ...trackBits(blob(), 'd')],
    },
    {
      target: () => q('#insp [data-act="nodes"]'),
      enter: () => {
        if (S.tool === 'node') setTool('select');
        pickAnd('Blob', () => q('#insp [data-act="nodes"]'))();
      },
      done: () => S.tool === 'node',
      show: async () => {
        await reveal(q('#insp [data-act="nodes"]'));
        await click(q('#insp [data-act="nodes"]'));
      },
      clip: () => [shapeEl(blob())],
    },
    {
      target: () => q('#wrap'),
      enter: c => {
        pick('Blob')();
        if (S.tool !== 'node') setTool('node');
        const b = blob();
        c.d = b ? JSON.stringify(b.t.d) : '';
      },
      done: c => {
        const b = blob();
        return !!(b && b.t.d && JSON.stringify(b.t.d) !== c.d);
      },
      show: async () => {
        const n = topNode();
        if (!n) return;
        const a = centre(n),
          k = screenOf(0, 40).y - screenOf(0, 0).y;
        await drag(a, { x: a.x, y: a.y - k }, { ms: 800 });
      },
      clip: () => [shapeEl(blob()), ...trackBits(blob(), 'd')],
    },
    {
      ...playStep(),
      enter: () => {
        pause();
        if (S.tool !== 'select') setTool('select');
      },
    },
  ],
  'motion-paths': [
    {
      target: () => lpRow('Plane'),
      enter: () => select(null),
      done: isSel('Plane'),
      show: () => click(lpRow('Plane'), 0.3, 0.5),
    },
    {
      target: () => q('#motionPath')?.closest('.row') || null,
      enter: pickAnd('Plane', () => q('#motionPath')),
      done: () => (plane()?.t.pos?.length || 0) > 2,
      show: async () => {
        await reveal(q('#motionPath'));
        await choose(q('#motionPath') as HTMLSelectElement, byName('Flight path')?.id || '');
      },
      clip: () => [shapeEl(plane()), shapeEl(byName('Flight path')), ...trackBits(plane(), 'pos')],
    },
    {
      target: () => q('#insp [data-act="orient"]'),
      enter: pickAnd('Plane', () => q('#insp [data-act="orient"]')),
      done: () => !!plane()?.or,
      show: async () => {
        await reveal(q('#insp [data-act="orient"]'));
        await click(q('#insp [data-act="orient"]'));
      },
      clip: () => [shapeEl(plane())],
    },
    {
      ...playStep(),
      enter: () => {
        pause();
        setTime(0);
      },
    },
  ],
  trim: [
    {
      target: () => lpRow('Trail'),
      enter: () => select(null),
      done: isSel('Trail'),
      show: () => click(lpRow('Trail'), 0.3, 0.5),
    },
    {
      target: () => fieldRow('te'),
      enter: () => {
        if (S.time) setTime(0);
        pickAnd('Trail', () => field('te'))();
      },
      done: () => {
        const t = trail();
        return !!t && Math.abs(valueAt(t, 'te', 0) ?? 100) < 0.5;
      },
      show: async () => {
        await reveal(field('te'));
        await type(field('te'), '0');
      },
      clip: () => [shapeEl(trail())],
    },
    {
      target: () => kb('te'),
      enter: pickAnd('Trail', () => kb('te')),
      done: () => !!trail()?.t.te,
      show: async () => {
        await reveal(kb('te'));
        await click(kb('te'));
      },
      clip: () => trackBits(trail(), 'te'),
    },
    { ...playheadStep(2), enter: pick('Trail') },
    {
      target: () => fieldRow('te'),
      enter: pickAnd('Trail', () => field('te')),
      done: () => keyAt(trail(), 'te', S.time) && (valueAt(trail()!, 'te', S.time) ?? 0) > 99,
      show: async () => {
        await reveal(field('te'));
        await type(field('te'), '100');
      },
      clip: () => [shapeEl(trail()), ...trackBits(trail(), 'te')],
    },
    playStep(),
  ],
  presets: [
    {
      target: () => q('#wrap'),
      enter: () => select(null),
      done: () => selIs(balloons()),
      show: () => drag(screenOf(130, 70), screenOf(510, 270), { ms: 900 }),
      clip: () => balloons().map(shapeEl),
    },
    {
      target: () => q('#lAnim'),
      enter: () => {
        if (!selIs(balloons())) selectMany(balloons().map(l => l.id));
      },
      done: () => presetsOpen(),
      show: async () => {
        await click(q('#lAnim'));
        await click(q('#animMenu [data-presets]'));
      },
    },
    {
      target: () => tile('pop-in'),
      enter: () => {
        if (!selIs(balloons())) selectMany(balloons().map(l => l.id));
        if (!presetsOpen()) openPresets(q('#lAnim') as HTMLElement);
      },
      done: () => !!tile('pop-in')?.classList.contains('on'),
      show: () => click(tile('pop-in')),
      clip: () => [q('#presetPop'), ...balloons().map(l => q(`#tlbody .tl-layer[data-lid="${l.id}"]`))],
    },
    {
      target: () => q('#prApply'),
      enter: () => {
        if (!selIs(balloons())) selectMany(balloons().map(l => l.id));
        if (!presetsOpen()) openPresets(q('#lAnim') as HTMLElement);
        if (!tile('pop-in')?.classList.contains('on')) (tile('pop-in') as HTMLElement | null)?.click();
      },
      done: () => balloons().every(l => !!l.t.scl),
      show: () => click(q('#prApply')),
      clip: () => balloons().flatMap(l => trackBits(l, 'scl')),
    },
    {
      ...playStep(),
      enter: () => {
        pause();
        setTime(0);
      },
    },
  ],
  multi: [
    {
      target: () => lpRow('Star 1'),
      enter: () => select(null),
      done: isSel('Star 1'),
      show: () => click(lpRow('Star 1'), 0.3, 0.5),
    },
    {
      target: () => q('#bSame'),
      enter: () => {
        const l = byName('Star 1');
        if (l && S.sel !== l.id) select(l.id);
      },
      done: () => selIs(yellow()),
      show: async () => {
        await click(q('#bSame'));
        await click(q('#layermenu [data-lm="same:fill"]'));
      },
      clip: () => [q('#layermenu'), ...yellow().map(shapeEl)],
    },
    {
      target: () => kb('rot'),
      enter: () => {
        if (!selIs(yellow())) selectMany(yellow().map(l => l.id));
      },
      done: () => yellow().every(l => !!l.t.rot),
      show: () => click(kb('rot')),
      clip: () => yellow().flatMap(l => trackBits(l, 'rot')),
    },
    {
      ...playheadStep(2),
      enter: () => {
        if (!selIs(yellow())) selectMany(yellow().map(l => l.id));
      },
    },
    {
      target: () => q('#rot-deg')?.closest('.row') || null,
      enter: () => {
        if (!selIs(yellow())) selectMany(yellow().map(l => l.id));
      },
      done: () => yellow().every(l => keyAt(l, 'rot', S.time)),
      show: () => type(q('#rot-deg') as HTMLInputElement, '144'),
      clip: () => yellow().map(shapeEl),
    },
    playStep(),
  ],
} as Record<string, TourStep[]>);

/* ---------- Freezing a track: a boat that sails and rocks ---------- */

Object.assign(scenes, {
  freeze: {
    name: 'Practice: freezing a track',
    svg: svg640(`<g id="Boat">
<path id="Sail" d="M160 262V150l52 100z" fill="#fff4c9"/>
<path id="Hull" d="M100 266h124l-22 30h-80z" fill="#e5484d"/>
</g>
<path id="Sea" d="M0 290q40-14 80 0t80 0 80 0 80 0 80 0 80 0 80 0 80 0V400H0z" fill="#1f2b5c"/>`),
    setup() {
      lock('Sky', 'Sea');
      const b = byName('Boat');
      if (!b) return;
      const [x, y] = (b.b.pos as number[]) || [0, 0];
      b.t.pos = [
        [0, [x, y], 'linear'],
        [3, [x + 300, y], 'linear'],
      ];
      b.t.rot = [0, 0.75, 1.5, 2.25, 3].map((t, i) => [t, [0, 8, 0, -8, 0][i], 'inOutSine']) as any;
    },
  },
} as Record<string, Scene>);

const boat = () => byName('Boat');
/** the boat's Rotate row in the timeline: its name part (the snowflake sits at its left) */
const rotName = () => {
  const l = boat();
  return l ? q(`#tlbody .tl-row[data-lid="${l.id}"][data-prop="rot"] .tl-name`) : null;
};
const snowflake = () => rotName()?.querySelector('.tl-fz') || null;
const frozen = () => {
  const l = boat();
  return !!l && isFrozen(l, 'rot');
};
/** the sea the boat sails across (the clip of a step that changes how it moves) */
const voyage = () => screenBox(80, 130, 480, 180);
/** hover the row (the snowflake shows on hover: script events don't give it the :hover look, so it is
 *  shown as the pointer's hover would), then click the snowflake */
async function clickSnowflake() {
  await hover(rotName());
  const s = snowflake() as HTMLElement | null;
  if (s) s.style.opacity = '1';
  await click(snowflake());
}
const setFrozen = (on: boolean) => {
  const l = boat();
  if (l && frozen() !== on) toggleFreeze(l, 'rot');
};

Object.assign(tours, {
  freeze: [
    {
      target: rotName,
      enter: () => {
        pause();
        if (S.time) setTime(0);
      },
      done: frozen,
      show: clickSnowflake,
      clip: () => [shapeEl(boat()), ...trackBits(boat(), 'rot')],
    },
    {
      target: () => lpRow('Boat'),
      enter: () => select(null),
      done: isSel('Boat'),
      show: () => click(lpRow('Boat'), 0.3, 0.5),
    },
    {
      target: () => q('#rot-deg')?.closest('.row') || null,
      enter: () => {
        pause();
        setFrozen(true);
        pick('Boat')();
      },
      done: () => frozen() && Math.abs(+(boat()?.b.rot ?? 0) - 8) < 0.5,
      show: () => type(q('#rot-deg') as HTMLInputElement, '8'),
      clip: () => [shapeEl(boat()), ...trackBits(boat(), 'rot')],
    },
    {
      ...playStep(),
      enter: () => {
        pause();
        setTime(0);
        setFrozen(true);
      },
      clip: () => [voyage()],
    },
    {
      target: rotName,
      enter: () => setFrozen(true),
      done: () => !frozen() && !!boat()?.t.rot,
      show: () => click(snowflake()),
      clip: () => [voyage(), ...trackBits(boat(), 'rot')],
    },
  ],
} as Record<string, TourStep[]>);
