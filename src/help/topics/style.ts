// SVGcinema — help/topics/style: Style (scenes and tour steps; the words are in help/content.json)
import type { Layer } from '../../model/types';
import { S } from '../../core/state';
import { select } from '../../core/history';
import { H, valueAt } from '../../core/constants';
import { pickerOpen, pickerPaint } from '../../ui/color-picker';
import { centre, click, drag, press, type } from '../ghost';
import {
  type Scene,
  type TourStep,
  byName,
  lock,
  lpRow,
  playStep,
  playheadStep,
  q,
  screenBox,
  screenOf,
  shapeEl,
  svg640,
  trackBits,
  keyAt,
} from '../kit';

/* ---------- helpers (help/topics/arrange uses them too) ---------- */

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** Brings a control in the inspector into view: opens its section when it is closed (the inspector remembers
 *  closed sections) and scrolls the inspector to it, as a person would before using it. */
export function reveal(el: Element | null) {
  if (!el || !el.isConnected) return;
  const sec = el.closest('.sec');
  if (sec && sec.classList.contains('closed')) (sec.querySelector('.sec-tg') as HTMLElement | null)?.click();
  const box = q('#insp');
  if (box && box.contains(el)) {
    const r = el.getBoundingClientRect(),
      b = box.getBoundingClientRect();
    if (r.top < b.top + 40 || r.bottom > b.bottom - 40)
      box.scrollTop += r.top - b.top - Math.max(60, (b.height - r.height) / 2);
  } else el.scrollIntoView({ block: 'nearest' });
}
/** reveal what `f` finds, give the inspector a moment, and return it */
export async function shown(f: () => Element | null) {
  reveal(f());
  await wait(60);
  return f();
}
/** the layer is selected (alone) */
export const selected = (n: string) => {
  const l = byName(n);
  return !!l && S.sel === l.id && S.selSet.size === 1;
};
/** select a layer for a step that starts with it selected */
export const keep = (n: string) => {
  const l = byName(n);
  if (l && !selected(n)) select(l.id);
};
/** an inspector row (for the light and the clip) from one of its fields */
export const rowOf = (sel: string) => q(sel)?.closest('.row') || null;
/** "Select …": click the layer's row in the Layers panel */
export const pickRow = (n: string): TourStep => ({
  target: () => lpRow(n),
  enter: () => select(null),
  done: () => selected(n),
  show: () => click(lpRow(n), 0.3, 0.5),
});
/** start a track with the ◆ of a property in the inspector */
export const keyStep = (n: string, k: string | (() => string)): TourStep => {
  const kk = () => (typeof k === 'string' ? k : k());
  const kb = () => q(`#insp .kb[data-kb="${CSS.escape(kk())}"]`);
  return {
    target: kb,
    enter: () => {
      keep(n);
      reveal(kb());
    },
    done: () => !!byName(n)?.t[kk()]?.length,
    show: async () => click(await shown(kb)),
    clip: () => trackBits(byName(n), kk()),
  };
};
/** type a value into an inspector field (its row is lit) */
export const typeStep = (n: string, sel: string, text: string, done: () => boolean, more?: () => any[]): TourStep => ({
  target: () => rowOf(sel),
  enter: () => {
    keep(n);
    reveal(q(sel));
  },
  done,
  show: async () => type((await shown(() => q(sel))) as HTMLInputElement, text),
  clip: () => [shapeEl(byName(n)), ...(more ? more() : [])],
});
/** Pick an option of a <select> the way a person does: click it, then choose (the browser's own list can't be
 *  shown here, so the choice is made as the browser makes it: the value, then a change event). */
export async function choose(el: HTMLSelectElement | null, value: string) {
  if (!el) return;
  await click(el);
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
  await wait(300);
}
/** a drag on the canvas from one document point to another */
export const dragDoc = (a: [number, number], b: [number, number], ms = 800) =>
  drag(screenOf(a[0], a[1]), screenOf(b[0], b[1]), { ms });

/* ---------- Fill and gradients: a lamp's beam ---------- */

const fillOf = (n: string) => {
  const l = byName(n);
  return l ? valueAt(l, 'fill', S.time) : null;
};
const lin = (n: string) => {
  const f = fillOf(n);
  return f && H.isG(f) && f.g === 'lin' ? f : null;
};
const gh = (k: string) => q(`#overlay [data-gh="${k}"]`);
const cpop = () => q('#cpop:not([hidden])');

/* ---------- Strokes and dashes: a trail of dots ---------- */

/* ---------- Filters: a glowing moon ---------- */

/** the moon's glow (a Drop shadow added as Glow) */
const glow = () => {
  const l = byName('Moon');
  const f = l && (l.fx || []).find(x => x.type === 'shadow');
  return f ? f.id : '';
};
const glowKey = () => 'fx.' + (glow() || 'f1') + '.sp';

/* ---------- Masks and clipping: a window on the sea ---------- */

