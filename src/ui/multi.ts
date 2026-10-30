// SVGcinema — ui/multi
// Editing several layers at once. With more than one layer selected, the inspector shows only the
// properties every selected layer has (transform, opacity, fill & stroke, stroke style…). A field
// whose value is the same everywhere shows it; one that differs shows "Mixed" (a color swatch shows
// "•••"). Setting a value, a keyframe ◆, a toggle or a color applies it to every selected layer that
// has the property, as one undo step.
import type { Layer, PropKey } from '../model/types';
import { H, valueAt } from '../core/constants';
import { S, doc, layerById } from '../core/state';
import { commit } from '../core/history';
import { propOK } from '../core/keyframes';
import { isLocked } from '../model/tree';
import { INSP as INSP0 } from '../core/dom';
const INSP = INSP0 as HTMLElement;

export const MIXED = 'Mixed';
/** the layers a multi-selection edits (none for a single selection) */
export function multiSel(): Layer[] {
  if (S.selSet.size < 2) return [];
  const ls = [...S.selSet].map(id => layerById(id)).filter(l => l && !isLocked(l));
  return ls.length > 1 ? ls : [];
}
export const isMulti = () => multiSel().length > 1;
/** Run `fn` for every selected layer, as one undo step (the handlers' own steps are folded in). */
export function multiEdit(fn: (l: Layer) => void, ls: Layer[] = multiSel()) {
  const u0 = S.undo.length,
    snap = JSON.stringify(doc);
  ls.forEach(l => fn(l));
  S.undo.length = Math.min(S.undo.length, u0);
  if (JSON.stringify(doc) !== snap) {
    S.undo.push(snap);
    if (S.undo.length > 150) S.undo.shift();
    S.redo = [];
  }
  commit({ insp: true });
}
const same = (vs: unknown[]) => vs.every(v => JSON.stringify(v) === JSON.stringify(vs[0]));
/** the value of a field's property on every layer, or MIXED */
export function common<T>(ls: Layer[], get: (l: Layer) => T): T | typeof MIXED {
  const vs = ls.map(get);
  return same(vs) ? vs[0] : MIXED;
}
/** every selected layer has this property */
export const allHave = (ls: Layer[], k: string) => ls.every(l => propOK(l, k as PropKey));
const PAINTED = ['rect', 'ellipse', 'path', 'text'];
export const allPainted = (ls: Layer[]) => ls.every(l => PAINTED.includes(l.type));
/** the text layers of a multi-selection (Text appearance edits only these) */
export const multiText = () => multiSel().filter(l => l.type === 'text');
/** the text layers that text fields and toggles change: all the selected ones, or the one selected */
export function textTargets(l: Layer | null): Layer[] {
  const tx = multiText();
  return tx.length ? tx : l && l.type === 'text' ? [l] : [];
}
const TEXT_DEF: Record<string, number> = { ls: 0, lh: 1.2, size: 16 };
/** whether a text toggle (Bold, Italic, Underline…, Keep width) is on for a layer */
export function textToggleOn(l: Layer, k: string, v?: string) {
  const G = l.geo;
  if (k === 'bold') return +String(G.weight || 400) >= 600;
  if (k === 'italic') return !!G.italic;
  if (k === 'deco')
    return String(G.deco || '')
      .split(/\s+/)
      .includes(v || '');
  if (k === 'wrap') return !!G.wrap;
  return null;
}
export const TEXT_TOGGLES = ['bold', 'italic', 'deco', 'anchor', 'dir', 'tcase', 'wrap'];
/** the type the selection shares, else "mixed" */
export const commonType = (ls: Layer[]) => (ls.every(l => l.type === ls[0].type) ? ls[0].type : 'mixed');

