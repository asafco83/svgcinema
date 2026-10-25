// SVGcinema — ui/file-menu
// The main menu (☰ in the top bar), laid out like SVGator's: New project, Open… · Edit ▸, Element ▸,
// Animate ▸ · Save, Save as…, Import files…, Export SVG… · View ▸, Help ▸. The file commands are fixed
// buttons (wired up in topbar, io/open and io/save); the submenus are built each time the menu opens,
// so they follow the selection: Element reuses the right-click menu's commands, Animate the Animate
// menu's properties, View the zoom and view settings. Help › About SVGcinema shows the version, the
// copyright and the licence.
import { $, esc } from '../core/constants';
import type { PropKey } from '../model/types';
import { openExport } from '../export/build';
import { S, doc, selLayer } from '../core/state';
import { deleteKeys, redo, selectMany, undo } from '../core/history';
import { copyKeys, duplicateKeys, pasteKeys, propOK } from '../core/keyframes';
import { isLocked, selectedRoots } from '../model/tree';
import { VIEW } from '../core/view';
import {
  type Item,
  clearLayerClip,
  copyLayers,
  hasLayerClip,
  layerItems,
  menuHTML,
  menuKeydown,
  pasteLayers,
  placeSub,
  trackSubs,
  runLayerCommand,
  selectAllLayers,
} from './layer-menu';
import { ANIM_GROUPS, animateProp } from './animate-menu';
import { openPresets } from './presets-panel';
import { setSpell, spellOn } from '../core/spell';
import { openThumbs, thumbsAvailable } from './thumbs-dialog';
import { toast } from '../io/open';
import { ONION } from './onion';
import { deleteSel, duplicate } from './layers-panel';
import { zoomCommand } from './zoom-menu';
import { toggleView } from './view-menu';
import { toggleAllSections } from './inspector';
import { currentTheme, toggleTheme } from './theme';
import { openShortcuts } from './shortcuts';
import { openSample } from './topbar';
import { clearRecent, loadRecent, openRecent, recentList, recentWhen } from '../io/recent';
import { type SameKind, sameKinds, selectSame } from '../core/select-same';
import LICENSE_TEXT from '../../LICENSE?raw';

export const FM = $('#fileMenu');
export const BM = $('#bMenu');

/** where the website is: beside the editor when it runs from the site's editor/ folder */
const SITE = /\/editor\/(index\.html)?$/.test(location.pathname) ? '../' : null;

const SAME: Array<[SameKind, string]> = [
  ['fill', 'Fill'],
  ['stk', 'Stroke'],
  ['sw', 'Stroke width'],
  ['font', 'Font'],
  ['type', 'Kind of layer'],
];
function editItems(): Item[] {
  const keys = S.keys.size > 0,
    roots = selectedRoots(),
    any = roots.length > 0,
    l = selLayer(),
    same = sameKinds(l);
  return [
    { id: 'ed:undo', label: 'Undo', on: S.undo.length > 0, key: 'Ctrl Z' },
    { id: 'ed:redo', label: 'Redo', on: S.redo.length > 0, key: 'Ctrl ⇧ Z' },
    '-',
    { id: 'ed:cut', label: keys ? 'Cut keyframes' : 'Cut', on: keys || any, key: 'Ctrl X' },
    { id: 'ed:copy', label: keys ? 'Copy keyframes' : 'Copy', on: keys || any, key: 'Ctrl C' },
    {
      id: 'ed:paste',
      label: S.clip && S.clip.length ? 'Paste keyframes' : 'Paste',
      on: !!(S.clip && S.clip.length) || hasLayerClip(),
      key: 'Ctrl V',
    },
    { id: 'ed:pastein', label: 'Paste in place', on: hasLayerClip(), key: 'Ctrl ⇧ V' },
    { id: 'ed:dup', label: keys ? 'Duplicate keyframes' : 'Duplicate', on: keys || !!l, key: 'Ctrl D' },
    '-',
    { id: 'ed:del', label: keys ? 'Delete keyframes' : 'Delete', on: keys || any, key: 'Del' },
    '-',
    { id: 'ed:all', label: 'Select all', on: doc.layers.length > 0, key: 'Ctrl A' },
    { id: 'ed:none', label: 'Deselect all', on: any || keys, key: 'Ctrl ⇧ A' },
    {
      id: 'ed:same',
      label: 'Select same',
      on: same.length > 0,
      sub: SAME.filter(([k]) => same.includes(k)).map(([k, label]): Item => ({ id: 'same:' + k, label, on: true })),
    },
  ];
}
function animateItems(): Item[] {
  const roots = selectedRoots(),
    free = roots.some(x => !isLocked(x));
  return ANIM_GROUPS.map(g =>
    g
      .filter(([k]) => roots.some(r => propOK(r, k)))
      .map(([k, label, key]): Item => ({ id: 'anim:' + k, label, on: free, key: key ? '⇧ ' + key : '' })),
  )
    .filter(g => g.length)
    .flatMap((g, i) => (i ? ['-' as Item, ...g] : g))
    .reduce((a: Item[], it, i) => (i ? [...a, it] : [{ id: 'presets', label: 'Presets…', on: free }, '-', it]), []);
}
function viewItems(): Item[] {
  return [
    { id: 'vw:100', label: 'Zoom 100%', on: true, key: '0' },
    { id: 'vw:fit', label: 'Zoom to fit', on: true, key: '1' },
    { id: 'vw:sel', label: 'Zoom to selection', on: S.selSet.size > 0, key: '2' },
    { id: 'vw:in', label: 'Zoom in', on: true, key: 'Ctrl +' },
    { id: 'vw:out', label: 'Zoom out', on: true, key: 'Ctrl −' },
    '-',
    { id: 'vw:rulers', label: 'Rulers', on: true, check: VIEW.rulers, key: 'Alt R' },
    { id: 'vw:guides', label: 'Guides', on: true, check: VIEW.guides, key: 'Alt L' },
    { id: 'vw:gridFront', label: 'Front grid', on: true, check: VIEW.gridFront, key: 'Alt G' },
    { id: 'vw:gridBack', label: 'Back grid', on: true, check: VIEW.gridBack },
    { id: 'vw:snap', label: 'Snapping', on: true, check: VIEW.snap, key: 'Alt S' },
    { id: 'vw:bones', label: 'Bones', on: true, check: S.showBones, key: 'Alt B' },
    { id: 'vw:pins', label: 'Pins', on: true, check: S.showPins, key: 'Alt P' },
    { id: 'vw:onion', label: 'Onion skin', on: true, check: ONION.on, key: 'Alt O' },
    '-',
    { id: 'vw:sections', label: 'Collapse or expand sections', on: true, key: '/' },
    { id: 'vw:theme', label: 'Dark theme', on: true, check: currentTheme() === 'dark' },
  ];
}
/** A page can't read or change the browser's own spell check setting, so we point to it. */
const SPELL_TIP =
  "No red underlines? Turn on spell check in your browser's settings (Chrome: Settings ▸ Languages ▸ Spell check).";
