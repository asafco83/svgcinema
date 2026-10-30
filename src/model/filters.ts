// SVGcinema — model/filters
// Layer filters. Each parameter is an animatable track keyed `fx.<filter id>.<param>`, stored like any
// other property in Layer.b / Layer.t. A filter is a short chain of SVG filter primitives; the runtime
// animates their attributes through Layer.fa (track → the primitives and attributes it drives, and how
// the value turns into the attribute: a matrix for the color filters, a sum for the outline's rings).
import type { Layer } from './types';
import { H } from '../core/constants';

export interface FilterParam {
  key: string;
  label: string;
  def: number | string;
  unit?: string;
  /** stored value ↔ shown value (e.g. opacity 0–1 shown as %) */
  scale?: number;
  min?: number;
  max?: number;
  /** the letter in the field (defaults to the label's first letter) */
  pre?: string;
  /** shown only when it applies (Outline: Gap only outside the shape) */
  when?: (f: FxEntry) => boolean;
}
export interface FxEntry {
  id: string;
  type: string;
  /** the name it was added under (Glow is a Drop shadow, Inner glow an Inner shadow) */
  name?: string;
  /** Outline: where the line sits ('out' | 'in' | 'mid') */
  pos?: string;
}
/** one animated attribute: [param, element suffix, attribute, value kind?, other param?] */
type Target = [string, string, string, string?, string?];
export interface FilterDef {
  label: string;
  group: 'shadow' | 'colour' | 'edges';
  params: FilterParam[];
  /** a fixed choice stored on the filter itself (not animated) */
  choice?: { key: 'pos'; label: string; def: string; opts: [string, string][] };
  /** the chain reads its input more than once, so the filter before it names its result */
  needsIn?: (l: Layer, f: FxEntry) => boolean;
  /** the attributes the parameters drive */
  targets: (l: Layer, f: FxEntry) => Target[];
  /** the primitives; A(sfx) writes an element's id and animated attributes, IN / OUT name the
   *  chain's input and (when the next filter needs it) the result */
  prims: (l: Layer, f: FxEntry, IN: string, OUT: string, A: (sfx: string) => string) => string;
  /** how far it reaches past the artwork (for meshes) */
  pad?: (v: (p: string) => number, f: FxEntry) => number;
  /** a short summary for the collapsed card */
  sum: (v: (p: string) => any, f: FxEntry) => string;
}
const res = (OUT: string) => (OUT ? ` result="${OUT}"` : '');
const px = (n: number) => `${Math.round(n * 10) / 10} px`;
const pc = (n: number) => `${Math.round(n * 100)}%`;
const opacity = (def: number): FilterParam => ({
  key: 'op',
  label: 'Opacity',
  def,
  unit: '%',
  scale: 100,
  min: 0,
  max: 1,
});
const amount = (def: number, max?: number): FilterParam => ({
  key: 'a',
  label: 'Amount',
  def,
  unit: '%',
  scale: 100,
  min: 0,
  ...(max != null ? { max } : {}),
});
/** a Drop shadow with spread needs the full chain; without, one feDropShadow does it */
const spreads = (l: Layer, f: FxEntry) => {
  const k = fxKey(f.id, 'sp');
  return !!(l.t[k] && l.t[k].length) || (l.b[k] as number) > 0;
};
const shadowParams = (dx: number, dy: number, sd: number, col: string, op: number): FilterParam[] => [
  { key: 'dx', label: 'X', def: dx, unit: 'px' },
  { key: 'dy', label: 'Y', def: dy, unit: 'px' },
  { key: 'sd', label: 'Blur', def: sd, unit: 'px', min: 0 },
  { key: 'sp', label: 'Spread', def: 0, unit: 'px', min: 0 },
  { key: 'col', label: 'Color', def: col },
  opacity(op),
];
const matrix = (label: string, kind: string, def: number, max?: number, type = 'matrix'): FilterDef => ({
  label,
  group: 'colour',
  params: [kind === 'hue' ? { key: 'a', label: 'Angle', def, unit: '°', pre: '∠' } : amount(def, max)],
  targets: () => [['a', '', 'values', kind === 'hue' || kind === 'sat' ? undefined : kind]],
  prims: (l, f, IN, OUT, A) => `<feColorMatrix${A('')} type="${type}"${res(OUT)}/>`,
  sum: v => (kind === 'hue' ? `${Math.round(v('a'))}°` : pc(v('a'))),
});

