// SVGcinema — ui/graph
// The graph editor: with the timeline bar's Graph button on, one property track opens into a value
// graph across time (matched to the "Graph editor" mockup). Number properties only: one curve, or X and
// Y in two colours for points (position, scale, size…). Drag a key to change its value and time; the
// handles of the selected segment shape its easing (a cubic-bezier, shared by X and Y, so dragging one
// curve's handle reshapes both). The name column offers the same easing set as the Keyframe panel for
// that segment. Colours, gradients, dash patterns and morphs have no graph. One undo step per drag.
import type { Ease, Keyframe, Layer, PropKey } from '../model/types';
import { $, clamp, esc, fmt, isFrozen, layerTracks, propKind, propLabel, r3, valueAt } from '../core/constants';
import { S, doc, layerById, selLayer, sortTrack } from '../core/state';
import { beginEdit } from '../core/history';
import { TLB } from '../core/dom';
import { bezOf } from './easing';
import { toast } from '../io/open';
import { frame } from '../render/stage';
import { renderTimeline } from './timeline';

export const GRAPH_H = 236;
const PAD = 18;
const KEY = 'svgcinema:graph';
export const GRAPH = { on: false };
try {
  GRAPH.on = localStorage.getItem(KEY) === '1';
} catch (_) {}
let track: { lid: string; k: string } | null = null;

/** can this property be drawn as a graph? (single numbers and points) */
export function graphable(l: Layer, k: string) {
  if (!l || k === 'd' || k === 'da') return false;
  const kind = propKind(l, k);
  if (kind !== 'n' && kind !== 'v') return false;
  const v = valueAt(l, k, 0);
  return typeof v === 'number' || (Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'number'));
}
/** the track the graph shows: the one picked, else the one of the selected keyframe, else the first
 *  number track of the selected layer */
