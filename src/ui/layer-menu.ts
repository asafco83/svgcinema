// SVGcinema — ui/layer-menu
// Right-click menu for layers, on the canvas and in the Layers panel (modelled on SVGator's), the
// layer clipboard (cut / copy / paste / paste in place), and the Hyperlink dialog.
import { detach, isInstance, makeSymbol } from '../core/symbols';
import { enterSymbol } from './symbols-ui';
import { layerBox } from '../render/mesh';
import type { Layer, PropKey } from '../model/types';
import { $, H, clone, esc, r2, valueAt } from '../core/constants';
import { WRAP, LP } from '../core/dom';
import { beginEdit, select, selectMany, setProp } from '../core/history';
import { keyLower } from '../core/keys';
import { S, doc, layerById, selLayer, uid } from '../core/state';
import { convertToPath, textConvertible } from '../core/layer-ops';
import { descendants, isLocked, kids, pidOf, selectedRoots } from '../model/tree';
import { toast } from '../io/open';
import { align, ALIGN, setMotionPath } from './align';
import { ANIM_GROUPS, animateProp } from './animate-menu';
import { propOK } from '../core/keyframes';
import { arrange, deleteSel, duplicate, groupSel, ungroup } from './layers-panel';
import { reOrigin } from './inspector';
import { openExport } from '../export/build';
import { hitChain, insideBox } from '../tools/stage-input';
import { docPt } from '../render/overlay';
import { canMask, makeMask, releaseMask } from '../core/masks';
import { BOOL_OPS, type BoolOp, boolTargets, booleanOp } from '../core/booleans';

/* ---------- layer clipboard ---------- */

let clip: Layer[] | null = null;
export function clearLayerClip() {
  clip = null;
}
export function hasLayerClip() {
  return !!(clip && clip.length);
}
/** Copy the selected layers (with everything inside them). */
export function copyLayers(cut?: boolean) {
  const roots = selectedRoots();
  if (!roots.length) return false;
  clip = roots.flatMap(l => [l, ...descendants(l)]).map(x => clone(x));
  if (cut) deleteSel();
  toast(`${roots.length} layer${roots.length > 1 ? 's' : ''} ${cut ? 'cut' : 'copied'}.`);
  return true;
}
/** Paste the copied layers above the selection; offset a little unless pasting in place. */
export function pasteLayers(inPlace?: boolean) {
  if (!clip || !clip.length) return false;
  const ed = beginEdit(),
    map: Record<string, string> = {},
    copies = clip.map(x => {
      const c = clone(x);
      map[x.id] = c.id = uid();
      return c;
    }),
    sel = selLayer(),
    pid = sel ? pidOf(sel) : null,
    at = sel ? doc.layers.indexOf(sel) + 1 + descendants(sel).length : doc.layers.length;
  const roots: Layer[] = [];
  copies.forEach(c => {
    if (c.parent && map[c.parent]) c.parent = map[c.parent];
    else {
      c.parent = pid && layerById(pid) ? pid : null;
      roots.push(c);
      if (!inPlace) {
        if (c.t.pos && c.t.pos.length) c.t.pos.forEach(q => (q[1] = [q[1][0] + 16, q[1][1] + 16]));
        else c.b.pos = [c.b.pos[0] + 16, c.b.pos[1] + 16];
      }
    }
  });
  doc.layers.splice(Math.min(at, doc.layers.length), 0, ...copies);
  S.selSet = new Set(roots.map(r => r.id));
  S.sel = roots.length ? roots[roots.length - 1].id : null;
  S.keys.clear();
  ed.end({ insp: true });
  return true;
}

/* ---------- actions ---------- */

