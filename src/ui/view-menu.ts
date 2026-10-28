// SVGcinema — ui/view-menu
// The snapping (magnet) and grid menus in the canvas bar, and their shortcuts:
// Alt+S snapping on/off, Alt+R rulers, Alt+L guides, Alt+B bones, Alt+P pins, Alt+G the front grid.
import { toggleOnion } from './onion';
import { $, ic } from '../core/constants';
import { VIEW, type ViewPrefs, onView, setView } from '../core/view';
import { drawBackGrid } from '../render/guides';
import { drawOverlay } from '../render/overlay';
import { beginEdit } from '../core/history';
import { S, doc } from '../core/state';

const MAG = ic('<path d="M6 4v8a6 6 0 0012 0V4"/><path d="M6 4h4v8a2 2 0 004 0V4h4"/><path d="M6 8h4M14 8h4"/>'),
  GRID = ic('<path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>');
type Row = [key: keyof ViewPrefs | string, label: string, on: boolean, kbd?: string, sub?: string] | '-';
const M = () => $('#viewMenu') as HTMLElement;
let which: 'snap' | 'grid' | null = null;

function rows(kind: 'snap' | 'grid'): Row[] {
  if (kind === 'snap')
    return [
      ['sObjects', 'Snap to objects', VIEW.sObjects],
      ['sPoints', 'Snap to points', VIEW.sPoints],
      ['sGuides', 'Snap to guides', VIEW.sGuides],
      ['sGrid', 'Snap to grid', VIEW.sGrid],
      ['sPixel', 'Snap to pixel', VIEW.sPixel],
      '-',
      ['snap', 'Enable snapping', VIEW.snap, 'Alt S'],
      '-',
      // keyframes in the timeline: their own switch, not turned off by Enable snapping
      ['sKeys', 'Snap keyframes', VIEW.sKeys, '', 'To the playhead, keys and 0.05 s'],
    ];
  return [
    ['gridFront', 'Front grid', VIEW.gridFront, 'Alt G'],
    ['gridBack', 'Back grid', VIEW.gridBack],
    '-',
    ['rulers', 'Show rulers', VIEW.rulers, 'Alt R'],
    ['guides', 'Show guides', VIEW.guides, 'Alt L'],
    ['bones', 'Show bones', S.showBones, 'Alt B'],
    ['pins', 'Show pins', S.showPins, 'Alt P'],
    '-',
    ['clearGuides', 'Clear guides', false],
  ];
}
function render(kind: 'snap' | 'grid') {
  const m = M(),
    off = kind === 'snap' && !VIEW.snap;
  m.innerHTML =
    rows(kind)
      .map(r =>
        r === '-'
          ? '<hr>'
          : r[0] === 'clearGuides'
            ? `<button role="menuitem" data-v="clearGuides"${doc.guides && (doc.guides.x.length || doc.guides.y.length) ? '' : ' disabled'}><span class="vm-chk"></span><span>Clear guides</span><kbd></kbd></button>`
            : `<button role="menuitemcheckbox" aria-checked="${r[2]}" data-v="${r[0]}"${off && r[0] !== 'snap' && r[0] !== 'sKeys' ? ' class="dim"' : ''}><span class="vm-chk">${r[2] ? '✓' : ''}</span><span>${r[1]}${r[4] ? `<small class="vm-sub">${r[4]}</small>` : ''}</span><kbd>${r[3] || ''}</kbd></button>`,
      )
      .join('') +
    (kind === 'grid'
      ? `<hr><label class="vm-size"><span>Grid size</span><input id="vmGrid" inputmode="numeric" value="${VIEW.grid}" aria-label="Grid size"><em>px</em></label>`
      : '');
}
function open(kind: 'snap' | 'grid') {
  const m = M(),
    btn = $(kind === 'snap' ? '#vSnap' : '#vGrid');
  if (!m.hidden && which === kind) return close();
  which = kind;
  render(kind);
  m.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect(),
    mr = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(r.left, innerWidth - mr.width - 8)) + 'px';
  m.style.top = Math.max(4, r.top - mr.height - 6) + 'px';
  const f = m.querySelector('button') as HTMLElement;
  if (f) f.focus();
}
function close() {
  M().hidden = true;
  which = null;
  $('#vSnap').setAttribute('aria-expanded', 'false');
  $('#vGrid').setAttribute('aria-expanded', 'false');
}
function syncButtons() {
  $('#vSnap').classList.toggle('on', VIEW.snap);
  $('#vGrid').classList.toggle('on', VIEW.gridFront || VIEW.gridBack || VIEW.rulers);
}
/** Turns a view setting on or off (rulers, guides, grids, snapping, bones), as the menus do. */
export function toggleView(k: string) {
  toggle(k);
}
function toggle(k: string) {
  if (k === 'bones') {
    S.showBones = !S.showBones;
    drawOverlay();
    return;
  }
  if (k === 'pins') {
    S.showPins = !S.showPins;
    drawOverlay();
    return;
  }
  if (k === 'onion') {
    toggleOnion();
    return;
  }
  if (k === 'clearGuides') {
    const ed = beginEdit();
    doc.guides = { x: [], y: [] };
    ed.end();
    return;
  }
  setView({ [k]: !(VIEW as any)[k] } as Partial<ViewPrefs>);
}
/** Alt+S / Alt+R / Alt+L / Alt+B / Alt+P / Alt+G / Alt+O. Returns true when handled. */
export function viewShortcut(e: KeyboardEvent) {
  if (!e.altKey || e.ctrlKey || e.metaKey) return false;
  const k =
    e.code === 'KeyS'
      ? 'snap'
      : e.code === 'KeyR'
        ? 'rulers'
        : e.code === 'KeyL'
          ? 'guides'
          : e.code === 'KeyB'
            ? 'bones'
            : e.code === 'KeyP'
              ? 'pins'
              : e.code === 'KeyG'
                ? 'gridFront'
                : e.code === 'KeyO'
                  ? 'onion'
                  : '';
  if (!k) return false;
  toggle(k);
  return true;
}
export function init(): void {
  $('#vSnapIc').innerHTML = MAG;
  $('#vGridIc').innerHTML = GRID;
  $('#vSnap').addEventListener('click', () => open('snap'));
  $('#vGrid').addEventListener('click', () => open('grid'));
  const m = M();
  m.addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('button[data-v]');
    if (!b || b.disabled) return;
    toggle(b.dataset.v);
    if (which) render(which);
  });
  m.addEventListener('change', (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'vmGrid') return;
    const v = Math.round(parseFloat(t.value));
    if (v >= 1 && v <= 500) setView({ grid: v });
    else t.value = String(VIEW.grid);
  });
  m.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    const bs = [...m.querySelectorAll('button:not(:disabled)')] as HTMLElement[],
      i = bs.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      (e.key === 'ArrowDown' ? bs[i + 1] || bs[0] : bs[i - 1] || bs[bs.length - 1]).focus();
    }
  });
  document.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!m.hidden && !m.contains(e.target as Node) && !(e.target as Element).closest('#vSnap,#vGrid')) close();
  });
  onView(() => {
    syncButtons();
    drawBackGrid();
    drawOverlay();
  });
  syncButtons();
  drawBackGrid();
}
