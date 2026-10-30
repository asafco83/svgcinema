// SVGcinema — ui/inspector
import { safeLink } from './layer-menu';
import { closeLayerMenu, flip, rotate } from './layer-menu';
import { openSameMenu, sameButton } from './select-same-menu';
import { infoTip } from './info-tip';
import { propOK } from '../core/keyframes';
import {
  TEXT_TOGGLES,
  allPainted,
  commonType,
  isMulti,
  multiEdit,
  multiFields,
  multiKey,
  multiSel,
  multiText,
  textToggleOn,
} from './multi';
import { instanceChip, instanceSection } from './symbols-ui';
import { layerBox } from '../render/mesh';
import { bgPaint, parseBg, setBg } from '../model/background';
import type { Ease, Layer, PathData, PropKey, Vec2 } from '../model/types';
import {
  $,
  EZFAM,
  ICON,
  FONTS,
  H,
  PROPS,
  propLabel,
  propKind,
  isFrozen,
  byId,
  clamp,
  clock,
  clone,
  parseClock,
  esc,
  fmt,
  r2,
  r3,
  xfp,
  valueAt,
  sizeBox,
} from '../core/constants';
import { INSP } from '../core/dom';
import { beginEdit, deleteKeys, setProp, setTool, toggleKey } from '../core/history';
import { convertToPath, morphTo, shapeNodes } from '../core/layer-ops';
import { plainPath } from '../core/plain-path';
import { ASSETS, S, doc, layerById, selLayer, sortTrack } from '../core/state';
import { subdivideAll } from '../geometry/nodes';
import { toast } from '../io/open';
import { fxOf } from '../model/filters';
import { loadLocalFonts, onFontLoad, pickWeight, webFont } from '../render/fonts';
import { descendants, kids } from '../model/tree';
import { fit, frame, renderStage } from '../render/stage';
import { MESH_DEFAULT, MESH_MAX, MESH_MIN } from '../model/mesh';
import { drawOrder, rigArtwork } from '../model/draw-order';
import { addChildBone, boneTipL, shiftChildBones } from '../tools/bones';
import { setAnchor } from '../tools/edit-tools';
import { align, alignBar, motionPick, selectionBox, setMotionPath, setSelectionBox } from './align';
import { booleanOp } from '../core/booleans';
import { openPicker, showSwatch, toValue, rgbaOf, isNone } from './color-picker';
import {
  appearanceSection,
  filtersSection,
  nodeSection,
  shapeSection,
  paintSection,
  propsChange,
  propsClick,
  propsInput,
  propsToggle,
  refreshProps,
  rotFromFields,
  textAppearanceSection,
  textSection,
  transformSection,
  LINK_IC,
  pinsSection,
  sizeRow,
  szLocked,
} from './props-panel';
import { applyEase, bezOf, drawEz, easeFam, famName, keyPanel, parseBez, sameEase } from './easing';
import { deleteSel, groupSel, moveLayers, ungroup } from './layers-panel';
import { dragWin } from './timeline';
import { poseRowFor, rigGaps, rigPopover } from '../tools/rig';
import { removeAllPins, removePin } from '../tools/pins';
import { drawOverlay } from '../render/overlay';
import { textDir } from '../render/text-layout';

export function num(f: string, lab: string, unit?: string) {
  return `<label class="nf"><span data-scrub="${f}">${lab}</span><input id="i-${f.replace(/[:.]/g, '_')}" data-f="${f}" inputmode="decimal" spellcheck="false" aria-label="${lab}">${unit ? `<em>${unit}</em>` : ''}</label>`;
}
export function gnum(g: string, lab: string, unit?: string) {
  return `<label class="nf"><span>${lab}</span><input id="g-${g}" data-g="${g}" inputmode="decimal" spellcheck="false" aria-label="${lab}">${unit ? `<em>${unit}</em>` : ''}</label>`;
}
/** A color swatch that opens the color picker. `types`: which paints it offers. */
const EYE = ICON.eyedropper;
/** the eyedropper button next to a swatch (only in browsers that have one) */
export function eyeBtn(attrs: string) {
  return typeof (window as any).EyeDropper === 'function'
    ? `<button class="btn ib" ${attrs} title="Pick a color from the screen" aria-label="Pick a color from the screen">${EYE}</button>`
    : '';
}
/** A color swatch that opens the color window, an eyedropper and the value as text.
 *  `types`: which paints the window offers. */
export function colf(f: string, types = 'solid') {
  const id = f.replace(/\./g, '_');
  return `<div class="cf"><div class="cbox"><button class="pswatch" data-paint="${f}" data-ptypes="${types}" id="c-${id}" aria-haspopup="dialog" aria-expanded="false" aria-label="Color"><i></i></button><input class="txt mono" data-f="${f}" id="t-${id}" spellcheck="false" aria-label="Color value"></div>${eyeBtn(`data-act="pick" data-k="${f}"`)}</div>`;
}
export function krow(k: string, label: string, body: string) {
  return `<div class="row"><button class="kb" data-kb="${k}" aria-label="Keyframe ${label}" title="Add / remove keyframe at playhead"></button><span class="rl">${label}</span><div class="rf">${body}</div></div>`;
}
const MOTION_TIP =
  'Drag the path on the canvas to curve it; drag its handles to fine-tune (Alt moves one handle alone); double-click a segment to straighten it.';
const BONE_TIP =
  'Drag a bone to rotate it (forward kinematics). Drag its tip, or Alt+drag the bone, to pull the chain into place (inverse kinematics). The Edit bone tool (E) changes the rest pose; the Scale bone tool (S) scales along or across the bone. Attach artwork by dragging layers onto the bone in the Layers panel, with the Bind tool, or with “Attach to bone” on the layer.';