export function arrangeEnd(l: Layer, front: boolean) {
  const sib = kids(pidOf(l));
  if (sib.length < 2) return;
  const ed = beginEdit(),
    i = doc.layers.indexOf(l);
  doc.layers.splice(i, 1);
  const ref = front ? sib[sib.length - 1] : sib[0];
  if (ref === l) {
    doc.layers.splice(i, 0, l);
    return ed.end();
  }
  const j = doc.layers.indexOf(ref);
  doc.layers.splice(front ? j + 1 : j, 0, l);
  ed.end({ insp: true });
}
export function centerOrigin(l: Layer) {
  const g = document.getElementById('e-' + l.id) as unknown as SVGGraphicsElement;
  if (!g) return;
  const ed = beginEdit(),
    bb = layerBox(l) || g.getBBox();
  reOrigin(l, [bb.x + bb.width / 2, bb.y + bb.height / 2]);
  ed.end({ insp: true });
}
function eachSel(fn: (l: Layer) => void) {
  const ls = selectedRoots().filter(l => !isLocked(l));
  if (!ls.length) return;
  const ed = beginEdit();
  ls.forEach(fn);
  ed.end({ insp: true });
}
/** Ctrl+H: hides the selected layers, or shows them when they are all hidden already. */
export function toggleHide() {
  const ls = selectedRoots();
  if (!ls.length) return false;
  const ed = beginEdit(),
    on = !ls.every(l => l.hid);
  ls.forEach(l => (l.hid = on));
  ed.end({ insp: true });
  return true;
}
/** Ctrl+A on the canvas: every top-level layer that is shown and unlocked (as a click picks the outermost
 *  layer, so do these). */
export function selectAllLayers() {
  const ids = doc.layers.filter(l => !l.parent && !l.hid && !l.lock).map(l => l.id);
  selectMany(ids);
  return ids.length > 0;
}
export function toggleLock() {
  const ls = selectedRoots();
  if (!ls.length) return;
  const ed = beginEdit(),
    on = !ls.every(l => l.lock);
  ls.forEach(l => (l.lock = on));
  ed.end({ insp: true });
}
const rotate = (d: number) => eachSel(l => setProp(l, 'rot', r2((valueAt(l, 'rot', S.time) || 0) + d)));
const flip = (ax: 0 | 1) =>
  eachSel(l => {
    const s = clone(valueAt(l, 'scl', S.time) || [1, 1]);
    s[ax] *= -1;
    setProp(l, 'scl', s);
  });
/** Open the Export dialog for just the selected layers. */
export function exportSelection() {
  const ls = selectedRoots();
  if (!ls.length) return;
  S.exportOnly = new Set(ls.flatMap(l => [l.id, ...descendants(l).map(d => d.id)]));
  openExport();
  toast('Exporting the selected layers only.');
}

/* ---------- Hyperlink ---------- */

/** Links allowed on a layer: web, mail, phone and in-page anchors (no script URLs). */
export function safeLink(u: string) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^(https?:|mailto:|tel:|#)/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  return 'https://' + s.replace(/^\/+/, '');
}
export function openHyperlink() {
  const l = selLayer();
  if (!l) return;
  const m = $('#mLink');
  ($('#hlUrl') as HTMLInputElement).value = (l.link && l.link.url) || '';
  ($('#hlTarget') as HTMLSelectElement).value = (l.link && l.link.target) || '_blank';
  $('#hlErr').hidden = true;
  $('#hlRemove').hidden = !l.link;
  m.dataset.lid = l.id;
  m.hidden = false;
  setTimeout(() => ($('#hlUrl') as HTMLInputElement).focus(), 0);
}
function saveHyperlink(remove?: boolean): void {
  const m = $('#mLink'),
    l = layerById(m.dataset.lid);
  if (!l) return void (m.hidden = true);
  const url = remove ? '' : safeLink(($('#hlUrl') as HTMLInputElement).value);
  if (url === null) {
    $('#hlErr').hidden = false;
    return;
  }
  const ed = beginEdit();
  if (url) l.link = { url, target: ($('#hlTarget') as HTMLSelectElement).value === '_self' ? '_self' : '_blank' };
  else delete l.link;
  ed.end({ insp: true });
  m.hidden = true;
}

/* ---------- the menu ---------- */

/** A menu entry (also used by the main menu): `check` shows a tick column, `sub` a submenu. */
export type Item =
  | { id: string; label: string; on?: boolean; key?: string; check?: boolean; sub?: Item[]; tip?: string }
  | '-';
const M = () => $('#layermenu') as HTMLElement;
export function closeLayerMenu() {
  const m = M();
  if (m) m.hidden = true;
}
/** The Element commands for the selection; `main` leaves out what the main menu has elsewhere
 *  (Copy / Paste is in Edit, Animate has its own menu). */
