// SVGcinema — ui/font-picker
// The Font field of Text appearance: a button that opens a searchable list of fonts, each previewed in
// itself with the layer's own text (or a sample in its script). Filters: type (serif, sans, display,
// script, mono) and script. Sections: Favourites (★, remembered in this browser), Recent (the last
// fonts chosen), Basic (system font stacks), then every Google Font grouped by script (a font that
// covers several scripts is listed under each), then On this computer (fonts the browser shares, or a
// name typed in). Preview faces load as their rows scroll into view: one alphabet, regular weight.
import type { Layer } from '../model/types';
import { FONTS, byId, esc } from '../core/constants';
import { S, layerById } from '../core/state';
import { beginEdit } from '../core/history';
import { WEB_FONTS, type WebFont } from '../model/font-catalog';
import {
  ensureFaces,
  familyCSS,
  loadLocalFonts,
  localFamilies,
  localFontsSupported,
  localLoaded,
  pickWeight,
  subsetOf,
  webFont,
} from '../render/fonts';
import { INSP } from '../core/dom';
import { renderInspector } from './inspector';
import { toast } from '../io/open';

export type FontType = 'serif' | 'sans' | 'display' | 'script' | 'mono' | 'symbols';
export const TYPES: Array<[FontType | 'all', string]> = [
  ['all', 'All'],
  ['serif', 'Serif'],
  ['sans', 'Sans'],
  ['display', 'Display'],
  ['script', 'Script'],
  ['mono', 'Mono'],
];
export const SCRIPTS: Array<[string, string]> = [
  ['hebrew', 'Hebrew'],
  ['latin', 'Latin'],
  ['cyrillic', 'Cyrillic'],
  ['greek', 'Greek'],
  ['arabic', 'Arabic'],
  ['symbols', 'Symbols'],
];
const SAMPLE: Record<string, string> = {
  hebrew: 'דוגמה',
  latin: 'Sample',
  cyrillic: 'Пример',
  greek: 'Δείγμα',
  arabic: 'عينة',
  symbols: '★ ✦ ☀ ♥ ➜ ✿',
};
/** letters of each script, to tell which script a text is in */
const SCRIPT_RE: Record<string, RegExp> = {
  hebrew: /[֐-׿יִ-ﭏ]/,
  cyrillic: /[Ѐ-ӿ]/,
  greek: /[Ͱ-Ͽ]/,
  arabic: /[؀-ࣿﭐ-﷿ﹰ-﻿]/,
  latin: /[A-Za-zÀ-ɏḀ-ỿ]/,
};
const SUB_SCRIPT: Record<string, string> = {
  hebrew: 'hebrew',
  latin: 'latin',
  'latin-ext': 'latin',
  vietnamese: 'latin',
  cyrillic: 'cyrillic',
  greek: 'greek',
  arabic: 'arabic',
};
const BASIC_TYPE: FontType[] = ['sans', 'serif', 'mono', 'display'];
const TYPE_OF: Record<string, FontType> = {
  serif: 'serif',
  'sans-serif': 'sans',
  display: 'display',
  handwriting: 'script',
  monospace: 'mono',
  symbols: 'symbols',
};
const TYPE_NAME: Record<FontType, string> = {
  serif: 'serif',
  sans: 'sans',
  display: 'display',
  script: 'script',
  mono: 'mono',
  symbols: 'symbols',
};
export function fontType(f: WebFont): FontType {
  return TYPE_OF[f.cat] || 'sans';
}
/** the scripts a web font covers (symbol fonts only under Symbols) */
export function fontScripts(f: WebFont): string[] {
  if (f.cat === 'symbols') return ['symbols'];
  return [...new Set(f.subsets.map(s => SUB_SCRIPT[s]).filter(Boolean))];
}
/** the scripts the letters of a text use */
export function textScripts(text: string): string[] {
  return Object.keys(SCRIPT_RE).filter(k => SCRIPT_RE[k].test(text));
}
/** what a row shows: the layer's own text when the font has all its letters (and, inside a script's
 *  group, when the text is in that script), else a sample in the script */