/** Hyperlink (also Element › Hyperlink…): clicking the layer in the exported SVG opens it. Empty: no link. */
function linkSection(l: Layer) {
  const k = l.link;
  return `<section class="sec" id="linkSec"><h3>Hyperlink${infoTip('Clicking the layer in the exported SVG opens the link. Use a web address (https://…), mailto:, tel: or #anchor; leave it empty for no link.', 'hyperlinks')}</h3>
    ${nrow('Link', `<input class="txt" id="lk-url" placeholder="https://…" spellcheck="false" inputmode="url" value="${esc((k && k.url) || '')}" aria-label="Link address">`)}
    ${k ? nrow('Opens', `<select class="sel" id="lk-target" aria-label="Opens in"><option value="_blank">New tab</option><option value="_self"${k.target === '_self' ? ' selected' : ''}>Same tab</option></select>`) : ''}</section>`;
}
function setLink(l: Layer) {
  const u = $('#lk-url') as HTMLInputElement,
    tg = $('#lk-target') as HTMLSelectElement | null,
    url = safeLink(u.value);
  if (url === null) {
    toast('Use a web address (https://…), mailto:, tel: or #anchor.');
    u.value = (l.link && l.link.url) || '';
    return;
  }
  const target: '_blank' | '_self' = tg && tg.value === '_self' ? '_self' : '_blank';
  if ((l.link ? l.link.url : '') === url && (!l.link || l.link.target === target)) return;
  const ed = beginEdit();
  if (url) l.link = { url, target };
  else delete l.link;
  ed.end({ insp: true });
}
/** What an imported element is (the importer kept it as it was) and what can still change. */
function rawWarning(l: Layer) {
  const m = /^\s*<\s*([\w:-]+)/.exec(l.geo.markup || ''),
    tag = m ? m[1] : '',
    what = tag === 'image' ? 'a linked image' : tag === 'text' ? 'text on a path' : tag ? `a ${tag}` : 'this element';
  return `<div class="xwarn raw-warn" role="note"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3l8 14H2z"/><path d="M10 8.5v3.5M10 14.6v.1"/></svg><span><b>Kept as imported: not editable.</b> SVGcinema can’t convert this element (here ${esc(what)}), so its shape, fill and stroke stay as they are. It can still move, turn, scale and fade; Size stretches it to the box, like Scale.</span></div>`;
}
export function nrow(label: string, body: string) {
  return `<div class="row nk"><span class="rl">${label}</span><div class="rf">${body}</div></div>`;
}
export function kb(n: number) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}
function renderInspector0() {
  const l = selLayer();
  if (!l) {
    INSP.innerHTML = docPanel();
    applyCollapse();
    refreshDocFields();
    return;
  }
  const ms = multiSel();
  if (ms.length) {
    // several layers: only what they all have, edited on all of them (ui/multi)
    let m = `<div class="insp-head"><span class="ih-name ih-multi">${ms.length} layers</span>${sameButton(l, true)}<span class="chip">${commonType(ms)}</span></div>`;
    m += alignBar();
    const sbn = (f: string, lab: string) =>
        `<label class="nf"><span>${lab}</span><input id="sb-${f}" data-sb="${f}" inputmode="decimal" spellcheck="false" aria-label="Selection ${lab}"></label>`,
      keep = S.sbLock !== false;
    m += `<section class="sec"><h3>${ms.length} layers selected${infoTip('The box around the whole selection. Moving it moves every layer; resizing it scales them all from its corner. Each change keys the layers that are animated.', 'the selection box')}</h3><p>Fields show the value the layers share, or “Mixed”. A change applies to all of them.</p>${nrow('Position', sbn('x', 'X') + sbn('y', 'Y'))}${nrow(
      'Size',
      sbn('w', 'W') +
        sbn('h', 'H') +
        `<button class="btn ib tg${keep ? ' on' : ''}" data-act="sblock" aria-pressed="${keep}" title="Keep proportions" aria-label="Keep proportions">${LINK_IC}</button>`,
    )}<div class="btns"><button class="btn" data-act="grp">Group them</button><button class="btn danger" data-act="delsel">Delete all</button></div></section>`;
    m += transformSection(l);
    // Text appearance when the selection has text layers (shapes beside them too): it edits the text layers
    const tx = ms.filter(x => x.type === 'text');
    if (tx.length) m += textAppearanceSection(tx.includes(l) ? l : tx[0]);
    if (allPainted(ms)) m += paintSection(l);
    m += appearanceSection(allPainted(ms) ? l : ({ ...l, type: 'group' } as Layer));
    INSP.innerHTML = m;
    applyCollapse();
    refreshInspector(true);
    return;
  }
  let h = `<div class="insp-head"><input class="txt ih-name" id="ln" data-name value="${esc(l.name)}" spellcheck="false" aria-label="Layer name">${sameButton(l)}<span class="chip${l.sym ? ' sym' : ''}">${l.sym ? instanceChip(l) || l.type : l.type}</span></div>`;
  h += alignBar();
  // the order: instance, keyframe easing, the layer's own section (its shape, text, image…), then the
  // properties every layer shares, and Morph and Rig last
  h += instanceSection(l);
  const painted = ['rect', 'ellipse', 'path', 'text'].includes(l.type);
  h += typeSection(l);
  h += transformSection(l);
  h += pinsSection(l);
  const curve = l.t.pos && l.t.pos.length > 1,
    pick = l.type === 'bone' ? '' : motionPick(l);
  if (curve || pick)
    h += `<section class="sec"><h3>Motion path${infoTip(MOTION_TIP, 'motion paths')}</h3>${pick ? nrow('Follow', pick) : ''}
    ${curve ? `<label class="check"><input type="checkbox" data-flag="sm" id="fl-sm" ${l.sm ? 'checked' : ''}> Smooth path through keyframes</label><label class="check"><input type="checkbox" data-flag="ev" id="fl-ev" ${l.ev ? 'checked' : ''}> Even speed along curves</label>${nodeSection(l)}` : ''}</section>`;
  if (l.type === 'text') h += textAppearanceSection(l);
  if (painted) h += paintSection(l);
  if (l.type !== 'bone') h += appearanceSection(l) + filtersSection(l);
  h += morphSection(l);
  if (l.type !== 'bone') {
    const bones = doc.layers.filter(b => b.type === 'bone' && !descendants(l).includes(b));
    if (bones.length) {
      const pb = l.parent && layerById(l.parent),
        cur = pb && pb.type === 'bone' ? pb.id : '';
      h += `<section class="sec"><h3>Rig</h3>${nrow('Attach to bone', `<select class="sel" id="attachBone"><option value="">Not attached</option>${bones.map(b => `<option value="${b.id}"${b.id === cur ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select>`)}</section>`;
    }
    h += linkSection(l);
  }
  INSP.innerHTML = h;
  applyCollapse();
  refreshInspector(true);
  drawEz();
}
/** The layer's own section: its shape (with its size), text, image, group, imported element or bone. */
function typeSection(l: Layer) {
  const G = l.geo;
  if (l.type === 'text') return textSection(l);
  if (l.type === 'rect') return shapeSection(l);
  // a path: polygon / star, line, or any other path (only its size)
  if (l.type === 'path') return shapeSection(l) || `<section class="sec"><h3>Path</h3>${sizeRow(l)}</section>`;
  if (l.type === 'ellipse')
    return `<section class="sec"><h3>Ellipse</h3>${nrow('Center', gnum('cx', 'X') + gnum('cy', 'Y'))}${sizeRow(l)}<div class="btns"><button class="btn" data-act="topath">Convert to path</button></div></section>`;
  if (l.type === 'group') {
    const n = kids(l.id).length;
    return `<section class="sec"><h3>Group <small>${n} layer${n === 1 ? '' : 's'} inside</small>${infoTip('Keyframes on a group move, turn, scale or fade everything inside it together. Layers inside keep their own keyframes.', 'groups')}</h3>${
      l.mask === 'mask'
        ? nrow(
            'Mask by' +
              infoTip(
                'Opacity: the mask shows the layers where it is opaque. Brightness: where it is light (white shows, black hides).',
                'Mask by',
              ),
            `<select class="sel" data-ly="mm" id="ly-mm" aria-label="Mask mode"><option value="">Opacity</option><option value="lum"${l.mm === 'lum' ? ' selected' : ''}>Brightness</option></select>`,
          )
        : ''
    }<div class="btns"><button class="btn" data-act="ungroup">Ungroup</button></div></section>`;
  }
  if (l.type === 'raw')
    return `<section class="sec"><h3>Imported element</h3>${sizeBox(l) ? sizeRow(l) : ''}${rawWarning(l)}</section>`;
  if (l.type === 'image') {
    const a = ASSETS[G.asset];
    return `<section class="sec"><h3>Image <span class="chip">${a ? esc((a.mime || '').replace('image/', '').replace('x-icon', 'ico')) : 'missing'}</span></h3>
      ${a ? `<p>${esc(a.name)} · ${a.w}×${a.h}px · ${kb(a.size || 0)}</p>` : '<p>The image file for this layer is missing. Add it again from the Assets tab.</p>'}
      ${nrow('Position', gnum('x', 'X') + gnum('y', 'Y'))}${sizeRow(l)}
      ${a ? '<div class="btns"><button class="btn" data-act="natural">Original size</button></div>' : ''}</section>`;
  }
  if (l.type === 'bone') {
    const n = kids(l.id).length,
      pb0 = l.parent && layerById(l.parent);
    return `<section class="sec"><h3>Bone <small>${n} attached</small>${infoTip(BONE_TIP, 'bones')}</h3>${nrow('Length', gnum('len', 'L'))}${nrow('Rest angle', gnum('ang', '∠', '°'))}
      <label class="check"><input type="checkbox" data-flag="pin" id="fl-pin" ${l.pin ? 'checked' : ''}> Pin: IK stops at this bone</label>
      <label class="check"><input type="checkbox" data-flag="lim" id="fl-lim" ${l.lim ? 'checked' : ''}> Limit rotation</label>
      ${poseRowFor(l) ? `<label class="check sub-check"><input type="checkbox" data-flag="kr" id="fl-kr" ${l.kr !== false ? 'checked' : ''}><span>Key whole rig${infoTip('Moving any bone of this rig keys every bone, so each pose is stored whole. Turn off for overlapping action.', 'Key whole rig')}</span></label>` : ''}
      ${poseRowFor(l) ? drawOrderBlock(l) : ''}
      ${pb0 && pb0.type === 'bone' ? `<label class="check sub-check"><input type="checkbox" data-flag="inh" id="fl-inh" ${l.inh ? 'checked' : ''}><span>Inherit scale${infoTip('Off: this bone follows the parent’s tip without being stretched by its scale.', 'Inherit scale')}</span></label>` : ''}
      ${l.lim ? nrow('Range', `<label class="nf"><span>min</span><input id="bl-min" data-bl="lmin" inputmode="decimal" value="${fmt(l.lmin != null ? l.lmin : -90)}"><em>°</em></label><label class="nf"><span>max</span><input id="bl-max" data-bl="lmax" inputmode="decimal" value="${fmt(l.lmax != null ? l.lmax : 90)}"><em>°</em></label>`) : ''}
      <div class="btns"><button class="btn" data-act="childbone">Add child bone</button></div></section>`;
  }
  return '';
}
/** Morph: on paths, and on rectangles and ellipses (they become paths when they start morphing). */
function morphSection(l: Layer) {
  if (l.type !== 'path' && l.type !== 'rect' && l.type !== 'ellipse') return '';
  const others = doc.layers.filter(o => o !== l && ['path', 'rect', 'ellipse'].includes(o.type)),
    nodes = l.type === 'path' ? (H.get(l, 'd', S.time) as PathData) : shapeNodes(l),
    cnt = (nodes || []).reduce((s, p) => s + p.n.length, 0),
    box = l.type !== 'path';
  const tip =
    'Add a Morph keyframe, move the playhead, then edit nodes. The shape blends between keyframes.' +
    (box
      ? ` Editing the nodes, or adding Morph keyframes, turns this ${l.type === 'rect' ? 'rectangle into a plain path. Radius keyframes are kept as Morph keyframes.' : 'ellipse into a plain path.'}`
      : '');
  return `<section class="sec"><h3>Morph <small>${cnt} nodes</small>${infoTip(tip, 'morphing')}</h3>
      ${krow('d', 'Morph', `<button class="btn" data-act="nodes" style="flex:1">${S.tool === 'node' ? 'Done editing' : 'Edit nodes'}</button>`)}
      ${nrow('Morph into', `<select class="sel" id="morphTo" aria-label="Morph into another shape"><option value="">Choose a shape…</option>${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>`)}
      <div class="btns"><button class="btn" data-act="subdiv">Add nodes (subdivide)</button></div></section>`;
}
/** Fired after the Inspector is drawn again, which happens whenever the selection changes (the agent's
 *  composer shows what is selected). */
export const INSPECTOR_EVENT = 'svgcinema:inspector';
export function renderInspector() {
  renderInspector0();
  document.dispatchEvent(new Event(INSPECTOR_EVENT));
}

/* ---------- collapsible sections ---------- */

const CLOSED_STORE = 'svgcinema:inspClosed';
let closedSecs: Set<string> | null = null;
function closedSet(): Set<string> {
  if (!closedSecs) {
    closedSecs = new Set();
    try {
      const v = JSON.parse(localStorage.getItem(CLOSED_STORE) || '[]');
      if (Array.isArray(v)) v.forEach(k => typeof k === 'string' && closedSecs.add(k));
    } catch (_) {}
  }
  return closedSecs;
}
/** A section's title: the heading's first text, without counts or buttons. */
function secTitle(h3: Element) {
  return (h3.childNodes[0]?.textContent || '').trim();
}
const CHEV =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>';
/** Give each section heading a collapse toggle and restore the sections the user closed. */
export function applyCollapse() {
  const closed = closedSet();
  INSP.querySelectorAll('.sec > h3').forEach((h3: Element) => {
    const t = secTitle(h3),
      shut = closed.has(t);
    h3.parentElement.classList.toggle('closed', shut);
    h3.insertAdjacentHTML(
      'beforeend',
      `<button class="sec-tg" data-sectg aria-expanded="${!shut}" aria-label="${shut ? 'Expand' : 'Collapse'} ${esc(t)}" title="${shut ? 'Show' : 'Hide'} this section">${CHEV}</button>`,
    );
  });
}
/** Show a property's row in the Inspector: open its section if it is closed, scroll it into view and
 *  flash it (after a track was added or picked in the timeline). */
export function focusProp(k: string) {
  requestAnimationFrame(() => {
    const kb = INSP.querySelector(`[data-kb="${CSS.escape(k)}"]`) as HTMLElement | null,
      row = kb && (kb.closest('.row') as HTMLElement | null);
    if (!row) return;
    const sec = row.closest('.sec');
    if (sec && sec.classList.contains('closed')) {
      const h3 = sec.querySelector(':scope > h3');
      if (h3) {
        closedSet().delete(secTitle(h3));
        try {
          localStorage.setItem(CLOSED_STORE, JSON.stringify([...closedSet()]));
        } catch (_) {}
      }
      sec.classList.remove('closed');
      const b = sec.querySelector('.sec-tg');
      if (b) b.setAttribute('aria-expanded', 'true');
    }
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1200);
  });
}
/** "/": closes every section of the inspector, or opens them all when they are all closed already. */
export function toggleAllSections() {
  const hs = [...INSP.querySelectorAll('.sec > h3')];
  if (!hs.length) return false;
  const closed = closedSet(),
    titles = hs.map(secTitle),
    shut = titles.some(t => !closed.has(t));
  titles.forEach(t => (shut ? closed.add(t) : closed.delete(t)));
  try {
    localStorage.setItem(CLOSED_STORE, JSON.stringify([...closed]));
  } catch (_) {}
  hs.forEach((h3: Element) => {
    h3.parentElement.classList.toggle('closed', shut);
    const b = h3.querySelector('.sec-tg'),
      t = secTitle(h3);
    if (b) {
      b.setAttribute('aria-expanded', String(!shut));
      b.setAttribute('aria-label', `${shut ? 'Expand' : 'Collapse'} ${t}`);
      b.setAttribute('title', `${shut ? 'Show' : 'Hide'} this section`);
    }
  });
  return true;
}
function toggleSection(h3: Element) {
  const t = secTitle(h3),
    closed = closedSet(),
    shut = !closed.has(t);
  if (shut) closed.add(t);
  else closed.delete(t);
  try {
    localStorage.setItem(CLOSED_STORE, JSON.stringify([...closed]));
  } catch (_) {}
  h3.parentElement.classList.toggle('closed', shut);
  const b = h3.querySelector('.sec-tg');
  if (b) {
    b.setAttribute('aria-expanded', String(!shut));
    b.setAttribute('aria-label', `${shut ? 'Expand' : 'Collapse'} ${t}`);
    b.setAttribute('title', `${shut ? 'Show' : 'Hide'} this section`);
  }
}
/** the document background as a paint value ('none' when transparent) */
function docBgValue() {
  const bp = bgPaint(doc);
  if (!doc.bg || bp.alpha <= 0) return 'none';
  const q = rgbaOf(bp.color);
  return toValue([q[0], q[1], q[2], bp.alpha]);
}
/** Open the color picker for a swatch: a layer's fill / stroke / filter color, or the background. */
function openPaint(btn: HTMLElement, l: Layer | null) {
  const begin = () => {
      if (!S.colorEd) S.colorEd = beginEdit();
    },
    done = () => {
      const ed = S.colorEd;
      S.colorEd = null;
      if (ed) ed.end({ insp: true });
    };
  if (btn.dataset.docpaint !== undefined)
    return openPicker(btn, {
      label: 'Background',
      types: ['none', 'solid'],
      get: docBgValue,
      set(v) {
        begin();
        const q = rgbaOf(isNone(v) ? bgPaint(doc).color : v);
        setBg(doc, { color: toValue([q[0], q[1], q[2], 1]), alpha: isNone(v) ? 0 : q[3] });
        renderStage();
        frame();
      },
      done,
    });
  if (!l) return;
  const k = btn.dataset.paint as PropKey,
    label = k === 'fill' ? 'Fill' : k === 'stk' ? 'Stroke' : propLabel(l, k);
  openPicker(btn, {
    label,
    layer: l.id,
    key: k,
    types: (btn.dataset.ptypes || 'solid').split(',') as any,
    get: () => valueAt(l, k, S.time),
    set(v) {
      begin();
      // several layers: the color goes on all of them
      (multiSel().length ? multiSel().filter(x => propOK(x, k as PropKey)) : [l]).forEach(x => {
        setProp(x, k, v);
        // a stroke color needs a width to be seen
        if (k === 'stk' && !isNone(v) && !(valueAt(x, 'sw', S.time) > 0)) setProp(x, 'sw', 2);
      });
      renderStage();
      frame();
    },
    done,
  });
}
export function docPanel() {
  return `<section class="sec"><h3>Document</h3>
    ${nrow('Canvas', `<label class="nf"><span>W</span><input id="d-w" data-doc="w" inputmode="numeric"></label><label class="nf"><span>H</span><input id="d-h" data-doc="h" inputmode="numeric"></label>`)}
    ${nrow('Background', `<div class="cf"><div class="cbox"><button class="pswatch" id="d-bgc" data-docpaint aria-haspopup="dialog" aria-expanded="false" aria-label="Background color"><i></i></button><input class="txt mono" id="d-bg" data-doc="bg" placeholder="none" spellcheck="false" aria-label="Background value"></div>${eyeBtn('data-docpick')}</div>`)}
    ${nrow('Length', `<label class="nf"><span>t</span><input id="d-dur" data-doc="dur" inputmode="decimal"><em>s</em></label>`)}
    ${nrow('Repeat', `<select class="sel" id="d-it" data-doc="it"><option value="0">Loop forever</option><option value="1">Play once</option><option value="2">2 times</option><option value="3">3 times</option><option value="5">5 times</option></select>`)}
    ${nrow('Direction', `<select class="sel" id="d-dir" data-doc="dir"><option value="normal">Normal</option><option value="alternate">Alternate</option><option value="reverse">Reverse</option><option value="alternate-reverse">Reverse, then alternate</option></select>`)}</section>
    <section class="sec"><h3>How to animate</h3><ol class="tip">
      <li><b>Bring in artwork.</b> Draw, paste Figma's “Copy as SVG”, or drop SVG and image files on the canvas.</li>
      <li><b>Organize layers.</b> Group and nest them in the Layers panel by dragging.</li>
      <li><b>Start animating a property</b> with ◆ beside it (or Animate in the Layers panel). Then move the playhead and change it: every change adds a keyframe there.</li>
      <li><b>Shape the timing.</b> Click a keyframe or the line between two keyframes to pick an easing or draw a custom curve.</li>
      <li><b>Export</b> one animated .svg with a JavaScript player (built in or shared) or pure CSS. Images are embedded inside it.</li></ol></section>`;
}
export function refreshDocFields() {
  const set = (id: string, v: string | number) => {
    const e = byId(id);
    if (e && e !== document.activeElement) e.value = v;
  };
  set('d-w', doc.w);
  set('d-h', doc.h);
  const bp = bgPaint(doc);
  const bgc = byId('d-bgc');
  if (bgc) showSwatch(bgc, docBgValue());
  set('d-bg', docBgValue());
  set('d-dur', fmt(doc.dur));
  set('d-it', String(doc.it || 0));
  set('d-dir', doc.dir);
  set('tDur', clock(doc.dur));
}
const GDEF: Record<string, number> = { ls: 0, lh: 1.2 };
export function refreshInspector(full?: boolean) {
  const td = $('#tDur');
  if (td !== document.activeElement) td.value = clock(doc.dur);
  const l = selLayer();
  if (!l) return;
  const sbIn = INSP.querySelectorAll('[data-sb]');
  if (sbIn.length) {
    const B = selectionBox();
    sbIn.forEach((inp: HTMLInputElement) => {
      if (inp !== document.activeElement) inp.value = B ? fmt(B[inp.dataset.sb as 'x' | 'y' | 'w' | 'h']) : '';
    });
  }
  INSP.querySelectorAll('[data-paint]').forEach((b: HTMLElement) => showSwatch(b, valueAt(l, b.dataset.paint, S.time)));
  INSP.querySelectorAll('[data-f]').forEach((inp: HTMLInputElement) => {
    if (inp === document.activeElement) return;
    const [k, i, m] = inp.dataset.f.split(':') as [PropKey, string, string];
    let v = valueAt(l, k, S.time);
    if (i !== undefined && i !== '') v = v ? v[+i] : 0;
    // Size shows the size you see: the shape's own size times its scale
    if (k === 'sz' && i !== undefined && i !== '') v = v * sizeScale(l)[+i];
    if (propKind(l, k) === 'c') {
      if (inp.type === 'color') {
        inp.value = toHex(v) || '#000000';
        swatch(inp, v);
      } else inp.value = H.isG(v) ? (v.g === 'rad' ? 'Radial' : 'Linear') : v == null ? '' : v;
    } else inp.value = fmt(m ? v * +m : v);
  });
  INSP.querySelectorAll('[data-kb]').forEach((b: HTMLElement) => {
    const tr = l.t[b.dataset.kb],
      has = !!(tr && tr.length),
      fz = isFrozen(l, b.dataset.kb);
    b.classList.toggle('fz', fz);
    b.title = fz ? 'Frozen in the timeline: unfreeze it to use or add keyframes' : 'Add / remove keyframe at playhead';
    b.classList.toggle('has', has);
    b.classList.toggle('on', has && tr.some(q => Math.abs(q[0] - S.time) < 0.005));
  });
  if (full)
    INSP.querySelectorAll('input[data-g]').forEach((inp: HTMLInputElement) => {
      inp.value = fmt(l.geo[inp.dataset.g] ?? GDEF[inp.dataset.g]);
    });
  refreshProps(l);
  INSP.querySelectorAll('[data-o]').forEach((inp: HTMLInputElement) => {
    if (full || inp !== document.activeElement) inp.value = fmt((l.o || [0, 0])[+inp.dataset.o]);
  });
  const ab = INSP.querySelectorAll('[data-anchor]');
  if (ab.length) {
    const g = byId('e-' + l.id);
    let bb = null;
    try {
      bb = g && (layerBox(l) || g.getBBox());
    } catch (e) {}
    ab.forEach((btn: HTMLElement) => {
      const [u, v] = btn.dataset.anchor.split(',').map(Number);
      btn.classList.toggle(
        'on',
        !!bb &&
          !!l.o &&
          Math.abs(bb.x + bb.width * u - H.get(l, 'org', S.time)[0]) < 0.6 &&
          Math.abs(bb.y + bb.height * v - H.get(l, 'org', S.time)[1]) < 0.6,
      );
    });
  }
  multiFields();
}
/** Show "no color" on a color swatch (a checkerboard with a red line, like other design apps), and
 *  let the checkerboard show through partly transparent colors. */
export function swatch(inp: HTMLInputElement, v: unknown, alpha?: number) {
  const box = inp.parentElement;
  if (!box || !box.classList.contains('swt')) return;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '',
    q = s ? H.pc(s) : null,
    a = alpha != null ? alpha : q ? q[3] : 1,
    none = !s || s === 'none' || s === 'transparent' || a <= 0;
  box.classList.toggle('none', none);
  inp.style.opacity = none ? '0' : a < 1 ? String(Math.max(0.15, a)) : '';
  box.title = none ? 'No color' : '';
}
export function toHex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return '#' + m[1].replace(/./g, '$&$&').toLowerCase();
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) return '#' + m[1].toLowerCase();
  m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (m) {
    const a = m[1].split(/[\s,\/]+/).map(parseFloat);
    return (
      '#' +
      a
        .slice(0, 3)
        .map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'))
        .join('')
    );
  }
  const named: Record<string, string> = {
    white: '#ffffff',
    black: '#000000',
    red: '#ff0000',
    blue: '#0000ff',
    green: '#008000',
    yellow: '#ffff00',
    orange: '#ffa500',
    gray: '#808080',
    grey: '#808080',
  };
  return named[c.toLowerCase()] || null;
}
export function parseField(l: Layer, inp: HTMLInputElement): [PropKey, any] | null {
  const [k, i, m] = inp.dataset.f.split(':') as [PropKey, string, string];
  const kind = propKind(l, k);
  let v: any;
  if (inp.dataset.rt) return [k, r3(rotFromFields())];
  if (kind === 'c') {
    v = inp.value.trim() || 'none';
    // the field names the gradient type: leave the gradient alone
    if (/^(linear|radial)$/i.test(v) && H.isG(valueAt(l, k, S.time))) return null;
  } else {
    v = parseFloat(inp.value);
    if (!isFinite(v)) return null;
    if (m) v /= +m;
    if (k === 'op' || k === 'fo' || k === 'so') v = clamp(v, 0, 1);
    if (k.startsWith('fx.')) {
      const p = fxOf(l, k);
      if (p && p.param.min != null) v = Math.max(p.param.min, v);
      if (p && p.param.scale === 100) v = Math.min(1, v);
    }
    if (k === 'sw' || k === 'sz') v = Math.max(0, v);
    // Size fields show the size times the scale: back to the shape's own size
    if (k === 'sz' && i !== undefined && i !== '') v = v / sizeScale(l)[+i];
    v = r3(v);
  }
  if (i !== undefined && i !== '') {
    const cur = clone(valueAt(l, k, S.time)),
      j = +i,
      o = 1 - j;
    if (((k === 'scl' && S.sclLock) || (k === 'sz' && szLocked(l))) && cur[j]) cur[o] = r3((cur[o] * v) / cur[j]);
    cur[j] = v;
    v = cur;
  }
  return [k, v];
}
/** a field's shown value on a layer (as refreshInspector writes it) */
function fieldValue(l: Layer, f: string) {
  const [k, i, m] = f.split(':');
  let v = valueAt(l, k, S.time);
  if (i !== undefined && i !== '') v = v ? v[+i] : 0;
  if (k === 'sz' && i !== undefined && i !== '') v = v * sizeScale(l)[+i];
  return m ? v * +m : v;
}
/** the scale Size fields are shown at (|scale|, never 0) */
export function sizeScale(l: Layer): number[] {
  const s = valueAt(l, 'scl', S.time) || [1, 1];
  return [0, 1].map(j => (Math.abs(s[j]) > 1e-6 ? Math.abs(s[j]) : 1));
}
export function setField(l: Layer, k: PropKey, v: any) {
  return k === 'org' ? reOrigin(l, v) : setProp(l, k, v);
}
export function reOrigin(l: Layer, o: number[]) {
  const old = H.get(l, 'org', S.time) || [0, 0],
    c = H.comp(l, S.time),
    rad = (c.r * Math.PI) / 180,
    d0 = o[0] - old[0],
    d1 = o[1] - old[1];
  const mx = c.sx * d0,
    my = c.sy * d1,
    rx = mx * Math.cos(rad) - my * Math.sin(rad),
    ry = mx * Math.sin(rad) + my * Math.cos(rad);
  const fix = [rx - d0, ry - d1],
    shift = (v: number[]): Vec2 => [r2(v[0] + fix[0]), r2(v[1] + fix[1])];
  if (l.t.org && l.t.org.length) {
    setProp(l, 'org', [r2(o[0]), r2(o[1])]);
    setProp(l, 'pos', shift(H.get(l, 'pos', S.time)));
    return;
  }
  if (l.t.pos && l.t.pos.length) l.t.pos.forEach(q => (q[1] = shift(q[1])));
  else l.b.pos = shift(l.b.pos);
  l.o = [r2(o[0]), r2(o[1])];
}
export function docField(t: HTMLInputElement) {
  const k = t.dataset.doc as 'w' | 'h' | 'dur' | string,
    ed = beginEdit();
  if (k === 'w' || k === 'h') {
    const v = parseInt(t.value);
    if (v > 0) doc[k as 'w' | 'h'] = Math.min(8000, v);
  } else if (k === 'dur') {
    const v = parseClock(t.value);
    if (v > 0) {
      doc.dur = r3(clamp(v, 0.1, 600));
      S.time = Math.min(S.time, doc.dur);
    }
  } else if (k === 'bg') {
    setBg(doc, parseBg(t.value, bgPaint(doc)));
  } else if (k === 'bgA') {
    const v = parseFloat(t.value);
    if (isFinite(v)) {
      setBg(doc, { color: bgPaint(doc).color, alpha: clamp(v, 0, 100) / 100 });
    }
  } else if (k === 'it') doc.it = parseInt(t.value) || 0;
  else if (k === 'dir') doc.dir = t.value;
  ed.end();
  refreshDocFields();
  if (k === 'w' || k === 'h') fit();
}

export function init(): void {
  // text depends on font metrics: redraw once a web font arrives
  onFontLoad(() => {
    renderStage();
    frame();
    if (selLayer()) refreshInspector(true);
  });
  INSP.addEventListener('input', (e: Event) => {
    const t = e.target as HTMLInputElement,
      l = selLayer();
    if (l && isMulti() && t.dataset.range === 'op') {
      multiSel().forEach(t2 => propsInput(t, t2));
      return frame();
    }
    if (l && propsInput(t, l)) return frame();
    if (l && t.dataset.preach !== undefined) {
      // Reach: live while dragging the slider, one undo step on release (closed on change)
      if (!S.colorEd) S.colorEd = beginEdit();
      l.reach = clamp(+t.value || 100, 20, 400);
      const v = byId('pinReachV');
      if (v) v.textContent = fmt(l.reach) + ' %';
      frame();
      return;
    }
    if (l && t.dataset.pmesh !== undefined && l.mesh) {
      // Mesh density: rebuilt while dragging the slider, one undo step on release (closed on change)
      if (!S.colorEd) S.colorEd = beginEdit();
      l.mesh.n = clamp(Math.round(+t.value || MESH_DEFAULT), MESH_MIN, MESH_MAX);
      renderStage();
      const v = byId('pinMeshV');
      if (v) v.textContent = l.mesh.t.length + ' triangles';
      frame();
      return;
    }
    if (l && t.dataset.g === 'text') {
      // type in the panel and the canvas follows; one undo step per edit (closed on change)
      if (!S.colorEd) S.colorEd = beginEdit();
      l.geo.text = t.value;
      renderStage();
      frame();
      return;
    }
    if (t.dataset.col !== undefined && l) {
      swatch(t, t.value);
      if (!S.colorEd) S.colorEd = beginEdit();
      const r = parseField(l, t);
      if (r) {
        setProp(l, r[0], r[1]);
        frame();
      }
    }
    if (t.id === 'd-bgc') {
      if (!S.colorEd) S.colorEd = beginEdit();
      const cur = bgPaint(doc);
      setBg(doc, { color: t.value, alpha: cur.alpha > 0 ? cur.alpha : 1 });
      refreshDocFields();
      renderStage();
      frame();
    }
  });
  INSP.addEventListener('change', (e: Event) => {
    const t = e.target as HTMLInputElement,
      l = selLayer();
    if (S.colorEd && t.dataset.g === 'text' && l) {
      const ed = S.colorEd;
      S.colorEd = null;
      l.geo.text = t.value;
      ed.end({ insp: true });
      return;
    }
    if (S.colorEd && (t.dataset.col !== undefined || t.dataset.range !== undefined || t.id === 'd-bgc')) {
      const ed = S.colorEd;
      S.colorEd = null;
      ed.end();
      return;
    }
    if (t.dataset.doc !== undefined) return docField(t);
    if (!l) return;
    if (t.dataset.sb) {
      const v = parseFloat(t.value);
      if (isFinite(v)) setSelectionBox(t.dataset.sb as 'x' | 'y' | 'w' | 'h', v, S.sbLock !== false);
      else refreshInspector();
      return;
    }
    // Text appearance with several layers selected: the text layers' style, size and spacing
    const tx = isMulti() ? multiText() : [];
    if (tx.length && t.dataset.txSel) {
      multiEdit(t2 => propsChange(t, t2), tx);
      return;
    }
    if (tx.length && t.dataset.fname !== undefined) {
      const v = t.value.trim().replace(/["';<>]/g, '');
      if (v) multiEdit(t2 => (t2.geo.family = v), tx);
      return;
    }
    if (tx.length && ['size', 'ls', 'ww', 'lh'].includes(t.dataset.g)) {
      const g = t.dataset.g,
        v = parseFloat(t.value);
      if (!isFinite(v)) return refreshInspector(true);
      const nv = g === 'lh' ? clamp(v, 0.5, 5) : g === 'ww' ? Math.max(1, v) : g === 'size' ? Math.max(0, v) : v;
      multiEdit(t2 => (t2.geo[g] = nv), tx);
      return;
    }
    if (isMulti() && (t.dataset.x !== undefined || t.dataset.da !== undefined || t.dataset.ly !== undefined)) {
      multiEdit(t2 => propsChange(t, t2));
      return;
    }
    if (propsChange(t, l)) return;
    if (t.id === 'motionPath') {
      if (t.value && !setMotionPath(l, t.value)) toast('That shape has no length to follow.');
      return;
    }
    if (t.dataset.f) {
      if (isMulti()) {
        if (!t.value.trim()) return refreshInspector();
        multiEdit(t2 => {
          const r = parseField(t2, t);
          if (r && propOK(t2, r[0])) setField(t2, r[0], r[1]);
        });
        return;
      }
      const r = parseField(l, t);
      if (!r) {
        refreshInspector();
        return;
      }
      const ed = beginEdit();
      setField(l, r[0], r[1]);
      ed.end();
      return;
    }
    if (t.dataset.g === 'family' && (t.value === '__local__' || t.value === '__custom__')) {
      const v = t.value;
      t.value = l.geo.family;
      if (v === '__custom__') {
        S.fontCustom = true;
        renderInspector();
        byId('g-fname') && byId('g-fname').focus();
        return;
      }
      loadLocalFonts()
        .then(f => {
          renderInspector();
          toast(f.length ? `${f.length} fonts from this computer added to the list.` : 'No fonts were shared.');
        })
        .catch(() => {
          toast('The browser didn’t share the fonts on this computer. You can type a font name instead.');
          S.fontCustom = true;
          renderInspector();
        });
      return;
    }
    if (t.dataset.fname !== undefined) {
      const v = t.value.trim().replace(/["';<>]/g, '');
      if (!v) return;
      const ed = beginEdit();
      l.geo.family = v;
      ed.end({ insp: true });
      return;
    }
    if (t.dataset.g) {
      const g = t.dataset.g,
        ed = beginEdit();
      if (['text', 'family', 'weight', 'anchor', 'deco'].includes(g)) {
        l.geo[g] = t.value;
        if (g === 'text') t.dir = textDir(l.geo);
        const wf = g === 'family' && webFont(t.value);
        if (wf) {
          l.geo.weight = String(pickWeight(wf, l.geo.weight));
          if (!wf.italic) delete l.geo.italic;
        }
      } else {
        const v = parseFloat(t.value);
        if (!isFinite(v)) {
          refreshInspector(true);
          return;
        }
        const nv =
          g === 'lh'
            ? clamp(v, 0.5, 5)
            : g === 'ww'
              ? Math.max(1, v)
              : ['w', 'h', 'rx', 'ry', 'size'].includes(g)
                ? Math.max(0, v)
                : v;
        if (l.type === 'image' && S.lockAR && (g === 'w' || g === 'h') && l.geo.w && l.geo.h) {
          const ratio = l.geo.h / l.geo.w;
          if (g === 'w') l.geo.h = r2(nv * ratio);
          else l.geo.w = r2(nv / ratio);
        }
        const oldTip = l.type === 'bone' ? boneTipL(l.geo) : null;
        l.geo[g] = g === 'len' ? Math.max(1, nv) : nv;
        if (oldTip) shiftChildBones(l, oldTip);
      }
      // the text box and line breaks can change with any text field
      if (l.type === 'text' && ['text', 'size', 'ww', 'ls', 'family'].includes(g)) ed.end({ insp: g !== 'text' });
      else ed.end();
      refreshInspector(true);
      return;
    }
    if (t.dataset.o !== undefined) {
      const v = parseFloat(t.value);
      if (!isFinite(v)) return;
      const ed = beginEdit();
      const o = (l.o || [0, 0]).slice();
      o[+t.dataset.o] = v;
      reOrigin(l, o);
      ed.end();
      return;
    }
    if (t.dataset.name !== undefined) {
      if (!t.value.trim()) return;
      const ed = beginEdit();
      l.name = t.value.trim();
      ed.end();
      return;
    }
    if (t.dataset.dord !== undefined) {
      // a rig's own draw order starts as the order nesting draws it
      const ed = beginEdit();
      if (t.checked) l.dord = rigArtwork(l, doc.layers).map(x => x.id);
      else delete l.dord;
      ed.end({ insp: true });
      return;
    }
    if (t.dataset.flag) {
      const ed = beginEdit();
      (l as any)[t.dataset.flag] = t.checked;
      if (t.dataset.flag === 'lim' && t.checked) {
        if (l.lmin == null) l.lmin = -90;
        if (l.lmax == null) l.lmax = 90;
      }
      ed.end({ insp: true });
      // turning "Key whole rig" on for a rig whose poses aren't whole yet: offer to add the keys
      if (t.dataset.flag === 'kr' && t.checked && rigGaps(l)) rigPopover(l);
      return;
    }
    if (t.dataset.bl) {
      const v = parseFloat(t.value);
      if (!isFinite(v)) return;
      const ed = beginEdit();
      (l as any)[t.dataset.bl] = v;
      if (l.lmin > l.lmax) {
        const x = l.lmin;
        l.lmin = l.lmax;
        l.lmax = x;
      }
      ed.end({ insp: true });
      return;
    }
    if (t.id === 'lk-url' || t.id === 'lk-target') return setLink(l);
    if (t.id === 'attachBone') {
      if (t.value) moveLayers([l.id], layerById(t.value), 'into');
      else moveLayers([l.id], null, 'root');
      return;
    }
    if (t.id === 'morphTo' && t.value) {
      const tg = layerById(t.value);
      if (tg) morphTo(l, tg);
    }
  });
  INSP.addEventListener('click', (e: MouseEvent) => {
    // a click on a section heading (not on a control inside it) opens or closes the section
    const h3 = (e.target as any).closest('.sec > h3');
    if (h3) {
      const ctl = (e.target as any).closest('button, input, select, label, a, .itip');
      if (!ctl || ctl.matches('[data-sectg]')) {
        toggleSection(h3);
        return;
      }
    }
    const sameB = (e.target as any).closest('#bSame');
    if (sameB) {
      const m = document.getElementById('layermenu') as HTMLElement;
      if (!m.hidden && m.classList.contains('same-menu')) closeLayerMenu();
      else openSameMenu(sameB);
      return;
    }
    const kbt = (e.target as any).closest('[data-kb]'),
      l = selLayer();
    if (kbt && l) return isMulti() ? multiKey(kbt.dataset.kb, toggleKey) : toggleKey(l, kbt.dataset.kb);
    if ((e.target as any).closest('[data-docpick]')) {
      new (window as any).EyeDropper()
        .open()
        .then((r: { sRGBHex: string }) => {
          const ed = beginEdit();
          setBg(doc, { color: r.sRGBHex, alpha: 1 });
          ed.end({ insp: true });
        })
        .catch(() => {});
      return;
    }
    const ps = (e.target as any).closest('[data-paint],[data-docpaint]');
    if (ps) return openPaint(ps, l);
    const al = (e.target as any).closest('[data-align]');
    if (al) return align(al.dataset.align);
    const bo = (e.target as any).closest('[data-bool]');
    if (bo) return void (bo.getAttribute('aria-disabled') === 'true' ? 0 : booleanOp(bo.dataset.bool));
    const xf = (e.target as any).closest('[data-xf]');
    if (xf) {
      const k = xf.dataset.xf;
      return void (k === 'fliph' || k === 'flipv' ? flip(k === 'fliph' ? 0 : 1) : rotate(k === 'rotr' ? 90 : -90));
    }
    const tx = (e.target as any).closest('[data-tx]');
    if (tx && l) {
      if (!isMulti()) return propsToggle(tx, l);
      if (!TEXT_TOGGLES.includes(tx.dataset.tx)) return multiEdit(t2 => propsToggle(tx, t2));
      // a text toggle on several layers: the text layers only, all ending the same way (on when any was off)
      const texts = multiText(),
        k = tx.dataset.tx,
        v = tx.dataset.v,
        allOn = texts.every(t2 => textToggleOn(t2, k, v));
      return multiEdit(t2 => {
        const on = textToggleOn(t2, k, v);
        if (on === null || on === allOn) propsToggle(tx, t2);
      }, texts);
    }
    const an = (e.target as any).closest('[data-anchor]');
    if (an && l) {
      const [u, v] = an.dataset.anchor.split(',').map(Number);
      if (isMulti()) multiEdit(t2 => setAnchor(t2, u, v));
      else setAnchor(l, u, v);
      return;
    }
    const b = (e.target as any).closest('[data-act]');
    if (!b || !l) return;
    const a = b.dataset.act;
    if (a === 'sblock') {
      S.sbLock = S.sbLock === false;
      b.classList.toggle('on', S.sbLock);
      b.setAttribute('aria-pressed', String(S.sbLock));
      return;
    }
    if (propsClick(a, b, l)) return;
    if (a === 'flipx' || a === 'flipy') {
      const flip = (x: Layer) => {
        const s = clone(H.get(x, 'scl', S.time)),
          ed = beginEdit();
        s[a === 'flipx' ? 0 : 1] *= -1;
        setProp(x, 'scl', s);
        ed.end();
      };
      if (isMulti()) multiEdit(flip);
      else flip(l);
      return;
    }
    if (a === 'center') {
      const g = byId('e-' + l.id);
      if (!g) return;
      const ed = beginEdit();
      const bb = layerBox(l) || g.getBBox();
      reOrigin(l, [bb.x + bb.width / 2, bb.y + bb.height / 2]);
      ed.end();
    } else if (a === 'topath') convertToPath(l);
    else if (a === 'childbone') addChildBone(l);
    else if (a === 'dmv') moveInOrder(l, b.dataset.id, b.dataset.dir === 'front' ? 1 : -1);
    else if (a === 'pinsel') {
      S.pinSel = +b.dataset.n;
      renderInspector();
      drawOverlay();
    } else if (a === 'pinrm') {
      if (S.pinSel != null) removePin(l, S.pinSel);
    } else if (a === 'pinrmall') removeAllPins(l);
    else if (a === 'nodes') {
      // a rectangle or ellipse shows its nodes as a path
      if (S.tool !== 'node' && (l.type === 'rect' || l.type === 'ellipse')) {
        const ed = beginEdit();
        plainPath(l);
        ed.end();
      }
      setTool(S.tool === 'node' ? 'select' : 'node');
      renderInspector();
    } else if (a === 'subdiv') {
      const ed = beginEdit();
      plainPath(l);
      subdivideAll(l);
      ed.end({ insp: true });
    } else if (a === 'delsel') deleteSel();
    else if (a === 'grp') groupSel();
    else if (a === 'ungroup') ungroup(l);
    else if (a === 'natural') {
      const as = ASSETS[l.geo.asset];
      if (!as) return;
      const ed = beginEdit();
      setProp(l, 'sz', [as.w, as.h]);
      ed.end();
      refreshInspector(true);
    }
  });
  INSP.addEventListener('pointerdown', (e: PointerEvent) => {
    const sc = (e.target as any).closest('[data-scrub]');
    const l = selLayer();
    if (!sc || !l) return;
    e.preventDefault();
    const f = sc.dataset.scrub,
      inp = sc.parentElement.querySelector('input'),
      [k] = f.split(':');
    const step =
        +sc.dataset.scrubStep ||
        (<Record<string, number>>{
          pos: 1,
          org: 1,
          rot: 1,
          scl: 0.5,
          skw: 0.5,
          op: 0.5,
          fo: 0.5,
          so: 0.5,
          sw: 0.1,
          dof: 1,
        })[k] ||
        (k.startsWith('fx.') ? 0.1 : 1),
      ms = multiSel(),
      start = parseFloat(inp.value) || (ms.length ? parseFloat(String(fieldValue(l, f))) || 0 : 0),
      x0 = e.clientX,
      ed = beginEdit();
    dragWin(
      ev => {
        inp.value = fmt(start + (ev.clientX - x0) * step * (ev.shiftKey ? 10 : 1));
        // several layers: each gets the value
        ms.forEach(t2 => {
          if (t2 === l) return;
          const r2 = parseField(t2, inp);
          if (r2 && propOK(t2, r2[0])) setField(t2, r2[0], r2[1]);
        });
        const r = parseField(l, inp);
        if (r) {
          setField(l, r[0], r[1]);
          // a value without keyframes (or a size) is drawn from the markup: redraw it as it changes
          if (ms.length || r[0] === 'sz' || !(l.t[r[0]] && l.t[r[0]].length)) renderStage();
          frame();
        }
      },
      () => ed.end(),
    );
  });
}

/* ---------- a rig's own draw order (Bone section of its top bone) ---------- */

export const DCHEV = (d: string) =>
  `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
export const GRIP =
  '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><circle cx="4.5" cy="3" r="1"/><circle cx="7.5" cy="3" r="1"/><circle cx="4.5" cy="6" r="1"/><circle cx="7.5" cy="6" r="1"/><circle cx="4.5" cy="9" r="1"/><circle cx="7.5" cy="9" r="1"/></svg>';
function drawOrderBlock(l: Layer) {
  const order = drawOrder(l, doc.layers);
  let h = `<label class="check sub-check"><input type="checkbox" data-dord id="fl-dord" ${order ? 'checked' : ''}><span>Own draw order${infoTip('Draws this rig’s artwork in the order below, whatever bone it hangs on, so a part can sit behind its parent’s artwork.', 'Own draw order')}</span></label>`;
  if (!order) return h;
  const rows = order
    .slice()
    .reverse()
    .map((x, i, a) => {
      const bone = layerById(x.parent);
      return `<div class="dord-row" role="listitem" draggable="true" data-dord-id="${x.id}"><span class="dord-grip" aria-hidden="true">${GRIP}</span><span class="dord-name">${esc(x.name)}</span><span class="dord-bone">${bone ? esc(bone.name) : ''}</span><button type="button" class="dord-mv" data-act="dmv" data-dir="front" data-id="${x.id}" aria-label="Move ${esc(x.name)} forward"${i === 0 ? ' disabled' : ''}>${DCHEV('M3 7.5l3-3 3 3')}</button><button type="button" class="dord-mv" data-act="dmv" data-dir="back" data-id="${x.id}" aria-label="Move ${esc(x.name)} back"${i === a.length - 1 ? ' disabled' : ''}>${DCHEV('M3 4.5l3 3 3-3')}</button></div>`;
    })
    .join('');
  h += `<div class="dord" role="list" aria-label="Draw order, front first"><div class="dord-cap">Front</div>${rows}<div class="dord-cap">Back</div></div>`;
  return h;
}
/** moves a piece of artwork one step toward the front (+1) or the back (−1), or to just above `before` */
function moveInOrder(l: Layer, id: string, step: number, onto?: string) {
  const order = drawOrder(l, doc.layers);
  if (!order) return;
  const ids = order.map(x => x.id),
    i = ids.indexOf(id);
  if (i < 0) return;
  ids.splice(i, 1);
  let j = onto != null ? ids.indexOf(onto) + (step > 0 ? 1 : 0) : i + step;
  j = Math.max(0, Math.min(ids.length, j));
  ids.splice(j, 0, id);
  if (ids.join() === order.map(x => x.id).join()) return;
  const ed = beginEdit();
  l.dord = ids;
  ed.end({ insp: true });
}
/** drag a row of the draw order list onto another: it takes that row's place */
export function initDrawOrderDrag() {
  let dragId: string | null = null;
  INSP.addEventListener('dragstart', (e: DragEvent) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.dord-row');
    if (!r) return;
    dragId = r.dataset.dordId;
    r.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    }
  });
  INSP.addEventListener('dragover', (e: DragEvent) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.dord-row');
    if (!r || !dragId) return;
    e.preventDefault();
    INSP.querySelectorAll('.dord-row.drop-above, .dord-row.drop-below').forEach((x: Element) =>
      x.classList.remove('drop-above', 'drop-below'),
    );
    const b = r.getBoundingClientRect();
    r.classList.add(e.clientY < b.top + b.height / 2 ? 'drop-above' : 'drop-below');
  });
  INSP.addEventListener('drop', (e: DragEvent) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.dord-row'),
      l = selLayer();
    if (!r || !dragId || !l) return;
    e.preventDefault();
    const above = r.classList.contains('drop-above');
    // the list shows the front first: above a row = in front of it
    if (r.dataset.dordId !== dragId) moveInOrder(l, dragId, above ? 1 : -1, r.dataset.dordId);
    dragId = null;
  });
  INSP.addEventListener('dragend', () => {
    dragId = null;
    INSP.querySelectorAll('.dord-row').forEach((x: Element) =>
      x.classList.remove('dragging', 'drop-above', 'drop-below'),
    );
  });
}
