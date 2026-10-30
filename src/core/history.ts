// SVGcinema — core/history
import { featureUsed } from './analytics';
import { EPHEMERAL } from './batch-mode';
import { syncSymbols } from './symbols';
import { renderSymbols } from '../ui/symbols-ui';
import type { Layer, PropKey, Tool } from '../model/types';
import {
  $,
  DEFAULT_EASE,
  H,
  HINTS,
  hintHTML,
  baseOf,
  clamp,
  clone,
  isFrozen,
  propLabel,
  r3,
  setBase,
  valueAt,
} from './constants';
import { toast } from '../io/open';
import { LP, WRAP } from './dom';
import { S, doc, layerById, selLayer, setDoc, sortTrack, syncIdc } from './state';
import { markDirty } from '../io/file-state';
import { ancestors, treeRows } from '../model/tree';
import { frame, renderAll, renderStage } from '../render/stage';
import { finishPen, toolCursor } from '../tools/pen';
import { renderInspector } from '../ui/inspector';
import { renderLayers } from '../ui/layers-panel';
import { renderTimeline } from '../ui/timeline';
import { renderTools } from '../ui/tools-rail';
import { plainPath } from './plain-path';

export function trackSig() {
  const l = selLayer();
  return (
    (S.sel || '') +
    '|' +
    S.selSet.size +
    '|' +
    doc.layers.length +
    '|' +
    (l
      ? Object.keys(l.t)
          .filter(k => l.t[k].length)
          .join(',') + l.type
      : '')
  );
}
export function beginEdit() {
  const snap = JSON.stringify(doc),
    sig = trackSig();
  return {
    end(o?: { insp?: boolean }) {
      o = o || {};
      // symbol instances share their contents: carry an edit in one to the others
      if (doc.symbols && syncSymbols(S.symEdit)) o.insp = true;
      if (JSON.stringify(doc) !== snap) {
        S.undo.push(snap);
        if (S.undo.length > 150) S.undo.shift();
        S.redo = [];
      }
      commit({ insp: o.insp || trackSig() !== sig });
    },
  };
}
export function commit(o?: { insp?: boolean }) {
  save();
  renderStage();
  renderLayers();
  renderTimeline();
  if (o && o.insp) renderInspector();
  renderSymbols();
  frame();
}
export function undo() {
  if (!S.undo.length) return;
  S.redo.push(JSON.stringify(doc));
  setDoc(JSON.parse(S.undo.pop()));
  afterSwap();
}
export function redo() {
  if (!S.redo.length) return;
  S.undo.push(JSON.stringify(doc));
  setDoc(JSON.parse(S.redo.pop()));
  afterSwap();
}
export function afterSwap() {
  S.keys.clear();
  S.node = null;
  if (S.sel && !layerById(S.sel)) S.sel = null;
  S.selSet = new Set<any>([...S.selSet].filter(id => layerById(id)));
  syncIdc();
  save();
  renderAll();
}
export let saveT: ReturnType<typeof setTimeout> | undefined;
export function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      if (!EPHEMERAL) localStorage.setItem('svgcinema:doc', JSON.stringify(doc));
    } catch (e) {}
  }, 300);
  $('#pname').value = doc.name;
  markDirty();
}
export function setProp(l: Layer, k: PropKey, v: any) {
  // new nodes for a polygon / star with an animated radius: it becomes a plain path first, or the
  // radius would keep rebuilding the shape over the edited nodes
  if (k === 'd' && l.shape && l.t.rad && l.t.rad.length) plainPath(l);
  const tr = l.t[k];
  if (tr && tr.length) {
    const kf = tr.find(q => Math.abs(q[0] - S.time) < 0.005);
    if (kf) kf[1] = v;
    else {
      tr.push([r3(S.time), v, DEFAULT_EASE]);
      sortTrack(tr);
    }
    return;
  }
  setBase(l, k, v);
}
/** Freeze a track: its keyframes are kept but not used, and the property holds its current value.
 *  Unfreezing brings the keyframes back. */