export function layerItems(main = false): Item[] {
  const all = items();
  return main ? all.filter(it => it === '-' || (it.id !== 'cp' && it.id !== 'anim')) : all;
}
function items(): Item[] {
  const roots = selectedRoots(),
    l = selLayer(),
    one = !!l && roots.length === 1,
    any = roots.length > 0,
    free = roots.some(x => !isLocked(x)),
    paths = l ? doc.layers.filter(o => o !== l && ['path', 'rect', 'ellipse'].includes(o.type)) : [],
    anim = ANIM_GROUPS.map(g =>
      g
        .filter(([k]) => roots.some(r => propOK(r, k)))
        .map(([k, label]): Item => ({ id: 'anim:' + k, label, on: free })),
    ).filter(g => g.length);
  return [
    {
      id: 'cp',
      label: 'Copy / Paste',
      sub: [
        { id: 'cut', label: 'Cut', on: any, key: 'Ctrl X' },
        { id: 'copy', label: 'Copy', on: any, key: 'Ctrl C' },
        { id: 'paste', label: 'Paste', on: hasLayerClip(), key: 'Ctrl V' },
        { id: 'pastein', label: 'Paste in place', on: hasLayerClip(), key: 'Ctrl ⇧ V' },
        { id: 'dup', label: 'Duplicate', on: one, key: 'Ctrl D' },
      ],
    },
    { id: 'group', label: 'Group', on: any, key: 'Ctrl G' },
    { id: 'ungroup', label: 'Ungroup', on: one && l.type === 'group', key: 'Ctrl ⇧ G' },
    { id: 'del', label: 'Delete', on: any, key: 'Del' },
    '-',
    { id: 'center', label: 'Center origin', on: one && free && l.type !== 'bone', key: 'Ctrl ⇧ O' },
    {
      id: 'anim',
      label: 'Animate',
      on: free && anim.length > 0,
      sub: anim.flatMap((g, i) => (i ? ['-' as Item, ...g] : g)),
    },
    {
      id: 'mp',
      label: 'Set motion path',
      on: one && free && paths.length > 0,
      sub: paths.map(p => ({ id: 'mp:' + p.id, label: p.name, on: true })),
    },
    { id: 'link', label: l && l.link ? 'Edit hyperlink…' : 'Hyperlink…', on: one },
    {
      id: 'topath',
      label: l && l.type === 'text' ? 'Convert to shapes' : 'Convert to path',
      on: one && free && (l.type === 'rect' || l.type === 'ellipse' || textConvertible(l)),
      key: 'Ctrl ⇧ P',
    },
    { id: 'export', label: 'Export selection…', on: any, key: 'Ctrl ⇧ E' },
    '-',
    {
      id: 'bool',
      label: 'Boolean',
      on: !!boolTargets(),
      sub: BOOL_OPS.map(([k, label]) => ({ id: 'bool:' + k, label, on: true })),
    },
    '-',
    { id: 'clip', label: 'Create clipping path', on: canMask() },
    { id: 'mask', label: 'Create mask', on: canMask() },
    { id: 'unmask', label: l && l.mask === 'clip' ? 'Release clipping path' : 'Release mask', on: one && !!l.mask },
    '-',
    { id: 'mksym', label: 'Make symbol', on: any && free && !(one && isInstance(l)) },
    { id: 'edsym', label: 'Edit symbol', on: one && isInstance(l) },
    { id: 'detach', label: 'Detach instance', on: one && isInstance(l) },
    '-',
    {
      id: 'align',
      label: 'Align',
      on: any,
      sub: ALIGN.map(([k, label]) => ({
        id: 'al:' + k,
        label: label
          .replace(/^Align |^Distribute /, m => (m.startsWith('D') ? 'Distribute ' : ''))
          .replace(/^./, c => c.toUpperCase()),
        on: k.startsWith('dist') ? roots.length >= 3 : true,
      })),
    },
    {
      id: 'arr',
      label: 'Arrange',
      on: one,
      sub: [
        { id: 'front', label: 'Bring to front', on: true, key: 'Ctrl ⇧ ]' },
        { id: 'fwd', label: 'Bring forward', on: true, key: 'Ctrl ]' },
        { id: 'bwd', label: 'Send backward', on: true, key: 'Ctrl [' },
        { id: 'back', label: 'Send to back', on: true, key: 'Ctrl ⇧ [' },
      ],
    },
    { id: 'hide', label: roots.length && roots.every(x => x.hid) ? 'Show' : 'Hide', on: any, key: 'Ctrl H' },
    { id: 'lock', label: roots.length && roots.every(x => x.lock) ? 'Unlock' : 'Lock', on: any, key: 'Ctrl L' },
    '-',
    { id: 'rotr', label: 'Rotate 90° right', on: free },
    { id: 'rotl', label: 'Rotate 90° left', on: free },
    '-',
    { id: 'fliph', label: 'Flip horizontal', on: free },
    { id: 'flipv', label: 'Flip vertical', on: free },
  ];
}
export function menuHTML(list: Item[]): string {
  return html(list);
}
function html(list: Item[]): string {
  const out: string[] = [];
  list.forEach(it => {
    if (it === '-') {
      if (out.length && out[out.length - 1] !== '<hr>') out.push('<hr>');
      return;
    }
    const dis = it.sub ? it.on === false || !it.sub.some(s => s !== '-' && s.on) : !it.on,
      chk = it.check !== undefined,
      role = chk ? `menuitemcheckbox" aria-checked="${it.check}` : 'menuitem';
    out.push(
      `<div class="lm-it${it.sub ? ' has-sub' : ''}"><button role="${role}" data-lm="${it.id}"${it.tip ? ` title="${esc(it.tip)}"` : ''}${dis ? ' disabled' : ''}${it.sub ? ' aria-haspopup="true"' : ''}>${chk ? `<span class="lm-chk">${it.check ? '✓' : ''}</span>` : ''}<span>${esc(it.label)}</span>${it.sub ? '<i class="lm-arrow">▸</i>' : `<kbd>${it.key || ''}</kbd>`}</button>${
        it.sub && !dis ? `<div class="ctx lm-sub" role="menu">${html(it.sub)}</div>` : ''
      }</div>`,
    );
  });
  while (out[out.length - 1] === '<hr>') out.pop();
  return out.join('');
}
export function openLayerMenu(x: number, y: number) {
  const m = M();
  m.innerHTML = html(items());
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 8)) + 'px';
  // submenus open to the left near the right edge
  m.classList.toggle('flip', x + r.width * 2 > innerWidth);
  const f = m.querySelector('button:not(:disabled)') as HTMLElement;
  if (f) f.focus();
}
/** Places an open submenu beside its item, inside the window: moved up when it would run off the
 *  bottom, to the left when it would run off the right, scrolling only when it is taller than the
 *  window. It is positioned against the window (fixed), so a parent submenu that scrolls never clips
 *  the next level. */
