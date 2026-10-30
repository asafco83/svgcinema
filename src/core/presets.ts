// SVGcinema — core/presets
// Animation presets: ready-made keyframes for the selected layers, starting at the playhead.
// Groups: Entrances, Exits, Emphasis, Strokes, Color, Filters. A preset writes keyframes only for the
// properties it animates, and only inside its own span: keyframes of those properties already in the
// span are replaced, everything else stays. Entrances end on the value the layer already has at the
// end of the span, exits start from its value at the start, emphasis starts and ends on it, so a
// preset slots into an existing animation. Several layers can be staggered. Running past the end
// lengthens the animation. One undo step.
import type { Keyframe, Layer, PropKey } from '../model/types';
import { clone, r3, valueAt } from './constants';
import { beginEdit } from './history';
import { propOK } from './keyframes';
import { S, doc, sortTrack } from './state';
import { FILTERS, addFilter, fxKey, syncFa } from '../model/filters';
import { isLocked } from '../model/tree';

export type PresetGroup = 'enter' | 'exit' | 'emph' | 'stroke' | 'colour' | 'filter';
export const PRESET_GROUPS: Array<[PresetGroup, string]> = [
  ['enter', 'Entrances'],
  ['exit', 'Exits'],
  ['emph', 'Emphasis'],
  ['stroke', 'Strokes'],
  ['colour', 'Color'],
  ['filter', 'Filters'],
];
/** [fraction of the span 0–1, value, easing to the next key] */
type Step = [number, any, string];
interface Ctx {
  /** the layer's value of `k` at the start / end of the span (before the preset) */
  a(k: string): any;
  b(k: string): any;
  /** strength: 1 = 100 % */
  s: number;
  l: Layer;
}
export interface Preset {
  id: string;
  name: string;
  group: PresetGroup;
  /** default length in seconds */
  dur: number;
  /** false: a CSS export can't play it (filters) */
  css?: boolean;
  /** the tile's picture: SVG inner markup, 44×36 */
  icon: string;
  applies(l: Layer): boolean;
  /** the tracks it writes. Filter presets may add the filter they need first (prep). */
  steps(c: Ctx): Record<string, Step[]>;
  prep?(l: Layer): void;
}

/* ---------- value helpers ---------- */