export function previewText(text: string, f: WebFont | null, script?: string) {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
  if (!f) return t || SAMPLE.latin;
  const scr = textScripts(t),
    fits = !!t && [...t].every(ch => /\s/.test(ch) || subsetOf(f, ch.codePointAt(0)) != null);
  if (fits && (!script || (scr.length ? scr.every(s => s === script) : script !== 'symbols'))) return t;
  const fs = fontScripts(f),
    s = script || fs.find(x => scr.includes(x)) || (fs.includes('latin') ? 'latin' : fs[0]) || 'latin';
  return SAMPLE[s] || SAMPLE.latin;
}

/* ---------- favourites and recent (this browser only) ---------- */

const FAV_KEY = 'svgcinema:fontFav',
  REC_KEY = 'svgcinema:fontRecent';
function readList(k: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(k) || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch (_) {
    return [];
  }
}
function writeList(k: string, v: string[]) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (_) {}
}
export const favourites = () => readList(FAV_KEY);
export function toggleFavourite(family: string) {
  const f = favourites(),
    i = f.indexOf(family);
  if (i >= 0) f.splice(i, 1);
  else f.push(family);
  writeList(FAV_KEY, f);
}
export const recentFonts = () => readList(REC_KEY);
export function addRecentFont(family: string) {
  writeList(REC_KEY, [family, ...recentFonts().filter(x => x !== family)].slice(0, 5));
}

/* ---------- the list ---------- */

let pop: HTMLElement | null = null,
  btn: HTMLElement | null = null,
  layerId: string | null = null,
  io: IntersectionObserver | null = null;
const F = { q: '', type: 'all' as FontType | 'all', script: 'any' };