/** After the inspector is drawn or refreshed: hide what not every layer has, show Mixed values. */
export function multiFields() {
  const ls = multiSel();
  if (!ls.length) return;
  // rows of properties some layer lacks
  INSP.querySelectorAll<HTMLElement>('[data-kb], [data-f]').forEach(el => {
    const k = (el.dataset.kb || el.dataset.f || '').split(':')[0];
    if (k && !allHave(ls, k)) {
      const row = el.closest('.row') as HTMLElement;
      if (row) row.hidden = true;
    }
  });
  INSP.querySelectorAll<HTMLElement>('.sec').forEach(sec => {
    const rows = [...sec.querySelectorAll<HTMLElement>('.row')];
    if (rows.length && rows.every(r => r.hidden)) sec.hidden = true;
  });
  const t = S.time;
  // number and color fields
  INSP.querySelectorAll<HTMLInputElement>('input[data-f]').forEach(inp => {
    if (inp === document.activeElement) return;
    const [k, i] = inp.dataset.f.split(':');
    if (!allHave(ls, k) || inp.dataset.rt) return;
    const v = common(ls, l => {
      const x = valueAt(l, k, t);
      return i !== undefined && i !== '' ? (x ? x[+i] : 0) : x;
    });
    const mixed = v === MIXED;
    inp.classList.toggle('mixed', mixed);
    if (mixed) {
      inp.value = '';
      inp.placeholder = MIXED;
    } else if (inp.placeholder === MIXED) inp.placeholder = '';
  });
  INSP.querySelectorAll<HTMLElement>('[data-paint]').forEach(b => {
    const k = b.dataset.paint;
    b.classList.toggle('mixed', allHave(ls, k) && common(ls, l => valueAt(l, k, t)) === MIXED);
  });
  // rotation: turns and degrees
  const rot = common(ls, l => valueAt(l, 'rot', t));
  INSP.querySelectorAll<HTMLInputElement>('input[data-rt]').forEach(inp => {
    if (inp === document.activeElement) return;
    inp.classList.toggle('mixed', rot === MIXED);
    if (rot === MIXED) {
      inp.value = '';
      inp.placeholder = MIXED;
    }
  });
  // attributes (paint order, miter limit, path length), blending, dashes, toggles
  INSP.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-x]').forEach(el => {
    const v = common(ls, l => (l.extra || {})[el.dataset.x] ?? '');
    mixedControl(el, v === MIXED);
  });
  INSP.querySelectorAll<HTMLSelectElement>('select[data-ly="blend"]').forEach(el =>
    mixedControl(el, common(ls, l => l.blend || 'normal') === MIXED),
  );
  const iso = INSP.querySelector<HTMLInputElement>('input[data-ly="iso"]');
  if (iso) iso.indeterminate = common(ls, l => !!l.iso) === MIXED;
  const da = INSP.querySelector<HTMLInputElement>('input[data-da]');
  if (da && da !== document.activeElement && common(ls, l => valueAt(l, 'da', t)) === MIXED) {
    da.value = '';
    da.placeholder = MIXED;
  }
  INSP.querySelectorAll<HTMLElement>('[data-tx^="x:"]').forEach(b => {
    const attr = b.dataset.tx.slice(2),
      v = common(ls, l => (l.extra || {})[attr] ?? '');
    if (v === MIXED) {
      b.classList.remove('on');
      b.setAttribute('aria-pressed', 'false');
    }
  });
  // Text appearance (shown when the selection has text layers): the text layers' shared values
  const tx = ls.filter(l => l.type === 'text');
  if (tx.length) {
    INSP.querySelectorAll<HTMLInputElement>('input[data-g]').forEach(inp => {
      if (inp === document.activeElement) return;
      const g = inp.dataset.g,
        v = common(tx, l => l.geo[g] ?? TEXT_DEF[g] ?? '');
      inp.classList.toggle('mixed', v === MIXED);
      inp.placeholder = v === MIXED ? MIXED : '';
      inp.value = v === MIXED || v === '' ? '' : String(Math.round(+v * 100) / 100);
    });
    const st = INSP.querySelector<HTMLSelectElement>('select[data-tx-sel="style"]');
    if (st) mixedControl(st, common(tx, l => String(l.geo.weight || '400') + '|' + (l.geo.italic ? 1 : 0)) === MIXED);
    const fam = INSP.querySelector<HTMLElement>('[data-fontpick] span');
    if (fam && common(tx, l => l.geo.family) === MIXED) {
      fam.textContent = MIXED;
      fam.style.fontFamily = '';
      fam.style.fontStyle = '';
    }
    INSP.querySelectorAll<HTMLElement>('[data-tx]').forEach(b => {
      const k = b.dataset.tx;
      if (!TEXT_TOGGLES.includes(k)) return;
      const on =
        textToggleOn(tx[0], k, b.dataset.v) !== null
          ? tx.every(l => textToggleOn(l, k, b.dataset.v))
          : tx.every(l => String((l.geo as any)[k] ?? '') === String(b.dataset.v ?? ''));
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  const rng = INSP.querySelector<HTMLInputElement>('input[data-range="op"]');
  if (rng) rng.classList.toggle('mixed', common(ls, l => valueAt(l, 'op', t)) === MIXED);
  // ◆: on when every layer has a key here, "has" when any is animated
  INSP.querySelectorAll<HTMLElement>('[data-kb]').forEach(b => {
    const k = b.dataset.kb,
      has = ls.some(l => l.t[k] && l.t[k].length),
      on = ls.every(l => l.t[k] && l.t[k].some(q => Math.abs(q[0] - t) < 0.005));
    b.classList.toggle('has', has);
    b.classList.toggle('on', on);
  });
}
function mixedControl(el: HTMLInputElement | HTMLSelectElement, mixed: boolean) {
  if (el === document.activeElement) return;
  el.classList.toggle('mixed', mixed);
  if (el instanceof HTMLSelectElement) {
    let o = el.querySelector<HTMLOptionElement>('option[data-mixed]');
    if (mixed) {
      if (!o) {
        o = document.createElement('option');
        o.dataset.mixed = '1';
        o.disabled = true;
        o.textContent = MIXED;
        el.prepend(o);
      }
      o.selected = true;
    } else if (o) o.remove();
  } else if (mixed) {
    el.value = '';
    el.placeholder = MIXED;
  }
}
/** a toggled keyframe ◆ on several layers: all get a key here, or (when all had one) all lose it */
export function multiKey(k: string, toggle: (l: Layer, k: PropKey) => void) {
  const ls = multiSel().filter(l => propOK(l, k as PropKey));
  const allOn = ls.every(l => l.t[k] && l.t[k].some(q => Math.abs(q[0] - S.time) < 0.005));
  multiEdit(l => {
    const on = !!(l.t[k] && l.t[k].some(q => Math.abs(q[0] - S.time) < 0.005));
    if (on === allOn) toggle(l, k as PropKey);
  }, ls);
}
export const isGrad = (v: unknown) => H.isG(v);
