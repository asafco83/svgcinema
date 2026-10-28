// SVGcinema — export/kind
// What the Export dialog makes: the picker in its header (Animated SVG, Image, Video, GIF & Animated
// WebP). Each kind has its own options column and its own preview and embed parts; the footer is
// shared. The last kind used is remembered in this browser.
import { $ } from '../core/constants';

export type ExportKind = 'svg' | 'image' | 'video' | 'anim';
export interface KindHooks {
  /** the kind was picked, or the dialog opened on it */
  open(): void;
  /** another kind was picked, or the dialog closed */
  close(): void;
}

const STORE = 'svgcinema:exportKind';
const hooks: Partial<Record<ExportKind, KindHooks>> = {};
/** each kind's own parts of the dialog */
const PARTS: Record<ExportKind, string[]> = {
  svg: ['xOptsSvg', 'xSvgPrev', 'xSvgEmbed'],
  image: ['xOptsImg', 'xiPrev', 'xiEmbed'],
  video: ['xOptsVid', 'xvPrev', 'xvEmbed'],
  anim: ['xOptsAnim', 'xaPrev', 'xaEmbed'],
};
let cur: ExportKind = 'svg';

export function exportKind(): ExportKind {
  return cur;
}
export function registerKind(k: ExportKind, h: KindHooks) {
  hooks[k] = h;
}
/** the kinds this build offers (a kind still being built has its picker button hidden) */
export function kindAvailable(k: string): k is ExportKind {
  const b = $('#xKind').querySelector(`[data-v="${k}"]`) as HTMLElement | null;
  return !!b && !b.hidden;
}
export function rememberedKind(): ExportKind {
  try {
    const v = localStorage.getItem(STORE);
    if (v && kindAvailable(v)) return v;
  } catch (_) {}
  return 'svg';
}
/** Show one kind's parts of the dialog, and tell it it's open. */
export function showKind(k: ExportKind) {
  if (!kindAvailable(k)) k = 'svg';
  if (k !== cur) hooks[cur]?.close();
  cur = k;
  try {
    localStorage.setItem(STORE, k);
  } catch (_) {}
  $('#xKind')
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => {
      const on = b.dataset.v === k;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
  (Object.keys(PARTS) as ExportKind[]).forEach(x =>
    PARTS[x].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.hidden = x !== k;
    }),
  );
  hooks[k]?.open();
}
/** The dialog closed: the open kind lets go of what it holds. */
export function closeKind() {
  hooks[cur]?.close();
}

export function init(): void {
  $('#xKind').addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as Element).closest('button') as HTMLElement | null;
    if (!b || !kindAvailable(b.dataset.v || '') || b.dataset.v === cur) return;
    showKind(b.dataset.v as ExportKind);
  });
}
