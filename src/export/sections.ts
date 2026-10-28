// SVGcinema — export/sections: the Export dialog's option sections collapse like the inspector's
import { $ } from '../core/constants';
import { syncSummaries } from './dialog';

const STORE = 'svgcinema:exportClosed';
/** sections closed until the person opens them (Advanced holds the rarely changed settings) */
const DEFAULT_CLOSED = ['Advanced'];
const CHEV =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>';

let closed: Set<string> | null = null;
function closedSet(): Set<string> {
  if (!closed) {
    closed = new Set(DEFAULT_CLOSED);
    try {
      const raw = localStorage.getItem(STORE);
      if (raw !== null) {
        const v = JSON.parse(raw);
        if (Array.isArray(v)) closed = new Set(v.filter(k => typeof k === 'string'));
      }
    } catch (_) {}
  }
  return closed;
}
/** A section's title: the heading's first text (the summary and toggle come after it). */
function title(h3: Element) {
  return (h3.childNodes[0]?.textContent || '').trim();
}
function show(h3: Element, shut: boolean) {
  const t = title(h3);
  h3.parentElement.classList.toggle('closed', shut);
  const b = h3.querySelector('.sec-tg');
  if (b) {
    b.setAttribute('aria-expanded', String(!shut));
    b.setAttribute('aria-label', `${shut ? 'Expand' : 'Collapse'} ${t}`);
    b.setAttribute('title', `${shut ? 'Show' : 'Hide'} this section`);
  }
}
/** The remembered key: the title, prefixed by the column for kinds other than Animated SVG. */
function key(h3: Element) {
  const col = h3.closest('.xopts') as HTMLElement | null,
    pre = col && col.id !== 'xOptsSvg' ? col.id.replace(/^xOpts/, '') + ':' : '';
  return pre + title(h3);
}
function toggle(h3: Element) {
  const t = key(h3),
    c = closedSet(),
    shut = !c.has(t);
  if (shut) c.add(t);
  else c.delete(t);
  try {
    localStorage.setItem(STORE, JSON.stringify([...c]));
  } catch (_) {}
  show(h3, shut);
}

export function init(): void {
  const c = closedSet();
  // every kind's options column (Animated SVG, Image…); a title is remembered per column
  document.querySelectorAll('#mExport .xopts').forEach(opts => {
    opts.querySelectorAll('.sec > h3').forEach((h3: Element) => {
      h3.insertAdjacentHTML('beforeend', `<button type="button" class="sec-tg">${CHEV}</button>`);
      show(h3, c.has(key(h3)));
    });
    opts.addEventListener('click', (e: Event) => {
      const h3 = (e.target as Element).closest('.sec > h3');
      if (h3) toggle(h3);
    });
  });
  // a closed section's summary follows every change made in the dialog
  const later = () => requestAnimationFrame(syncSummaries);
  const svg = $('#xOptsSvg') as HTMLElement;
  svg.addEventListener('change', later);
  svg.addEventListener('click', later);
}