export function graphTrack(): { l: Layer; k: string } | null {
  if (!GRAPH.on) return null;
  if (track) {
    const l = layerById(track.lid);
    if (l && l.t[track.k] && l.t[track.k].length && graphable(l, track.k)) return { l, k: track.k };
  }
  for (const q of S.keys)
    for (const l of doc.layers) for (const k in l.t) if (l.t[k].includes(q) && graphable(l, k)) return { l, k };
  const l = selLayer();
  if (!l) return null;
  const k = layerTracks(l).find(x => !isFrozen(l, x) && graphable(l, x));
  return k ? { l, k } : null;
}
export function setGraphTrack(lid: string, k: string) {
  track = { lid, k };
}
export function toggleGraph(on = !GRAPH.on) {
  GRAPH.on = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch (_) {}
  const b = $('#tGraph');
  if (b) {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

/* ---------- drawing ---------- */

const comps = (v: any): number[] => (Array.isArray(v) ? v.slice(0, 2) : [v]);
interface Geo {
  t: number[];
  min: number;
  max: number;
  y(v: number): number;
  v(y: number): number;
}
function scale(l: Layer, k: string, W: number): Geo {
  const tr = l.t[k],
    vals: number[] = [];
  const n = Math.max(40, Math.min(600, Math.round(W / 3)));
  for (let i = 0; i <= n; i++) vals.push(...comps(valueAt(l, k, (i / n) * doc.dur)));
  tr.forEach(q => vals.push(...comps(q[1])));
  let min = Math.min(...vals),
    max = Math.max(...vals);
  if (!(max - min > 1e-9)) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;
  const h = GRAPH_H - PAD * 2;
  return {
    t: [],
    min,
    max,
    y: v => PAD + ((max - v) / (max - min)) * h,
    v: y => max - ((y - PAD) / h) * (max - min),
  };
}
/** the selected segment: from the selected keyframe of this track, else the one under the playhead */
export function segIndex(tr: Keyframe[]) {
  const i = tr.findIndex(q => S.keys.has(q));
  if (i >= 0) return i < tr.length - 1 ? i : i - 1;
  for (let j = 0; j < tr.length - 1; j++) if (S.time >= tr[j][0] && S.time <= tr[j + 1][0]) return j;
  return tr.length > 1 ? 0 : -1;
}
const COL = ['var(--accent)', 'var(--graph-y)'];
function nice(min: number, max: number) {
  const span = max - min,
    step = Math.pow(10, Math.floor(Math.log10(span / 3))),
    s = [1, 2, 5, 10].map(m => m * step).find(x => span / x <= 5) || step * 10,
    out: number[] = [];
  for (let v = Math.ceil(min / s) * s; v <= max; v += s) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}
/** the graph lane's SVG */
export function graphSVG(l: Layer, k: string, W: number, LW: number) {
  const tr = l.t[k],
    G = scale(l, k, W),
    pps = S.pps,
    n2 = comps(tr[0][1]).length,
    seg = segIndex(tr);
  let s = `<svg class="gr-svg" width="${LW}" height="${GRAPH_H}" data-lid="${l.id}" data-prop="${k}">`;
  // value grid and labels
  nice(G.min, G.max).forEach(v => {
    const y = r3(G.y(v));
    s += `<line class="gr-grid" x1="0" x2="${W}" y1="${y}" y2="${y}"/><text class="gr-lab" x="${W + 6}" y="${r3(y + 3)}">${fmt(v)}</text>`;
  });
  // curves, sampled through the real easing
  const n = Math.max(40, Math.min(1200, Math.round(W / 2)));
  for (let c = 0; c < n2; c++) {
    let d = '';
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * doc.dur;
      d += (i ? 'L' : 'M') + r3(t * pps) + ' ' + r3(G.y(comps(valueAt(l, k, t))[c]));
    }
    s += `<path class="gr-curve" d="${d}" stroke="${COL[c]}"/>`;
  }
  // the selected segment's handles (bezier easings only)
  if (seg >= 0) {
    const a = tr[seg],
      b = tr[seg + 1],
      bz = bezOf(a[2] || 'ease');
    if (b && bz)
      for (let c = 0; c < n2; c++) {
        const v0 = comps(a[1])[c],
          v1 = comps(b[1])[c];
        if (Math.abs(v1 - v0) < 1e-9) continue;
        const x0 = a[0] * pps,
          x1 = b[0] * pps,
          h1 = [x0 + bz[0] * (x1 - x0), G.y(v0 + bz[1] * (v1 - v0))],
          h2 = [x0 + bz[2] * (x1 - x0), G.y(v0 + bz[3] * (v1 - v0))];
        s += `<line class="gr-arm" x1="${r3(x0)}" y1="${r3(G.y(v0))}" x2="${r3(h1[0])}" y2="${r3(h1[1])}"/><line class="gr-arm" x1="${r3(x1)}" y1="${r3(G.y(v1))}" x2="${r3(h2[0])}" y2="${r3(h2[1])}"/>`;
        s += `<circle class="gr-hd" data-gh="1" data-gc="${c}" data-gi="${seg}" cx="${r3(h1[0])}" cy="${r3(h1[1])}" r="4"/><circle class="gr-hd" data-gh="2" data-gc="${c}" data-gi="${seg}" cx="${r3(h2[0])}" cy="${r3(h2[1])}" r="4"/>`;
      }
  }
  // keys
  tr.forEach((q, i) =>
    comps(q[1]).forEach((v, c) => {
      const x = r3(q[0] * pps),
        y = r3(G.y(v));
      s += `<rect class="gr-key${S.keys.has(q) ? ' sel' : ''}" data-gi="${i}" data-gc="${c}" x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" fill="${COL[c]}" transform="rotate(45 ${x} ${y})"><title>${esc(propLabel(l, k as PropKey))}${n2 > 1 ? (c ? ' Y' : ' X') : ''} · ${fmt(q[0])}s · ${fmt(v)}</title></rect>`;
    }),
  );
  s += `<g class="gr-read" id="grRead" visibility="hidden"><rect rx="4" height="20"/><text y="14"></text></g></svg>`;
  return s;
}
export function graphNames(l: Layer, k: string, controls: string) {
  const tr = l.t[k],
    v = comps(valueAt(l, k, S.time)),
    seg = segIndex(tr),
    names = v.length > 1 ? ['X', 'Y'] : [''];
  // easing presets live in the Keyframe panel (click a key): here, the values at the playhead
  return `<div class="gr-names">${controls}<div class="gr-leg">${v
    .map((x, c) => `<span><i style="background:${COL[c]}"></i>${names[c]}<b data-gv="${c}">${fmt(x)}</b></span>`)
    .join('')}</div><p class="gr-note">${
    seg >= 0
      ? `Drag a key for its value and time, or a handle to shape the easing of the selected segment (${fmt(tr[seg][0])} → ${fmt(tr[seg + 1][0])} s). Click a key for the easing presets in the Keyframe panel.`
      : 'Add a second keyframe to shape the curve between them.'
  }</p></div>`;
}
/** the values beside the graph follow the playhead */
export function updateGraphValues() {
  const row = TLB.querySelector('.tl-graph') as HTMLElement;
  if (!row) return;
  const l = layerById(row.dataset.lid),
    k = row.dataset.prop;
  if (!l || !l.t[k]) return;
  const v = comps(valueAt(l, k, S.time));
  row.querySelectorAll<HTMLElement>('[data-gv]').forEach(b => (b.textContent = fmt(v[+b.dataset.gv])));
}

/* ---------- interaction ---------- */

function at(e: PointerEvent, svg: SVGSVGElement) {
  const r = svg.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function readout(svg: SVGSVGElement, x: number, y: number, text: string) {
  const g = svg.querySelector('#grRead') as SVGGElement;
  if (!g) return;
  const t = g.querySelector('text'),
    r = g.querySelector('rect');
  t.textContent = text;
  const w = text.length * 6.4 + 14;
  r.setAttribute('width', String(w));
  g.setAttribute('transform', `translate(${r3(x + 10)},${r3(Math.max(2, y - 26))})`);
  t.setAttribute('x', '7');
  g.setAttribute('visibility', 'visible');
}
const rerender = () => renderTimeline();
function keyDrag(e0: PointerEvent, svg: SVGSVGElement, l: Layer, k: string, i: number, c: number) {
  const tr = l.t[k],
    q = tr[i],
    G = scale(l, k, doc.dur * S.pps),
    p0 = at(e0, svg),
    t0 = q[0],
    v0 = comps(q[1])[c],
    lo = i > 0 ? tr[i - 1][0] + 0.01 : 0,
    hi = i < tr.length - 1 ? tr[i + 1][0] - 0.01 : doc.dur,
    ed = beginEdit();
  S.keys = new Set([q]);
  let axis: 'x' | 'y' | null = null;
  const move = (e: PointerEvent) => {
    const p = at(e, (TLB.querySelector('.gr-svg') as SVGSVGElement) || svg),
      dx = p.x - p0.x,
      dy = p.y - p0.y;
    // Shift keeps the drag to one direction (the first one moved)
    if (e.shiftKey && !axis && Math.hypot(dx, dy) > 4) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (!e.shiftKey) axis = null;
    const t = axis === 'y' ? t0 : r3(clamp(t0 + dx / S.pps, lo, hi)),
      v = axis === 'x' ? v0 : r3(v0 + (G.v(p0.y + dy) - G.v(p0.y)));
    q[0] = t;
    if (Array.isArray(q[1])) q[1][c] = v;
    else q[1] = v;
    rerender();
    frame();
    const s2 = TLB.querySelector('.gr-svg') as SVGSVGElement;
    if (s2)
      readout(s2, q[0] * S.pps, G.y(v), `${fmt(q[0])} s · ${comps(q[1]).length > 1 ? (c ? 'Y ' : 'X ') : ''}${fmt(v)}`);
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    sortTrack(tr);
    ed.end({ insp: true });
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}
function handleDrag(e0: PointerEvent, svg: SVGSVGElement, l: Layer, k: string, i: number, c: number, h: 1 | 2) {
  const tr = l.t[k],
    a = tr[i],
    b = tr[i + 1],
    G = scale(l, k, doc.dur * S.pps),
    v0 = comps(a[1])[c],
    v1 = comps(b[1])[c],
    ed = beginEdit();
  const bz0 = (bezOf(a[2] || 'ease') || [0.25, 0.1, 0.25, 1]).slice();
  const move = (e: PointerEvent) => {
    const p = at(e, (TLB.querySelector('.gr-svg') as SVGSVGElement) || svg),
      fx = clamp((p.x / S.pps - a[0]) / (b[0] - a[0]), 0, 1),
      fy = clamp((G.v(p.y) - v0) / (v1 - v0), -2, 3),
      bz = bz0.slice();
    bz[h === 1 ? 0 : 2] = r3(fx);
    bz[h === 1 ? 1 : 3] = r3(fy);
    a[2] = bz as Ease;
    rerender();
    frame();
    const s2 = TLB.querySelector('.gr-svg') as SVGSVGElement;
    if (s2) readout(s2, p.x, p.y, `cubic-bezier(${bz.map(x => r3(x)).join(', ')})`);
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    ed.end({ insp: true });
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}
export function init(): void {
  toggleGraph(GRAPH.on);
  $('#tGraph').addEventListener('click', () => {
    toggleGraph();
    rerender();
  });
  TLB.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      const t = e.target as Element,
        svg = t.closest && (t.closest('.gr-svg') as SVGSVGElement | null);
      if (!svg) return;
      const l = layerById(svg.dataset.lid),
        k = svg.dataset.prop;
      if (!l || !l.t[k]) return;
      const key = t.closest('.gr-key') as SVGElement | null,
        hd = t.closest('.gr-hd') as SVGElement | null;
      if (!key && !hd) return;
      e.preventDefault();
      e.stopPropagation();
      const i = +(key || hd).dataset.gi,
        c = +(key || hd).dataset.gc;
      if (key) keyDrag(e, svg, l, k, i, c);
      else handleDrag(e, svg, l, k, i, c, +hd.dataset.gh as 1 | 2);
    },
    true,
  );
  TLB.addEventListener('click', (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    const row = t.closest('.tl-prop') as HTMLElement;
    if (!GRAPH.on) return;
    const nm = t.closest('.tl-pname') as HTMLElement;
    if (nm && row) {
      const l = layerById(row.dataset.lid),
        k = row.dataset.prop;
      if (!l) return;
      if (!graphable(l, k)) {
        toast('The graph shows number properties only.');
        return;
      }
      setGraphTrack(l.id, k);
      rerender();
      const g = TLB.querySelector('.tl-graph') as HTMLElement;
      if (g) g.scrollIntoView({ block: 'nearest' });
    }
  });
}