const num = (v: any, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const vec = (v: any, d: number[] = [0, 0]) => (Array.isArray(v) ? [num(v[0]), num(v[1])] : d.slice());
const add = (v: any, dx: number, dy: number) => {
  const p = vec(v);
  return [r3(p[0] + dx), r3(p[1] + dy)];
};
const mul = (v: any, f: number) => {
  const p = vec(v, [1, 1]);
  return [r3(p[0] * f), r3(p[1] * f)];
};
const paintable = (l: Layer) => ['rect', 'ellipse', 'path', 'text'].includes(l.type);
const can =
  (...ks: PropKey[]) =>
  (l: Layer) =>
    ks.every(k => propOK(l, k));
const solidFill = (l: Layer) => {
  const v = valueAt(l, 'fill', S.time);
  return paintable(l) && typeof v === 'string' && v !== 'none' && !/^url/.test(v);
};
/** a filter of this type on the layer, or a new one with the given resting values */
function filterId(l: Layer, type: string, rest: Record<string, any>, fresh?: boolean) {
  const have = (l.fx || []).find(f => f.type === type);
  if (have && !fresh) return have.id;
  const fx = addFilter(l, type);
  for (const k in rest) l.b[fxKey(fx.id, k)] = rest[k];
  syncFa(l);
  return fx.id;
}
const fxk = (l: Layer, type: string, p: string) => {
  const f = (l.fx || []).find(x => x.type === type);
  return f ? fxKey(f.id, p) : '';
};

/* ---------- icons ---------- */

const ACC = '#7189ff',
  DIM = '#b4bac8';
const ic = {
  fade: `<circle cx="14" cy="18" r="8" fill="${ACC}" opacity=".25"/><circle cx="30" cy="18" r="8" fill="${ACC}"/>`,
  slide: (dx: number, dy: number) =>
    `<rect x="${15 + dx}" y="${11 + dy}" width="14" height="14" rx="3" fill="none" stroke="${DIM}" stroke-dasharray="2 2"/><rect x="15" y="11" width="14" height="14" rx="3" fill="${ACC}"/>`,
  grow: `<circle cx="22" cy="18" r="5" fill="none" stroke="${DIM}" stroke-dasharray="2 2"/><circle cx="22" cy="18" r="12" fill="${ACC}"/>`,
  shrink: `<circle cx="22" cy="18" r="13" fill="none" stroke="${DIM}" stroke-dasharray="2 2"/><circle cx="22" cy="18" r="6" fill="${ACC}"/>`,
  pulse: `<circle cx="22" cy="18" r="9" fill="none" stroke="${DIM}" stroke-dasharray="2 3"/><circle cx="22" cy="18" r="13" fill="${ACC}"/>`,
  pop: `<circle cx="22" cy="18" r="15" fill="none" stroke="${ACC}" stroke-width="1.5"/><circle cx="22" cy="18" r="10" fill="${ACC}"/>`,
  wiggle: `<path d="M8 18c4-8 8 8 12 0s8 8 12 0 6-4 6-4" fill="none" stroke="${ACC}" stroke-width="2" stroke-linecap="round"/>`,
  shake: `<rect x="12" y="10" width="20" height="16" rx="3" fill="${ACC}"/><path d="M6 14v8M38 14v8" stroke="${DIM}" stroke-width="1.5" stroke-linecap="round"/>`,
  spin: `<path d="M22 6a12 12 0 1 1-11 7" fill="none" stroke="${DIM}" stroke-width="1.5" stroke-linecap="round"/><path d="M8 9l3 4 4-2" fill="none" stroke="${DIM}" stroke-width="1.5" stroke-linecap="round"/><rect x="16" y="12" width="12" height="12" rx="2" fill="${ACC}"/>`,
  swing: `<path d="M22 4v6" stroke="${DIM}" stroke-width="1.5"/><rect x="14" y="10" width="16" height="20" rx="3" fill="${ACC}" transform="rotate(14 22 10)"/>`,
  blink: `<circle cx="14" cy="18" r="7" fill="${ACC}"/><circle cx="30" cy="18" r="7" fill="${ACC}" opacity=".25"/>`,
  heart: `<path d="M22 30S8 21 8 13a7 7 0 0 1 14-2 7 7 0 0 1 14 2c0 8-14 17-14 17z" fill="#e5484d"/>`,
  draw: `<path d="M6 26C14 6 28 6 38 22" fill="none" stroke="${DIM}" stroke-width="2" stroke-dasharray="2 3"/><path d="M6 26C10 16 15 11 20 10" fill="none" stroke="${ACC}" stroke-width="2.5" stroke-linecap="round"/>`,
  erase: `<path d="M6 26C14 6 28 6 38 22" fill="none" stroke="${DIM}" stroke-width="2" stroke-dasharray="2 3"/><path d="M24 10C30 11 35 15 38 22" fill="none" stroke="${ACC}" stroke-width="2.5" stroke-linecap="round"/>`,
  travel: `<path d="M6 26C14 6 28 6 38 22" fill="none" stroke="${DIM}" stroke-width="2"/><path d="M15 13C18 10 22 9 26 10" fill="none" stroke="${ACC}" stroke-width="3" stroke-linecap="round"/>`,
  flash: `<rect x="10" y="9" width="24" height="18" rx="4" fill="${ACC}"/><path d="M23 11l-6 8h5l-2 6 6-8h-5z" fill="#fff"/>`,
  dim: `<rect x="8" y="9" width="12" height="18" rx="3" fill="${ACC}"/><rect x="24" y="9" width="12" height="18" rx="3" fill="${ACC}" opacity=".3"/>`,
  blurIn: `<circle cx="22" cy="18" r="11" fill="${ACC}" opacity=".35"/><circle cx="22" cy="18" r="8" fill="${ACC}"/>`,
  blurOut: `<circle cx="22" cy="18" r="8" fill="${ACC}" opacity=".5"/><circle cx="22" cy="18" r="13" fill="${ACC}" opacity=".18"/>`,
  glow: `<circle cx="22" cy="18" r="14" fill="${ACC}" opacity=".2"/><circle cx="22" cy="18" r="8" fill="${ACC}"/>`,
  lift: `<rect x="13" y="20" width="18" height="8" rx="4" fill="${DIM}" opacity=".6"/><rect x="13" y="6" width="18" height="12" rx="3" fill="${ACC}"/>`,
};

/* ---------- the presets ---------- */

const D = 80; // slide distance in px at 100 %
function slideIn(id: string, name: string, dx: number, dy: number, icon: string): Preset {
  return {
    id,
    name,
    group: 'enter',
    dur: 0.6,
    icon,
    applies: can('pos', 'op'),
    steps: c => ({
      pos: [
        [0, add(c.b('pos'), dx * D * c.s, dy * D * c.s), 'outCubic'],
        [1, vec(c.b('pos')), 'ease'],
      ],
      op: [
        [0, 0, 'outQuad'],
        [0.6, num(c.b('op'), 1), 'ease'],
      ],
    }),
  };
}
function slideOut(id: string, name: string, dx: number, dy: number, icon: string): Preset {
  return {
    id,
    name,
    group: 'exit',
    dur: 0.6,
    icon,
    applies: can('pos', 'op'),
    steps: c => ({
      pos: [
        [0, vec(c.a('pos')), 'inCubic'],
        [1, add(c.a('pos'), dx * D * c.s, dy * D * c.s), 'ease'],
      ],
      op: [
        [0.4, num(c.a('op'), 1), 'inQuad'],
        [1, 0, 'ease'],
      ],
    }),
  };
}
/** emphasis that goes round a full turn: it lands on the start value plus a turn, held for an instant
 *  then set back, so the rest of the animation goes on from the value it had */
const turnEnd = (c: Ctx, k: string, turn: number): Step[] => [
  [0.97, num(c.a(k)) + turn, 'hold'],
  [1, num(c.b(k)), 'ease'],
];

export const PRESETS: Preset[] = [
  // Entrances
  {
    id: 'fade-in',
    name: 'Fade in',
    group: 'enter',
    dur: 0.6,
    icon: ic.fade,
    applies: can('op'),
    steps: c => ({
      op: [
        [0, 0, 'outQuad'],
        [1, num(c.b('op'), 1), 'ease'],
      ],
    }),
  },
  slideIn('slide-up', 'Slide up', 0, 1, ic.slide(0, 8)),
  slideIn('slide-down', 'Slide down', 0, -1, ic.slide(0, -8)),
  slideIn('slide-left', 'Slide left', 1, 0, ic.slide(8, 0)),
  slideIn('slide-right', 'Slide right', -1, 0, ic.slide(-8, 0)),
  {
    id: 'pop-in',
    name: 'Pop in',
    group: 'enter',
    dur: 0.6,
    icon: ic.grow,
    applies: can('scl', 'op'),
    steps: c => ({
      scl: [
        [0, mul(c.b('scl'), Math.max(0, 1 - c.s)), 'outBack'],
        [1, vec(c.b('scl'), [1, 1]), 'ease'],
      ],
      op: [
        [0, 0, 'outQuad'],
        [0.35, num(c.b('op'), 1), 'ease'],
      ],
    }),
  },
  {
    id: 'zoom-in',
    name: 'Zoom in',
    group: 'enter',
    dur: 0.7,
    icon: ic.shrink,
    applies: can('scl', 'op'),
    steps: c => ({
      scl: [
        [0, mul(c.b('scl'), 1 + 0.6 * c.s), 'outCubic'],
        [1, vec(c.b('scl'), [1, 1]), 'ease'],
      ],
      op: [
        [0, 0, 'outQuad'],
        [0.6, num(c.b('op'), 1), 'ease'],
      ],
    }),
  },
  {
    id: 'drop-in',
    name: 'Drop in',
    group: 'enter',
    dur: 0.9,
    icon: ic.slide(0, -8),
    applies: can('pos', 'op'),
    steps: c => ({
      pos: [
        [0, add(c.b('pos'), 0, -D * c.s), 'outBounce'],
        [1, vec(c.b('pos')), 'ease'],
      ],
      op: [
        [0, 0, 'outQuad'],
        [0.2, num(c.b('op'), 1), 'ease'],
      ],
    }),
  },
  {
    id: 'rotate-in',
    name: 'Rotate in',
    group: 'enter',
    dur: 0.7,
    icon: ic.spin,
    applies: can('rot', 'scl', 'op'),
    steps: c => ({
      rot: [
        [0, num(c.b('rot')) - 180 * c.s, 'outCubic'],
        [1, num(c.b('rot')), 'ease'],
      ],
      scl: [
        [0, mul(c.b('scl'), Math.max(0, 1 - 0.7 * c.s)), 'outBack'],
        [1, vec(c.b('scl'), [1, 1]), 'ease'],
      ],
      op: [
        [0, 0, 'outQuad'],
        [0.4, num(c.b('op'), 1), 'ease'],
      ],
    }),
  },
  {
    id: 'flip-in',
    name: 'Flip in',
    group: 'enter',
    dur: 0.6,
    icon: ic.grow,
    applies: can('scl', 'op'),
    steps: c => {
      const e = vec(c.b('scl'), [1, 1]);
      return {
        scl: [
          [0, [r3(e[0] * Math.max(0, 1 - c.s)), e[1]], 'outBack'],
          [1, e, 'ease'],
        ],
        op: [
          [0, 0, 'outQuad'],
          [0.3, num(c.b('op'), 1), 'ease'],
        ],
      };
    },
  },
  {
    id: 'elastic-in',
    name: 'Elastic in',
    group: 'enter',
    dur: 1,
    icon: ic.grow,
    applies: can('scl', 'op'),
    steps: c => ({
      scl: [
        [0, mul(c.b('scl'), Math.max(0, 1 - c.s)), 'outElastic'],
        [1, vec(c.b('scl'), [1, 1]), 'ease'],
      ],
      op: [
        [0, 0, 'outQuad'],
        [0.15, num(c.b('op'), 1), 'ease'],
      ],
    }),
  },
  {
    id: 'spiral-in',
    name: 'Spiral in',
    group: 'enter',
    dur: 0.9,
    icon: ic.spin,
    applies: can('rot', 'scl', 'op'),
    steps: c => ({
      rot: [
        [0, num(c.b('rot')) - 360 * c.s, 'outCubic'],
        [1, num(c.b('rot')), 'ease'],
      ],
      scl: [
        [0, mul(c.b('scl'), Math.max(0, 1 - c.s)), 'outCubic'],
        [1, vec(c.b('scl'), [1, 1]), 'ease'],
      ],
      op: [
        [0, 0, 'outQuad'],
        [0.4, num(c.b('op'), 1), 'ease'],
      ],
    }),
  },
  {
    id: 'skew-in',
    name: 'Skew in',
    group: 'enter',
    dur: 0.7,
    icon: ic.slide(8, 0),
    applies: can('pos', 'skw', 'op'),
    steps: c => ({
      pos: [
        [0, add(c.b('pos'), D * c.s, 0), 'outCubic'],
        [1, vec(c.b('pos')), 'ease'],
      ],
      skw: [
        [0, add(c.b('skw'), -25 * c.s, 0), 'outBack'],
        [1, vec(c.b('skw')), 'ease'],
      ],
      op: [
        [0, 0, 'outQuad'],
        [0.5, num(c.b('op'), 1), 'ease'],
      ],
    }),
  },
  {
    id: 'unfold',
    name: 'Unfold',
    group: 'enter',
    dur: 0.6,
    icon: ic.grow,
    applies: can('scl', 'op'),
    steps: c => {
      const e = vec(c.b('scl'), [1, 1]);
      return {
        scl: [
          [0, [e[0], r3(e[1] * Math.max(0, 1 - c.s))], 'outCubic'],
          [1, e, 'ease'],
        ],
        op: [
          [0, 0, 'outQuad'],
          [0.3, num(c.b('op'), 1), 'ease'],
        ],
      };
    },
  },
  // Exits
  {
    id: 'fade-out',
    name: 'Fade out',
    group: 'exit',
    dur: 0.6,
    icon: ic.fade,
    applies: can('op'),
    steps: c => ({
      op: [
        [0, num(c.a('op'), 1), 'inQuad'],
        [1, 0, 'ease'],
      ],
    }),
  },
  slideOut('slide-out-up', 'Slide up', 0, -1, ic.slide(0, -8)),
  slideOut('slide-out-down', 'Slide down', 0, 1, ic.slide(0, 8)),
  slideOut('slide-out-left', 'Slide left', -1, 0, ic.slide(-8, 0)),
  slideOut('slide-out-right', 'Slide right', 1, 0, ic.slide(8, 0)),
  {
    id: 'pop-out',
    name: 'Pop out',
    group: 'exit',
    dur: 0.5,
    icon: ic.shrink,
    applies: can('scl', 'op'),
    steps: c => ({
      scl: [
        [0, vec(c.a('scl'), [1, 1]), 'outQuad'],
        [0.3, mul(c.a('scl'), 1 + 0.12 * c.s), 'inBack'],
        [1, mul(c.a('scl'), Math.max(0, 1 - c.s)), 'ease'],
      ],
      op: [
        [0.65, num(c.a('op'), 1), 'inQuad'],
        [1, 0, 'ease'],
      ],
    }),
  },
  {
    id: 'zoom-out',
    name: 'Zoom out',
    group: 'exit',
    dur: 0.7,
    icon: ic.grow,
    applies: can('scl', 'op'),
    steps: c => ({
      scl: [
        [0, vec(c.a('scl'), [1, 1]), 'inCubic'],
        [1, mul(c.a('scl'), 1 + 0.6 * c.s), 'ease'],
      ],
      op: [
        [0.4, num(c.a('op'), 1), 'inQuad'],
        [1, 0, 'ease'],
      ],
    }),
  },
  {
    id: 'drop-out',
    name: 'Drop out',
    group: 'exit',
    dur: 0.6,
    icon: ic.slide(0, 8),
    applies: can('pos', 'op'),
    steps: c => ({
      pos: [
        [0, vec(c.a('pos')), 'inBack'],
        [1, add(c.a('pos'), 0, D * c.s), 'ease'],
      ],
      op: [
        [0.5, num(c.a('op'), 1), 'inQuad'],
        [1, 0, 'ease'],
      ],
    }),
  },
  {
    id: 'rotate-out',
    name: 'Rotate out',
    group: 'exit',
    dur: 0.7,
    icon: ic.spin,
    applies: can('rot', 'scl', 'op'),
    steps: c => ({
      rot: [
        [0, num(c.a('rot')), 'inCubic'],
        [1, num(c.a('rot')) + 180 * c.s, 'ease'],
      ],
      scl: [
        [0, vec(c.a('scl'), [1, 1]), 'inBack'],
        [1, mul(c.a('scl'), Math.max(0, 1 - 0.7 * c.s)), 'ease'],
      ],
      op: [
        [0.6, num(c.a('op'), 1), 'inQuad'],
        [1, 0, 'ease'],
      ],
    }),
  },
  {
    id: 'flip-out',
    name: 'Flip out',
    group: 'exit',
    dur: 0.5,
    icon: ic.shrink,
    applies: can('scl', 'op'),
    steps: c => {
      const a = vec(c.a('scl'), [1, 1]);
      return {
        scl: [
          [0, a, 'inBack'],
          [1, [r3(a[0] * Math.max(0, 1 - c.s)), a[1]], 'ease'],
        ],
        op: [
          [0.7, num(c.a('op'), 1), 'inQuad'],
          [1, 0, 'ease'],
        ],
      };
    },
  },
  {
    id: 'spiral-out',
    name: 'Spiral out',
    group: 'exit',
    dur: 0.9,
    icon: ic.spin,
    applies: can('rot', 'scl', 'op'),
    steps: c => ({
      rot: [
        [0, num(c.a('rot')), 'inCubic'],
        [1, num(c.a('rot')) + 360 * c.s, 'ease'],
      ],
      scl: [
        [0, vec(c.a('scl'), [1, 1]), 'inCubic'],
        [1, mul(c.a('scl'), Math.max(0, 1 - c.s)), 'ease'],
      ],
      op: [
        [0.6, num(c.a('op'), 1), 'inQuad'],
        [1, 0, 'ease'],
      ],
    }),
  },
  {
    id: 'skew-out',
    name: 'Skew out',
    group: 'exit',
    dur: 0.7,
    icon: ic.slide(8, 0),
    applies: can('pos', 'skw', 'op'),
    steps: c => ({
      pos: [
        [0, vec(c.a('pos')), 'inCubic'],
        [1, add(c.a('pos'), D * c.s, 0), 'ease'],
      ],
      skw: [
        [0, vec(c.a('skw')), 'inBack'],
        [1, add(c.a('skw'), 25 * c.s, 0), 'ease'],
      ],
      op: [
        [0.5, num(c.a('op'), 1), 'inQuad'],
        [1, 0, 'ease'],
      ],
    }),
  },
  {
    id: 'fold',
    name: 'Fold',
    group: 'exit',
    dur: 0.5,
    icon: ic.shrink,
    applies: can('scl', 'op'),
    steps: c => {
      const a = vec(c.a('scl'), [1, 1]);
      return {
        scl: [
          [0, a, 'inCubic'],
          [1, [a[0], r3(a[1] * Math.max(0, 1 - c.s))], 'ease'],
        ],
        op: [
          [0.7, num(c.a('op'), 1), 'inQuad'],
          [1, 0, 'ease'],
        ],
      };
    },
  },
  // Emphasis
  {
    id: 'pulse',
    name: 'Pulse',
    group: 'emph',
    dur: 0.8,
    icon: ic.pulse,
    applies: can('scl'),
    steps: c => ({
      scl: [
        [0, vec(c.a('scl'), [1, 1]), 'inOutSine'],
        [0.5, mul(c.a('scl'), 1 + 0.08 * c.s), 'inOutSine'],
        [1, vec(c.b('scl'), [1, 1]), 'ease'],
      ],
    }),
  },
  {
    id: 'pop',
    name: 'Pop',
    group: 'emph',
    dur: 0.6,
    icon: ic.pop,
    applies: can('scl'),
    steps: c => ({
      scl: [
        [0, vec(c.a('scl'), [1, 1]), 'outQuad'],
        [0.35, mul(c.a('scl'), 1 + 0.2 * c.s), 'outBack'],
        [1, vec(c.b('scl'), [1, 1]), 'ease'],
      ],
    }),
  },
  {
    id: 'wiggle',
    name: 'Wiggle',
    group: 'emph',
    dur: 0.8,
    icon: ic.wiggle,
    applies: can('rot'),
    steps: c => {
      const a = num(c.a('rot')),
        s = c.s;
      return {
        rot: [
          [0, a, 'inOutSine'],
          [0.2, a + 6 * s, 'inOutSine'],
          [0.4, a - 6 * s, 'inOutSine'],
          [0.6, a + 4 * s, 'inOutSine'],
          [0.8, a - 2 * s, 'inOutSine'],
          [1, num(c.b('rot')), 'ease'],
        ],
      };
    },
  },
  {
    id: 'shake',
    name: 'Shake',
    group: 'emph',
    dur: 0.6,
    icon: ic.shake,
    applies: can('pos'),
    steps: c => {
      const a = c.a('pos'),
        d = 10 * c.s;
      return {
        pos: [
          [0, vec(a), 'inOutSine'],
          [0.15, add(a, d, 0), 'inOutSine'],
          [0.3, add(a, -d, 0), 'inOutSine'],
          [0.45, add(a, d, 0), 'inOutSine'],
          [0.6, add(a, -d, 0), 'inOutSine'],
          [0.75, add(a, d / 2, 0), 'inOutSine'],
          [1, vec(c.b('pos')), 'ease'],
        ],
      };
    },
  },
  {
    id: 'spin',
    name: 'Spin',
    group: 'emph',
    dur: 0.8,
    icon: ic.spin,
    applies: can('rot'),
    steps: c => ({
      rot: [[0, num(c.a('rot')), 'inOutCubic'], ...turnEnd(c, 'rot', 360 * Math.max(1, Math.round(c.s)))],
    }),
  },
  {
    id: 'swing',
    name: 'Swing',
    group: 'emph',
    dur: 1,
    icon: ic.swing,
    applies: can('rot'),
    steps: c => {
      const a = num(c.a('rot')),
        s = c.s;
      return {
        rot: [
          [0, a, 'inOutSine'],
          [0.2, a + 15 * s, 'inOutSine'],
          [0.4, a - 10 * s, 'inOutSine'],
          [0.6, a + 5 * s, 'inOutSine'],
          [0.8, a - 3 * s, 'inOutSine'],
          [1, num(c.b('rot')), 'ease'],
        ],
      };
    },
  },
  {
    id: 'blink',
    name: 'Blink',
    group: 'emph',
    dur: 0.8,
    icon: ic.blink,
    applies: can('op'),
    steps: c => {
      const a = num(c.a('op'), 1);
      return {
        op: [
          [0, a, 'hold'],
          [0.25, 0, 'hold'],
          [0.5, a, 'hold'],
          [0.75, 0, 'hold'],
          [1, num(c.b('op'), 1), 'ease'],
        ],
      };
    },
  },
  {
    id: 'heartbeat',
    name: 'Heartbeat',
    group: 'emph',
    dur: 1,
    icon: ic.heart,
    applies: can('scl'),
    steps: c => {
      const a = c.a('scl'),
        up = mul(a, 1 + 0.15 * c.s);
      return {
        scl: [
          [0, vec(a, [1, 1]), 'outQuad'],
          [0.14, up, 'inOutQuad'],
          [0.28, vec(a, [1, 1]), 'outQuad'],
          [0.42, up, 'inOutQuad'],
          [0.7, vec(a, [1, 1]), 'ease'],
          [1, vec(c.b('scl'), [1, 1]), 'ease'],
        ],
      };
    },
  },
  {
    id: 'bounce',
    name: 'Bounce',
    group: 'emph',
    dur: 0.9,
    icon: ic.slide(0, 8),
    applies: can('pos'),
    steps: c => {
      const a = c.a('pos'),
        h = 22 * c.s;
      return {
        pos: [
          [0, vec(a), 'outQuad'],
          [0.3, add(a, 0, -h), 'inQuad'],
          [0.55, vec(a), 'outQuad'],
          [0.72, add(a, 0, -h * 0.35), 'inQuad'],
          [0.86, vec(a), 'ease'],
          [1, vec(c.b('pos')), 'ease'],
        ],
      };
    },
  },
  {
    id: 'rubber',
    name: 'Rubber band',
    group: 'emph',
    dur: 0.9,
    icon: ic.pulse,
    applies: can('scl'),
    steps: c => {
      const a = vec(c.a('scl'), [1, 1]),
        k = (x: number, y: number) => [r3(a[0] * (1 + (x - 1) * c.s)), r3(a[1] * (1 + (y - 1) * c.s))];
      return {
        scl: [
          [0, a, 'inOutSine'],
          [0.3, k(1.25, 0.75), 'inOutSine'],
          [0.4, k(0.75, 1.25), 'inOutSine'],
          [0.5, k(1.15, 0.85), 'inOutSine'],
          [0.65, k(0.95, 1.05), 'inOutSine'],
          [0.75, k(1.05, 0.95), 'inOutSine'],
          [1, vec(c.b('scl'), [1, 1]), 'ease'],
        ],
      };
    },
  },
  {
    id: 'jello',
    name: 'Jello',
    group: 'emph',
    dur: 0.9,
    icon: ic.wiggle,
    applies: can('skw'),
    steps: c => {
      const a = vec(c.a('skw')),
        k = (d: number) => [r3(a[0] + d * c.s), r3(a[1] + d * c.s)];
      return {
        skw: [
          [0, a, 'inOutSine'],
          [0.2, k(-12), 'inOutSine'],
          [0.35, k(6), 'inOutSine'],
          [0.5, k(-3), 'inOutSine'],
          [0.65, k(1.5), 'inOutSine'],
          [0.8, k(-0.6), 'inOutSine'],
          [1, vec(c.b('skw')), 'ease'],
        ],
      };
    },
  },
  {
    id: 'tada',
    name: 'Tada',
    group: 'emph',
    dur: 1,
    icon: ic.pop,
    applies: can('scl', 'rot'),
    steps: c => {
      const a = vec(c.a('scl'), [1, 1]),
        r = num(c.a('rot')),
        s = c.s,
        w = (f: number, d: number): Step => [f, r + d * s, 'inOutSine'];
      return {
        scl: [
          [0, a, 'inOutSine'],
          [0.15, mul(a, 1 - 0.1 * s), 'inOutSine'],
          [0.3, mul(a, 1 + 0.1 * s), 'inOutSine'],
          [0.9, mul(a, 1 + 0.1 * s), 'inOutSine'],
          [1, vec(c.b('scl'), [1, 1]), 'ease'],
        ],
        rot: [
          w(0, 0),
          w(0.15, -3),
          w(0.3, 3),
          w(0.4, -3),
          w(0.5, 3),
          w(0.6, -3),
          w(0.7, 3),
          w(0.8, -3),
          w(0.9, 3),
          [1, num(c.b('rot')), 'ease'],
        ],
      };
    },
  },
  {
    id: 'float',
    name: 'Float',
    group: 'emph',
    dur: 1.6,
    icon: ic.slide(0, -6),
    applies: can('pos'),
    steps: c => ({
      pos: [
        [0, vec(c.a('pos')), 'inOutSine'],
        [0.5, add(c.a('pos'), 0, -10 * c.s), 'inOutSine'],
        [1, vec(c.b('pos')), 'ease'],
      ],
    }),
  },
  {
    id: 'flicker',
    name: 'Flicker',
    group: 'emph',
    dur: 0.8,
    icon: ic.blink,
    applies: can('op'),
    steps: c => {
      const a = num(c.a('op'), 1),
        lo = (f: number) => r3(a * Math.max(0, 1 - f * c.s));
      return {
        op: [
          [0, a, 'hold'],
          [0.1, lo(0.8), 'hold'],
          [0.18, a, 'hold'],
          [0.3, lo(0.5), 'hold'],
          [0.36, a, 'hold'],
          [0.6, lo(0.9), 'hold'],
          [0.66, a, 'hold'],
          [1, num(c.b('op'), 1), 'ease'],
        ],
      };
    },
  },
  {
    id: 'head-shake',
    name: 'Head shake',
    group: 'emph',
    dur: 0.9,
    icon: ic.shake,
    applies: can('pos', 'rot'),
    steps: c => {
      const a = c.a('pos'),
        r = num(c.a('rot')),
        s = c.s;
      return {
        pos: [
          [0, vec(a), 'inOutSine'],
          [0.13, add(a, -6 * s, 0), 'inOutSine'],
          [0.37, add(a, 5 * s, 0), 'inOutSine'],
          [0.63, add(a, -3 * s, 0), 'inOutSine'],
          [0.87, add(a, 2 * s, 0), 'inOutSine'],
          [1, vec(c.b('pos')), 'ease'],
        ],
        rot: [
          [0, r, 'inOutSine'],
          [0.13, r - 9 * s, 'inOutSine'],
          [0.37, r + 7 * s, 'inOutSine'],
          [0.63, r - 5 * s, 'inOutSine'],
          [0.87, r + 3 * s, 'inOutSine'],
          [1, num(c.b('rot')), 'ease'],
        ],
      };
    },
  },
  {
    id: 'breathe',
    name: 'Breathe',
    group: 'emph',
    dur: 2,
    icon: ic.pulse,
    applies: can('scl', 'op'),
    steps: c => {
      const a = vec(c.a('scl'), [1, 1]),
        o = num(c.a('op'), 1);
      return {
        scl: [
          [0, a, 'inOutSine'],
          [0.5, mul(a, 1 + 0.05 * c.s), 'inOutSine'],
          [1, vec(c.b('scl'), [1, 1]), 'ease'],
        ],
        op: [
          [0, o, 'inOutSine'],
          [0.5, r3(o * Math.max(0, 1 - 0.25 * c.s)), 'inOutSine'],
          [1, num(c.b('op'), 1), 'ease'],
        ],
      };
    },
  },
  {
    id: 'wobble',
    name: 'Wobble',
    group: 'emph',
    dur: 1,
    icon: ic.swing,
    applies: can('pos', 'rot'),
    steps: c => {
      const a = c.a('pos'),
        r = num(c.a('rot')),
        s = c.s,
        st = (f: number, dx: number, dr: number): [Step, Step] => [
          [f, add(a, dx * s, 0), 'inOutSine'],
          [f, r + dr * s, 'inOutSine'],
        ],
        k = [st(0.15, -18, -5), st(0.3, 14, 3), st(0.45, -10, -3), st(0.6, 6, 2), st(0.75, -3, -1)];
      return {
        pos: [[0, vec(a), 'inOutSine'], ...k.map(x => x[0]), [1, vec(c.b('pos')), 'ease']],
        rot: [[0, r, 'inOutSine'], ...k.map(x => x[1]), [1, num(c.b('rot')), 'ease']],
      };
    },
  },
  {
    id: 'squash',
    name: 'Squash',
    group: 'emph',
    dur: 0.6,
    icon: ic.pulse,
    applies: can('scl'),
    steps: c => {
      const a = vec(c.a('scl'), [1, 1]),
        k = (x: number, y: number) => [r3(a[0] * (1 + (x - 1) * c.s)), r3(a[1] * (1 + (y - 1) * c.s))];
      return {
        scl: [
          [0, a, 'outQuad'],
          [0.3, k(1.3, 0.7), 'outBack'],
          [1, vec(c.b('scl'), [1, 1]), 'ease'],
        ],
      };
    },
  },
  {
    id: 'glitch',
    name: 'Glitch',
    group: 'emph',
    dur: 0.6,
    icon: ic.shake,
    applies: can('pos', 'op'),
    steps: c => {
      const a = c.a('pos'),
        o = num(c.a('op'), 1),
        s = c.s;
      return {
        pos: [
          [0, vec(a), 'hold'],
          [0.1, add(a, 6 * s, -2 * s), 'hold'],
          [0.2, add(a, -5 * s, 3 * s), 'hold'],
          [0.3, vec(a), 'hold'],
          [0.55, add(a, 4 * s, 0), 'hold'],
          [0.65, add(a, -3 * s, -2 * s), 'hold'],
          [0.75, vec(a), 'hold'],
          [1, vec(c.b('pos')), 'ease'],
        ],
        op: [
          [0, o, 'hold'],
          [0.2, r3(o * Math.max(0, 1 - 0.6 * s)), 'hold'],
          [0.3, o, 'hold'],
          [0.65, r3(o * Math.max(0, 1 - 0.4 * s)), 'hold'],
          [0.75, o, 'hold'],
          [1, num(c.b('op'), 1), 'ease'],
        ],
      };
    },
  },
  // Strokes
  {
    id: 'draw-on',
    name: 'Draw on',
    group: 'stroke',
    dur: 1.2,
    icon: ic.draw,
    applies: can('te'),
    steps: c => ({
      te: [
        [0, num(c.b('ts'), 0), 'inOutCubic'],
        [1, num(c.b('te'), 100), 'ease'],
      ],
    }),
  },
  {
    id: 'erase',
    name: 'Erase',
    group: 'stroke',
    dur: 1.2,
    icon: ic.erase,
    applies: can('ts'),
    steps: c => ({
      ts: [
        [0, num(c.a('ts'), 0), 'inOutCubic'],
        [1, num(c.a('te'), 100), 'ease'],
      ],
    }),
  },
  {
    id: 'travel',
    name: 'Travel',
    group: 'stroke',
    dur: 1.2,
    icon: ic.travel,
    applies: can('to'),
    steps: c => ({ to: [[0, num(c.a('to')), 'linear'], ...turnEnd(c, 'to', 100)] }),
  },
  {
    id: 'draw-mid',
    name: 'Draw from middle',
    group: 'stroke',
    dur: 1.2,
    icon: ic.draw,
    applies: can('ts', 'te'),
    steps: c => {
      const ts = num(c.b('ts'), 0),
        te = num(c.b('te'), 100),
        m = r3((ts + te) / 2);
      return {
        ts: [
          [0, m, 'inOutCubic'],
          [1, ts, 'ease'],
        ],
        te: [
          [0, m, 'inOutCubic'],
          [1, te, 'ease'],
        ],
      };
    },
  },
  {
    id: 'stroke-pulse',
    name: 'Stroke pulse',
    group: 'stroke',
    dur: 0.8,
    icon: ic.travel,
    applies: l => propOK(l, 'sw') && num(valueAt(l, 'sw', S.time)) > 0 && valueAt(l, 'stk', S.time) !== 'none',
    steps: c => {
      const a = num(c.a('sw'), 1);
      return {
        sw: [
          [0, a, 'inOutSine'],
          [0.5, r3(a * (1 + 1.5 * c.s)), 'inOutSine'],
          [1, num(c.b('sw'), 1), 'ease'],
        ],
      };
    },
  },
  {
    id: 'undraw',
    name: 'Undraw',
    group: 'stroke',
    dur: 1,
    icon: ic.erase,
    applies: can('te'),
    steps: c => ({
      te: [
        [0, num(c.a('te'), 100), 'inOutCubic'],
        [1, num(c.a('ts'), 0), 'ease'],
      ],
    }),
  },
  // Color
  {
    id: 'flash',
    name: 'Flash',
    group: 'colour',
    dur: 0.6,
    icon: ic.flash,
    applies: solidFill,
    steps: c => ({
      fill: [
        [0, c.a('fill'), 'outQuad'],
        [0.3, '#ffffff', 'inOutQuad'],
        [1, c.b('fill'), 'ease'],
      ],
    }),
  },
  {
    id: 'dim',
    name: 'Dim',
    group: 'colour',
    dur: 0.8,
    icon: ic.dim,
    applies: l => paintable(l) && propOK(l, 'fo'),
    steps: c => {
      const a = num(c.a('fo'), 1);
      return {
        fo: [
          [0, a, 'inOutSine'],
          [0.5, r3(a * Math.max(0, 1 - 0.7 * c.s)), 'inOutSine'],
          [1, num(c.b('fo'), 1), 'ease'],
        ],
      };
    },
  },
  {
    id: 'stroke-flash',
    name: 'Stroke flash',
    group: 'colour',
    dur: 0.6,
    icon: ic.flash,
    applies: l => {
      const v = valueAt(l, 'stk', S.time);
      return (
        paintable(l) && typeof v === 'string' && v !== 'none' && !/^url/.test(v) && num(valueAt(l, 'sw', S.time)) > 0
      );
    },
    steps: c => ({
      stk: [
        [0, c.a('stk'), 'outQuad'],
        [0.3, '#ffffff', 'inOutQuad'],
        [1, c.b('stk'), 'ease'],
      ],
    }),
  },
  {
    id: 'colour-pulse',
    name: 'Color pulse',
    group: 'colour',
    dur: 0.9,
    icon: ic.flash,
    applies: solidFill,
    steps: c => ({
      fill: [
        [0, c.a('fill'), 'inOutSine'],
        [0.5, '#ffc547', 'inOutSine'],
        [1, c.b('fill'), 'ease'],
      ],
    }),
  },
  // Filters (the JS export plays them; a CSS export keeps filters still)
  {
    id: 'blur-in',
    name: 'Blur in',
    group: 'filter',
    dur: 0.6,
    css: false,
    icon: ic.blurIn,
    applies: l => l.type !== 'bone',
    prep: l => filterId(l, 'blur', { sd: 0 }),
    steps: c => {
      const k = fxk(c.l, 'blur', 'sd');
      return {
        [k]: [
          [0, r3(12 * c.s), 'outQuad'],
          [1, num(c.b(k)), 'ease'],
        ],
      };
    },
  },
  {
    id: 'blur-out',
    name: 'Blur out',
    group: 'filter',
    dur: 0.6,
    css: false,
    icon: ic.blurOut,
    applies: l => l.type !== 'bone',
    prep: l => filterId(l, 'blur', { sd: 0 }),
    steps: c => {
      const k = fxk(c.l, 'blur', 'sd');
      return {
        [k]: [
          [0, num(c.a(k)), 'inQuad'],
          [1, r3(num(c.a(k)) + 12 * c.s), 'ease'],
        ],
      };
    },
  },
  {
    id: 'glow',
    name: 'Glow pulse',
    group: 'filter',
    dur: 1,
    css: false,
    icon: ic.glow,
    applies: l => l.type !== 'bone',
    prep: l => {
      if (!(l.fx || []).some(f => f.type === 'shadow')) {
        filterId(l, 'shadow', { dx: 0, dy: 0, sd: 8, sp: 2, col: '#ffffff', op: 0 });
        const g = l.fx.find(f => f.type === 'shadow');
        if (g) g.name = 'Glow';
      }
    },
    steps: c => {
      const k = fxk(c.l, 'shadow', 'op'),
        a = num(c.a(k));
      return {
        [k]: [
          [0, a, 'inOutSine'],
          [0.5, r3(Math.min(1, a + 0.8 * c.s)), 'inOutSine'],
          [1, num(c.b(k)), 'ease'],
        ],
      };
    },
  },
  {
    id: 'lift',
    name: 'Shadow lift',
    group: 'filter',
    dur: 1,
    css: false,
    icon: ic.lift,
    applies: l => l.type !== 'bone' && propOK(l, 'pos'),
    prep: l => {
      if (!(l.fx || []).some(f => f.type === 'shadow')) filterId(l, 'shadow', { dx: 0, dy: 0, sd: 0, op: 0 });
    },
    steps: c => {
      const l = c.l,
        dy = fxk(l, 'shadow', 'dy'),
        sd = fxk(l, 'shadow', 'sd'),
        op = fxk(l, 'shadow', 'op'),
        s = c.s;
      const up = (k: string, d: number, max = Infinity): Step[] => [
        [0, num(c.a(k)), 'outCubic'],
        [0.4, r3(Math.min(max, num(c.a(k)) + d * s)), 'inOutCubic'],
        [1, num(c.b(k)), 'ease'],
      ];
      return {
        pos: [
          [0, vec(c.a('pos')), 'outCubic'],
          [0.4, add(c.a('pos'), 0, -8 * s), 'inOutCubic'],
          [1, vec(c.b('pos')), 'ease'],
        ],
        [dy]: up(dy, 10),
        [sd]: up(sd, 10),
        [op]: up(op, 0.3, 1),
      };
    },
  },
  {
    id: 'soft-focus',
    name: 'Soft focus',
    group: 'filter',
    dur: 1,
    css: false,
    icon: ic.blurOut,
    applies: l => l.type !== 'bone',
    prep: l => filterId(l, 'blur', { sd: 0 }),
    steps: c => {
      const k = fxk(c.l, 'blur', 'sd'),
        a = num(c.a(k));
      return {
        [k]: [
          [0, a, 'inOutSine'],
          [0.5, r3(a + 6 * c.s), 'inOutSine'],
          [1, num(c.b(k)), 'ease'],
        ],
      };
    },
  },
];
export const presetById = (id: string) => PRESETS.find(p => p.id === id) || null;

/* ---------- applying ---------- */

export interface PresetPlan {
  /** per layer: the span and the properties written */
  spans: Array<{ lid: string; t0: number; t1: number; props: string[] }>;
  /** existing keyframes that would be replaced */
  replaced: Keyframe[];
  /** the animation would grow to this length */
  dur: number;
}
/** The layers a preset can go on, of the selection. */
export function presetTargets(p: Preset, ids: Iterable<string> = S.selSet): Layer[] {
  return [...ids].map(id => doc.layers.find(l => l.id === id)).filter(l => l && !isLocked(l) && p.applies(l));
}
/** the properties a preset writes on a layer, without changing it (filters it would add show as their
 *  filter's parameter keys) */
function plannedProps(p: Preset, l: Layer): string[] {
  if (!p.prep) return Object.keys(p.steps(ctxFor(l, 0, 0, 1)));
  const copy: Layer = { ...l, b: { ...l.b }, t: { ...l.t }, fx: l.fx ? l.fx.slice() : undefined };
  p.prep(copy);
  return Object.keys(p.steps(ctxFor(copy, 0, 0, 1)));
}
function ctxFor(l: Layer, t0: number, t1: number, s: number): Ctx {
  return { a: k => clone(valueAt(l, k, t0)), b: k => clone(valueAt(l, k, t1)), s, l };
}
/** What applying would do, for the hover preview: spans, replaced keys, new length. */
export function planPreset(p: Preset, at: number, len: number, stagger = 0, ids?: Iterable<string>): PresetPlan {
  const ls = presetTargets(p, ids),
    spans: PresetPlan['spans'] = [],
    replaced: Keyframe[] = [];
  let dur = doc.dur;
  ls.forEach((l, i) => {
    const t0 = r3(at + i * stagger),
      t1 = r3(t0 + len),
      props = plannedProps(p, l);
    spans.push({ lid: l.id, t0, t1, props });
    props.forEach(k => (l.t[k] || []).forEach(q => q[0] >= t0 - 0.0005 && q[0] <= t1 + 0.0005 && replaced.push(q)));
    dur = Math.max(dur, t1);
  });
  return { spans, replaced, dur: r3(dur) };
}
/**
 * Apply a preset to the selected layers at `at` (seconds), `len` long, each next layer `stagger`
 * seconds later, at `strength` (1 = 100 %). One undo step. Returns how many layers it went on and how
 * many keyframes it replaced, or null when it applies to none of them.
 */
export function applyPreset(p: Preset, at: number, len: number, stagger = 0, strength = 1, ids?: Iterable<string>) {
  if (!presetTargets(p, ids).length) return null;
  const ed = beginEdit(),
    r = writePreset(p, at, len, stagger, strength, ids);
  ed.end({ insp: true });
  return r;
}
/** applyPreset without the undo step (the document changes only) */
export function writePreset(p: Preset, at: number, len: number, stagger = 0, strength = 1, ids?: Iterable<string>) {
  const ls = presetTargets(p, ids);
  if (!ls.length) return null;
  const was = doc.dur;
  let replaced = 0,
    end = doc.dur;
  const made: Keyframe[] = [];
  ls.forEach((l, i) => {
    const t0 = r3(Math.max(0, at + i * stagger)),
      t1 = r3(t0 + len);
    if (p.prep) p.prep(l);
    // the values the layer has now, before anything is removed
    const c = ctxFor(l, t0, t1, strength),
      plan = p.steps(c);
    for (const k in plan) {
      if (!k) continue;
      const tr = (l.t[k] = l.t[k] || []),
        keep = tr.filter(q => q[0] < t0 - 0.0005 || q[0] > t1 + 0.0005);
      replaced += tr.length - keep.length;
      plan[k].forEach(([f, v, e]) => {
        const q: Keyframe = [r3(t0 + f * (t1 - t0)), clone(v), e];
        keep.push(q);
        made.push(q);
      });
      sortTrack(keep);
      l.t[k] = keep;
    }
    S.exp[l.id] = true;
    end = Math.max(end, t1);
  });
  if (end > was) doc.dur = r3(end);
  S.keys = new Set(made);
  return { layers: ls.length, replaced, grew: doc.dur > was };
}
/** a CSS export can't play this preset */
export const presetJSOnly = (p: Preset) => p.css === false;
/** the filter definitions presets rely on exist (guards against renames) */
export const PRESET_FILTERS_OK = !!(FILTERS.blur && FILTERS.shadow);

/* ---------- tile previews ---------- */

const NEUTRAL: Record<string, any> = {
  pos: [0, 0],
  scl: [1, 1],
  rot: 0,
  skw: [0, 0],
  op: 1,
  fo: 1,
  so: 1,
  sw: 2,
  ts: 0,
  te: 100,
  to: 0,
  fill: '#7189ff',
  stk: '#7189ff',
};
/** what a preset writes on a plain shape at full strength: its steps, with the shape's values neutral */
function demo(p: Preset) {
  const l = { id: 'demo', type: 'path', b: { ...NEUTRAL }, t: {}, geo: {}, extra: {} } as unknown as Layer;
  if (p.prep) p.prep(l);
  const val = (k: string) => (k in NEUTRAL ? NEUTRAL[k] : l.b[k]);
  return { l, steps: p.steps({ a: k => clone(val(k)), b: k => clone(val(k)), s: 1, l }) };
}
export const demoSteps = (p: Preset): Record<string, Step[]> => demo(p).steps;
const LABELS: Record<string, string> = {
  pos: 'Position',
  scl: 'Scale',
  rot: 'Rotate',
  skw: 'Skew',
  op: 'Opacity',
  fo: 'Fill opacity',
  fill: 'Fill',
  stk: 'Stroke',
  sw: 'Stroke width',
  ts: 'Trim start',
  te: 'Trim end',
  to: 'Trim offset',
};
/** the tracks a preset animates, in words ("Position · Opacity"); a filter's by its filter */
export function presetTracks(p: Preset): string[] {
  const { l, steps } = demo(p),
    out: string[] = [];
  Object.keys(steps).forEach(k => {
    const fx = /^fx\.([^.]+)\./.exec(k),
      f = fx && (l.fx || []).find(x => x.id === fx[1]),
      name = LABELS[k] || (f ? (f.type === 'blur' ? 'Blur' : 'Shadow') : k);
    if (!out.includes(name)) out.push(name);
  });
  return out;
}
