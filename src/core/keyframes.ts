// SVGcinema — core/keyframes
import { fxOf } from '../model/filters';
import { isPinKey, pinOfKey } from '../model/pins';
import type { ClipKey, Ease, Keyframe, Layer, PropKey } from '../model/types';
import { $, H, clamp, clone, hasSize, r3 } from './constants';
import { TLB } from './dom';
import { beginEdit, deleteKeys, removeTrack, select, setTime, toggleFreeze, toggleKey } from './history';
import { S, doc, layerById, selLayer, sortTrack } from './state';
import { equalizeTrack } from '../geometry/nodes';
import { toast } from '../io/open';
import { isAnim } from '../model/tree';
import { frame } from '../render/stage';
import { applyEase } from '../ui/easing';
import { focusProp, renderInspector } from '../ui/inspector';
import { multiKey } from '../ui/multi';
import { nameDblClick, renameInline, renderLayers } from '../ui/layers-panel';
import { MENU, keyOwners, laneTime, renderTimeline, resolveCollisions, selectKeyLayer } from '../ui/timeline';

function isLineLayer(l: Layer) {
  const d = l.type === 'path' && l.b.d;
  return !!d && d.length === 1 && !d[0].c && d[0].n.length === 2;
}
export function propOK(l: Layer, k: PropKey) {
  const painted = ['rect', 'ellipse', 'path', 'text'].includes(l.type);
  return (
    ['pos', 'org', 'rot', 'scl', 'op'].includes(k) ||
    (k === 'skw' && l.type !== 'bone') ||
    (['fill', 'stk', 'sw', 'fo', 'so', 'dof'].includes(k) && painted) ||
    (['ts', 'te', 'to'].includes(k) && ['rect', 'ellipse', 'path'].includes(l.type)) ||
    (k === 'd' && l.type === 'path') ||
    ((k === 'p0' || k === 'p1') && isLineLayer(l)) ||
    (k === 'rad' && (l.type === 'rect' || !!l.shape)) ||
    (k === 'sz' && hasSize(l)) ||
    (k === 'da' && painted) ||
    (k.startsWith('fx.') && !!fxOf(l, k)) ||
    (isPinKey(k) && !!pinOfKey(l, k))
  );
}
export function keySpan() {
  const ts = [...S.keys].map(q => q[0]);
  return [Math.min(...ts), Math.max(...ts)];
}
export function copyKeys(silent?: boolean) {
  const ow = keyOwners(),
    ks = [...S.keys].filter(q => ow.get(q));
  if (!ks.length) return false;
  const base = Math.min(...ks.map(q => q[0]));
  S.clip = ks.map(q => {
    const o = ow.get(q);
    return { lid: o.l.id, k: o.k, dt: r3(q[0] - base), v: clone(q[1]), e: clone(q[2]) };
  });
  if (!silent) toast(`Copied ${ks.length} keyframe${ks.length > 1 ? 's' : ''}. Paste with Ctrl+V at the playhead.`);
  return true;
}
export function pasteKeys(at?: number | null, clip?: ClipKey[]) {
  clip = clip || S.clip;
  if (!clip || !clip.length) {
    toast('Copy some keyframes first.');
    return;
  }
  const t0 = at == null ? S.time : at,
    src = new Set<string>(clip.map(c => c.lid)),
    tgt = selLayer(),
    retarget = src.size === 1 && tgt && !src.has(tgt.id);
  const ed = beginEdit(),
    ns = new Set<Keyframe>();
  let skipped = 0;
  clip.forEach(c => {
    const l = retarget ? tgt : layerById(c.lid);
    if (!l || !propOK(l, c.k)) {
      skipped++;
      return;
    }
    const t = r3(clamp(t0 + c.dt, 0, doc.dur)),
      tr = l.t[c.k] || (l.t[c.k] = []),
      nk: Keyframe = [t, clone(c.v), clone(c.e)],
      ex = tr.findIndex(q => Math.abs(q[0] - t) < 0.004);
    if (ex >= 0) tr.splice(ex, 1, nk);
    else tr.push(nk);
    sortTrack(tr);
    ns.add(nk);
    S.exp[l.id] = true;
    if (c.k === 'd') equalizeTrack(l);
  });
  S.keys = ns;
  ed.end({ insp: true });
  if (skipped)
    toast(
      `${skipped} keyframe${skipped > 1 ? 's were' : ' was'} skipped because that property doesn't exist on this layer.`,
    );
}
export function duplicateKeys() {
  if (!S.keys.size) return;
  const keep = S.clip;
  copyKeys(true);
  const c = S.clip;
  S.clip = keep;
  pasteKeys(keySpan()[1] + 0.25, c);
}
export function shiftKeys(dt: number) {
  if (!S.keys.size) return;
  const [lo, hi] = keySpan(),
    d = clamp(dt, -lo, doc.dur - hi);
  if (Math.abs(d) < 1e-6) return;
  const ed = beginEdit();
  S.keys.forEach(q => (q[0] = r3(q[0] + d)));
  resolveCollisions();
  ed.end({ insp: true });
}
export function revEase(e: Ease): Ease {
  if (!e || e === 'ease') e = H.EZ.ease;
  if (Array.isArray(e)) return [r3(1 - e[2]), r3(1 - e[3]), r3(1 - e[0]), r3(1 - e[1])];
  if (e === 'in') return 'out';
  if (e === 'out') return 'in';
  if (/^inOut/.test(e)) return e;
  if (/^in[A-Z]/.test(e)) return 'out' + e.slice(2);
  if (/^out[A-Z]/.test(e)) return 'in' + e.slice(3);
  return e;
}
export function reverseKeys() {
  if (S.keys.size < 2) return;
  const ow = keyOwners(),
    byTr = new Map<Keyframe[], Keyframe[]>(),
    [lo, hi] = keySpan();
  S.keys.forEach(q => {
    const o = ow.get(q);
    if (!o) return;
    if (!byTr.has(o.tr)) byTr.set(o.tr, []);
    byTr.get(o.tr).push(q);
  });
  const ed = beginEdit();
  byTr.forEach((ks: Keyframe[], tr: Keyframe[]) => {
    ks.sort((a: Keyframe, b: Keyframe) => a[0] - b[0]);
    const ez = ks.map((q: Keyframe) => q[2]),
      cv = ks.map((q: Keyframe) => q[3]);
    ks.forEach((q: Keyframe) => (q[0] = r3(lo + hi - q[0])));
    ks.forEach((q: Keyframe, i: number) => {
      if (i > 0) q[2] = revEase(ez[i - 1]);
      // a curved motion segment now runs the other way: its control points swap ends
      const c = i > 0 ? cv[i - 1] : null;
      if (c) q[3] = [c[2], c[3], c[0], c[1]];
      else if (q.length > 3) q.length = 3;
    });
    sortTrack(tr);
  });
  ed.end({ insp: true });
  toast('Keyframes reversed.');
}
export function distributeKeys() {
  const ts = [...new Set<number>([...S.keys].map(q => r3(q[0])))].sort((a, b) => a - b);
  if (ts.length < 3) {
    toast('Select keyframes at three or more different times to distribute them.');
    return;
  }
  const lo = ts[0],
    hi = ts[ts.length - 1],
    map = new Map<number, number>(ts.map((t, i) => [t, r3(lo + ((hi - lo) * i) / (ts.length - 1))]));
  const ed = beginEdit();
  S.keys.forEach(q => (q[0] = map.get(r3(q[0]))));
  resolveCollisions();
  ed.end({ insp: true });
}
export function selectAllKeys() {
  S.keys = new Set<Keyframe>();
  doc.layers.forEach(l => Object.values(l.t).forEach(tr => tr.forEach(q => S.keys.add(q))));
  doc.layers.forEach(l => {
    if (isAnim(l)) S.exp[l.id] = S.exp[l.id];
  });
  renderTimeline();
  renderInspector();
  frame();
}
export function jumpKey(dir: number) {
  const l = selLayer(),
    src = l && isAnim(l) ? [l] : doc.layers;
  const ts = [...new Set<number>(src.flatMap(x => Object.values(x.t).flatMap(tr => tr.map(q => q[0]))))].sort(
    (a, b) => a - b,
  );
  const t =
    dir > 0
      ? ts.find(v => v > S.time + 0.002)
      : ts
          .slice()
          .reverse()
          .find(v => v < S.time - 0.002);
  if (t != null) setTime(t);
}
export function closeMenu() {
  MENU.hidden = true;
}
type MenuItem = [id: string, label: string, enabled?: boolean, shortcut?: string];
export function openMenu(x: number, y: number, row?: unknown) {
  const n = S.keys.size,
    has = n > 0;
  const items: Array<MenuItem | '-'> = [
    ['h', 'Keyframes' + (n ? ` (${n})` : '')],
    ['copy', 'Copy', has, 'Ctrl C'],
    ['paste', 'Paste at playhead', !!(S.clip && S.clip.length), 'Ctrl V'],
    ['dupk', 'Duplicate', has, 'Ctrl D'],
    ['del', 'Delete', has, 'Del'],
    '-',
    ['h', 'Easing'],
    ['ez:linear', 'Linear', has, ''],
    ['ez:inOut', 'Ease in-out', has, 'F9'],
    ['ez:in', 'Ease in', has, '⇧ F9'],
    ['ez:out', 'Ease out', has, 'Ctrl ⇧ F9'],
    ['ez:hold', 'Hold', has, ''],
    '-',
    ['h', 'Timing'],
    ['rev', 'Reverse order', n > 1, ''],
    ['dist', 'Distribute evenly', n > 2, ''],
    ['toph', 'Move to playhead', has, ''],
    '-',
    ['row', 'Select this row', !!row, ''],
    ['all', 'Select all keyframes', true, 'Ctrl A'],
  ];
  const groups: MenuItem[][] = [];
  let gcur: MenuItem[] = [];
  items.forEach(it => {
    if (it === '-') {
      groups.push(gcur);
      gcur = [];
    } else gcur.push(it);
  });
  groups.push(gcur);
  MENU.innerHTML = groups
    .map(g => {
      const btns = g.filter(it => it[0] !== 'h' && it[2]);
      if (!btns.length) return '';
      const head = g.find(it => it[0] === 'h');
      return (
        (head ? `<div class="ctx-h">${head[1]}</div>` : '') +
        btns
          .map(it => `<button role="menuitem" data-m="${it[0]}"><span>${it[1]}</span><kbd>${it[3]}</kbd></button>`)
          .join('')
      );
    })
    .filter(Boolean)
    .join('<hr>');
  MENU._row = row;
  MENU.hidden = false;
  const r = MENU.getBoundingClientRect();
  MENU.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 8)) + 'px';
  MENU.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 8)) + 'px';
  const f = MENU.querySelector('button:not(:disabled)');
  if (f) f.focus();
}