export const FILTERS: Record<string, FilterDef> = {
  blur: {
    label: 'Blur',
    group: 'shadow',
    params: [{ key: 'sd', label: 'Amount', def: 4, unit: 'px', min: 0 }],
    targets: () => [['sd', '', 'stdDeviation']],
    prims: (l, f, IN, OUT, A) => `<feGaussianBlur${A('')}${res(OUT)}/>`,
    pad: v => v('sd') * 2.5,
    sum: v => px(v('sd')),
  },
  shadow: {
    label: 'Drop shadow',
    group: 'shadow',
    params: shadowParams(4, 6, 6, '#000000', 0.35),
    needsIn: spreads,
    targets: (l, f) =>
      spreads(l, f)
        ? [
            ['sp', 'm', 'radius'],
            ['sd', 'b', 'stdDeviation'],
            ['dx', 'o', 'dx'],
            ['dy', 'o', 'dy'],
            ['col', 'c', 'flood-color'],
            ['op', 'c', 'flood-opacity'],
          ]
        : [
            ['dx', '', 'dx'],
            ['dy', '', 'dy'],
            ['sd', '', 'stdDeviation'],
            ['col', '', 'flood-color'],
            ['op', '', 'flood-opacity'],
          ],
    prims: (l, f, IN, OUT, A) => {
      if (!spreads(l, f)) return `<feDropShadow${A('')}${res(OUT)}/>`;
      const u = f.id;
      return (
        `<feMorphology${A('m')} in="${IN}" operator="dilate" result="${u}m"/>` +
        `<feGaussianBlur${A('b')} in="${u}m"/><feOffset${A('o')} result="${u}o"/>` +
        `<feFlood${A('c')}/><feComposite in2="${u}o" operator="in" result="${u}s"/>` +
        `<feMerge${res(OUT)}><feMergeNode in="${u}s"/><feMergeNode in="${IN}"/></feMerge>`
      );
    },
    pad: v => Math.max(Math.abs(v('dx')), Math.abs(v('dy'))) + v('sd') * 2.5 + v('sp'),
    sum: v => px(v('sd')),
  },
  inner: {
    label: 'Inner shadow',
    group: 'shadow',
    params: shadowParams(0, 3, 4, '#000000', 0.4),
    needsIn: () => true,
    targets: () => [
      ['col', 'c', 'flood-color'],
      ['op', 'c', 'flood-opacity'],
      ['sp', 'm', 'radius'],
      ['sd', 'b', 'stdDeviation'],
      ['dx', 'o', 'dx'],
      ['dy', 'o', 'dy'],
    ],
    // the color everywhere outside the shape, grown inward, blurred and moved, kept inside the shape
    prims: (l, f, IN, OUT, A) => {
      const u = f.id;
      return (
        `<feFlood${A('c')} result="${u}c"/><feComposite in="${u}c" in2="${IN}" operator="out"/>` +
        `<feMorphology${A('m')} operator="dilate"/><feGaussianBlur${A('b')}/><feOffset${A('o')}/>` +
        `<feComposite in2="${IN}" operator="in" result="${u}s"/>` +
        `<feMerge${res(OUT)}><feMergeNode in="${IN}"/><feMergeNode in="${u}s"/></feMerge>`
      );
    },
    sum: v => px(v('sd')),
  },
  bright: matrix('Brightness', 'bri', 1.2),
  con: matrix('Contrast', 'con', 1.2),
  sat: matrix('Saturation', 'sat', 0.6, undefined, 'saturate'),
  hue: matrix('Hue rotate', 'hue', 90, undefined, 'hueRotate'),
  gray: matrix('Grayscale', 'gray', 1, 1),
  sepia: matrix('Sepia', 'sep', 1, 1),
  invert: matrix('Invert', 'inv', 1, 1),
  overlay: {
    label: 'Color overlay',
    group: 'colour',
    params: [{ key: 'col', label: 'Color', def: '#3b5bfd' }, amount(0.5, 1)],
    needsIn: () => true,
    targets: () => [
      ['col', 'c', 'flood-color'],
      ['a', 'c', 'flood-opacity'],
    ],
    prims: (l, f, IN, OUT, A) => {
      const u = f.id;
      return (
        `<feFlood${A('c')}/><feComposite in2="${IN}" operator="in" result="${u}t"/>` +
        `<feMerge${res(OUT)}><feMergeNode in="${IN}"/><feMergeNode in="${u}t"/></feMerge>`
      );
    },
    sum: v => pc(v('a')),
  },
  outline: {
    label: 'Outline',
    group: 'edges',
    choice: {
      key: 'pos',
      label: 'Position',
      def: 'out',
      opts: [
        ['out', 'Outside'],
        ['in', 'Inside'],
        ['mid', 'Centre'],
      ],
    },
    params: [
      { key: 'w', label: 'Width', def: 2, unit: 'px', min: 0 },
      { key: 'g', label: 'Gap', def: 0, unit: 'px', min: 0, when: f => (f.pos || 'out') === 'out' },
      { key: 'col', label: 'Color', def: '#000000' },
      opacity(1),
    ],
    needsIn: () => true,
    targets: (l, f) => {
      const pos = f.pos || 'out',
        w = fxKey(f.id, 'w'),
        g = fxKey(f.id, 'g'),
        t: Target[] =
          pos === 'out'
            ? [
                ['w', 'a', 'radius', 'add', g],
                ['g', 'a', 'radius', 'add', w],
                ['g', 'b', 'radius'],
              ]
            : pos === 'in'
              ? [['w', 'b', 'radius']]
              : [
                  ['w', 'a', 'radius', 'half'],
                  ['w', 'b', 'radius', 'half'],
                ];
      return [...t, ['col', 'c', 'flood-color'], ['op', 'c', 'flood-opacity']];
    },
    // the ring between the shape grown (or shrunk) by two amounts, filled with the color
    prims: (l, f, IN, OUT, A) => {
      const u = f.id,
        pos = f.pos || 'out';
      const ring =
        pos === 'out'
          ? `<feMorphology${A('a')} in="${IN}" operator="dilate" result="${u}a"/><feMorphology${A('b')} in="${IN}" operator="dilate" result="${u}b"/><feComposite in="${u}a" in2="${u}b" operator="out" result="${u}r"/>`
          : pos === 'in'
            ? `<feMorphology${A('b')} in="${IN}" operator="erode" result="${u}b"/><feComposite in="${IN}" in2="${u}b" operator="out" result="${u}r"/>`
            : `<feMorphology${A('a')} in="${IN}" operator="dilate" result="${u}a"/><feMorphology${A('b')} in="${IN}" operator="erode" result="${u}b"/><feComposite in="${u}a" in2="${u}b" operator="out" result="${u}r"/>`;
      const fill = `<feFlood${A('c')}/><feComposite in2="${u}r" operator="in" result="${u}s"/>`;
      // outside, the line sits behind the shape; inside or centred, on top of it
      const merge =
        pos === 'out'
          ? `<feMergeNode in="${u}s"/><feMergeNode in="${IN}"/>`
          : `<feMergeNode in="${IN}"/><feMergeNode in="${u}s"/>`;
      return `${ring}${fill}<feMerge${res(OUT)}>${merge}</feMerge>`;
    },
    pad: (v, f) => ((f.pos || 'out') === 'out' ? v('w') + v('g') : (f.pos || 'out') === 'mid' ? v('w') / 2 : 0),
    sum: v => px(v('w')),
  },
};
/** the Add filter menu: groups, and the extra entries that add a filter with other settings */
export const FX_GROUPS: [string, string][] = [
  ['shadow', 'Blur & shadow'],
  ['colour', 'Color'],
  ['edges', 'Edges'],
];
export interface FxPreset {
  id: string;
  label: string;
  type: string;
  group: string;
  /** the filter it is a version of, shown in the menu */
  of?: string;
  set?: Record<string, number | string>;
}
export const FX_MENU: FxPreset[] = [
  { id: 'blur', label: 'Blur', type: 'blur', group: 'shadow' },
  { id: 'shadow', label: 'Drop shadow', type: 'shadow', group: 'shadow' },
  {
    id: 'glow',
    label: 'Glow',
    type: 'shadow',
    group: 'shadow',
    of: 'shadow',
    set: { dx: 0, dy: 0, sd: 8, sp: 2, col: '#ffd27a', op: 0.8 },
  },
  { id: 'inner', label: 'Inner shadow', type: 'inner', group: 'shadow' },
  {
    id: 'innerglow',
    label: 'Inner glow',
    type: 'inner',
    group: 'shadow',
    of: 'inner shadow',
    set: { dx: 0, dy: 0, sd: 6, sp: 0, col: '#ffffff', op: 0.75 },
  },
  ...['bright', 'con', 'sat', 'hue', 'gray', 'sepia', 'invert', 'overlay'].map(t => ({
    id: t,
    label: '',
    type: t,
    group: 'colour',
  })),
  { id: 'outline', label: 'Outline', type: 'outline', group: 'edges' },
].map(p => ({ ...p, label: p.label || FILTERS[p.type].label }));