const masked = () => {
  const w = byName('Window'),
    f = w && w.parent ? byName('Masks') : null;
  return !!(w && f && f.maskSrc && w.parent === f.id);
};
const posOf = (l: Layer | null) => (l ? (valueAt(l, 'pos', S.time) as number[]) || [0, 0] : [0, 0]);

export const scenes: Record<string, Scene> = {
  fill: {
    name: 'Practice: fill and gradients',
    svg: svg640(`<rect id="Floor" y="320" width="640" height="80" fill="#1f2b5c"/>
<path id="Beam" d="M266 80h108l94 240H172z" fill="#ffe08a"/>
<rect id="Cord" x="318" y="0" width="4" height="44" fill="#141a33"/>
<path id="Lamp" d="M286 40h68l22 42H264z" fill="#141a33"/>`),
    setup() {
      lock('Sky', 'Floor', 'Cord', 'Lamp');
    },
  },
  strokes: {
    name: 'Practice: strokes and dashes',
    svg: svg640(`<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>
<path id="Trail" d="M70 250C150 130 250 320 340 210S520 120 580 190" fill="none" stroke="#ffd36e" stroke-width="3"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
  filters: {
    name: 'Practice: filters',
    svg: svg640(`<circle id="Moon" cx="320" cy="160" r="58" fill="#fff4c9"/>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>`),
    setup() {
      lock('Sky', 'Hills');
    },
  },
  masks: {
    name: 'Practice: masks and clipping',
    svg: svg640(
      `<rect id="Wall" width="640" height="400" fill="#2b3a78"/>
<g id="Sea view">
<rect id="Sky" x="110" y="50" width="420" height="190" fill="#9fd3f5"/>
<circle id="Sun" cx="420" cy="120" r="34" fill="#ffd36e"/>
<rect id="Sea" x="110" y="240" width="420" height="110" fill="#2f7fc1"/>
<path id="Boat" d="M230 236h90l-14 22h-62zM272 236V176l34 46z" fill="#fff"/>
</g>
<circle id="Window" cx="320" cy="200" r="96" fill="#fff"/>`,
      false,
    ),
    setup() {
      lock('Wall');
    },
  },
  appearance: {
    name: 'Practice: appearance and blending',
    svg: svg640(
      `<rect id="Night" width="640" height="400" fill="#141a33"/>
<circle id="Red" cx="275" cy="165" r="85" fill="#ff3b3b"/>
<circle id="Green" cx="365" cy="165" r="85" fill="#2fd35a"/>
<circle id="Blue" cx="320" cy="245" r="85" fill="#3b6bff"/>`,
      false,
    ),
    setup() {
      lock('Night');
      // the red and green lights add up already; the tour gives the blue one the same blending
      ['Red', 'Green'].forEach(n => {
        const l = byName(n);
        if (l) l.blend = 'screen';
      });
    },
  },
};

export const tours: Record<string, TourStep[]> = {
  fill: [
    {
      target: () => shapeEl(byName('Beam')),
      enter: () => select(null),
      done: () => selected('Beam'),
      show: () => click(shapeEl(byName('Beam')), 0.5, 0.75),
    },
    {
      target: () => rowOf('#c-fill'),
      enter: () => {
        keep('Beam');
        reveal(q('#c-fill'));
      },
      done: () => pickerOpen() && pickerPaint()?.key === 'fill',
      show: async () => click(await shown(() => q('#c-fill'))),
      clip: () => [cpop()],
    },
    {
      target: () => q('#cpop [data-cpt="lin"]'),
      enter: () => {
        keep('Beam');
        if (!pickerOpen()) (q('#c-fill') as HTMLElement | null)?.click();
      },
      done: () => !!lin('Beam'),
      show: () => click(q('#cpop [data-cpt="lin"]')),
      clip: () => [cpop(), shapeEl(byName('Beam'))],
    },
    {
      target: () => shapeEl(byName('Beam')),
      enter: () => {
        keep('Beam');
        if (!pickerOpen()) (q('#c-fill') as HTMLElement | null)?.click();
      },
      done: () => {
        const g = lin('Beam'),
          p = g && H.linP(g);
        return !!(p && p[3] - p[1] > 0.5 && Math.abs(p[2] - p[0]) < 0.3);
      },
      show: async () => {
        const a = gh('p1');
        if (a) await drag(centre(a), screenOf(320, 86), { ms: 700 });
        const b = gh('p2');
        if (b) await drag(centre(b), screenOf(320, 314), { ms: 700 });
      },
      clip: () => [cpop()],
    },
    {
      ...typeStep(
        'Beam',
        '#i-fo__100',
        '70',
        () => {
          const l = byName('Beam');
          return !!l && (valueAt(l, 'fo', S.time) ?? 1) < 0.95;
        },
        () => [rowOf('#c-fill')],
      ),
      show: async () => {
        // Esc closes the colour window first (a click outside it does too, but redraws the inspector under it)
        if (pickerOpen()) await press('Esc', 'Escape', 'Escape');
        await type((await shown(() => q('#i-fo__100'))) as HTMLInputElement, '70');
      },
    },
  ],

  strokes: [
    pickRow('Trail'),
    typeStep('Trail', '#i-sw', '10', () => (valueAt(byName('Trail')!, 'sw', S.time) || 0) >= 6),
    {
      target: () => rowOf('[data-tx="x:stroke-linecap"][data-v="round"]'),
      enter: () => {
        keep('Trail');
        reveal(q('[data-tx="x:stroke-linecap"]'));
      },
      done: () => byName('Trail')?.extra?.['stroke-linecap'] === 'round',
      show: async () => click(await shown(() => q('[data-tx="x:stroke-linecap"][data-v="round"]'))),
      clip: () => [shapeEl(byName('Trail'))],
    },
    typeStep(
      'Trail',
      '#x-dash',
      '0, 22',
      () => ((valueAt(byName('Trail')!, 'da', S.time) as number[]) || []).length > 0,
    ),
    keyStep('Trail', 'dof'),
    playheadStep(3),
    typeStep(
      'Trail',
      '#i-dof',
      '-110',
      () => keyAt(byName('Trail'), 'dof', S.time),
      () => trackBits(byName('Trail'), 'dof'),
    ),
  ],

  filters: [
    {
      target: () => shapeEl(byName('Moon')),
      enter: () => select(null),
      done: () => selected('Moon'),
      show: () => click(shapeEl(byName('Moon')), 0.3, 0.7),
    },
    {
      target: () => q('#fx-add'),
      enter: () => {
        keep('Moon');
        reveal(q('#fx-add'));
      },
      done: () => !!q('#fxMenu'),
      show: async () => click(await shown(() => q('#fx-add'))),
      clip: () => [q('#fxMenu')],
    },
    {
      target: () => q('#fxMenu') || q('#fx-add'),
      enter: () => {
        keep('Moon');
        if (!q('#fxMenu')) (q('#fx-add') as HTMLElement | null)?.click();
      },
      done: () => !!glow(),
      show: () => click(q('#fxMenu [data-fxp="glow"]')),
      clip: () => [shapeEl(byName('Moon'))],
    },
    keyStep('Moon', glowKey),
    playheadStep(),
    {
      ...typeStep('Moon', '', '12', () => keyAt(byName('Moon'), glowKey(), S.time)),
      target: () => rowOf('#i-' + glowKey().replace(/[:.]/g, '_')),
      enter: () => {
        keep('Moon');
        reveal(q('#i-' + glowKey().replace(/[:.]/g, '_')));
      },
      show: async () => type((await shown(() => q('#i-' + glowKey().replace(/[:.]/g, '_')))) as HTMLInputElement, '12'),
      clip: () => [shapeEl(byName('Moon')), ...trackBits(byName('Moon'), glowKey())],
    },
    playStep(),
  ],

  masks: [
    {
      target: () => q('#wrap'),
      enter: () => select(null),
      done: () => {
        const w = byName('Window'),
          v = byName('Sea view');
        return !!(w && v && S.selSet.has(w.id) && S.selSet.has(v.id));
      },
      show: () => dragDoc([40, 30], [300, 230], 900),
      clip: () => [screenBox(40, 30, 500, 330)],
    },
    {
      target: () => q('#lMask'),
      done: masked,
      show: () => click(q('#lMask')),
      clip: () => [q('#lp'), screenBox(110, 50, 420, 300)],
    },
    {
      target: () => lpRow('Window'),
      enter: () => {
        if (selected('Window')) select(null);
      },
      done: () => selected('Window'),
      show: () => click(lpRow('Window'), 0.3, 0.5),
    },
    {
      ...typeStep(
        'Window',
        '#i-pos_0',
        '100',
        () => false,
        () => [screenBox(110, 50, 420, 300)],
      ),
      enter: c => {
        keep('Window');
        reveal(q('#i-pos_0'));
        c.p = posOf(byName('Window')).slice();
      },
      done: c => {
        const p = posOf(byName('Window'));
        return !!c.p && Math.hypot(p[0] - c.p[0], p[1] - c.p[1]) > 20;
      },
    },
  ],

  appearance: [
    pickRow('Blue'),
    {
      target: () => rowOf('#ly-blend'),
      enter: () => {
        keep('Blue');
        reveal(q('#ly-blend'));
      },
      done: () => byName('Blue')?.blend === 'screen',
      show: async () => choose((await shown(() => q('#ly-blend'))) as HTMLSelectElement, 'screen'),
      clip: () => [shapeEl(byName('Blue'))],
    },
    keyStep('Blue', 'op'),
    playheadStep(),
    typeStep(
      'Blue',
      '#i-op__100',
      '0',
      () => keyAt(byName('Blue'), 'op', S.time),
      () => trackBits(byName('Blue'), 'op'),
    ),
    playStep(),
  ],
};