export function init(): void {
  TLB.addEventListener('contextmenu', (e: MouseEvent) => {
    const kf = (e.target as any).closest('.kf, .sdot, .seg'),
      lane = (e.target as any).closest('[data-act="lane"]');
    if (!kf && !lane) return;
    e.preventDefault();
    if (kf) {
      const ks = kf._ks || [kf._k];
      if (!ks.every((q: Keyframe) => S.keys.has(q))) {
        S.keys = new Set<any>(ks);
        selectKeyLayer(kf.dataset.lid);
        renderLayers();
        renderTimeline();
        renderInspector();
      }
    } else {
      S.time = clamp(r3(laneTime(e, lane)), 0, doc.dur);
      S.ptime = S.time;
      frame();
    }
    const row = (e.target as any).closest('.tl-prop');
    openMenu(e.clientX, e.clientY, row ? { lid: row.dataset.lid, prop: row.dataset.prop } : null);
  });
  MENU.addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('[data-m]');
    if (!b || b.disabled) return;
    const m = b.dataset.m,
      row = MENU._row;
    closeMenu();
    if (m === 'copy') copyKeys();
    else if (m === 'paste') pasteKeys();
    else if (m === 'dupk') duplicateKeys();
    else if (m === 'del') deleteKeys();
    else if (m.startsWith('ez:')) applyEase(m.slice(3));
    else if (m === 'rev') reverseKeys();
    else if (m === 'dist') distributeKeys();
    else if (m === 'toph') {
      shiftKeys(S.time - keySpan()[0]);
    } else if (m === 'row' && row) {
      const l = layerById(row.lid);
      S.keys = new Set<any>((l && l.t[row.prop]) || []);
      renderTimeline();
      renderInspector();
      frame();
    } else if (m === 'all') selectAllKeys();
  });
  MENU.addEventListener('keydown', (e: KeyboardEvent) => {
    const bs = [...MENU.querySelectorAll('button:not(:disabled)')],
      i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (bs[i + 1] || bs[0]).focus();
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      (bs[i - 1] || bs[bs.length - 1]).focus();
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeMenu();
    }
  });
  document.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!MENU.hidden && !MENU.contains(e.target as Node)) closeMenu();
  });
  TLB.addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('[data-act]');
    if (!b) return;
    const row = b.closest('[data-lid]');
    const l = row && layerById(row.dataset.lid);
    if (!l) return;
    const a = b.dataset.act;
    if (a === 'exp') {
      S.exp[l.id] = !(S.exp[l.id] !== false);
      renderTimeline();
    } else if (a === 'sel') {
      // Ctrl/Cmd adds or removes a layer, Shift selects the run of layers up to it
      const mode = e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : undefined;
      if (!mode) S.keys.clear();
      select(l.id, mode);
    } else if (a === 'track') {
      // a track's title: all its keyframes (Ctrl/Cmd or Shift add them to the ones selected)
      const k = row.dataset.prop,
        add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!add) S.keys.clear();
      const pick = () => (l.t[k] || []).forEach((q: any) => S.keys.add(q));
      if (!S.selSet.has(l.id)) {
        // selecting the layer clears the keyframe selection: pick the track's keys after it
        const kept = add ? [...S.keys] : [];
        select(l.id, add ? 'toggle' : undefined);
        kept.forEach(q => S.keys.add(q));
        pick();
        renderTimeline();
      } else {
        pick();
        S.sel = l.id;
        renderTimeline();
        renderLayers();
        renderInspector();
        frame();
      }
      focusProp(k);
    } else if (a === 'key') {
      const k = row.dataset.prop;
      // several layers selected (this one among them): the key goes on each of them at the playhead
      if (S.selSet.size > 1 && S.selSet.has(l.id)) multiKey(k, toggleKey);
      else toggleKey(l, k);
      focusProp(k);
    } else if (a === 'rmtrack') {
      removeTrack(l, row.dataset.prop);
    } else if (a === 'freeze') {
      toggleFreeze(l, row.dataset.prop);
    }
  });
  nameDblClick(TLB, '.tl-lname', renameInline);
  TLB.addEventListener('dblclick', (e: MouseEvent) => {
    if ((e.target as any).closest('.tl-lname')) return;
    const lane = (e.target as any).closest('.tl-prop [data-act="lane"]');
    if (lane && !(e.target as any).closest('.kf')) {
      const row = lane.closest('[data-lid]'),
        l = layerById(row.dataset.lid),
        k = row.dataset.prop;
      setTime(Math.round(laneTime(e, lane) * 20) / 20);
      if (l.t[k] && !l.t[k].some(q => Math.abs(q[0] - S.time) < 0.005)) toggleKey(l, k);
    }
  });
}
