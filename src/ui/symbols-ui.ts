// SVGcinema — ui/symbols-ui
// Symbols in the interface (core/symbols has the model), matched to the "Symbols" mockups:
// - editing a symbol (isolation): double-click an instance, Element ▸ Edit symbol or the inspector's
//   Edit symbol. The rest of the scene dims and can't be picked, the other instances show as dashed
//   outlines that follow the edits, and a chip on the canvas says what is being edited, with Done (Esc).
// - Assets ▸ Symbols: a card per symbol with a live thumbnail and its instance count; click to add an
//   instance, double-click the name to rename it, Delete (asks first when it has instances).
// - the inspector's Instance section: time offset, Edit symbol, Detach instance.
import { infoTip } from './info-tip';
import type { Layer } from '../model/types';
import { $, esc, fmt } from '../core/constants';
import { S, doc, layerById } from '../core/state';
import { beginEdit, select } from '../core/history';
import { ancestors, descendants, isHidden } from '../model/tree';
import { markup } from '../render/markup';
import { ASSETS, URLS } from '../core/state';
import {
  addInstance,
  deleteSymbol,
  detach,
  instanceCount,
  instanceOf,
  instancesOf,
  isInstance,
  renameSymbol,
  setOffset,
  symbols,
} from '../core/symbols';
import { frame } from '../render/stage';
import { renderLayers } from './layers-panel';
import { renderInspector, nrow } from './inspector';
import { toast } from '../io/open';

/* ---------- isolation ---------- */

export function enterSymbol(inst: Layer | null) {
  if (!inst || !isInstance(inst)) return;
  S.symEdit = inst.id;
  ancestors(inst).forEach(a => (S.lexp[a.id] = true));
  S.lexp[inst.id] = true;
  select(null);
  syncChip();
  renderLayers();
  frame();
}
export function exitSymbol() {
  const id = S.symEdit;
  if (!id) return;
  S.symEdit = null;
  syncChip();
  if (layerById(id)) select(id);
  else frame();
}
function syncChip() {
  const c = $('#symChip') as HTMLElement;
  if (!c) return;
  const inst = S.symEdit ? layerById(S.symEdit) : null;
  if (!inst || !isInstance(inst)) {
    c.hidden = true;
    document.body.classList.remove('sym-iso');
    return;
  }
  const n = instanceCount(inst.sym);
  c.innerHTML = `<span class="sc-ic" aria-hidden="true">${SYM_IC}</span><span>Editing symbol <b>${esc(symbols()[inst.sym].name)}</b>${n > 1 ? ` · changes apply to all ${n} instances` : ''}</span><button id="symDone">Done <span>(Esc)</span></button>`;
  c.hidden = false;
  document.body.classList.add('sym-iso');
}
/** the isolation layer: the scene dimmed, the edited instance on top, the others as outlines */
export function drawIso() {
  const g = document.getElementById('iso');
  if (!g) return;
  const inst = S.symEdit ? layerById(S.symEdit) : null;
  if (!inst || !isInstance(inst)) {
    if (g.childNodes.length) g.innerHTML = '';
    if (S.symEdit) {
      S.symEdit = null;
      syncChip();
    }
    return;
  }
  const href = (id: string) => URLS[id] || (ASSETS[id] && ASSETS[id].data) || '',
    branch = (l: Layer) => {
      const keep = new Set<string>([l.id, ...descendants(l).map(x => x.id), ...ancestors(l).map(x => x.id)]);
      return doc.layers.filter(x => keep.has(x.id));
    };
  const others = instancesOf(inst.sym).filter(o => o !== inst && !isHidden(o));
  g.innerHTML =
    `<rect class="iso-dim" x="${(doc.vx || 0) - 1e4}" y="${(doc.vy || 0) - 1e4}" width="${doc.w + 2e4}" height="${doc.h + 2e4}"/>` +
    `<g class="iso-on">${markup(branch(inst), null, { pre: 'iso-', editor: true, t: S.time, href })}</g>` +
    others
      .map(
        (o, i) =>
          `<g class="og iso-other">${markup(branch(o), null, { pre: `iso${i}-`, editor: true, t: S.time, href })}</g>`,
      )
      .join('');
}
/** stage-input's hit chain while editing a symbol: only layers inside the instance, its children first */
export function isoChain(chain: string[]): string[] {
  if (!S.symEdit) return chain;
  const i = chain.indexOf(S.symEdit);
  return i < 0 ? [] : chain.slice(0, i);
}

/* ---------- inspector ---------- */

export const SYM_IC =
  '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="1.5" width="11" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M7 3.6l1 2.1 2.3.3-1.7 1.6.4 2.3L7 8.8 5 9.9l.4-2.3L3.7 6l2.3-.3z" fill="currentColor"/></svg>';
export function instanceChip(l: Layer) {
  if (!isInstance(l)) return '';
  const n = instanceCount(l.sym);
  return `symbol · ${n} instance${n > 1 ? 's' : ''}`;
}
export function instanceSection(l: Layer) {
  if (!isInstance(l)) return '';
  return `<section class="sec" id="symSec"><h3>Instance${infoTip(`Shape, fill, stroke and the contents’ animation are shared by all ${instanceCount(l.sym)} instances: edit them inside the symbol. Transform, opacity and keyframes here are this instance’s own.`, 'instances')}</h3>
    ${nrow('Time offset' + infoTip('Starts the symbol’s animation later for this instance. In the JS export an offset instance is written out in full rather than shared.', 'Time offset'), `<label class="nf"><span>t</span><input id="sym-off" data-symoff inputmode="decimal" value="${fmt(l.symOff || 0)}" aria-label="Time offset"><em>s</em></label>`)}
    <div class="btns"><button class="btn pri" data-symact="edit">Edit symbol</button><button class="btn" data-symact="detach">Detach instance</button></div></section>`;
}

