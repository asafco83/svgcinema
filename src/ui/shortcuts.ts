// SVGcinema — ui/shortcuts
// The Keyboard shortcuts window (F1, the keyboard button in the top bar, or Help › Keyboard shortcuts).
// Five tabs that follow the main menu — General (File, Edit), Layers (the Element menu), Tools,
// Animation (the Animate menu and the timeline) and View — each in titled sections, and a search box
// across all of them (each hit says where it lives). Tool keys come from TOOL_INFO and the Animate keys
// from ANIM_GROUPS, so the list follows the real bindings. On a Mac, Ctrl shows as ⌘ and Alt as ⌥.
import { $, TOOL_INFO, esc } from '../core/constants';
import { keyLabel } from '../core/keys';
import { ANIM_GROUPS } from './animate-menu';

/** One way to press it: keys, with plain words for mouse parts ('drag', 'click'…) */
type Combo = string[];
type Row = [label: string, combos: Combo[]];
interface Section {
  title: string;
  rows: Row[];
}
interface Tab {
  id: string;
  label: string;
  sections: Section[];
}
const sec = (title: string, ...rows: Row[]): Section => ({ title, rows });
/** "Ctrl Shift Z" → keys; a trailing lower-case phrase ("+ drag", "double-click a lane") is one part */
const c = (s: string): Combo => {
  const t = s.split(' '),
    out: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const w = t[i],
      phrase = /^[a-z]/.test(w) || (w === '+' && i + 1 < t.length && /^[a-z]/.test(t[i + 1]));
    if (phrase) {
      out.push(t.slice(i).join(' '));
      break;
    }
    out.push(w);
  }
  return out;
};
const r = (label: string, ...combos: string[]): Row => [label, combos.map(c)];