function helpItems(): Item[] {
  return [
    { id: 'hp:keys', label: 'Keyboard shortcuts', on: true, key: 'F1' },
    { id: 'hp:sample', label: 'Open the sample scene…', on: true },
    { id: 'hp:spell', label: 'Spell check', on: true, check: spellOn(), tip: SPELL_TIP },
    ...(thumbsAvailable() ? [{ id: 'hp:thumbs', label: 'Thumbnails on your computer…', on: true } as Item] : []),
    ...(SITE ? [{ id: 'hp:site', label: 'SVGcinema website', on: true } as Item] : []),
    '-',
    { id: 'hp:about', label: 'About SVGcinema', on: true },
  ];
}
function recentItems(): Item[] {
  const l = recentList();
  return l.length
    ? [
        ...l.map(
          (e, i): Item => ({
            id: 'rc:' + i,
            label: e.name.replace(/\.svgcinema(\.zip)?$/i, ''),
            on: true,
            key: recentWhen(e.at),
          }),
        ),
        '-',
        { id: 'rc:clear', label: 'Clear the list', on: true },
      ]
    : [];
}
const SUBS: Record<string, () => Item[]> = {
  recent: recentItems,
  edit: editItems,
  element: () => layerItems(true),
  animate: animateItems,
  view: viewItems,
  help: helpItems,
};
/** fills the submenus for the current selection; a submenu with nothing to do greys out */
function fill(only?: string) {
  FM.querySelectorAll(only ? `[data-sub="${only}"]` : '[data-sub]').forEach((it: HTMLElement) => {
    const list = SUBS[it.dataset.sub](),
      on = list.some(x => x !== '-' && x.on !== false && (x.on || x.sub)),
      b = it.querySelector(':scope > button') as HTMLButtonElement;
    it.classList.remove('open');
    b.disabled = !on;
    (it.querySelector('.lm-sub') as HTMLElement).innerHTML = on ? menuHTML(list) : '';
  });
}
/** the recent list loads from storage the first time: fill its submenu once it's there */
function refillRecent() {
  const it = FM.querySelector('[data-sub="recent"]');
  if (it && !it.classList.contains('open')) fill('recent');
}
function run(id: string) {
  const keys = S.keys.size > 0,
    l = selLayer();
  if (id === 'ed:undo') undo();
  else if (id === 'ed:redo') redo();
  else if (id === 'ed:cut') {
    if (keys) {
      clearLayerClip();
      copyKeys();
      deleteKeys();
    } else copyLayers(true);
  } else if (id === 'ed:copy') {
    if (keys) {
      clearLayerClip();
      copyKeys();
    } else {
      S.clip = null;
      copyLayers();
    }
  } else if (id === 'ed:paste') S.clip && S.clip.length ? pasteKeys() : pasteLayers();
  else if (id === 'ed:pastein') pasteLayers(true);
  else if (id === 'ed:dup') keys ? duplicateKeys() : l && duplicate(l);
  else if (id === 'ed:del') keys ? deleteKeys() : deleteSel();
  else if (id === 'ed:all') selectAllLayers();
  else if (id === 'ed:none') selectMany([]);
  else if (id === 'rc:clear') clearRecent();
  else if (id.startsWith('rc:')) openRecent(+id.slice(3));
  else if (id.startsWith('same:')) selectSame(id.slice(5) as SameKind);
  else if (id === 'presets') openPresets(null);
  else if (id.startsWith('anim:')) animateProp(id.slice(5) as PropKey);
  else if (id === 'vw:100' || id === 'vw:fit' || id === 'vw:sel' || id === 'vw:in' || id === 'vw:out')
    zoomCommand(id.slice(3));
  else if (id === 'vw:sections') toggleAllSections();
  else if (id === 'vw:theme') toggleTheme();
  else if (id.startsWith('vw:')) toggleView(id.slice(3));
  else if (id === 'hp:keys') openShortcuts();
  else if (id === 'hp:sample') openSample();
  else if (id === 'hp:spell') {
    setSpell(!spellOn());
    if (spellOn()) toast('Spell check is on. ' + SPELL_TIP, undefined, 7000);
    else toast('Spell check is off.');
  } else if (id === 'hp:site' && SITE) window.open(SITE, '_blank', 'noopener');
  else if (id === 'hp:thumbs') openThumbs();
  else if (id === 'hp:about') openAbout();
  else runLayerCommand(id);
}