export function placeSub(it: HTMLElement) {
  const s = it.querySelector(':scope > .lm-sub') as HTMLElement | null;
  if (!s) return;
  s.style.position = 'fixed';
  s.style.right = 'auto';
  s.style.maxHeight = '';
  s.style.overflowY = '';
  s.classList.remove('left');
  const ir = it.getBoundingClientRect();
  s.style.left = ir.right + 2 + 'px';
  s.style.top = ir.top - 5 + 'px';
  let r = s.getBoundingClientRect();
  if (!r.height) return;
  const room = innerHeight - 16;
  let h = r.height;
  if (h > room) {
    s.style.maxHeight = room + 'px';
    s.style.overflowY = 'auto';
    h = room;
  }
  const top = Math.max(8, Math.min(ir.top - 5, innerHeight - 8 - h));
  s.style.top = top + 'px';
  r = s.getBoundingClientRect();
  if (ir.right + 2 + r.width > innerWidth - 8 && ir.left - 2 - r.width >= 4) {
    s.style.left = ir.left - 2 - r.width + 'px';
    s.classList.add('left');
  }
}
/** Opens submenus as the pointer reaches their items (and keyboard focus), and places them. A submenu
 *  stays open until the pointer settles on another item of the same list: moving to a sibling closes
 *  it after a short delay, cancelled if the pointer comes back or reaches the submenu, so the pointer
 *  can cross the gap (or a scrollbar, or a corner of a sibling) at any speed. Submenus are re-placed
 *  when a scrolling submenu moves the items they open from. */
