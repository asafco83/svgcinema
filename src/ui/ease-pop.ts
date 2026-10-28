// SVGcinema — ui/ease-pop
// The Easing panel: the curve button in the timeline header (left of Animate) opens the selected
// keyframes' easing (the Keyframe section that used to sit in the Inspector). The button is greyed out
// while no keyframe is selected; the panel opens only when the button is clicked, on the left side of
// the window just above the timeline (it covers little of the canvas), and closes with the button, Esc,
// a click elsewhere, or when no keyframe is left selected. It follows the selection while open.
import type { Ease } from '../model/types';
import { $, EZFAM, clamp, clone, r2, r3, xfp } from '../core/constants';
import { beginEdit, deleteKeys } from '../core/history';
import { S, doc, sortTrack } from '../core/state';
import { frame } from '../render/stage';
import { toast } from '../io/open';
import { EZXi, EZYi, applyEase, bezOf, drawEz, easeFam, famName, keyPanel, sameEase } from './easing';
import { INSPECTOR_EVENT } from './inspector';

const ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.7 13.5H8.9M12.3 2.5H7.1" stroke-width="1.1"/><path d="M2.5 13.5C10.5 13.5 5.5 2.5 13.5 2.5" stroke-width="1.5"/><circle cx="10.5" cy="13.5" r="1.6" stroke-width="1.2"/><circle cx="5.5" cy="2.5" r="1.6" stroke-width="1.2"/><rect x="1.3" y="12.3" width="2.4" height="2.4" rx=".4" fill="currentColor" stroke="none"/><rect x="12.3" y="1.3" width="2.4" height="2.4" rx=".4" fill="currentColor" stroke="none"/></svg>';

const POP = () => $('#ezPop') as HTMLElement;
const BTN = () => $('#tEase') as HTMLButtonElement;

export const isEasePopOpen = () => !POP().hidden;

/** Draw the panel's content again (keys changed) and keep it in place. */
export function renderEasePop() {
  const btn = BTN(),
    has = S.keys.size > 0;
  btn.disabled = !has;
  if (!has && isEasePopOpen()) return closeEasePop();
  if (!isEasePopOpen()) return;
  const p = POP(),
    focus =
      document.activeElement && p.contains(document.activeElement) ? (document.activeElement as HTMLElement).id : '';
  p.innerHTML = keyPanel();
  drawEz();
  place();
  if (focus) {
    const f = document.getElementById(focus);
    if (f) f.focus();
  }
}
/** Left side of the window, its bottom just above the timeline. */
function place() {
  const p = POP(),
    tl = document.querySelector('.panel.tl') as HTMLElement | null,
    top = tl ? tl.getBoundingClientRect().top : innerHeight - 300;
  p.style.left = '8px';
  p.style.top = Math.max(8, top - p.offsetHeight - 6) + 'px';
}
export function openEasePop() {
  if (!S.keys.size) return;
  POP().hidden = false;
  BTN().setAttribute('aria-expanded', 'true');
  renderEasePop();
  const on = POP().querySelector<HTMLElement>('.ezb.on') || POP().querySelector<HTMLElement>('.ezb');
  if (on) on.focus();
}
export function closeEasePop() {
  POP().hidden = true;
  BTN().setAttribute('aria-expanded', 'false');
}

function onChange(e: Event) {
  const t = e.target as HTMLInputElement;
  if (t.id !== 'kf-time') return;
  const v = parseFloat(t.value);
  if (!isFinite(v)) return;
  const ed = beginEdit();
  const k = [...S.keys][0];
  k[0] = r3(clamp(v, 0, doc.dur));
  doc.layers.forEach(L => Object.values<any>(L.t).forEach(sortTrack));
  S.time = k[0];
  ed.end({ insp: true });
}
function onClick(e: MouseEvent) {
  const t = e.target as Element;
  const ez = t.closest('[data-ez]') as HTMLElement | null;
  if (ez) return applyEase(JSON.parse(ez.dataset.ez));
  const dirB = t.closest('#ezDir button') as HTMLElement | null;
  if (dirB) {
    S.ezDir = dirB.dataset.v;
    const k0 = [...S.keys][0],
      fam = easeFam(k0 && k0[2]);
    if (EZFAM.includes(fam)) applyEase(famName(fam, S.ezDir));
    else renderEasePop();
    return;
  }
  const b = t.closest('[data-act]') as HTMLElement | null;
  if (!b) return;
  const a = b.dataset.act,
    k0 = [...S.keys][0];
  if (a === 'kdel') deleteKeys();
  else if (a === 'ezsave') {
    if (!k0 || !Array.isArray(k0[2])) return;
    const ed = beginEdit();
    doc.ezPresets = doc.ezPresets || [];
    doc.ezPresets.push({ name: 'Custom ' + (doc.ezPresets.length + 1), v: clone(k0[2]) });
    ed.end({ insp: true });
    toast('Saved as an easing preset for this project.');
  } else if (a === 'ezdelp') {
    const ed = beginEdit();
    doc.ezPresets = (doc.ezPresets || []).filter(p => !sameEase(p.v, k0[2]));
    ed.end({ insp: true });
  } else if (a === 'ezall') {
    if (!k0) return;
    const ed = beginEdit();
    doc.layers.forEach(L =>
      Object.values(L.t).forEach(tr => {
        if (tr.some(q => S.keys.has(q))) tr.forEach(q => (q[2] = clone(k0[2])));
      }),
    );
    ed.end({ insp: true });
    toast('Easing applied to every keyframe in this animator.');
  }
}
/** Drag a handle of the curve: a custom cubic-bezier for every selected key (one undo step). */
function onPointerDown(e: PointerEvent) {
  const hd = (e.target as Element).closest('[data-hd]') as HTMLElement | null;
  if (!hd || !S.keys.size) return;
  e.preventDefault();
  const idx = +hd.dataset.hd,
    svg = $('#ezEd') as unknown as SVGSVGElement,
    k0 = [...S.keys][0],
    base = (bezOf(k0[2]) || [0.25, 0.1, 0.25, 1]).slice(),
    ed = beginEdit();
  const move = (ev: PointerEvent) => {
    const p = xfp(svg.getScreenCTM().inverse(), ev.clientX, ev.clientY);
    base[idx * 2] = r2(clamp(EZXi(p.x), 0, 1));
    base[idx * 2 + 1] = r2(clamp(EZYi(p.y), -0.5, 1.5));
    S.keys.forEach(k => (k[2] = base.slice() as Ease));
    drawEz();
    frame();
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
  const btn = BTN(),
    p = POP();
  btn.innerHTML = ICON;
  btn.addEventListener('click', () => (isEasePopOpen() ? closeEasePop() : openEasePop()));
  p.addEventListener('change', onChange);
  p.addEventListener('click', onClick);
  p.addEventListener('pointerdown', onPointerDown);
  p.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeEasePop();
      btn.focus();
    }
  });
  // a click elsewhere closes it (the timeline's keyframes keep it open: picking keys updates it)
  document.addEventListener('pointerdown', e => {
    if (!isEasePopOpen()) return;
    const t = e.target as Element;
    if (p.contains(t) || t.closest('#tEase, .tl .kf, .tl .sdot, .tl .seg, #toast')) return;
    closeEasePop();
  });
  // the selection of keyframes changes with every Inspector render: follow it
  document.addEventListener(INSPECTOR_EVENT, () => renderEasePop());
  addEventListener('resize', () => isEasePopOpen() && place());
  renderEasePop();
}