/* ---------- Assets ▸ Symbols ---------- */

let armed: string | null = null;
export function renderSymbols() {
  const el = $('#symList') as HTMLElement;
  if (!el) return;
  const defs = symbols(),
    ids = Object.keys(defs);
  if (!ids.length) {
    el.innerHTML = '';
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML =
    `<div class="sym-h">SYMBOLS</div><div class="sym-grid">` +
    ids
      .map(id => {
        const list = instancesOf(id),
          n = list.length,
          src = list[0];
        let thumb = '';
        const s = src && (document.getElementById('e-' + src.id + '-s') as unknown as SVGGraphicsElement);
        if (s) {
          try {
            const b = s.getBBox();
            if (b.width || b.height)
              thumb = `<svg viewBox="${b.x - 2} ${b.y - 2} ${b.width + 4} ${b.height + 4}" aria-hidden="true"><use href="#e-${src.id}-s"/></svg>`;
          } catch (_) {}
        }
        return `<div class="sym-card" data-sym="${id}"><button class="sym-th" data-symadd="${id}" title="${n ? 'Add an instance to the canvas' : 'This symbol has no instances'}" aria-label="Add an instance of ${esc(defs[id].name)}"${n ? '' : ' disabled'}>${thumb || SYM_IC}</button>
          <b class="sym-name" data-symname="${id}" title="Double-click to rename">${esc(defs[id].name)}</b><span class="sym-n">${n} instance${n === 1 ? '' : 's'}</span>
          <div class="sym-acts"><button class="tl-ic" data-symedit="${id}" title="Edit symbol"${n ? '' : ' disabled'} aria-label="Edit ${esc(defs[id].name)}">✎</button><button class="tl-ic${armed === id ? ' armed' : ''}" data-symdel="${id}" title="${armed === id ? `Click again: delete the symbol${n ? `; its ${n} instance${n > 1 ? 's' : ''} become plain groups` : ''}` : 'Delete symbol'}" aria-label="Delete ${esc(defs[id].name)}">${armed === id ? 'Delete?' : '×'}</button></div></div>`;
      })
      .join('') +
    `</div><p class="sym-hint">Click a symbol to add an instance. Make one with Element ▸ Make symbol.</p>`;
}

export function init(): void {
  document.addEventListener('click', (e: MouseEvent) => {
    const t = e.target as Element;
    if (t.closest('#symDone')) return exitSymbol();
    const add = t.closest('[data-symadd]') as HTMLElement;
    if (add) {
      const ed = beginEdit(),
        inst = addInstance(add.dataset.symadd);
      if (inst) {
        S.sel = inst.id;
        S.selSet = new Set([inst.id]);
      }
      ed.end({ insp: true });
      return;
    }
    const edt = t.closest('[data-symedit]') as HTMLElement;
    if (edt) return enterSymbol(instancesOf(edt.dataset.symedit)[0] || null);
    const del = t.closest('[data-symdel]') as HTMLElement;
    if (del) {
      const id = del.dataset.symdel;
      if (armed !== id && instanceCount(id)) {
        armed = id;
        renderSymbols();
        return;
      }
      armed = null;
      if (S.symEdit && instanceOf(layerById(S.symEdit))?.sym === id) exitSymbol();
      const ed = beginEdit();
      deleteSymbol(id);
      ed.end({ insp: true });
      return;
    }
    if (armed && !t.closest('[data-symdel]')) {
      armed = null;
      renderSymbols();
    }
    const act = t.closest('[data-symact]') as HTMLElement;
    if (act) {
      const l = layerById(S.sel);
      if (!l || !isInstance(l)) return;
      if (act.dataset.symact === 'edit') enterSymbol(l);
      else {
        const ed = beginEdit();
        detach(l);
        ed.end({ insp: true });
        toast('Detached: it is now a plain group. The symbol and its other instances stay.');
      }
    }
  });
  document.addEventListener('dblclick', (e: MouseEvent) => {
    const nm = (e.target as Element).closest('[data-symname]') as HTMLElement;
    if (!nm) return;
    const id = nm.dataset.symname,
      inp = document.createElement('input');
    inp.className = 'txt sym-rename';
    inp.value = symbols()[id].name;
    inp.setAttribute('aria-label', 'Symbol name');
    nm.replaceWith(inp);
    inp.focus();
    inp.select();
    let done = false;
    const commit = (ok: boolean) => {
      if (done) return;
      done = true;
      if (ok && inp.value.trim() && inp.value.trim() !== symbols()[id].name) {
        const ed = beginEdit();
        renameSymbol(id, inp.value);
        ed.end({ insp: true });
      } else renderSymbols();
    };
    inp.addEventListener('keydown', k => {
      if (k.key === 'Enter') commit(true);
      if (k.key === 'Escape') commit(false);
    });
    inp.addEventListener('blur', () => commit(true));
  });
  document.addEventListener('change', (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset && t.dataset.symoff !== undefined) {
      const l = layerById(S.sel),
        v = parseFloat(t.value);
      if (!l || !isInstance(l) || !isFinite(v)) return renderInspector();
      const ed = beginEdit();
      setOffset(l, Math.round(v * 1000) / 1000);
      // the instance's own contents changed: keep the symbol's record in step (no copy to the others)
      ed.end({ insp: true });
    }
  });
  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (!S.symEdit || e.key !== 'Escape') return;
      const tg = e.target as Element;
      if (tg.closest && tg.closest('input,textarea,select,[role=dialog],.ctx,.modal')) return;
      if (S.sel || S.selSet.size || S.keys.size || S.tool !== 'select') return; // Esc first clears those
      e.preventDefault();
      e.stopPropagation();
      exitSymbol();
    },
    true,
  );
}
