// SVGcinema — export/dialog
import { facesFor, isLocalFamily, needsShaping, webFont } from '../render/fonts';
import { $, fmt } from '../core/constants';
import { S, doc } from '../core/state';
import { kb } from '../ui/inspector';
import { PLAYER_VERSION, SCRUB_DEFAULT, projectPayload } from './build';
import type { ScrubSettings } from '../model/types';
import type { Layer } from '../model/types';
import { syncSizeUI } from './size';
import { renderSnippet } from './snippets';

export const XTRIG = [
  ['load', 'On load'],
  ['hover', 'On mouse over'],
  ['click', 'On click'],
  ['scroll', 'On scroll into view'],
  ['scrub', 'Linked to scroll'],
  ['api', 'Programmatic'],
];
export const XOUT = [
  ['pause', 'Pause'],
  ['reverse', 'Reverse back to start'],
  ['start', 'Jump to start'],
  ['restart', 'Restart'],
  ['none', 'Keep playing'],
];
/** the layers an export writes (all, or the selection with the groups that hold it) */
export function exportLayers(): Layer[] {
  if (!S.exportOnly || !S.exportOnly.size) return doc.layers;
  const keep = new Set(S.exportOnly);
  doc.layers.forEach(l => {
    if (!S.exportOnly.has(l.id)) return;
    let p = l.parent && doc.layers.find(x => x.id === l.parent);
    while (p && !keep.has(p.id)) {
      keep.add(p.id);
      p = p.parent && doc.layers.find(x => x.id === p.parent);
    }
  });
  return doc.layers.filter(l => keep.has(l.id));
}
export function setOpts(sel: HTMLSelectElement, list: string[][], val: string) {
  sel.innerHTML = list.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('');
  sel.value = list.some(o => o[0] === val) ? val : list[0][0];
}
export function syncExportUI() {
  const ex = doc.ex,
    css = ex.mode === 'css';
  if (css && ['click', 'scroll', 'scrub', 'api'].includes(ex.trigger)) ex.trigger = 'load';
  $('#xMode')
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => b.classList.toggle('on', b.dataset.v === ex.mode));
  $('#xSize')
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => b.classList.toggle('on', b.dataset.v === (ex.size || 'resp')));
  syncSizeUI();
  // Player: inside the SVG, or the external player (page's own copy, else jsDelivr); JavaScript only
  const ext = !css && ex.player === 'external';
  $('#xPlayerRow').hidden = $('#xPlayerNote').hidden = $('#xImgWarn').hidden = css;
  $('#xPlayer')
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => b.classList.toggle('on', b.dataset.v === (ext ? 'external' : 'embed')));
  $('#xPlayerNote').textContent = ext
    ? `Uses the page’s player, else loads svgcinema-player ${PLAYER_VERSION} from jsDelivr. Saves about 26 KB per SVG.`
    : 'Plays anywhere, even offline. Adds about 26 KB.';
  const wf = doc.layers.filter(
      l => l.type === 'text' && !l.hid && (webFont(l.geo.family) || isLocalFamily(l.geo.family)),
    ),
    fm = ex.fonts === 'embed' ? 'embed' : 'outline';
  $('#xFontRow').hidden = !wf.length;
  $('#xSumText').textContent = fm === 'embed' ? 'Embedded fonts' : 'Outlines';
  $('#xFonts')
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => b.classList.toggle('on', b.dataset.v === fm));
  const rtl = fm === 'outline' && wf.some(l => needsShaping(l.geo.text));
  const missing = [
    ...new Set(wf.filter(l => isLocalFamily(l.geo.family) && !facesFor(l.geo).length).map(l => l.geo.family)),
  ];
  $('#xFontNote').hidden = !wf.length;
  $('#xFontNote').textContent =
    (fm === 'outline'
      ? 'Text is converted to shapes: it looks identical everywhere and needs no font download, but can’t be selected or read by screen readers.' +
        (rtl ? ' Arabic-script text is embedded instead, so its letters join.' : '')
      : 'The font files are embedded (only the alphabets your text uses). Text stays selectable; best for longer text.') +
    (missing.length
      ? ` ${missing.join(', ')} ${missing.length > 1 ? 'are fonts' : 'is a font'} on this computer that this page can't read yet: pick it again in the Font list (“Show fonts on this computer…”) to convert or embed it. Until then the SVG only names it, so it shows only where it's installed.`
      : '');
  $('#xIds')
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => b.classList.toggle('on', b.dataset.v === (ex.ids || 'gen')));
  setOpts(
    $('#xTrig'),
    XTRIG.filter(o => !css || ['load', 'hover'].includes(o[0])),
    ex.trigger,
  );
  if (css && !['pause', 'start'].includes(ex.out)) ex.out = 'pause';
  setOpts(
    $('#xOut'),
    XOUT.filter(o => (css ? ['pause', 'start'].includes(o[0]) : ex.trigger === 'click' || o[0] !== 'restart')),
    ex.out,
  );
  if ($('#xOut').value !== ex.out) ex.out = $('#xOut').value;
  const showOut = css ? ex.trigger === 'hover' : ['hover', 'click', 'scroll'].includes(ex.trigger);
  $('#xOutRow').hidden = !showOut;
  $('#xOutLbl').textContent =
    ex.trigger === 'click' ? 'Second click' : ex.trigger === 'scroll' ? 'Scrolled away' : 'On mouse out';
  $('#xOut').setAttribute('aria-label', $('#xOutLbl').textContent);
  $('#xFpsRow').hidden = css;
  // Linked to scroll: where in the scroll it plays and the smoothing, instead of repeat, direction,
  // the end and speed (which don't apply)
  const scrub = ex.trigger === 'scrub';
  $('#xScrubRows').hidden = !scrub;
  ['#xItRow', '#xDirRow', '#xFillRow', '#xSpeedRow'].forEach(q => ($(q).hidden = scrub));
  if (scrub) syncScrubUI();
  $('#xIt').value = String(doc.it || 0);
  $('#xDir').value = doc.dir || 'normal';
  $('#xFill').value = ex.fill || 'forwards';
  $('#xRm').value = ex.rm || 'play';
  $('#xFps').value = String(ex.fps || 0);
  const sp = $('#xSpeed');
  if (sp !== document.activeElement) sp.value = fmt(ex.speed || 1);
  $('#xPre').value = ex.prefix;
  // the editable project inside the SVG: what it adds to the file
  $('#xProj').checked = !!ex.proj;
  $('#xProjKb').textContent = '+' + kb(new Blob([projectPayload(exportLayers())]).size);
  $('#xProjNote').hidden = !ex.proj;
  $('#xAboutT').textContent = css ? 'What CSS can and can’t do' : 'What the JavaScript export supports';
  $('#xNote').innerHTML = !css
    ? 'Every animator and easing, including morph, curved paths and custom curves. Images are embedded in the file. Scripts run when the SVG is inline, or placed with <code>&lt;object&gt;</code> or <code>&lt;embed&gt;</code>. The <b>Embed</b> tab has ready code for each framework.'
    : 'Pure CSS keyframes, no script: animates inside <code>&lt;img&gt;</code> and as a CSS background. Starts on load or on hover only. On mouse out it can pause or jump to the start; reversing needs JavaScript. Morph plays with SMIL; with the hover trigger it uses CSS <code>d: path()</code>, which Safari does not support.';
  syncSummaries();
  renderSnippet();
}

