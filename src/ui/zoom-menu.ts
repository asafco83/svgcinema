// SVGcinema — ui/zoom-menu
// Click the zoom percentage for a menu: a slider and a typed value, then
// Fit selection (2), Fit (1), Zoom 100% (0), Zoom in (Ctrl +) and Zoom out (Ctrl −).
import { $ } from '../core/constants';
import { S } from '../core/state';
import { fitSelection, fitSelectionTargets, fitView, isFitView, zoomAt, zoomTo } from '../tools/hand';
import { MAX_SCALE, MIN_SCALE } from '../render/stage';

const STEP = 1.25;
const RANGE = 1000;
// the slider is logarithmic, so every doubling takes the same distance
const toSlider = (s: number) => Math.round((Math.log(s / MIN_SCALE) / Math.log(MAX_SCALE / MIN_SCALE)) * RANGE);
const fromSlider = (v: number) => MIN_SCALE * Math.pow(MAX_SCALE / MIN_SCALE, v / RANGE);

const M = () => $('#zoomMenu') as HTMLElement;

type Item = [id: string, label: string, key: string];
const ITEMS: Item[] = [
  ['sel', 'Fit selection', '2'],
  ['fit', 'Fit', '1'],
  ['100', 'Zoom 100%', '0'],
  ['in', 'Zoom in', 'Ctrl +'],
  ['out', 'Zoom out', 'Ctrl −'],
];
/** Zoom 100% / fit / fit selection / in / out (the main menu's View items) */
export function zoomCommand(id: string) {
  return run(id);
}
function run(id: string) {
  if (id === 'sel') return fitSelection();
  if (id === 'fit') fitView();
  else if (id === '100') zoomTo(1);
  else if (id === 'in') zoomAt(STEP);
  else if (id === 'out') zoomAt(1 / STEP);
  return true;
}
/** Keyboard zoom: 1 fit, 0 100%, 2 fit selection, Ctrl +/− zoom. Returns true when handled. */
export function zoomShortcut(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && (e.key === '=' || e.key === '+')) return run('in');
  if (mod && !e.altKey && (e.key === '-' || e.key === '_')) return run('out');
  if (mod || e.altKey || e.shiftKey) return false;
  if (e.key === '1') return run('fit');
  if (e.key === '0') return run('100');
  if (e.key === '2') return run('sel');
  return false;
}
function sync() {
  const m = M();
  if (!m || m.hidden) return;
  const r = m.querySelector<HTMLInputElement>('#zmRange'),
    n = m.querySelector<HTMLInputElement>('#zmNum');
  if (r) r.value = String(toSlider(S.scale));
  if (n && n !== document.activeElement) n.value = String(Math.round(S.scale * 100));
  const fit = isFitView(),
    actual = Math.abs(S.scale - 1) < 1e-3,
    hasSel = fitSelectionTargets().length > 0;
  m.querySelectorAll<HTMLButtonElement>('[data-z]').forEach(b => {
    const id = b.dataset.z,
      on = (id === 'fit' && fit) || (id === '100' && actual);
    b.querySelector('.ck').textContent = on ? '✓' : '';
    b.setAttribute('aria-checked', String(on));
    if (id === 'sel') b.disabled = !hasSel;
  });
}
/** Keep the menu in step with zoom changes made elsewhere (wheel, keys, buttons). */
export function zoomChanged() {
  sync();
}
export function closeZoomMenu() {
  const m = M();
  if (!m || m.hidden) return;
  m.hidden = true;
  $('#zVal').setAttribute('aria-expanded', 'false');
}
export function openZoomMenu() {
  const m = M(),
    btn = $('#zVal') as HTMLElement;
  m.innerHTML =
    `<div class="zm-top"><input type="range" id="zmRange" min="0" max="${RANGE}" step="1" aria-label="Zoom"><label class="zm-num"><input id="zmNum" inputmode="numeric" aria-label="Zoom percent"><em>%</em></label></div><hr>` +
    ITEMS.map(
      ([id, label, key]) =>
        `<button role="menuitemradio" data-z="${id}"><span class="zm-l"><span class="ck" aria-hidden="true"></span>${label}</span><kbd>${key}</kbd></button>`,
    ).join('');
  m.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  sync();
  const r = btn.getBoundingClientRect(),
    mr = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(r.right - mr.width, innerWidth - mr.width - 4)) + 'px';
  m.style.top = Math.max(4, r.top - mr.height - 6) + 'px';
  m.querySelector<HTMLInputElement>('#zmNum').focus();
  m.querySelector<HTMLInputElement>('#zmNum').select();
}

export function init(): void {
  $('#zVal').addEventListener('click', () => (M().hidden ? openZoomMenu() : closeZoomMenu()));
  const m = M();
  m.addEventListener('input', (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'zmRange') {
      zoomTo(fromSlider(+t.value));
      sync();
    }
  });
  m.addEventListener('keydown', (e: KeyboardEvent) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'zmNum' && e.key === 'Enter') {
      e.preventDefault();
      const v = parseFloat(t.value);
      if (isFinite(v) && v > 0) zoomTo(Math.min(MAX_SCALE, Math.max(MIN_SCALE, v / 100)));
      t.value = String(Math.round(S.scale * 100));
      t.select();
      sync();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeZoomMenu();
      ($('#zVal') as HTMLElement).focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (t.id === 'zmRange') return;
      e.preventDefault();
      const items = [...m.querySelectorAll<HTMLElement>('#zmNum, button:not(:disabled)')],
        i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
    if (e.key === 'Tab') closeZoomMenu();
  });
  m.addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-z]');
    if (!b || b.disabled) return;
    run(b.dataset.z);
    closeZoomMenu();
  });
  document.addEventListener('pointerdown', (e: PointerEvent) => {
    const t = e.target as HTMLElement;
    if (!t.closest('#zoomMenu') && !t.closest('#zVal')) closeZoomMenu();
  });
  window.addEventListener('resize', closeZoomMenu);
}