export function fontLabel(family: string) {
  const b = FONTS.find(f => f[0] === family);
  return b
    ? b[1]
    : String(family || '')
        .split(',')[0]
        .replace(/['"]/g, '');
}
interface Row {
  family: string;
  label: string;
  meta: string;
  text: string;
  web: WebFont | null;
}
function matches(name: string, type: FontType | null) {
  if (F.q && !name.toLowerCase().includes(F.q.toLowerCase())) return false;
  if (F.type !== 'all' && type !== F.type) return false;
  return true;
}
function webRow(f: WebFont, text: string, script?: string): Row {
  const scr = fontScripts(f)
    .filter(s => s !== 'latin' && s !== 'symbols')
    .map(s => SCRIPTS.find(x => x[0] === s)[1]);
  return {
    family: f.family,
    label: f.family,
    meta: [f.family, TYPE_NAME[fontType(f)], ...scr].join(' · '),
    text: previewText(text, f, script),
    web: f,
  };
}
function anyRow(family: string, text: string): Row | null {
  const wf = webFont(family);
  if (wf) return matches(wf.family, fontType(wf)) ? webRow(wf, text) : null;
  const bi = FONTS.findIndex(f => f[0] === family);
  if (bi >= 0)
    return matches(FONTS[bi][1], BASIC_TYPE[bi])
      ? { family, label: FONTS[bi][1], meta: FONTS[bi][1] + ' · basic', text: previewText(text, null), web: null }
      : null;
  return F.type === 'all' && matches(family, null)
    ? { family, label: family, meta: family + ' · on this computer', text: previewText(text, null), web: null }
    : null;
}
/** the sections of the list for the current filters: [heading, count note, rows] */
export function sections(text: string, current: string): Array<[string, string, Row[]]> {
  const out: Array<[string, string, Row[]]> = [],
    anyScript = F.script === 'any';
  const fav = favourites()
    .map(x => anyRow(x, text))
    .filter(Boolean);
  const rec = recentFonts()
    .map(x => anyRow(x, text))
    .filter(Boolean);
  if (anyScript && fav.length) out.push(['Favourites', '', fav]);
  if (anyScript && rec.length) out.push(['Recent', '', rec]);
  if (anyScript) {
    const basic = FONTS.map((f, i) =>
      matches(f[1], BASIC_TYPE[i])
        ? { family: f[0], label: f[1], meta: f[1] + ' · basic', text: previewText(text, null), web: null }
        : null,
    ).filter(Boolean);
    if (basic.length) out.push(['Basic', '· ' + basic.length, basic]);
  }
  const sorted = WEB_FONTS.slice().sort((a, b) => a.family.localeCompare(b.family));
  SCRIPTS.forEach(([k, name]) => {
    if (!anyScript && F.script !== k) return;
    const rows = sorted
      .filter(f => fontScripts(f).includes(k) && matches(f.family, fontType(f)))
      .map(f => webRow(f, text, k));
    if (rows.length) out.push([name, '· ' + rows.length, rows]);
  });
  if (anyScript && F.type === 'all') {
    const loc = localFamilies()
      .filter(n => !WEB_FONTS.some(f => f.family === n))
      .filter(n => matches(n, null))
      .map(n => ({ family: n, label: n, meta: n + ' · on this computer', text: previewText(text, null), web: null }));
    // a typed-in family that is in none of the lists
    if (current && !webFont(current) && !FONTS.some(f => f[0] === current) && !loc.some(r => r.family === current))
      loc.unshift({
        family: current,
        label: fontLabel(current),
        meta: fontLabel(current) + ' · typed in',
        text: previewText(text, null),
        web: null,
      });
    out.push(['On this computer', loc.length ? '· ' + loc.length : '', loc]);
  }
  return out;
}
const STAR_ON =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M7 1.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L7 10l-3.4 1.9.7-3.8L1.5 5.5l3.8-.5z"/></svg>';
const STAR_OFF =
  '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M7 1.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L7 10l-3.4 1.9.7-3.8L1.5 5.5l3.8-.5z"/></svg>';
function listHTML() {
  const l = layerId ? layerById(layerId) : null;
  const text = l ? String(l.geo.text || '') : '',
    cur = l ? String(l.geo.family || '') : '',
    fav = new Set(favourites()),
    secs = sections(text, cur);
  let h = '';
  secs.forEach(([name, note, rows]) => {
    h += `<div class="fp-head" role="presentation">${esc(name.toUpperCase())}${note ? `<span>${esc(note)}</span>` : ''}<i></i></div>`;
    rows.forEach(r => {
      const on = fav.has(r.family);
      h += `<div class="fp-opt${r.family === cur ? ' cur' : ''}" role="option" aria-selected="${r.family === cur}" title="${esc(r.meta)}" data-font="${esc(r.family)}"${r.web ? ` data-sample="${esc(r.text)}"` : ''}><span class="fp-name">${esc(r.label)}</span><span class="fp-prev" dir="auto" style="font-family:${esc(familyCSS(r.family))}">${esc(r.text)}</span><button class="fp-star${on ? ' on' : ''}" data-fpstar="${esc(r.family)}" tabindex="-1" aria-label="${on ? 'Remove from favourites' : 'Add to favourites'}" title="${on ? 'Remove from favourites' : 'Add to favourites'}">${on ? STAR_ON : STAR_OFF}</button></div>`;
    });
    if (name === 'On this computer')
      h +=
        (localFontsSupported()
          ? `<button class="fp-act" data-fpact="local">${localLoaded() ? 'Refresh fonts on this computer…' : 'Show fonts on this computer…'}</button>`
          : '') + `<button class="fp-act" data-fpact="custom">Type a font name…</button>`;
  });
  if (!secs.some(s => s[2].length)) h += `<div class="fp-none">No fonts match.</div>`;
  return h;
}
function fill() {
  if (!pop) return;
  const list = pop.querySelector('#fpList') as HTMLElement;
  list.innerHTML = listHTML();
  observe(list);
  const cur = list.querySelector('.fp-opt.cur') as HTMLElement;
  if (cur && !F.q) cur.scrollIntoView({ block: 'nearest' });
  highlight(cur || (list.querySelector('.fp-opt') as HTMLElement));
}
/** load a row's preview face when it scrolls into view */
function observe(list: HTMLElement) {
  if (io) io.disconnect();
  const load = (el: Element) => {
    const fam = (el as HTMLElement).dataset.font,
      t = (el as HTMLElement).dataset.sample;
    if (fam && t != null) ensureFaces({ family: fam, weight: '400', text: t });
  };
  if (typeof IntersectionObserver === 'undefined') {
    list.querySelectorAll('.fp-opt[data-sample]').forEach(load);
    return;
  }
  io = new IntersectionObserver(
    es =>
      es.forEach(e => {
        if (e.isIntersecting) {
          load(e.target);
          io.unobserve(e.target);
        }
      }),
    { root: list, rootMargin: '120px 0px' },
  );
  list.querySelectorAll('.fp-opt[data-sample]').forEach(el => io.observe(el));
}
function highlight(el: HTMLElement | null) {
  if (!pop) return;
  pop.querySelectorAll('.fp-opt.hl').forEach(x => x.classList.remove('hl'));
  if (el) {
    el.classList.add('hl');
    el.scrollIntoView({ block: 'nearest' });
    (pop.querySelector('#fpFind') as HTMLElement).setAttribute('aria-activedescendant', '');
  }
}
function chipsHTML() {
  return TYPES.map(
    ([k, n]) =>
      `<button class="fp-chip${F.type === k ? ' on' : ''}" data-fptype="${k}" aria-pressed="${F.type === k}">${n}</button>`,
  ).join('');
}
function scriptHTML() {
  const used = new Set(WEB_FONTS.flatMap(fontScripts));
  return `<option value="any"${F.script === 'any' ? ' selected' : ''}>Any script</option>${SCRIPTS.filter(([k]) =>
    used.has(k),
  )
    .map(([k, n]) => `<option value="${k}"${F.script === k ? ' selected' : ''}>${n}</option>`)
    .join('')}`;
}
export function fontPickerOpen() {
  return !!pop;
}
export function openFontPicker(button: HTMLElement, l: Layer) {
  closeFontPicker();
  btn = button;
  layerId = l.id;
  F.q = '';
  pop = document.createElement('div');
  pop.className = 'fontpop';
  pop.id = 'fontPop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Fonts');
  pop.innerHTML = `<div class="fp-top">
      <label class="fp-find"><svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="6" r="4"/><path d="M9 9l3 3"/></svg><input id="fpFind" placeholder="Search fonts" aria-label="Search fonts" spellcheck="false" autocomplete="off" aria-controls="fpList"></label>
      <div class="fp-chips" role="group" aria-label="Type">${chipsHTML()}</div>
      <div class="fp-scr"><span>Script</span><select class="sel" id="fpScript" aria-label="Script">${scriptHTML()}</select></div>
    </div>
    <div class="fp-list" id="fpList" role="listbox" aria-label="Fonts"></div>
    <div class="fp-foot">Each font shows the layer’s own text, or “Sample” in its script. ★ keeps a font at the top.</div>`;
  document.body.appendChild(pop);
  place();
  fill();
  button.setAttribute('aria-expanded', 'true');
  (pop.querySelector('#fpFind') as HTMLInputElement).focus();
}
function place() {
  if (!pop || !btn) return;
  // as wide as the inspector, under the field (or above it when there is more room there)
  const r = btn.getBoundingClientRect(),
    ins = INSP.getBoundingClientRect(),
    w = Math.max(280, Math.min(360, ins.width || r.width + 60)),
    left = Math.max(8, Math.min(ins.width ? ins.left : r.right - w, innerWidth - w - 8)),
    below = innerHeight - r.bottom - 12,
    above = r.top - 12,
    down = below >= 360 || below >= above,
    h = Math.min(600, Math.max(220, down ? below : above));
  Object.assign(pop.style, {
    left: left + 'px',
    width: w + 'px',
    maxHeight: h + 'px',
    top: down ? r.bottom + 4 + 'px' : '',
    bottom: down ? '' : innerHeight - r.top + 4 + 'px',
  });
}
export function closeFontPicker(focus = false) {
  if (io) io.disconnect();
  io = null;
  if (pop) pop.remove();
  pop = null;
  if (btn) {
    btn.setAttribute('aria-expanded', 'false');
    if (focus && document.body.contains(btn)) btn.focus();
  }
  btn = null;
}
/** Use a font for the text layer: one undo step; a Google Font keeps the nearest weight it has. */
export function applyFont(l: Layer, family: string) {
  const ed = beginEdit();
  l.geo.family = family;
  const wf = webFont(family);
  if (wf) {
    l.geo.weight = String(pickWeight(wf, l.geo.weight));
    if (!wf.italic) delete l.geo.italic;
  }
  S.fontCustom = false;
  addRecentFont(family);
  ed.end({ insp: true });
}
function pick(family: string) {
  const l = layerId ? layerById(layerId) : null;
  closeFontPicker();
  if (l && l.type === 'text') applyFont(l, family);
  const b = byId('g-family');
  if (b) (b as HTMLElement).focus();
}
function action(a: string) {
  const l = layerId ? layerById(layerId) : null;
  if (a === 'custom') {
    closeFontPicker();
    S.fontCustom = true;
    renderInspector();
    const f = byId('g-fname') as HTMLElement;
    if (f) f.focus();
    return;
  }
  loadLocalFonts()
    .then(f => {
      toast(f.length ? `${f.length} fonts from this computer added to the list.` : 'No fonts were shared.');
      if (pop) fill();
    })
    .catch(() => {
      toast('The browser didn’t share the fonts on this computer. You can type a font name instead.');
      closeFontPicker();
      S.fontCustom = true;
      if (l) renderInspector();
    });
}
function moveHL(d: number) {
  const opts = [...pop.querySelectorAll('.fp-opt')] as HTMLElement[];
  if (!opts.length) return;
  const i = opts.findIndex(o => o.classList.contains('hl'));
  highlight(opts[Math.max(0, Math.min(opts.length - 1, i < 0 ? 0 : i + d))]);
}

export function init(): void {
  INSP.addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as Element).closest('[data-fontpick]') as HTMLElement | null;
    if (!b) return;
    const l = layerById(S.sel);
    if (!l || l.type !== 'text') return;
    if (pop && btn === b) closeFontPicker();
    else openFontPicker(b, l);
  });
  INSP.addEventListener('keydown', (e: KeyboardEvent) => {
    const b = (e.target as Element).closest('[data-fontpick]') as HTMLElement | null;
    if (b && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !pop) {
      e.preventDefault();
      const l = layerById(S.sel);
      if (l && l.type === 'text') openFontPicker(b, l);
    }
  });
  document.addEventListener('click', (e: MouseEvent) => {
    if (!pop) return;
    const t = e.target as Element;
    const star = t.closest('[data-fpstar]') as HTMLElement;
    if (star && pop.contains(star)) {
      e.stopPropagation();
      toggleFavourite(star.dataset.fpstar);
      const st = pop.querySelector('#fpList').scrollTop;
      fill();
      pop.querySelector('#fpList').scrollTop = st;
      return;
    }
    const chip = t.closest('[data-fptype]') as HTMLElement;
    if (chip && pop.contains(chip)) {
      F.type = chip.dataset.fptype as FontType | 'all';
      pop.querySelector('.fp-chips').innerHTML = chipsHTML();
      fill();
      return;
    }
    const act = t.closest('[data-fpact]') as HTMLElement;
    if (act && pop.contains(act)) return action(act.dataset.fpact);
    const opt = t.closest('.fp-opt') as HTMLElement;
    if (opt && pop.contains(opt)) return pick(opt.dataset.font);
  });
  // a press anywhere else closes it (the canvas handles presses itself, so no click follows there)
  document.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      const t = e.target as Element;
      if (pop && !pop.contains(t) && !(btn && btn.contains(t))) closeFontPicker();
    },
    true,
  );
  document.addEventListener('input', (e: Event) => {
    if (pop && (e.target as HTMLElement).id === 'fpFind') {
      F.q = (e.target as HTMLInputElement).value.trim();
      fill();
    }
  });
  document.addEventListener('change', (e: Event) => {
    if (pop && (e.target as HTMLElement).id === 'fpScript') {
      F.script = (e.target as HTMLSelectElement).value;
      fill();
    }
  });
  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (!pop || !pop.contains(e.target as Node)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeFontPicker(true);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if ((e.target as HTMLElement).id === 'fpScript') return;
        e.preventDefault();
        moveHL(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter') {
        const hl = pop.querySelector('.fp-opt.hl') as HTMLElement;
        if (hl && (e.target as HTMLElement).id !== 'fpScript') {
          e.preventDefault();
          pick(hl.dataset.font);
        }
      }
    },
    true,
  );
  addEventListener('resize', () => place());
}