export function toggleFreeze(l: Layer, k: PropKey) {
  const ed = beginEdit();
  if (isFrozen(l, k)) {
    l.t[k] = l.ft[k];
    delete l.ft[k];
    if (!Object.keys(l.ft).length) delete l.ft;
  } else if (l.t[k] && l.t[k].length) {
    const v = clone(valueAt(l, k, S.time));
    l.t[k].forEach(q => S.keys.delete(q));
    l.ft = l.ft || {};
    l.ft[k] = l.t[k];
    delete l.t[k];
    setBase(l, k, v);
  }
  ed.end({ insp: true });
}
export function toggleKey(l: Layer, k: PropKey) {
  if (isFrozen(l, k)) return toast(`${propLabel(l, k)} is frozen. Unfreeze it in the timeline to add keyframes.`);
  const ed = beginEdit();
  // a Morph keyframe on a rectangle, ellipse, polygon or star: it becomes a plain path first (an
  // animated radius turns into Morph keyframes)
  // (when a baked keyframe already sits at the playhead, converting is the whole change)
  if (k === 'd' && plainPath(l) && l.t.d && l.t.d.some(q => Math.abs(q[0] - S.time) < 0.005)) {
    S.exp[l.id] = true;
    ed.end({ insp: true });
    return;
  }
  const tr = l.t[k],
    cur = clone(valueAt(l, k, S.time));
  if (!tr || !tr.length) {
    l.t[k] = [[r3(S.time), cur, DEFAULT_EASE]];
    featureUsed('animate_' + k);
  } else {
    const i = tr.findIndex(q => Math.abs(q[0] - S.time) < 0.005);
    if (i >= 0) {
      S.keys.delete(tr[i]);
      tr.splice(i, 1);
      if (!tr.length) {
        delete l.t[k];
        setBase(l, k, cur);
      }
    } else {
      tr.push([r3(S.time), cur, DEFAULT_EASE]);
      sortTrack(tr);
    }
  }
  S.exp[l.id] = true;
  ed.end({ insp: true });
}
export function removeTrack(l: Layer, k: PropKey) {
  const ed = beginEdit();
  const v = clone(valueAt(l, k, S.time));
  (l.t[k] || []).forEach(q => S.keys.delete(q));
  delete l.t[k];
  if (l.ft) {
    delete l.ft[k];
    if (!Object.keys(l.ft).length) delete l.ft;
  }
  setBase(l, k, v);
  ed.end({ insp: true });
}
export function deleteKeys() {
  if (!S.keys.size) return;
  const ed = beginEdit();
  doc.layers.forEach(l => {
    for (const k of Object.keys(l.t) as PropKey[]) {
      const tr = l.t[k];
      const removed = tr.filter(q => S.keys.has(q));
      if (!removed.length) continue;
      l.t[k] = tr.filter(q => !S.keys.has(q));
      if (!l.t[k].length) {
        delete l.t[k];
        setBase(l, k, clone(removed[removed.length - 1][1]));
      }
    }
  });
  S.keys.clear();
  ed.end({ insp: true });
}
export function select(id: string | null, mode?: 'add' | 'toggle' | string) {
  S.pinFocus = false;
  if (id !== S.sel && mode !== 'toggle' && mode !== 'range') S.keys.clear();
  if (!id) {
    S.sel = null;
    S.selSet.clear();
  } else if (mode === 'toggle') {
    if (S.selSet.has(id)) {
      S.selSet.delete(id);
      if (S.sel === id) S.sel = [...S.selSet].pop() || null;
    } else {
      S.selSet.add(id);
      S.sel = id;
    }
  } else if (mode === 'range' && S.sel) {
    const rows = treeRows(null, 0, [], true).map(r => r[0].id),
      a = rows.indexOf(S.sel),
      b = rows.indexOf(id);
    if (a >= 0 && b >= 0) rows.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => S.selSet.add(x));
    S.sel = id;
  } else {
    S.sel = id;
    S.selSet = new Set<any>([id]);
  }
  if (S.sel) {
    const l = selLayer();
    if (l) ancestors(l).forEach(a => (S.lexp[a.id] = true));
  }
  S.node = null;
  renderLayers();
  renderTimeline();
  renderInspector();
  frame();
  if (S.sel) {
    const row = LP.querySelector(`[data-lid="${S.sel}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
}
/** Selects exactly these layers (the last one is the primary), as Select all and the canvas marquee do. */
export function selectMany(ids: string[]) {
  S.keys.clear();
  S.selSet = new Set<any>(ids);
  S.sel = ids.length ? ids[ids.length - 1] : null;
  ids.forEach(id => {
    const l = layerById(id);
    if (l) ancestors(l).forEach(a => (S.lexp[a.id] = true));
  });
  S.node = null;
  renderLayers();
  renderTimeline();
  renderInspector();
  frame();
}
export function setTime(t: number) {
  S.time = clamp(r3(t), 0, doc.dur);
  S.ptime = S.time;
  frame();
}
export function setTool(t: Tool) {
  featureUsed('tool_' + t);
  if (S.pen && t !== 'pen') finishPen(false);
  const wasBind = S.tool === 'bonebind';
  S.tool = t;
  S.pinBind = false;
  S.penHint = null;
  if (t === 'bonebind' || wasBind) {
    // the Bind tool starts with nothing picked (its picks show as the selection)
    S.bindPick = [];
    S.bindPins = [];
    S.bindHover = null;
    if (t === 'bonebind' && !wasBind) select(null);
  }
  renderTools();
  WRAP.className = 't-' + t + (S.spaceHeld ? ' space' : '');
  toolCursor();
  $('#hint').innerHTML = hintHTML(HINTS[t] || '');
  frame();
}