export function openFileMenu() {
  loadRecent().then(() => !FM.hidden && refillRecent());
  const r = BM.getBoundingClientRect();
  fill();
  FM.hidden = false;
  FM.style.left = Math.max(4, r.left) + 'px';
  FM.style.top = r.bottom + 6 + 'px';
  BM.setAttribute('aria-expanded', 'true');
  const f = FM.querySelector('button:not(:disabled)') as HTMLElement;
  if (f) f.focus();
}
export function closeFileMenu() {
  FM.hidden = true;
  FM.querySelectorAll('.lm-it.open').forEach((x: Element) => x.classList.remove('open'));
  BM.setAttribute('aria-expanded', 'false');
}

/* ---------- About ---------- */

export const APP_VERSION = __APP_VERSION__;
/** the copyright line of the LICENSE file */
export function copyrightLine() {
  const m = /^Copyright[^\n]*/m.exec(LICENSE_TEXT);
  return m ? m[0].replace(/\(c\)/i, '©').replace(/\s*\(https?:[^)]*\)/, '') : '';
}
export function openAbout() {
  const logo = document.querySelector('.brand .logo'),
    build = [__APP_BUILD__, __APP_DATE__].filter(Boolean).join(' · ');
  $('#aboutBody').innerHTML = `
    <div class="ab-top">${logo ? logo.outerHTML : '<b>SVGcinema</b>'}<p>A browser editor for animated SVG.</p></div>
    <dl class="ab-facts">
      <dt>Version</dt><dd id="abVersion">${esc(APP_VERSION)}</dd>
      ${build ? `<dt>Build</dt><dd id="abBuild">${esc(build)}</dd>` : ''}
      <dt>Copyright</dt><dd id="abCopy">${esc(copyrightLine())}</dd>
      <dt>Licence</dt><dd>Proprietary. You may use the app to create, save and export animations. The files you export, with the player inside them, are yours to use for any purpose, including commercially.</dd>
    </dl>
    <details class="ab-lic"><summary>The full licence</summary><pre>${esc(LICENSE_TEXT.trim())}</pre></details>
    <div class="ab-oss">
      <h3>Open-source parts</h3>
      <ul>
        <li><b>Paper.js</b> (shape booleans): MIT licence</li>
        <li><b>opentype.js</b> (text to outlines): MIT licence</li>
        <li><b>Instrument Sans, Instrument Serif, JetBrains Mono</b> (the interface): SIL Open Font License</li>
        <li><b>Google Fonts</b> in the font list: their own open licences, most of them the SIL Open Font License</li>
      </ul>
    </div>`;
  $('#mAbout').hidden = false;
}

export function init(): void {
  BM.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    FM.hidden ? openFileMenu() : closeFileMenu();
  });
  FM.addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as Element).closest('button') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    // a submenu's own button opens it (touch screens have no hover)
    if (b.getAttribute('aria-haspopup')) {
      const it = b.parentElement;
      FM.querySelectorAll('.lm-it.open').forEach(
        (x: Element) => x !== it && !x.contains(it) && x.classList.remove('open'),
      );
      it.classList.add('open');
      placeSub(it);
      return;
    }
    closeFileMenu();
    if (b.dataset.lm) run(b.dataset.lm);
  });
  trackSubs(FM);
  FM.addEventListener('keydown', (e: KeyboardEvent) =>
    menuKeydown(FM, e, () => {
      closeFileMenu();
      BM.focus();
    }),
  );
  document.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!FM.hidden && !FM.contains(e.target as Node) && e.target !== BM && !BM.contains(e.target as Node))
      closeFileMenu();
  });
  $('#bExport2').addEventListener('click', openExport);
}