/** Linked to scroll's settings, created with their defaults the first time. */
export function scrubSettings(): ScrubSettings {
  if (!doc.ex.scrub) doc.ex.scrub = { ...SCRUB_DEFAULT };
  return doc.ex.scrub;
}
export const SCRUB_RANGE: Record<string, string> = {
  cross: 'while it crosses the window',
  in: 'while it scrolls in',
  out: 'while it scrolls out',
  custom: 'custom range',
};
export function smoothLabel(v: number) {
  return v > 0 ? fmt(Math.round(v * 100) / 100) + ' s' : 'Off';
}
function syncScrubUI() {
  const sc = scrubSettings(),
    custom = sc.range === 'custom';
  ($('#xsRange') as HTMLSelectElement).value = sc.range;
  $('#xsCustom').hidden = !custom;
  ($('#xsFe') as HTMLSelectElement).value = sc.fe;
  ($('#xsTe') as HTMLSelectElement).value = sc.te;
  if ($('#xsFp') !== document.activeElement) ($('#xsFp') as HTMLInputElement).value = fmt(sc.fp);
  if ($('#xsTp') !== document.activeElement) ($('#xsTp') as HTMLInputElement).value = fmt(sc.tp);
  ($('#xsSm') as HTMLInputElement).value = String(sc.sm);
  $('#xsSmv').textContent = smoothLabel(sc.sm);
}

const TRIG_SHORT: Record<string, string> = {
  load: 'On load',
  hover: 'On mouse over',
  click: 'On click',
  scroll: 'On scroll',
  scrub: 'Linked to scroll',
  api: 'Programmatic',
};
/** the one-line summaries a closed section shows next to its title */
export function syncSummaries() {
  const ex = doc.ex,
    css = ex.mode === 'css',
    it = doc.it || 0;
  $('#xSumFmt').textContent = css
    ? 'CSS only'
    : ex.player === 'external'
      ? 'JavaScript · external player'
      : 'JavaScript · embedded player';
  $('#xSumPlay').textContent =
    ex.trigger === 'scrub'
      ? 'Linked to scroll · ' + SCRUB_RANGE[scrubSettings().range]
      : (TRIG_SHORT[ex.trigger] || 'On load') +
        ' · ' +
        (it === 0 ? 'loops forever' : it === 1 ? 'plays once' : `plays ${it} times`) +
        ((ex.speed || 1) !== 1 ? ` · ×${fmt(ex.speed)}` : '');
  $('#xSumSize').textContent = ex.size === 'fixed' ? `${$('#xW').value} × ${$('#xH').value} px` : 'Responsive';
  const fmtSel = $('#xFmt') as HTMLSelectElement,
    fmtTxt = fmtSel.selectedOptions && fmtSel.selectedOptions[0] ? fmtSel.selectedOptions[0].textContent : '';
  $('#xSumImg').textContent =
    ex.opt === false
      ? 'Original files'
      : (fmtTxt || '').replace(/ \(.*\)$/, '') + (ex.fmt === 'png' ? '' : ` · ${ex.q || 82}%`);
  $('#xSumAdv').textContent =
    (ex.ids === 'names' ? 'IDs from names' : 'Generated IDs') + ' · ' + ex.prefix + (ex.proj ? ' · project' : '');
}