export function trackSubs(m: HTMLElement) {
  const timers = new Map<Element, number>();
  const keep = (it: Element) => {
    clearTimeout(timers.get(it));
    timers.delete(it);
  };
  const open = (it: HTMLElement) => {
    keep(it);
    if (!it.classList.contains('open')) {
      it.classList.add('open');
      placeSub(it);
    }
  };
  m.addEventListener('pointerover', (e: Event) => {
    const it = (e.target as Element).closest && ((e.target as Element).closest('.lm-it') as HTMLElement);
    if (!it || !m.contains(it)) return;
    // this item and the submenus it sits in stay open
    for (let a: HTMLElement | null = it; a && m.contains(a); a = a.parentElement)
      if (a.classList.contains('lm-it')) keep(a);
    const list = it.parentElement;
    // open siblings close after a moment, unless the pointer comes back or reaches their submenu
    list.querySelectorAll<HTMLElement>(':scope > .lm-it.open').forEach(o => {
      if (o === it || timers.has(o)) return;
      timers.set(
        o,
        window.setTimeout(() => {
          timers.delete(o);
          o.classList.remove('open');
          o.querySelectorAll('.lm-it.open').forEach(x => x.classList.remove('open'));
        }, 260),
      );
    });
    if (it.classList.contains('has-sub') && !(it.querySelector(':scope > button') as HTMLButtonElement).disabled)
      open(it);
  });
  m.addEventListener('focusin', (e: Event) => {
    const it = (e.target as Element).closest && ((e.target as Element).closest('.lm-it.has-sub') as HTMLElement);
    if (it && m.contains(it)) placeSub(it);
  });
  m.addEventListener(
    'scroll',
    () =>
      m.querySelectorAll<HTMLElement>('.lm-it.has-sub').forEach(it => {
        const s = it.querySelector(':scope > .lm-sub') as HTMLElement;
        if (s && getComputedStyle(s).display !== 'none') placeSub(it);
      }),
    true,
  );
}
/** Arrow keys, Enter and Esc in a menu built with menuHTML (submenus open to the right). */
export function menuKeydown(m: HTMLElement, e: KeyboardEvent, close: () => void) {
  const cur = document.activeElement as HTMLElement,
    list = (cur && (cur.closest('.lm-sub') as HTMLElement)) || m,
    bs = [...list.querySelectorAll(':scope > .lm-it > button:not(:disabled)')] as HTMLElement[],
    i = bs.indexOf(cur);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    (e.key === 'ArrowDown' ? bs[i + 1] || bs[0] : bs[i - 1] || bs[bs.length - 1]).focus();
  } else if ((e.key === 'ArrowRight' || e.key === 'Enter') && cur && cur.getAttribute('aria-haspopup')) {
    e.preventDefault();
    const s = cur.parentElement.querySelector('.lm-sub button:not(:disabled)') as HTMLElement;
    cur.parentElement.classList.add('open');
    placeSub(cur.parentElement);
    if (s) s.focus();
  } else if (e.key === 'ArrowLeft' && list !== m) {
    e.preventDefault();
    const it = list.parentElement;
    it.classList.remove('open');
    (it.querySelector('button') as HTMLElement).focus();
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    close();
  }
}
/** Runs an Element command (the ids of layerItems()) on the selection. */
export function runLayerCommand(id: string) {
  run(id);
}
function run(id: string) {
  const l = selLayer();
  closeLayerMenu();
  if (id === 'cut') copyLayers(true);
  else if (id === 'copy') copyLayers();
  else if (id === 'paste') pasteLayers();
  else if (id === 'pastein') pasteLayers(true);
  else if (id === 'dup') l && duplicate(l);
  else if (id === 'group') groupSel();
  else if (id === 'ungroup') l && ungroup(l);
  else if (id === 'del') deleteSel();
  else if (id === 'center') l && centerOrigin(l);
  else if (id.startsWith('anim:')) animateProp(id.slice(5) as PropKey);
  else if (id.startsWith('mp:')) l && setMotionPath(l, id.slice(3));
  else if (id === 'link') openHyperlink();
  else if (id === 'topath') l && convertToPath(l);
  else if (id === 'export') exportSelection();
  else if (id === 'clip' || id === 'mask') makeMask(id === 'clip' ? 'clip' : 'mask');
  else if (id === 'unmask') l && releaseMask(l);
  else if (id === 'mksym') makeSymbolFromSelection();
  else if (id === 'edsym') l && enterSymbol(l);
  else if (id === 'detach' && l && isInstance(l)) {
    const ed = beginEdit();
    detach(l);
    ed.end({ insp: true });
  } else if (id.startsWith('bool:')) booleanOp(id.slice(5) as BoolOp);
  else if (id.startsWith('al:')) align(id.slice(3));
  else if (id === 'front' || id === 'back') l && arrangeEnd(l, id === 'front');
  else if (id === 'fwd' || id === 'bwd') l && arrange(l, id === 'fwd' ? 1 : -1);
  else if (id === 'lock') toggleLock();
  else if (id === 'hide') toggleHide();
  else if (id === 'rotr' || id === 'rotl') rotate(id === 'rotr' ? 90 : -90);
  else if (id === 'fliph' || id === 'flipv') flip(id === 'fliph' ? 0 : 1);
}
/** Element ▸ Make symbol: the selected group, or a new group of the selected layers, becomes a symbol */
export function makeSymbolFromSelection() {
  const roots = selectedRoots();
  if (!roots.length) return;
  if (roots.length > 1 || roots[0].type !== 'group' || roots[0].mask) groupSel();
  const g = selLayer();
  if (!g) return;
  const ed = beginEdit();
  // a group made for the symbol takes the shape's name
  if (g !== roots[0] && roots.length === 1) g.name = roots[0].name;
  const id = makeSymbol(g, roots.length === 1 ? roots[0].name : undefined);
  ed.end({ insp: true });
  toast(`“${g.name}” is now a symbol. Duplicate it (Ctrl+D or Alt+drag) for more instances.`);
  return id;
}
/** Keyboard shortcuts for the menu's commands. Returns true when handled. */
export function layerShortcut(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey,
    k = keyLower(e),
    l = selLayer();
  if (!mod) return false;
  if (k === 'x' && !e.shiftKey) return copyLayers(true);
  if (k === 'v' && e.shiftKey) return pasteLayers(true);
  if (k === 'l' && !e.shiftKey) return l ? (toggleLock(), true) : false;
  if (e.shiftKey && k === 'o') return l ? (centerOrigin(l), true) : false;
  if (e.shiftKey && k === 'p')
    return l && (l.type === 'rect' || l.type === 'ellipse' || textConvertible(l)) ? (convertToPath(l), true) : false;
  if (e.shiftKey && k === 'e') return l ? (exportSelection(), true) : false;
  if (e.shiftKey && (e.key === '}' || e.key === ']' || e.code === 'BracketRight'))
    return l ? (arrangeEnd(l, true), true) : false;
  if (e.shiftKey && (e.key === '{' || e.key === '[' || e.code === 'BracketLeft'))
    return l ? (arrangeEnd(l, false), true) : false;
  return false;
}

