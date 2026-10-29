// SVGcinema — export/scrub-preview
// The Animated SVG preview for Starts › Linked to scroll: the exported SVG on a small test page that
// scrolls, so the player follows that page's scroll as it would a real one (runtime/scrub finds the
// nearest box that scrolls). Dashed lines show where in the window it starts and ends, and a side
// panel shows how much has played.
import { $ } from '../core/constants';
import { doc } from '../core/state';
import { tc } from '../render/stage';
import { scrubRange } from './build';

const EDGE_NAME = ['its top', 'its centre', 'its bottom'];
const edgeName = (k: number) => EDGE_NAME[k === 0 ? 0 : k === 1 ? 2 : 1];
const LINES_ABOVE = [42, 100, 92, 96, 64],
  LINES_BELOW = [88, 100, 76, 94, 58, 100, 83];
const bars = (ws: number[]) => ws.map(w => `<span style="width:${w}%"></span>`).join('');

export function isScrubPreview() {
  return doc.ex.mode !== 'css' && doc.ex.trigger === 'scrub';
}
/** The test page around the exported code. */
export function scrubPreviewHTML(code: string) {
  const [, p1, , p2] = scrubRange(doc.ex.scrub),
    [k1, , k2] = scrubRange(doc.ex.scrub),
    y = (p: number) => Math.max(0, Math.min(100, p)),
    shift = (p: number) => (p >= 96 ? '-100%' : p <= 4 ? '0' : '-50%');
  const line = (cls: string, p: number, tag: string) =>
    `<span class="xs-line ${cls}" style="top:${y(p)}%" aria-hidden="true"></span>` +
    `<span class="xs-tag ${cls}" style="top:${y(p)}%;transform:translateY(${shift(p)})">${tag}</span>`;
  return (
    `<div class="xs-test"><div class="xs-win"><div class="xs-page" id="xsPage" role="region" tabindex="0" aria-label="A test page: scroll it to play the animation">` +
    `<div class="xs-col"><div class="xs-fill">${bars(LINES_ABOVE)}</div><div class="xs-art">${code}</div><div class="xs-fill">${bars(LINES_BELOW)}</div></div></div>` +
    line('start', p1, 'Start · ' + edgeName(k1) + ' here') +
    line('end', p2, 'End · ' + edgeName(k2) + ' here') +
    `</div><div class="xs-side"><div><span>Played</span><b id="xsPct">0%</b><span id="xsTime"></span></div>` +
    `<div class="xs-rail" aria-hidden="true"><i id="xsFill"></i><em id="xsKnob"></em></div>` +
    `<span>Scroll the test page to try it</span></div></div>`
  );
}
/** Size the fillers to the window (so the whole range can be scrolled through) and the art to the page. */
export function layoutScrubPreview(rw: number, rh: number, actual: boolean) {
  const page = document.getElementById('xsPage'),
    svg = page && (page.querySelector('.xs-art svg') as SVGSVGElement | null);
  if (!page || !svg) return 1;
  const s = actual ? 1 : Math.min(1, (page.clientWidth - 56) / rw);
  svg.style.width = Math.round(rw * s) + 'px';
  svg.style.height = Math.round(rh * s) + 'px';
  page
    .querySelectorAll('.xs-fill')
    .forEach((f: Element) => ((f as HTMLElement).style.minHeight = page.clientHeight + 'px'));
  return s;
}
/** Scroll the test page so the art is in the middle of its window. */
export function centreScrubPreview() {
  const page = document.getElementById('xsPage'),
    art = page && (page.querySelector('.xs-art') as HTMLElement | null);
  if (!page || !art) return;
  page.scrollTop = Math.max(0, art.offsetTop + art.offsetHeight / 2 - page.clientHeight / 2);
}
let raf = 0;
/** Keep the side panel in step with the player while the test page is shown. */
export function watchScrubPreview() {
  if (raf) return;
  const tick = () => {
    raf = 0;
    const svg = document.querySelector('#xsPage .xs-art svg') as (SVGSVGElement & { player?: any }) | null;
    if (!svg || !svg.player || $('#mExport').hidden) return;
    const P = svg.player,
      d = P.duration || 1,
      t = Math.max(0, Math.min(d, P.currentTime || 0)),
      pct = Math.round((t / d) * 100);
    $('#xsPct').textContent = pct + '%';
    $('#xsTime').textContent = `${tc(t / 1000)} of ${tc(d / 1000)}`;
    ($('#xsFill') as HTMLElement).style.height = pct + '%';
    ($('#xsKnob') as HTMLElement).style.top = pct + '%';
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
