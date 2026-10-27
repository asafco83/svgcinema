// SVGcinema — ui/animate-menu
// The Animate button at the bottom of the Layers panel: pick a property and every
// selected layer that has it gets a keyframe at the playhead, so it joins the timeline.
// Shortcuts: Shift + the letter shown next to each property.
import { keyLower } from '../core/keys';
import type { Keyframe, Layer, PropKey } from '../model/types';
import { $, DEFAULT_EASE, H, ICON, clone, ic, isFrozen, r3, valueAt } from '../core/constants';
import { beginEdit } from '../core/history';
import { propOK } from '../core/keyframes';
import { S, layerById, sortTrack } from '../core/state';
import { isLocked, kids, pidOf } from '../model/tree';
import { canMask } from '../core/masks';
import { openPresets } from './presets-panel';
import { focusProp } from './inspector';

/** Menu sections, in order. Letters are Shift shortcuts (Shift+C is the Convert Point tool). */
export const ANIM_GROUPS: Array<Array<[PropKey, string, string?]>> = [
  [
    ['pos', 'Position', 'P'],
    ['org', 'Origin', 'A'],
    ['scl', 'Scale', 'S'],
    ['rot', 'Rotate', 'R'],
    ['skw', 'Skew', 'X'],
  ],
  [['op', 'Opacity', 'O']],
  [
    ['fill', 'Fill color'],
    ['fo', 'Fill opacity'],
  ],
  [
    ['stk', 'Stroke color', 'B'],
    ['so', 'Stroke opacity'],
    ['sw', 'Stroke width', 'W'],
    ['te', 'Trim end (draw on)', 'D'],
    ['dof', 'Dash offset', 'F'],
    ['da', 'Dash pattern'],
  ],
  [
    ['sz', 'Size'],
    ['rad', 'Corner radius'],
    ['p0', 'Line start'],
    ['p1', 'Line end'],
  ],
  [['d', 'Morph path', 'M']],
];
const BY_KEY: Record<string, PropKey> = {};
ANIM_GROUPS.flat().forEach(([k, , key]) => key && (BY_KEY[key.toLowerCase()] = k));

