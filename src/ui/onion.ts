// SVGcinema — ui/onion
// Onion skin: faint outlines of the selected layers a few steps before (blue) and after (red) the
// playhead, fading with distance, so you can see where they were and will be. Canvas only: never
// exported, and hidden while playing. The timeline bar's Onion skin button turns it on; the arrow
// beside it opens its settings (frames before / after, the step between them, and how strong the
// nearest ones are). The settings are remembered in this browser.
import { featureUsed } from '../core/analytics';
import type { Layer } from '../model/types';
import { $, fmt } from '../core/constants';
import { S, doc, layerById } from '../core/state';
import { ancestors, isHidden } from '../model/tree';
import { markup } from '../render/markup';
import { ASSETS, URLS } from '../core/state';

export interface OnionSettings {
  on: boolean;
  before: number;
  after: number;
  /** seconds between ghosts */
  step: number;
  /** opacity of the nearest ghost, % */
  fade: number;
}
const KEY = 'svgcinema:onion';
export const ONION: OnionSettings = { on: false, before: 3, after: 3, step: 0.1, fade: 60 };
try {
  Object.assign(ONION, JSON.parse(localStorage.getItem(KEY) || '{}'));
} catch (_) {}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(ONION));
  } catch (_) {}
}
/** the ghost times: [time, -1 before / +1 after, opacity] */
export function onionTimes(t: number, o: OnionSettings = ONION, dur = doc.dur): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [],
    step = Math.max(0.01, o.step),
    a = Math.max(0, Math.min(1, o.fade / 100));
  const n = (side: number, count: number) => {
    for (let i = 1; i <= count; i++) {
      const tt = Math.round((t + side * i * step) * 1000) / 1000;
      if (tt < -1e-9 || tt > dur + 1e-9) break;
      out.push([tt, side, Math.round(a * (1 - (i - 1) / count) * 1000) / 1000]);
    }
  };
  n(-1, Math.max(0, Math.min(10, Math.round(o.before))));
  n(1, Math.max(0, Math.min(10, Math.round(o.after))));
  return out;
}
/** the layers drawn for a ghost: the selected ones with their ancestors (for their transforms) and
 *  their contents */
function ghostList(sel: Layer[]): Layer[] {
  const keep = new Set<string>();
  const down = (l: Layer) => {
    keep.add(l.id);
    doc.layers.forEach(c => c.parent === l.id && down(c));
  };
  sel.forEach(l => {
    down(l);
    ancestors(l).forEach(a => keep.add(a.id));
  });
  return doc.layers.filter(l => keep.has(l.id));
}
/** Redraw the ghosts (called with every frame). */
export function drawOnion() {
  const g = document.getElementById('onion');
  if (!g) return;
  const sel = [...S.selSet].map(id => layerById(id)).filter(l => l && !isHidden(l) && l.type !== 'bone');
  if (!ONION.on || S.playing || !sel.length) {
    if (g.childNodes.length) g.innerHTML = '';
    return;
  }
  const list = ghostList(sel),
    href = (id: string) => URLS[id] || (ASSETS[id] && ASSETS[id].data) || '';
  g.innerHTML = onionTimes(S.time)
    .map(
      ([t, side, a], i) =>
        `<g class="og ${side < 0 ? 'og-b' : 'og-a'}" opacity="${a}">${markup(list, null, { pre: `og${i}-`, editor: true, t, href })}</g>`,
    )
    .join('');
}
function syncButton() {
  const b = $('#tOnion');
  if (!b) return;
  b.classList.toggle('on', ONION.on);
  b.setAttribute('aria-pressed', String(ONION.on));
}
export function toggleOnion(on = !ONION.on) {
  ONION.on = on;
  if (on) featureUsed('onion_skin');
  save();
  syncButton();
  drawOnion();
}

/* ---------- settings popover ---------- */

let pop: HTMLElement | null = null;
const FIELDS: Array<[keyof OnionSettings, string, string, string, number, number]> = [
  ['before', 'Before', '', 'Frames before', 0, 10],
  ['after', 'After', '', 'Frames after', 0, 10],
  ['step', 'Every', 's', 'Seconds between frames', 0.01, 5],
  ['fade', 'Fade', '%', 'Opacity of the nearest frame', 5, 100],
];
export function openOnionSettings() {
  closeOnionSettings();
  const anchor = $('#tOnionOpt') as HTMLElement;
  pop = document.createElement('div');
  pop.className = 'onionpop';
  pop.id = 'onionPop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Onion skin settings');
  pop.innerHTML =
    FIELDS.map(
      ([k, lab, unit, aria]) =>
        `<label class="nf"><span class="${k === 'before' ? 'on-b' : k === 'after' ? 'on-a' : ''}">${lab}</span><input data-onion="${k}" inputmode="decimal" aria-label="${aria}" value="${fmt(ONION[k] as number)}">${unit ? `<em>${unit}</em>` : ''}</label>`,
    ).join('') + `<p>Outlines only, on the canvas. Never exported. Hidden while playing.</p>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(),
    pr = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.right - pr.width, innerWidth - pr.width - 8)) + 'px';
  pop.style.top = Math.max(8, r.top - pr.height - 6) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  (pop.querySelector('input') as HTMLElement).focus();
}
export function closeOnionSettings() {
  if (pop) pop.remove();
  pop = null;
  const a = $('#tOnionOpt');
  if (a) a.setAttribute('aria-expanded', 'false');
}

export function init(): void {
  syncButton();
  $('#tOnion').addEventListener('click', () => toggleOnion());
  $('#tOnionOpt').addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    pop ? closeOnionSettings() : openOnionSettings();
  });
  document.addEventListener('input', (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (!pop || !t.dataset || !t.dataset.onion) return;
    const f = FIELDS.find(x => x[0] === t.dataset.onion),
      v = parseFloat(t.value);
    if (!f || !isFinite(v)) return;
    (ONION as any)[f[0]] = Math.min(f[5], Math.max(f[4], v));
    if (!ONION.on) toggleOnion(true);
    save();
    drawOnion();
  });
  document.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      const t = e.target as Element;
      if (pop && !pop.contains(t) && !t.closest('#tOnionOpt')) closeOnionSettings();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (pop && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeOnionSettings();
        ($('#tOnionOpt') as HTMLElement).focus();
      }
    },
    true,
  );
}