export function init(): void {
  // canvas: right-click a layer (or the empty canvas for Paste)
  WRAP.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    // the layer under the pointer (looking through the selection overlay)
    const under = document
        .elementsFromPoint(e.clientX, e.clientY)
        .find(el => el.closest && el.closest('#content g[data-lid]')),
      chain = under ? hitChain(under) : [],
      cur = S.sel && layerById(S.sel),
      id =
        chain.find(c => S.selSet.has(c)) ||
        chain[chain.length - 1] ||
        (cur && insideBox(cur, docPt(e)) ? cur.id : undefined);
    if (id && !S.selSet.has(id)) select(id);
    if (!id && S.selSet.size) select(null);
    openLayerMenu(e.clientX, e.clientY);
  });
  LP.addEventListener('contextmenu', (e: MouseEvent) => {
    const r = (e.target as any).closest('.lp-row');
    if (!r) return;
    e.preventDefault();
    if (!S.selSet.has(r.dataset.lid)) select(r.dataset.lid);
    openLayerMenu(e.clientX, e.clientY);
  });
  const m = M();
  m.addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('[data-lm]');
    if (!b || b.disabled || b.getAttribute('aria-haspopup')) return;
    run(b.dataset.lm);
  });
  m.addEventListener('keydown', (e: KeyboardEvent) => menuKeydown(m, e, closeLayerMenu));
  trackSubs(m);
  document.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!m.hidden && !m.contains(e.target as Node)) closeLayerMenu();
  });
  // Hyperlink dialog
  $('#hlDone').addEventListener('click', () => saveHyperlink());
  $('#hlRemove').addEventListener('click', () => saveHyperlink(true));
  $('#hlUrl').addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') saveHyperlink();
  });
  void H;
}