export const fxKey = (id: string, param: string) => `fx.${id}.${param}`;
export function isFxKey(k: string) {
  return k.startsWith('fx.');
}
/** a filter's shown name: what it was added as (Glow), else its type */
export function fxName(f: FxEntry) {
  return f.name || (FILTERS[f.type] ? FILTERS[f.type].label : f.type);
}
/** Parse `fx.<id>.<param>` into the filter and its parameter definition. */
export function fxOf(l: Layer, k: string) {
  const [, id, key] = k.split('.'),
    fx = (l.fx || []).find(f => f.id === id),
    def = fx && FILTERS[fx.type],
    param = def && def.params.find(p => p.key === key);
  return fx && param ? { fx, def, param } : null;
}
/** the parameters of a filter that apply (Outline's Gap only outside) */
export function fxParams(f: FxEntry) {
  const def = FILTERS[f.type];
  return def ? def.params.filter(p => !p.when || p.when(f)) : [];
}
/** Every filter track key of a layer, in display order. */
export function fxKeys(l: Layer) {
  return (l.fx || []).flatMap(f => (FILTERS[f.type] ? FILTERS[f.type].params.map(p => fxKey(f.id, p.key)) : []));
}
/** Keep Layer.fa (the runtime's attribute map) in step with Layer.fx. */
export function syncFa(l: Layer) {
  const fa: Record<string, [string, string, string?, string?][]> = {};
  (l.fx || []).forEach(f => {
    const def = FILTERS[f.type];
    if (!def) return;
    def.targets(l, f).forEach(([p, sfx, attr, kind, arg]) => {
      const k = fxKey(f.id, p),
        e: [string, string, string?, string?] = ['-' + f.id + sfx, attr];
      if (kind) e.push(kind);
      if (arg) e.push(arg);
      (fa[k] = fa[k] || []).push(e);
    });
  });
  // a parameter that drives one attribute as it is keeps the short form [suffix, attribute]
  const out: NonNullable<Layer['fa']> = {};
  for (const k in fa) out[k] = fa[k].length === 1 && fa[k][0].length === 2 ? (fa[k][0] as [string, string]) : fa[k];
  if (Object.keys(out).length) l.fa = out;
  else delete l.fa;
}
export function addFilter(l: Layer, type: string, preset?: string) {
  const def = FILTERS[type];
  if (!def) return null;
  const used = new Set((l.fx || []).map(f => f.id));
  let n = 1;
  while (used.has('f' + n)) n++;
  const fx: FxEntry = { id: 'f' + n, type };
  if (def.choice) fx[def.choice.key] = def.choice.def;
  const p = preset ? FX_MENU.find(x => x.id === preset && x.type === type) : null;
  if (p && p.of) fx.name = p.label;
  l.fx = [...(l.fx || []), fx];
  def.params.forEach(q => (l.b[fxKey(fx.id, q.key)] = q.def));
  if (p && p.set) for (const k in p.set) l.b[fxKey(fx.id, k)] = p.set[k];
  syncFa(l);
  return fx;
}
export function removeFilter(l: Layer, id: string) {
  const fx = (l.fx || []).find(f => f.id === id);
  if (!fx) return;
  fxKeys({ ...l, fx: [fx] } as Layer).forEach(k => {
    delete l.b[k];
    delete l.t[k];
    if (l.ft) delete l.ft[k];
  });
  l.fx = l.fx.filter(f => f !== fx);
  if (!l.fx.length) delete l.fx;
  syncFa(l);
}
/** Move a filter to another place in the list (filters apply top to bottom). */
export function moveFilter(l: Layer, id: string, to: number) {
  const list = (l.fx || []).slice(),
    i = list.findIndex(f => f.id === id);
  if (i < 0) return false;
  const j = Math.max(0, Math.min(list.length - 1, to));
  if (i === j) return false;
  const [f] = list.splice(i, 1);
  list.splice(j, 0, f);
  l.fx = list;
  syncFa(l);
  return true;
}
/** a filter's value for a parameter (at a time, through `get`), or its default */
function val(get: (k: string) => any, f: FxEntry, p: string) {
  const v = get(fxKey(f.id, p));
  if (v != null) return v;
  const q = FILTERS[f.type] && FILTERS[f.type].params.find(x => x.key === p);
  return q ? q.def : 0;
}
/** <filter> markup for a layer at time t, or '' when it has none. `get` reads a (possibly animated) value. */
export function filterSVG(l: Layer, pre: string, get: (k: string) => any) {
  if (!l.fx || !l.fx.length) return '';
  // the chain's shape can follow its values (a Drop shadow gains a spread): keep the runtime map in step
  syncFa(l);
  const id = pre + l.id,
    list = l.fx.filter(f => FILTERS[f.type]);
  const prims = list
    .map((f, i) => {
      const def = FILTERS[f.type],
        next = list[i + 1],
        IN = i === 0 ? 'SourceGraphic' : 'r' + list[i - 1].id,
        OUT = next && FILTERS[next.type].needsIn && FILTERS[next.type].needsIn(l, next) ? 'r' + f.id : '',
        targets = def.targets(l, f);
      const A = (sfx: string) =>
        ` id="${id}-${f.id}${sfx}"` +
        targets
          .filter(t => t[1] === sfx)
          // one attribute may be driven by two parameters (the outline's sum): write it once
          .filter((t, j, a) => a.findIndex(x => x[2] === t[2]) === j)
          .map(([p, , attr, kind, arg]) => {
            const v = H.fxv(kind, val(get, f, p), arg ? val(get, f, arg.split('.')[2]) : 0);
            return ` ${attr}="${String(v).replace(/"/g, '&quot;')}"`;
          })
          .join('');
      return def.prims(l, f, IN, OUT, A);
    })
    .join('');
  return `<filter id="${id}-fx" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${prims}</filter>`;
}
/** a filter card's one-line summary */
export function fxSummary(l: Layer, f: FxEntry, get: (k: string) => any) {
  const def = FILTERS[f.type];
  return def ? def.sum(p => val(get, f, p), f) : '';
}
/** how far a layer's filters reach past it */
export function fxReach(f: FxEntry, v: (p: string, def: number) => number) {
  const def = FILTERS[f.type];
  if (!def || !def.pad) return 0;
  return def.pad(p => {
    const q = def.params.find(x => x.key === p);
    return v(p, q && typeof q.def === 'number' ? q.def : 0);
  }, f);
}