/** Selected layers that can be animated (unlocked). */
export function animTargets(): Layer[] {
  return [...S.selSet].map(id => layerById(id)).filter(l => l && !isLocked(l));
}
export function canAnimate() {
  return animTargets().length > 0;
}
/** Add a keyframe for `k` at the playhead on every target that has the property. */
export function animateProp(k: PropKey) {
  const ls = animTargets().filter(l => propOK(l, k) && !isFrozen(l, k));
  if (!ls.length) return false;
  const ed = beginEdit(),
    t = r3(S.time),
    made: Keyframe[] = [];
  ls.forEach(l => {
    const tr = l.t[k] || (l.t[k] = []);
    let q = tr.find(x => Math.abs(x[0] - t) < 0.005);
    if (!q) {
      q = [t, clone(valueAt(l, k, S.time)), DEFAULT_EASE];
      tr.push(q);
      sortTrack(tr);
    }
    made.push(q);
    S.exp[l.id] = true;
  });
  S.keys = new Set(made);
  ed.end({ insp: true });
  focusProp(k);
  return true;
}
/** Shift+letter shortcuts. Returns true when handled. */
export function animateShortcut(e: KeyboardEvent) {
  if (!e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false;
  const k = BY_KEY[keyLower(e)];
  if (!k || !canAnimate()) return false;
  return animateProp(k);
}

const MENU = () => $('#animMenu') as HTMLElement;
export function closeAnimMenu() {
  const m = MENU();
  if (!m || m.hidden) return;
  m.hidden = true;
  $('#lAnim').setAttribute('aria-expanded', 'false');
}
export function openAnimMenu() {
  const ls = animTargets();
  if (!ls.length) return;
  const m = MENU(),
    btn = $('#lAnim') as HTMLElement;
  m.innerHTML = ANIM_GROUPS.map(g =>
    g
      .filter(([k]) => ls.some(l => propOK(l, k)))
      .map(([k, label, key]) => {
        const has = ls.some(l => l.t[k] && l.t[k].length);
        return `<button role="menuitem" data-k="${k}"><span class="am-l"><i class="am-key${has ? ' has' : ''}" aria-hidden="true"></i>${label}</span><kbd>${key ? '⇧ ' + key : ''}</kbd></button>`;
      })
      .join(''),
  )
    .filter(Boolean)
    .join('<hr>');
  m.innerHTML =
    `<button role="menuitem" data-presets="1"><span class="am-l"><i class="am-pre" aria-hidden="true">✦</i>Presets…</span><kbd></kbd></button><hr>` +
    m.innerHTML;
  m.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  // open upwards from the button, kept inside the window
  const r = btn.getBoundingClientRect();
  // never over the button: taller than the room above it, the menu scrolls
  m.style.maxHeight = Math.max(160, r.top - 10) + 'px';
  m.style.overflowY = 'auto';
  const mr = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(r.left, innerWidth - mr.width - 4)) + 'px';
  m.style.top = Math.max(4, r.top - mr.height - 6) + 'px';
  const first = m.querySelector<HTMLElement>('button');
  if (first) first.focus();
}
/** Enable or grey out the panel's action buttons for the current selection. */
export function syncLayerActions(sel: Layer | null | undefined) {
  const one = sel && S.selSet.size === 1 && !isLocked(sel) ? sel : null,
    sib = one ? kids(pidOf(one)) : [],
    i = one ? sib.indexOf(one) : -1;
  ($('#lUp') as HTMLButtonElement).disabled = !one || i >= sib.length - 1;
  ($('#lDown') as HTMLButtonElement).disabled = !one || i <= 0;
  ($('#lDup') as HTMLButtonElement).disabled = !sel;
  ($('#lAnim') as HTMLButtonElement).disabled = !canAnimate();
  ($('#lUngroup') as HTMLButtonElement).disabled = !(sel && sel.type === 'group' && !isLocked(sel));
  ($('#lDel') as HTMLButtonElement).disabled = !S.selSet.size;
  ($('#lMask') as HTMLButtonElement).disabled = !canMask();
  const un = $('#lUnmask') as HTMLButtonElement,
    m = S.selSet.size === 1 && sel && sel.mask && !isLocked(sel) ? sel.mask : null,
    lab = m === 'clip' ? 'Release clipping path' : 'Release mask';
  un.disabled = !m;
  un.setAttribute('aria-label', lab);
  un.title = lab;
  if (!canAnimate()) closeAnimMenu();
}

export function init(): void {
  $('#lAnimIc').innerHTML = ICON.animate;
  $('#lUp').innerHTML = ic('<path d="M12 19V5M6.5 10.5L12 5l5.5 5.5"/>', 15);
  $('#lDown').innerHTML = ic('<path d="M12 5v14M6.5 13.5L12 19l5.5-5.5"/>', 15);
  $('#lDup').innerHTML = ICON.duplicate;
  $('#lGroup').innerHTML = ICON.group;
  $('#lUngroup').innerHTML = ICON.ungroup;
  $('#lMask').innerHTML = ICON.mask;
  $('#lUnmask').innerHTML = ICON.unmask;
  $('#lAnim').addEventListener('click', () => (MENU().hidden ? openAnimMenu() : closeAnimMenu()));
  MENU().addEventListener('click', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-presets]')) {
      closeAnimMenu();
      openPresets($('#lAnim') as HTMLElement);
      return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
    if (!b) return;
    closeAnimMenu();
    animateProp(b.dataset.k as PropKey);
  });
  MENU().addEventListener('keydown', (e: KeyboardEvent) => {
    const items = [...MENU().querySelectorAll<HTMLElement>('button')],
      i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeAnimMenu();
      ($('#lAnim') as HTMLElement).focus();
    } else if (e.key === 'Tab') closeAnimMenu();
  });
  document.addEventListener('pointerdown', (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest('#animMenu') && !t.closest('#lAnim')) closeAnimMenu();
  });
  window.addEventListener('blur', closeAnimMenu);
  window.addEventListener('resize', closeAnimMenu);
}