function tabs(): Tab[] {
  const tools: Row[] = Object.values(TOOL_INFO)
    .filter(t => t.key)
    .map(t => r(t.label.replace(/ \(hold Space\)$/, ''), t.key.replace('⇧', 'Shift ')));
  const anim: Row[] = ANIM_GROUPS.flat()
    .filter(([, , k]) => k)
    .map(([, label, k]) => r(label, `Shift ${k}`));
  return [
    {
      id: 'general',
      label: 'General',
      sections: [
        sec(
          'File',
          r('Save the project', 'Ctrl S'),
          r('Save as', 'Ctrl Shift S'),
          r('Open', 'Ctrl O'),
          r('Import files', 'Ctrl I'),
          r('Export', 'Ctrl E'),
          r('Export the selected layers', 'Ctrl Shift E'),
        ),
        sec(
          'Edit',
          r('Undo', 'Ctrl Z'),
          r('Redo', 'Ctrl Shift Z', 'Ctrl Y'),
          r('Cut', 'Ctrl X'),
          r('Copy', 'Ctrl C'),
          r('Paste', 'Ctrl V'),
          r('Paste in place', 'Ctrl Shift V'),
          r('Duplicate', 'Ctrl D'),
          r('Duplicate by dragging', 'Alt + drag'),
          r('Delete', 'Del'),
        ),
        sec(
          'Help',
          r('Keyboard shortcuts', 'F1'),
          r('Close a menu or dialog', 'Esc'),
          r('Back to the Select tool', 'Esc'),
        ),
      ],
    },
    {
      id: 'layers',
      label: 'Layers',
      sections: [
        sec(
          'Select',
          r('Select all layers', 'Ctrl A'),
          r('Deselect all', 'Ctrl Shift A'),
          r('Add to or remove from the selection', 'Shift + click'),
          r('Select a layer inside a group', 'Ctrl + click'),
          r('Select with a marquee', 'drag on empty canvas'),
          r('Add or remove with a marquee', 'Shift + drag on empty canvas'),
          r('Marquee the shapes inside groups', 'Ctrl + drag on empty canvas'),
        ),
        sec(
          'Organise',
          r('Group', 'Ctrl G'),
          r('Ungroup', 'Ctrl Shift G'),
          r('Hide or show', 'Ctrl H'),
          r('Lock or unlock', 'Ctrl L'),
          r('Bring forward', 'Ctrl ↑', 'Ctrl ]'),
          r('Bring to front', 'Ctrl Shift ↑', 'Ctrl Shift ]'),
          r('Send backward', 'Ctrl ↓', 'Ctrl ['),
          r('Send to back', 'Ctrl Shift ↓', 'Ctrl Shift ['),
        ),
        sec(
          'Transform',
          r('Nudge 1px', '← ↑ → ↓'),
          r('Nudge 10px', 'Shift ← ↑ → ↓'),
          r('Constrain a move · keep proportions · rotate in 15° steps', 'Shift + drag'),
          r('Scale from the centre', 'Alt + drag a handle'),
          r('Scale around the origin (past the edge mirrors)', 'Ctrl + drag a handle'),
          r('Move the origin (Shift snaps to corners and edges)', 'drag the origin'),
          r('Center the origin', 'Ctrl Shift O'),
          r('Convert to path', 'Ctrl Shift P'),
        ),
        sec(
          'Color',
          r('Pick the fill color from the screen', 'I'),
          r('Pick the stroke color from the screen', 'Alt I'),
        ),
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      sections: [
        sec('Tools', ...tools),
        sec(
          'Drawing',
          r('Pen: a corner', 'click'),
          r('Pen: a curve', 'drag'),
          r('Pen: break the handle', 'Alt + drag'),
          r('Pen: move the point being placed', 'Space + drag'),
          r('Pen: finish the path', 'Enter', 'Esc'),
          r('Pen: remove the last point', 'Del'),
          r('Shapes: square, circle, 45° lines', 'Shift + drag'),
          r('Shapes: draw from the centre', 'Alt + drag'),
          r('Polygon and star: more or fewer sides', '↑ ↓ while drawing'),
          r('Edit nodes: smooth ↔ corner', 'double-click a node'),
        ),
        sec(
          'Bones and pins',
          r('Turn one bone (FK)', 'drag a bone'),
          r('Pose the chain (IK)', 'drag the tip', 'Alt + drag a bone'),
          r('Bend with a pin (Select tool, pins shown)', 'drag a pin'),
          r('Move a pin at rest (Pin tool)', 'Alt + drag a pin'),
          r('Bind pins to a bone (Bind tool)', 'click pins', 'click a bone'),
          r('Remove the selected pin', 'Del'),
        ),
      ],
    },
    {
      id: 'animation',
      label: 'Animation',
      sections: [
        sec(
          'Playback',
          r('Play / pause', 'Space'),
          r('Stop and go to the start', 'Shift Space', 'Home'),
          r('Go to the end', 'End'),
          r('Previous frame', ','),
          r('Next frame', '.'),
          r('Previous keyframe', 'J'),
          r('Next keyframe', 'K'),
        ),
        sec(
          'Keyframes',
          r('Select all keyframes (in the timeline)', 'Ctrl A'),
          r('Cut', 'Ctrl X'),
          r('Copy', 'Ctrl C'),
          r('Paste at the playhead', 'Ctrl V'),
          r('Duplicate', 'Ctrl D'),
          r('Delete', 'Del'),
          r('Move one frame (Shift: 10)', '← →'),
          r('Box-select (Shift or Ctrl adds)', 'drag an empty lane'),
          r('Add to or remove from the selection', 'Shift + click'),
          r('Stretch the selection from its other end', 'Alt + drag a key'),
          r('Copy while dragging', 'Ctrl + drag a key'),
          r('Add a keyframe', 'double-click a lane'),
        ),
        sec('Easing', r('Ease in-out', 'F9'), r('Ease in', 'Shift F9'), r('Ease out', 'Ctrl Shift F9')),
        sec('Animate a property', ...anim),
      ],
    },
    {
      id: 'view',
      label: 'View',
      sections: [
        sec(
          'Zoom',
          r('Zoom to 100%', '0'),
          r('Zoom to fit', '1'),
          r('Zoom to the selection', '2'),
          r('Zoom in', 'Ctrl +'),
          r('Zoom out', 'Ctrl -'),
          r('Zoom at the pointer', 'Ctrl + scroll'),
        ),
        sec('Pan', r('Pan the canvas', 'Space + drag', 'middle-drag', 'scroll')),
        sec(
          'Panels',
          r('Zoom the timeline', 'Ctrl + scroll'),
          r('Close or open all inspector sections', '/'),
          r('Open or close the agent', 'Alt A'),
        ),
        sec(
          'Show and hide',
          r('Snapping', 'Alt S'),
          r('Rulers', 'Alt R'),
          r('Guides', 'Alt L'),
          r('Front grid', 'Alt G'),
          r('Bones', 'Alt B'),
          r('Pins', 'Alt P'),
          r('Onion skin', 'Alt O'),
        ),
      ],
    },
  ];
}

function keyHTML(k: string) {
  return /^[a-z]/.test(k) || k.startsWith('+ ')
    ? `<span class="sk-w">${esc(k)}</span>`
    : `<kbd>${esc(keyLabel(k))}</kbd>`;
}
function comboHTML(cb: Combo) {
  return `<span class="sk-combo">${cb.map(keyHTML).join('')}</span>`;
}
function rowHTML([label, combos]: Row, ctx = '') {
  return `<div class="sk-row"><span class="sk-l">${esc(label)}${ctx ? `<span class="sk-ctx">${esc(ctx)}</span>` : ''}</span><span class="sk-keys">${combos.map(comboHTML).join('<span class="sk-or">or</span>')}</span></div>`;
}
const secHTML = (x: Section) =>
  `<section class="sk-sec"><h3>${esc(x.title)}</h3>${x.rows.map(row => rowHTML(row)).join('')}</section>`;

let cur = 'general';
function render(q = '') {
  const body = $('#skBody') as HTMLElement,
    all = tabs(),
    s = q.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>('#skTabs [role=tab]').forEach(b => {
    const on = !s && b.dataset.tab === cur;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on || (!!s && b.dataset.tab === cur) ? 0 : -1;
  });
  if (s) {
    const hits = all.flatMap(t =>
      t.sections.flatMap(x =>
        x.rows
          .filter(([l, cbs]) =>
            (x.title + ' ' + l + ' ' + cbs.map(cb => cb.join(' ')).join(' ')).toLowerCase().includes(s),
          )
          .map(row => ({ row, ctx: `${t.label} · ${x.title}` })),
      ),
    );
    body.innerHTML = hits.length
      ? `<div class="sk-list">${hits.map(h => rowHTML(h.row, h.ctx)).join('')}</div>`
      : `<p class="sk-none">No shortcut matches “${esc(q.trim())}”.</p>`;
    return;
  }
  const t = all.find(x => x.id === cur) || all[0];
  body.innerHTML = `<div class="sk-grid">${t.sections.map(secHTML).join('')}</div>`;
}
export function openShortcuts() {
  const m = $('#mKeys') as HTMLElement;
  if (!m.hidden) return;
  const f = $('#skFind') as HTMLInputElement;
  f.value = '';
  render();
  m.hidden = false;
  f.focus();
}
/** the list as data, for tests */
export const shortcutTabs = tabs;

export function initShortcuts(): void {
  const m = $('#mKeys') as HTMLElement;
  if (!m) return;
  ($('#skTabs') as HTMLElement).innerHTML = tabs()
    .map(
      t =>
        `<button type="button" role="tab" id="sk-${t.id}" data-tab="${t.id}" aria-controls="skBody" aria-selected="${t.id === cur}">${esc(t.label)}</button>`,
    )
    .join('');
  const list = $('#skTabs') as HTMLElement,
    f = $('#skFind') as HTMLInputElement;
  list.addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as Element).closest('[role=tab]') as HTMLElement;
    if (!b) return;
    cur = b.dataset.tab;
    f.value = '';
    render();
  });
  list.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const ids = tabs().map(t => t.id),
      i = ids.indexOf(cur);
    cur = ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
    f.value = '';
    render();
    ($('#sk-' + cur) as HTMLElement).focus();
  });
  f.addEventListener('input', () => render(f.value));
  f.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && f.value) {
      e.stopPropagation();
      f.value = '';
      render();
    }
  });
  $('#bKeys').addEventListener('click', openShortcuts);
}
