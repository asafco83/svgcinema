// SVGcinema — ui/props-panel
// The property sections of the inspector: Transforms, Text, Text appearance, Fill & stroke,
// Appearance (compositing, line style, dashes) and Filters. Fields follow the inspector's conventions:
//   data-f="prop[:index[:multiplier]]"  animatable value (keyframe button = data-kb)
//   data-g="field"                      geometry (rect/ellipse/text…)
//   data-x="attr"                       static SVG attribute stored in Layer.extra
//   data-ly="field"                     layer setting (blend, iso)
//   data-tx="…" / data-act="…"          buttons
import { layerBox } from '../render/mesh';
import { canAlign, meshOf } from '../render/markup';
import { MESH_DEFAULT } from '../model/mesh';
import type { Layer, PathData, PropKey } from '../model/types';
import { FONTS, ICON, byId, clone, esc, fmt, ic, parseDash, r2, valueAt } from '../core/constants';
import { INSP } from '../core/dom';
import { beginEdit, setProp, setTime } from '../core/history';
import { type NodeType, currentNode, nodeType, setNodePos, setNodeType } from '../tools/motion-path';
import { S, layerById, selLayer } from '../core/state';
import { familyCSS, localFamilies, pickWeight, webFont } from '../render/fonts';
import { fontLabel } from './font-picker';
import {
  FILTERS,
  FX_GROUPS,
  FX_MENU,
  addFilter,
  fxKey,
  fxName,
  fxParams,
  fxSummary,
  moveFilter,
  removeFilter,
  syncFa,
} from '../model/filters';
import { H9 } from '../tools/edit-tools';
import { DCHEV, GRIP, colf, gnum, krow, nrow, num, renderInspector } from './inspector';
import { isLine, liveShape, setShape } from '../tools/shapes';
import { type ShapeParams, maxCornerRadius } from '../geometry/nodes';
import { renderStage } from '../render/stage';
import { textDir, visualAnchor } from '../render/text-layout';
import { textConvertible } from '../core/layer-ops';
import { spellOn } from '../core/spell';

const PAINTED = ['rect', 'ellipse', 'path', 'text'];
const I = {
  link: ic('<path d="M9 15l6-6M10 6.5l1.5-1.5a4 4 0 015.7 5.7L15.7 12M8.3 12l-1.5 1.5a4 4 0 005.7 5.7L14 17.5"/>'),
  pick: ICON.eyedropper,
  swap: ic('<path d="M7 4v13M4 14l3 3 3-3M17 20V7M14 10l3-3 3 3"/>'),
  dirL: ic('<path d="M10 3v11M14 3v11M16 3H9.5a3 3 0 000 6H10M5 19h14M16 16l3 3-3 3"/>'),
  dirR: ic('<path d="M10 3v11M14 3v11M16 3H9.5a3 3 0 000 6H10M19 19H5M8 16l-3 3 3 3"/>'),
  alignL: ic('<path d="M4 5h16M4 10h10M4 15h16M4 20h10"/>'),
  alignC: ic('<path d="M4 5h16M7 10h10M4 15h16M7 20h10"/>'),
  alignR: ic('<path d="M4 5h16M10 10h10M4 15h16M10 20h10"/>'),
  keepW: ic('<path d="M4 5v14M20 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3"/>'),
  capButt: ic(
    '<path fill="currentColor" stroke="none" d="M2 6.5h13v11H2z"/><path class="knock" fill="none" stroke-width="1.7" stroke-linecap="round" d="M2 12h13"/><circle class="knockf" stroke="none" cx="15" cy="12" r="2"/>',
    18,
  ),
  capRound: ic(
    '<path fill="currentColor" stroke="none" d="M2 6.5h13a5.5 5.5 0 010 11H2z"/><path class="knock" fill="none" stroke-width="1.7" stroke-linecap="round" d="M2 12h13"/><circle class="knockf" stroke="none" cx="15" cy="12" r="2"/>',
    18,
  ),
  capSquare: ic(
    '<path fill="currentColor" stroke="none" d="M2 6.5h18.5v11H2z"/><path class="knock" fill="none" stroke-width="1.7" stroke-linecap="round" d="M2 12h13"/><circle class="knockf" stroke="none" cx="15" cy="12" r="2"/>',
    18,
  ),
  joinMiter: ic(
    '<path fill="currentColor" stroke="none" d="M3 22V2h20v10h-10v10z"/><path class="knock" fill="none" stroke-width="1.7" stroke-linecap="round" d="M8 22V7h15"/>',
    18,
  ),
  joinRound: ic(
    '<path fill="currentColor" stroke="none" d="M3 22V12A10 10 0 0113 2h10v10h-10v10z"/><path class="knock" fill="none" stroke-width="1.7" stroke-linecap="round" d="M8 22V7h15"/>',
    18,
  ),
  joinBevel: ic(
    '<path fill="currentColor" stroke="none" d="M3 22V8.5L9.5 2H23v10h-10v10z"/><path class="knock" fill="none" stroke-width="1.7" stroke-linecap="round" d="M8 22V7h15"/>',
    18,
  ),
  // the owner's icons: the stroke band small (inside the path), medium with the path knocked out
  // through it (centre), large (outside)
  alCentre: ic(
    '<path fill="currentColor" stroke="none" d="M4.287 4.287L19.713 4.287L19.713 19.713L4.287 19.713ZM9.686 9.686L9.686 14.314L14.314 14.314L14.314 9.686Z"/><path class="knock" fill="none" stroke-width="1.7" stroke-linecap="round" d="M6.986 6.986L17.014 6.986L17.014 17.014L6.986 17.014Z"/>',
    18,
  ),
  alInside: ic(
    '<path fill="currentColor" stroke="none" d="M6.133 6.133L17.867 6.133L17.867 17.867L6.133 17.867ZM9.623 9.623L9.623 14.377L14.377 14.377L14.377 9.623Z"/>',
    18,
  ),
  alOutside: ic(
    '<path fill="currentColor" stroke="none" d="M2.4 2.4L21.6 2.4L21.6 21.6L2.4 21.6ZM6.133 6.133L6.133 17.867L17.867 17.867L17.867 6.133Z"/>',
    18,
  ),
  orient: ic('<path d="M4 19c2-8 7-12 14-13"/><path d="M14 3.5l4.5 2.5-2.5 4.5"/><circle cx="4" cy="19" r="1.5"/>'),
  up: ic('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: ic('<path d="M12 5v14M6 13l6 6 6-6"/>'),
};
const STYLES: Array<[string, string]> = [
  ['100', 'Thin'],
  ['200', 'Extra light'],
  ['300', 'Light'],
  ['400', 'Regular'],
  ['500', 'Medium'],
  ['600', 'Semibold'],
  ['700', 'Bold'],
  ['800', 'Extra bold'],
  ['900', 'Black'],
];
const BLENDS = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];
const ORDERS: Array<[string, string]> = [
  ['', 'Fill, Stroke, Markers'],
  ['stroke', 'Stroke, Fill, Markers'],
  ['fill markers', 'Fill, Markers, Stroke'],
  ['markers', 'Markers, Fill, Stroke'],
  ['stroke markers', 'Stroke, Markers, Fill'],
  ['markers stroke', 'Markers, Stroke, Fill'],
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
const tbtn = (attr: string, val: string, on: boolean, icon: string, label: string) =>
  `<button class="btn ib tg${on ? ' on' : ''}" data-tx="${attr}" data-v="${val}" aria-pressed="${on}" title="${label}" aria-label="${label}">${icon}</button>`;
const sel = (attrs: string, opts: Array<[string, string]>, cur: string) =>
  `<select class="sel" ${attrs}>${opts.map(([v, t]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;

/* ---------- Transforms ---------- */

function rotField(part: 'turn' | 'deg') {
  return `<label class="nf"><span data-scrub="rot"${part === 'turn' ? ' data-scrub-step="0.02"' : ''}>${part === 'turn' ? '⟳' : '∠'}</span><input id="rot-${part}" data-f="rot" data-rt="${part}" inputmode="decimal" spellcheck="false" aria-label="Rotate ${part === 'turn' ? 'turns' : 'degrees'}">${part === 'turn' ? '' : '<em>°</em>'}</label>`;
}
export function transformSection(l: Layer) {
  const bone = l.type === 'bone',
    onPath = !!(l.t.pos && l.t.pos.length > 1);
  return `<section class="sec"><h3>Transforms <span class="kleg" title="◆ beside a property adds or removes a keyframe at the playhead"><span><i></i>off</span><span><i class="a"></i>animated</span><span><i class="k"></i>key here</span></span></h3>
    ${krow('pos', 'Position', num('pos:0', 'X') + num('pos:1', 'Y'))}
    ${krow('scl', 'Scale', num('scl:0:100', 'W', '%') + num('scl:1:100', 'H', '%') + `<button class="btn ib tg${S.sclLock ? ' on' : ''}" data-act="scllock" aria-pressed="${!!S.sclLock}" title="Keep proportions" aria-label="Keep proportions">${I.link}</button>`)}
    ${bone ? '<p class="bnote">W along the bone · H across it</p>' : ''}
    ${bone ? '' : krow('skw', 'Skew', num('skw:0', 'X', '°') + num('skw:1', 'Y', '°'))}
    ${krow('rot', 'Rotate', rotField('turn') + rotField('deg') + (onPath ? `<button class="btn ib tg${l.or ? ' on' : ''}" data-act="orient" aria-pressed="${!!l.or}" title="Rotate along the motion path" aria-label="Rotate along the motion path">${I.orient}</button>` : ''))}
    ${bone ? '' : krow('org', 'Origin', num('org:0', 'X') + num('org:1', 'Y') + `<button class="btn ib" data-act="center" title="Center origin on the shape" aria-label="Center origin">${ic('<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>', 14)}</button>`)}
    ${
      bone
        ? ''
        : `${nrow('Anchor', `<div class="anchor" role="group" aria-label="Move origin to a point of the box">${H9.map(([u, v]) => `<button data-anchor="${u},${v}" aria-label="Origin at ${['left', 'center', 'right'][u * 2]} ${['top', 'middle', 'bottom'][v * 2]}" title="Origin at ${['left', 'center', 'right'][u * 2]} ${['top', 'middle', 'bottom'][v * 2]}"></button>`).join('')}</div><div class="btns" style="margin-left:auto"><button class="btn" data-act="flipx" title="Mirror horizontally around the origin">Flip H</button><button class="btn" data-act="flipy" title="Mirror vertically around the origin">Flip V</button></div>`)}`
    }</section>`;
}

/* ---------- Shape settings: polygon sides, star points & ratio, corner radius, line ends ---------- */

/** The eyedropper (browsers that have one): picks a colour anywhere on screen for the layer's fill or
 *  stroke. Also I (fill) and Alt+I (stroke). */
export function pickPaint(l: Layer, k: PropKey) {
  if (!l || !(window as any).EyeDropper) return false;
  new (window as any).EyeDropper()
    .open()
    .then((r: { sRGBHex: string }) => {
      const ed = beginEdit();
      setProp(l, k, r.sRGBHex);
      ed.end({ insp: true });
    })
    .catch(() => {});
  return true;
}
/** Size keeps its proportions: images by default (lockAR), other shapes when turned on (szLock) */
export const szLocked = (l: Layer) => (l && l.type === 'image' ? S.lockAR : !!S.szLock);
/** Size: the shape's width and height, animatable (it grows around the origin), with the same
 *  keep-proportions toggle as Scale */
export function sizeRow(l: Layer) {
  const on = szLocked(l);
  return krow(
    'sz',
    'Size',
    num('sz:0', 'W') +
      num('sz:1', 'H') +
      `<button class="btn ib tg${on ? ' on' : ''}" data-act="szlock" aria-pressed="${on}" title="Keep proportions" aria-label="Keep proportions">${I.link}</button>`,
  );
}
/** slider + number for one shape setting */
function slide(
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  val: number,
  unit = '',
  scale = 1,
  kb?: PropKey,
) {
  return (kb ? (b: string) => krow(kb, label, b) : (b: string) => nrow(label, b))(
    `<input type="range" class="rng" id="sh-${key}-r" data-sh="${key}" data-scale="${scale}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${label}"><label class="nf"><input id="sh-${key}" data-sh="${key}" data-scale="${scale}" inputmode="decimal" value="${fmt(val)}" aria-label="${label}">${unit ? `<em>${unit}</em>` : ''}</label>`,
  );
}
export function shapeSection(l: Layer) {
  if (l.type === 'rect') {
    const G = l.geo,
      mx = Math.max(0, Math.min(G.w, G.h) / 2);
    return `<section class="sec"><h3>Rectangle</h3>${nrow('Position', gnum('x', 'X') + gnum('y', 'Y'))}${sizeRow(l)}${slide('rad', 'Radius', 0, r2(mx), 0.5, Math.min(valueAt(l, 'rad', S.time) || 0, mx), 'px', 1, 'rad')}<div class="btns"><button class="btn" data-act="topath">Convert to path</button></div></section>`;
  }
  const sh = liveShape(l);
  if (sh) {
    const star = sh.kind === 'star',
      mx = r2(maxCornerRadius(sh));
    return `<section class="sec"><h3>${star ? 'Star' : 'Polygon'}</h3>
      ${slide('n', star ? 'Points' : 'Sides', 3, 24, 1, sh.n)}
      ${star ? slide('ratio', 'Ratio', 5, 95, 1, Math.round((sh.ratio == null ? 0.45 : sh.ratio) * 100), '%', 100) : ''}
      ${slide('rad', 'Radius', 0, mx, 0.5, Math.min(valueAt(l, 'rad', S.time) || 0, mx), 'px', 1, 'rad')}
      <p>Editing the nodes by hand, or adding Morph keyframes, turns this into a plain path.</p></section>`;
  }
  if (isLine(l))
    return `<section class="sec"><h3>Line</h3>
      ${krow('p0', 'From', `<label class="nf"><span>X</span><input id="ln-0-0" data-ln="0:0" inputmode="decimal" aria-label="From X"></label><label class="nf"><span>Y</span><input id="ln-0-1" data-ln="0:1" inputmode="decimal" aria-label="From Y"></label>`)}
      ${krow('p1', 'To', `<label class="nf"><span>X</span><input id="ln-1-0" data-ln="1:0" inputmode="decimal" aria-label="To X"></label><label class="nf"><span>Y</span><input id="ln-1-1" data-ln="1:1" inputmode="decimal" aria-label="To Y"></label>`)}
      <p>Key each end with ◆ so the line can grow, swing or swap ends over time.</p></section>`;
  return '';
}
/** Apply one shape setting (from a slider while dragging, or a number). */
function applyShape(l: Layer, key: string, raw: number) {
  if (l.type === 'rect') {
    if (key === 'rad') setProp(l, 'rad', r2(Math.max(0, Math.min(raw, Math.min(l.geo.w, l.geo.h) / 2))));
    return;
  }
  const sh = liveShape(l);
  if (!sh) return;
  // the radius is animatable: keyed at the playhead once it has keyframes
  if (key === 'rad') return setProp(l, 'rad', r2(Math.max(0, Math.min(raw, maxCornerRadius(sh)))));
  const p: ShapeParams & { sig?: string } = { ...sh };
  delete p.sig;

  if (key === 'n') p.n = Math.round(Math.max(3, Math.min(24, raw)));
  if (key === 'ratio') p.ratio = Math.max(0.05, Math.min(0.95, raw));
  if (key === 'rad') p.rad = r2(Math.max(0, raw));
  if (key === 'n') sh.kind === 'star' ? (S.starPoints = p.n) : (S.polySides = p.n);
  if (key === 'ratio') S.starRatio = p.ratio;
  setShape(l, p);
}
/** Move one end of a line (its handles move with it); keyed like a Morph value. */
function setLineEnd(l: Layer, node: number, axis: number, v: number) {
  const k = ('p' + node) as PropKey,
    e = clone(valueAt(l, k, S.time)) as number[];
  e[axis] = v;
  setProp(l, k, e);
}

/* ---------- Path nodes (motion path keyframes) ---------- */

const NT: Array<[NodeType, string, string]> = [
  ['straight', 'Straight (corner)', '<path d="M4 17l8-9 8 9"/><circle cx="12" cy="8" r="1.6" fill="currentColor"/>'],
  [
    'mirrored',
    'Mirrored',
    '<path d="M4 17c1-6 4-9 8-9s7 3 8 9"/><path d="M5 8h14"/><circle cx="12" cy="8" r="1.6" fill="currentColor"/><circle cx="5" cy="8" r="1.2"/><circle cx="19" cy="8" r="1.2"/>',
  ],
  [
    'asymmetric',
    'Asymmetric',
    '<path d="M4 17c1-6 4-9 8-9s5 2 8 9"/><path d="M3 8h13"/><circle cx="12" cy="8" r="1.6" fill="currentColor"/><circle cx="3" cy="8" r="1.2"/><circle cx="16" cy="8" r="1.2"/>',
  ],
  [
    'disconnected',
    'Disconnected',
    '<path d="M4 17c1-5 4-9 8-9 2 3 5 6 8 9"/><path d="M12 8L6 5M12 8l5 3"/><circle cx="12" cy="8" r="1.6" fill="currentColor"/><circle cx="6" cy="5" r="1.2"/><circle cx="17" cy="11" r="1.2"/>',
  ],
];
/** Type and position of the motion-path node at (or before) the playhead. */
export function nodeSection(l: Layer) {
  const i = currentNode(l);
  if (i < 0) return '';
  const tr = l.t.pos,
    type = nodeType(l, i),
    on = Math.abs(tr[i][0] - S.time) < 0.005;
  return `<div class="sub">Path node <span class="muted">${i + 1} of ${tr.length} · ${fmt(tr[i][0])}s${on ? '' : ' (before the playhead)'}</span>
      <span class="sp"></span><button class="btn ib" data-act="nodego" data-d="-1" ${i === 0 ? 'disabled' : ''} title="Previous node" aria-label="Previous node">‹</button><button class="btn ib" data-act="nodego" data-d="1" ${i === tr.length - 1 ? 'disabled' : ''} title="Next node" aria-label="Next node">›</button></div>
    ${nrow('Type', `<div class="btns tight" role="group" aria-label="Node type">${NT.map(([v, t, p]) => tbtnAct('ntype', v, type === v, ic(p), t)).join('')}</div>`)}
    ${nrow('Position', `<label class="nf"><span>X</span><input id="np-x" data-np="0" data-ni="${i}" data-on="${on ? 1 : 0}" inputmode="decimal" aria-label="Node X"></label><label class="nf"><span>Y</span><input id="np-y" data-np="1" data-ni="${i}" inputmode="decimal" aria-label="Node Y"></label>`)}`;
}
const tbtnAct = (act: string, val: string, on: boolean, icon: string, label: string) =>
  `<button class="btn ib tg${on ? ' on' : ''}" data-act="${act}" data-v="${val}" aria-pressed="${on}" title="${label}" aria-label="${label}">${icon}</button>`;

/* ---------- Text ---------- */

export function textSection(l: Layer) {
  const G = l.geo;
  return `<section class="sec"><h3>Text</h3><textarea class="ta" data-g="text" id="g-text" spellcheck="${spellOn()}" dir="${textDir(G)}" rows="${Math.min(6, Math.max(2, String(G.text || '').split('\n').length))}" aria-label="Text">${esc(G.text)}</textarea>
    ${nrow('Position', `<label class="nf"><span>X</span><input id="g-x" data-g="x" inputmode="decimal" aria-label="X"></label><label class="nf"><span>Y</span><input id="g-y" data-g="y" inputmode="decimal" aria-label="Y"></label>`)}
    ${nrow('Size', `<label class="nf ro"><span>W</span><input id="bb-w" data-bb="w" readonly tabindex="-1" aria-label="Width"></label><label class="nf ro"><span>H</span><input id="bb-h" data-bb="h" readonly tabindex="-1" aria-label="Height"></label>`)}
    ${textConvertible(l) ? '<div class="btns"><button class="btn" data-act="topath" id="txToPath">Convert to shapes</button></div>' : ''}
  </section>`;
}
const CASES: Array<[string, string, string]> = [
  ['', 'Aa', 'As typed'],
  ['upper', 'AB', 'Uppercase'],
  ['lower', 'ab', 'Lowercase'],
  ['title', 'Ab', 'Capitalise each word'],
];
export function textAppearanceSection(l: Layer) {
  const G = l.geo,
    va = visualAnchor(G),
    dir = textDir(G),
    wf = webFont(G.family),
    known = !!wf || FONTS.some(f => f[0] === G.family),
    w = String(G.weight || '400'),
    deco = String(G.deco || '').split(/\s+/),
    has = (d: string) => deco.includes(d);
  // only the weights and styles the chosen web font has
  const styleOpts: Array<[string, string]> = STYLES.filter(([v]) => !wf || wf.weights.includes(+v)).flatMap(
    ([v, n]): Array<[string, string]> =>
      !wf || wf.italic
        ? [
            [v + '|0', n],
            [v + '|1', n === 'Regular' ? 'Italic' : n + ' italic'],
          ]
        : [[v + '|0', n]],
  );
  const locals = localFamilies().filter(n => !webFont(n)),
    isLocal = !wf && locals.includes(G.family),
    other = !wf && !isLocal && !FONTS.some(f => f[0] === G.family);
  // the font list opens from this button (ui/font-picker); the name shows in the font itself
  const fontSel = `<button class="fontbtn" id="g-family" data-fontpick aria-haspopup="dialog" aria-expanded="false" aria-label="Font: ${esc(fontLabel(G.family))}"><span style="font-family:${esc(familyCSS(G.family))}${G.italic ? ';font-style:italic' : ''}">${esc(fontLabel(G.family))}</span><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg></button>`;
  const custom = S.fontCustom
    ? nrow(
        'Font name',
        `<input class="txt" id="g-fname" data-fname value="${esc(other || isLocal ? G.family : '')}" placeholder="e.g. Segoe UI" spellcheck="false" aria-label="Font installed on this computer">`,
      )
    : '';
  return `<section class="sec"><h3>Text appearance</h3>
    ${nrow('Font', fontSel)}${custom}
    ${nrow('Style', sel('data-tx-sel="style" id="tx-style" aria-label="Style"', styleOpts, w + '|' + (G.italic ? 1 : 0)))}
    <div class="row nk"><span class="rl"></span><div class="rf tx-tg">
      ${tbtn('bold', '', +w >= 600, '<b>B</b>', 'Bold')}${tbtn('italic', '', !!G.italic, '<i>I</i>', 'Italic')}${tbtn('deco', 'underline', has('underline'), '<u>U</u>', 'Underline')}${tbtn('deco', 'overline', has('overline'), '<span style="text-decoration:overline">O</span>', 'Overline')}${tbtn('deco', 'line-through', has('line-through'), '<s>S</s>', 'Strikethrough')}
    </div></div>
    ${nrow('Size', `<label class="nf"><span>pt</span><input id="g-size" data-g="size" inputmode="decimal" aria-label="Font size"></label><label class="nf"><span>↔</span><input id="g-ls" data-g="ls" inputmode="decimal" aria-label="Letter spacing"><em>px</em></label>`)}
    ${nrow('Align', `<div class="btns tight">${tbtn('anchor', 'start', va === 'start', I.alignL, 'Align left')}${tbtn('anchor', 'middle', va === 'middle', I.alignC, 'Align center')}${tbtn('anchor', 'end', va === 'end', I.alignR, 'Align right')}</div><div class="btns tight" role="group" aria-label="Direction">${tbtn('dir', 'ltr', dir === 'ltr', I.dirL, 'Left to right')}${tbtn('dir', 'rtl', dir === 'rtl', I.dirR, 'Right to left')}</div>`)}
    ${nrow('Case', `<div class="btns tight" role="group" aria-label="Letter case">${CASES.map(([v, t, lab]) => tbtn('tcase', v, (G.tcase || '') === v, `<span class="tx-case">${t}</span>`, lab)).join('')}</div>`)}
    ${nrow('Box width', `${tbtn('wrap', '', !!G.wrap, I.keepW, 'Keep width while typing (wrap lines)')}<label class="nf${G.wrap ? '' : ' ro'}" title="${G.wrap ? 'Lines break to stay inside this width' : 'Turn on Keep width to fix the box width'}"><span>W</span><input id="g-ww" data-g="ww" inputmode="decimal" aria-label="Box width"${G.wrap ? '' : ' disabled'}><em>px</em></label>`)}
    ${String(G.text || '').includes('\n') || G.wrap ? nrow('Line height', `<label class="nf"><span>×</span><input id="g-lh" data-g="lh" inputmode="decimal" aria-label="Line height"></label>`) : ''}
  </section>`;
}

/* ---------- Fill & stroke ---------- */

export function paintSection(l: Layer) {
  if (!PAINTED.includes(l.type)) return '';
  return `<section class="sec"><h3>Fill & stroke <button class="btn ib h3b" data-act="swap" title="Swap fill and stroke" aria-label="Swap fill and stroke">${I.swap}</button></h3>
    ${krow('fill', 'Fill', colf('fill', 'none,solid,lin,rad'))}
    ${krow('fo', 'Opacity', num('fo::100', 'α', '%'))}
    ${krow('stk', 'Stroke', colf('stk', 'none,solid,lin,rad'))}
    ${krow('so', 'Opacity', num('so::100', 'α', '%'))}
    ${krow('sw', 'Width', num('sw', 'W', 'px'))}
  </section>`;
}

/* ---------- Appearance ---------- */

export function appearanceSection(l: Layer) {
  const painted = PAINTED.includes(l.type),
    X = l.extra || {},
    lc = X['stroke-linecap'] || 'butt',
    join = X['stroke-linejoin'] || 'miter';
  let h = `<section class="sec"><h3>Appearance</h3><div class="sub">Compositing</div>`;
  if (painted)
    h += nrow(
      'Order',
      sel('data-x="paint-order" id="x-order" aria-label="Paint order"', ORDERS, X['paint-order'] || ''),
    );
  h += nrow(
    'Blending',
    sel(
      'data-ly="blend" id="ly-blend" aria-label="Blending"',
      BLENDS.map(b => [b, cap(b)]),
      l.blend || 'normal',
    ) +
      `<label class="check inl"><input type="checkbox" data-ly="iso" id="ly-iso" ${l.iso ? 'checked' : ''}> Isolate</label>`,
  );
  h += krow(
    'op',
    'Opacity',
    `<input type="range" class="rng" id="op-range" data-range="op" min="0" max="100" step="1" aria-label="Opacity">` +
      num('op::100', 'α', '%'),
  );
  if (painted) {
    h += `<div class="sub">Stroke style</div>`;
    h += nrow(
      'Line ends',
      `<div class="btns tight lj">${tbtn('x:stroke-linecap', 'butt', lc === 'butt', I.capButt, 'Butt ends')}${tbtn('x:stroke-linecap', 'round', lc === 'round', I.capRound, 'Round ends')}${tbtn('x:stroke-linecap', 'square', lc === 'square', I.capSquare, 'Square ends')}</div>`,
    );
    h += nrow(
      'Line join',
      `<div class="btns tight lj">${tbtn('x:stroke-linejoin', 'miter', join === 'miter', I.joinMiter, 'Miter join')}${tbtn('x:stroke-linejoin', 'round', join === 'round', I.joinRound, 'Round join')}${tbtn('x:stroke-linejoin', 'bevel', join === 'bevel', I.joinBevel, 'Bevel join')}</div><label class="nf${join === 'miter' ? '' : ' ro'}" title="${join === 'miter' ? 'Miter limit: how far a sharp corner may stick out before it is cut flat, as a multiple of the stroke width' : 'Miter limit only applies to miter joins'}"><span>Miter</span><input data-x="stroke-miterlimit" id="x-miter" inputmode="decimal" value="${esc(X['stroke-miterlimit'] || '4')}" aria-label="Miter limit"${join === 'miter' ? '' : ' disabled'}></label>`,
    );
    // inside / outside only mean something on a closed shape: hidden on open paths and lines
    if (canAlign(l)) {
      const al = l.al || 'center';
      h += nrow(
        // "Align stroke" doesn't fit the label column; under Stroke style "Align" says it
        'Align',
        `<div class="btns tight lj" role="group" aria-label="Align stroke">${tbtn('al', 'center', al === 'center', I.alCentre, 'Align stroke to centre')}${tbtn('al', 'in', al === 'in', I.alInside, 'Align stroke inside')}${tbtn('al', 'out', al === 'out', I.alOutside, 'Align stroke outside')}</div>`,
      );
    }
    h += krow(
      'da',
      'Dashes',
      `<input class="txt mono" data-da id="x-dash" spellcheck="false" placeholder="dash, gap, dash, gap, …" aria-label="Dash pattern">`,
    );
    h += krow('dof', 'Dash offset', num('dof', '⇥', 'px'));
    h += nrow(
      'Length',
      `<label class="nf"><span>L</span><input data-x="pathLength" id="x-plen" inputmode="decimal" placeholder="auto" value="${esc(X.pathLength || '')}" aria-label="Path length for dashes"></label>`,
    );
    if (l.type !== 'text')
      h +=
        `<div class="sub">Trim path</div>` +
        krow('ts', 'Start', num('ts', 'S', '%')) +
        krow('te', 'End', num('te', 'E', '%')) +
        krow('to', 'Offset', num('to', 'O', '%')) +
        `<p>Trim shows only part of the stroke, from Start to End, shifted along the path by Offset. Animate End from 0% to 100% to draw a line on. While the stroke is trimmed, trim replaces the dash pattern.</p>`;
  }
  return h + `</section>`;
}

/* ---------- Filters ---------- */

/** filter cards the person closed (this session only: never saved, never an undo step) */
const fxClosed = new Set<string>();
const fxCK = (l: Layer, id: string) => l.id + '/' + id;
const TRASH = ic('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>', 13);
export function filtersSection(l: Layer) {
  if (l.type === 'bone') return '';
  const list = (l.fx || []).filter(f => FILTERS[f.type]),
    anyOpen = list.some(f => !fxClosed.has(fxCK(l, f.id)));
  let h = `<section class="sec"><h3>Filters${
    list.length
      ? `<button type="button" class="h3b fx-all" data-act="fxall" title="${anyOpen ? 'Collapse every filter' : 'Expand every filter'}">${anyOpen ? 'Collapse all' : 'Expand all'}</button>`
      : ''
  }</h3><div class="row nk"><span class="rl">Add</span><div class="rf"><button type="button" class="fx-add" id="fx-add" data-act="fxmenu" aria-haspopup="menu" aria-expanded="false">+ Add filter…</button></div></div>`;
  if (!list.length) return h + `<p class="muted">No filters</p></section>`;
  h += `<div class="xwarn fx-warn" role="note"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3l8 14H2z"/><path d="M10 8.5v3.5M10 14.6v.1"/></svg><span><b>Doesn’t animate in CSS exports.</b> The filters are kept but stay still; use <b>JavaScript</b> to animate them.</span></div>`;
  h += `<div class="fxl" role="list" aria-label="Filters, applied top to bottom">`;
  list.forEach((f, i) => {
    const def = FILTERS[f.type],
      name = esc(fxName(f)),
      shut = fxClosed.has(fxCK(l, f.id)),
      keys = def.params.map(p => fxKey(f.id, p.key)),
      anim = keys.some(k => l.t[k] && l.t[k].length),
      col = def.params.find(p => typeof p.def === 'string'),
      sw = col ? valueAt(l, fxKey(f.id, col.key) as PropKey, S.time) : '',
      sum = fxSummary(l, f, k => valueAt(l, k as PropKey, S.time));
    h += `<div class="fxc${shut ? ' closed' : ''}" role="listitem" data-fxc="${f.id}">
      <div class="fxc-head" draggable="true" data-fxh="${f.id}" title="Drag to reorder">
        <span class="dord-grip" aria-hidden="true">${GRIP}</span>
        <button type="button" class="fxc-tg" data-act="fxtg" data-fx="${f.id}" aria-expanded="${!shut}" aria-label="${shut ? 'Expand' : 'Collapse'} ${name}">${DCHEV('M3 4.5l3 3 3-3')}</button>
        <span class="fxc-name"><b>${name}</b><span class="fxc-sum">${anim ? '<i class="fxc-k" title="Animated"></i>' : ''}${sw && typeof sw === 'string' ? `<i class="fxc-sw" style="background:${esc(sw)}"></i>` : ''}${esc(sum)}</span></span>
        <button type="button" class="dord-mv" data-act="fxmove" data-fx="${f.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${name} up" title="Move up">${DCHEV('M3 7.5l3-3 3 3')}</button>
        <button type="button" class="dord-mv" data-act="fxmove" data-fx="${f.id}" data-d="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Move ${name} down" title="Move down">${DCHEV('M3 4.5l3 3 3-3')}</button>
        <button type="button" class="dord-mv" data-act="fxdel" data-fx="${f.id}" aria-label="Remove ${name}" title="Remove">${TRASH}</button>
      </div><div class="fxc-body">`;
    if (def.choice) {
      const c = def.choice,
        v = (f as any)[c.key] || c.def;
      h += `<div class="row"><span></span><span class="rl">${c.label}</span><div class="rf"><div class="segc" role="radiogroup" aria-label="${c.label}">${c.opts
        .map(
          ([k, t]) =>
            `<button type="button" role="radio" aria-checked="${k === v}" class="${k === v ? 'on' : ''}" data-act="fxpos" data-fx="${f.id}" data-v="${k}">${t}</button>`,
        )
        .join('')}</div></div></div>`;
    }
    fxParams(f).forEach(p => {
      const k = fxKey(f.id, p.key);
      h += krow(
        k,
        p.label,
        typeof p.def === 'string' ? colf(k) : num(k + (p.scale ? '::' + p.scale : ''), p.pre || p.label[0], p.unit),
      );
    });
    h += `</div></div>`;
  });
  return h + `</div></section>`;
}
/** the Add filter menu, below its button */
function closeFxMenu() {
  const m = document.getElementById('fxMenu');
  if (m) m.remove();
  const b = document.getElementById('fx-add');
  if (b) b.setAttribute('aria-expanded', 'false');
}
function openFxMenu(btn: HTMLElement) {
  closeFxMenu();
  const m = document.createElement('div');
  m.className = 'ctx fxm';
  m.id = 'fxMenu';
  m.setAttribute('role', 'menu');
  m.setAttribute('aria-label', 'Add filter');
  m.innerHTML = FX_GROUPS.map(
    ([g, t]) =>
      `<div class="ctx-h">${t}</div>` +
      FX_MENU.filter(p => p.group === g)
        .map(
          p =>
            `<button type="button" role="menuitem" data-fxp="${p.id}" data-fxt="${p.type}"><span>${p.label}</span>${p.of ? `<kbd>${p.of}</kbd>` : ''}</button>`,
        )
        .join(''),
  ).join('');
  document.body.appendChild(m);
  btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect(),
    mr = m.getBoundingClientRect();
  const below = r.bottom + 4 + mr.height <= innerHeight - 4;
  m.style.left = Math.max(4, Math.min(r.left, innerWidth - mr.width - 4)) + 'px';
  m.style.top = (below ? r.bottom + 4 : Math.max(4, r.top - mr.height - 4)) + 'px';
  (m.querySelector('button') as HTMLElement).focus();
  m.addEventListener('click', (e: MouseEvent) => {
    const it = (e.target as HTMLElement).closest<HTMLElement>('[data-fxp]'),
      l = selLayer();
    if (!it || !l) return;
    closeFxMenu();
    const ed = beginEdit(),
      f = addFilter(l, it.dataset.fxt, it.dataset.fxp);
    if (f) fxClosed.delete(fxCK(l, f.id));
    ed.end({ insp: true });
  });
  m.addEventListener('keydown', (e: KeyboardEvent) => {
    const items = [...m.querySelectorAll<HTMLElement>('button')],
      i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeFxMenu();
      btn.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
  });
}
/** drag a filter card onto another to reorder; every card folds to its one-row head while dragging */
export function initFilterDrag() {
  let dragId: string | null = null;
  const clear = () =>
    INSP.querySelectorAll('.fxc').forEach((x: Element) => x.classList.remove('dragging', 'drop-above', 'drop-below'));
  INSP.addEventListener('dragstart', (e: DragEvent) => {
    const hd = (e.target as HTMLElement).closest<HTMLElement>('.fxc-head');
    if (!hd) return;
    const list = hd.closest('.fxl') as HTMLElement,
      card = hd.parentElement as HTMLElement,
      y0 = hd.getBoundingClientRect().top;
    dragId = hd.dataset.fxh;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
      e.dataTransfer.setDragImage(hd, e.clientX - hd.getBoundingClientRect().left, e.clientY - y0);
    }
    // fold after the drag image is taken, and keep the grabbed card where it was on screen
    requestAnimationFrame(() => {
      list.classList.add('folded');
      card.classList.add('dragging');
      INSP.scrollTop += hd.getBoundingClientRect().top - y0;
    });
  });
  INSP.addEventListener('dragover', (e: DragEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.fxc');
    if (!c || !dragId) return;
    e.preventDefault();
    INSP.querySelectorAll('.fxc.drop-above, .fxc.drop-below').forEach((x: Element) =>
      x.classList.remove('drop-above', 'drop-below'),
    );
    const b = c.getBoundingClientRect();
    if (c.dataset.fxc !== dragId) c.classList.add(e.clientY < b.top + b.height / 2 ? 'drop-above' : 'drop-below');
  });
  INSP.addEventListener('drop', (e: DragEvent) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>('.fxc'),
      l = selLayer();
    if (!c || !dragId || !l || !l.fx) return;
    e.preventDefault();
    const above = c.classList.contains('drop-above'),
      from = l.fx.findIndex(f => f.id === dragId),
      at = l.fx.findIndex(f => f.id === c.dataset.fxc);
    if (from >= 0 && at >= 0 && c.dataset.fxc !== dragId) {
      let to = above ? at : at + 1;
      if (from < to) to--;
      const ed = beginEdit();
      moveFilter(l, dragId, to);
      ed.end({ insp: true });
    }
    dragId = null;
  });
  INSP.addEventListener('dragend', () => {
    dragId = null;
    clear();
    INSP.querySelectorAll('.fxl.folded').forEach((x: Element) => x.classList.remove('folded'));
  });
  document.addEventListener('mousedown', (e: MouseEvent) => {
    const m = document.getElementById('fxMenu');
    if (m && !m.contains(e.target as Node) && !(e.target as HTMLElement).closest('#fx-add')) closeFxMenu();
  });
}

/* ---------- refresh and events ---------- */

/** Values the generic refresh can't fill: rotate turns/degrees, the measured size, the opacity slider. */
export function refreshProps(l: Layer): void {
  const rot = valueAt(l, 'rot', S.time) || 0,
    turns = Math.trunc(rot / 360),
    deg = Math.round((rot - turns * 360) * 1000) / 1000;
  const t = byId('rot-turn'),
    d = byId('rot-deg');
  if (t && t !== document.activeElement) t.value = String(turns);
  if (d && d !== document.activeElement) d.value = fmt(deg);
  const rg = byId('op-range');
  if (rg && rg !== document.activeElement) rg.value = String(Math.round((valueAt(l, 'op', S.time) ?? 1) * 100));
  const bw = byId('bb-w');
  if (bw) {
    let bb = null;
    try {
      bb = layerBox(l);
    } catch (_) {}
    bw.value = bb ? fmt(bb.width) : '';
    byId('bb-h').value = bb ? fmt(bb.height) : '';
  }
  if (byId('ln-0-0') && isLine(l))
    [0, 1].forEach(n => {
      const v = valueAt(l, 'p' + n, S.time);
      [0, 1].forEach(a => {
        const e = byId(`ln-${n}-${a}`);
        if (e && e !== document.activeElement && v) e.value = fmt(v[a]);
      });
    });
  const rr = byId('sh-rad-r');
  if (rr && rr !== document.activeElement) {
    const v = valueAt(l, 'rad', S.time) || 0;
    rr.value = String(v);
    const rn = byId('sh-rad');
    if (rn !== document.activeElement) rn.value = fmt(v);
  }
  const nx = byId('np-x');
  // the playhead moved onto another node: rebuild the panel for it
  if (nx) {
    const ci = currentNode(l),
      on = l.t.pos && l.t.pos[ci] && Math.abs(l.t.pos[ci][0] - S.time) < 0.005 ? '1' : '0';
    if (+nx.dataset.ni !== ci || nx.dataset.on !== on) return void setTimeout(renderInspector, 0);
  }
  if (nx) {
    const i = +nx.dataset.ni,
      q = l.t.pos && l.t.pos[i],
      o = valueAt(l, 'org', S.time) || [0, 0];
    if (q) {
      if (nx !== document.activeElement) nx.value = fmt(q[1][0] + o[0]);
      const ny = byId('np-y');
      if (ny !== document.activeElement) ny.value = fmt(q[1][1] + o[1]);
    }
  }
  const dash = byId('x-dash');
  if (dash && dash !== document.activeElement)
    dash.value = ((valueAt(l, 'da', S.time) as number[]) || []).map(fmt).join(', ');
  const ww = byId('g-ww');
  if (ww && !l.geo.wrap) ww.value = byId('bb-w') ? byId('bb-w').value : '';
}
/** Rotation from the two fields. */
export function rotFromFields() {
  const t = parseFloat(byId('rot-turn').value) || 0,
    d = parseFloat(byId('rot-deg').value) || 0;
  return t * 360 + d;
}
function setExtra(l: Layer, attr: string, v: string) {
  l.extra = Object.assign({}, l.extra || {});
  if (v === '' || v == null) delete l.extra[attr];
  else l.extra[attr] = v;
}
/** Swap fill and stroke (colours, opacities and their keyframes). */
function swapPaint(l: Layer) {
  const sw = (a: string, b: string) => {
    const x = l.b[a];
    l.b[a] = l.b[b];
    l.b[b] = x;
    const ta = l.t[a],
      tb = l.t[b];
    if (tb) l.t[a] = tb;
    else delete l.t[a];
    if (ta) l.t[b] = ta;
    else delete l.t[b];
  };
  sw('fill', 'stk');
  sw('fo', 'so');
  ['fo', 'so'].forEach(k => l.b[k] == null && delete l.b[k]);
  if (l.b.stk && l.b.stk !== 'none' && !(l.b.sw > 0) && !(l.t.sw && l.t.sw.length)) l.b.sw = 2;
}
/** Handle a button in these sections. Returns true when handled. */
export function propsClick(a: string, b: HTMLElement, l: Layer) {
  if (a === 'ntype') {
    const ed = beginEdit();
    setNodeType(l, currentNode(l), b.dataset.v as NodeType);
    ed.end({ insp: true });
    return true;
  }
  if (a === 'nodego') {
    const tr = l.t.pos,
      i = currentNode(l) + +b.dataset.d;
    if (tr && tr[i]) setTime(tr[i][0]);
    return true;
  }
  if (a === 'orient') {
    const ed = beginEdit();
    l.or = !l.or;
    if (!l.or) delete l.or;
    ed.end({ insp: true });
    return true;
  }
  if (a === 'szlock') {
    const on = !szLocked(l);
    if (l.type === 'image') S.lockAR = on;
    else S.szLock = on;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    return true;
  }
  if (a === 'scllock') {
    S.sclLock = !S.sclLock;
    b.classList.toggle('on', S.sclLock);
    b.setAttribute('aria-pressed', String(S.sclLock));
    return true;
  }
  if (a === 'swap') {
    const ed = beginEdit();
    swapPaint(l);
    ed.end({ insp: true });
    return true;
  }
  if (a === 'pick') {
    pickPaint(l, b.dataset.k as PropKey);
    return true;
  }
  if (a === 'fxdel' || a === 'fxmove') {
    const ed = beginEdit();
    if (a === 'fxdel') removeFilter(l, b.dataset.fx);
    else moveFilter(l, b.dataset.fx, l.fx.findIndex(f => f.id === b.dataset.fx) + +b.dataset.d);
    ed.end({ insp: true });
    return true;
  }
  if (a === 'fxmenu') {
    if (document.getElementById('fxMenu')) closeFxMenu();
    else openFxMenu(b);
    return true;
  }
  if (a === 'fxtg' || a === 'fxall') {
    const ids = (l.fx || []).map(f => f.id),
      open = ids.some(id => !fxClosed.has(fxCK(l, id)));
    if (a === 'fxtg') {
      const k = fxCK(l, b.dataset.fx);
      if (fxClosed.has(k)) fxClosed.delete(k);
      else fxClosed.add(k);
    } else ids.forEach(id => (open ? fxClosed.add(fxCK(l, id)) : fxClosed.delete(fxCK(l, id))));
    renderInspector();
    return true;
  }
  if (a === 'fxpos') {
    const f = (l.fx || []).find(x => x.id === b.dataset.fx);
    if (!f || f.pos === b.dataset.v) return true;
    const ed = beginEdit();
    f.pos = b.dataset.v;
    syncFa(l);
    ed.end({ insp: true });
    return true;
  }
  return false;
}
/** Toggle buttons (data-tx). */
export function propsToggle(b: HTMLElement, l: Layer) {
  const k = b.dataset.tx,
    v = b.dataset.v,
    G = l.geo,
    ed = beginEdit();
  if (k === 'bold') {
    const wf = webFont(G.family),
      want = +String(G.weight || 400) >= 600 ? 400 : 700;
    G.weight = String(wf ? pickWeight(wf, want) : want);
  } else if (k === 'italic') G.italic = !G.italic;
  else if (k === 'deco') {
    const set = new Set(
      String(G.deco || '')
        .split(/\s+/)
        .filter(Boolean),
    );
    set.has(v) ? set.delete(v) : set.add(v);
    G.deco = [...set].join(' ');
    if (!G.deco) delete G.deco;
  } else if (k === 'anchor') {
    // the buttons are visual (left / centre / right); the anchor is logical, so right-to-left text swaps it
    const rtl = textDir(G) === 'rtl';
    G.anchor = rtl && v !== 'middle' ? (v === 'start' ? 'end' : 'start') : v;
  } else if (k === 'dir') {
    if (textDir(G) !== v && G.anchor !== 'middle') G.anchor = G.anchor === 'end' ? 'start' : 'end'; // keeps the alignment on screen
    G.dir = v;
  } else if (k === 'tcase') {
    if (v) G.tcase = v;
    else delete G.tcase;
  } else if (k === 'wrap') {
    // keep the text where it is: with a fixed box the anchor sits inside the box, not at x
    const va = visualAnchor(G),
      shift = (on: boolean) => (va === 'middle' ? G.ww / 2 : va === 'end' ? G.ww : 0) * (on ? 1 : -1);
    if (!G.wrap) {
      let w = 0;
      try {
        w = (byId('e-' + l.id + '-s') as any).getBBox().width;
      } catch (_) {}
      if (!(G.ww > 0)) G.ww = Math.max(20, Math.ceil(w || (G.size || 16) * 8) + 1);
      G.x = r2(G.x - shift(true));
      G.wrap = true;
    } else {
      G.x = r2(G.x - shift(false));
      G.wrap = false;
    }
  } else if (k === 'al') {
    if (v === 'in' || v === 'out') l.al = v;
    else delete l.al;
  } else if (k.startsWith('x:')) setExtra(l, k.slice(2), v);
  ed.end({ insp: true });
}
/** Change events in these sections. Returns true when handled. */
export function propsChange(t: HTMLInputElement | HTMLSelectElement, l: Layer) {
  if (t.dataset.txSel === 'style') {
    const [w, it] = t.value.split('|'),
      ed = beginEdit();
    l.geo.weight = w;
    l.geo.italic = it === '1';
    ed.end({ insp: true });
    return true;
  }
  if (t.dataset.x !== undefined) {
    const ed = beginEdit();
    let v = t.value.trim();
    if (t.dataset.x === 'stroke-miterlimit' || t.dataset.x === 'pathLength') {
      const n = parseFloat(v);
      v = isFinite(n) && n > 0 ? String(n) : '';
    }
    setExtra(l, t.dataset.x, v);
    ed.end({ insp: true });
    return true;
  }
  if (t.dataset.da !== undefined) {
    const ed = beginEdit();
    setProp(l, 'da', parseDash(t.value.replace(/[^\d.,\s]/g, ' ')));
    ed.end({ insp: true });
    return true;
  }
  if (t.dataset.ly !== undefined) {
    const ed = beginEdit();
    if (t.dataset.ly === 'mm') {
      if (t.value === 'lum') l.mm = 'lum';
      else delete l.mm;
      ed.end({ insp: true });
      return true;
    }
    if (t.dataset.ly === 'iso') l.iso = (t as HTMLInputElement).checked || undefined;
    else l.blend = t.value === 'normal' ? undefined : t.value;
    if (!l.iso) delete l.iso;
    if (!l.blend) delete l.blend;
    ed.end({ insp: true });
    return true;
  }
  if (t.dataset.sh !== undefined) {
    const v = parseFloat(t.value);
    if (!isFinite(v)) return true;
    const ed = S.colorEd || beginEdit();
    S.colorEd = null;
    applyShape(l, t.dataset.sh, (t as HTMLInputElement).type === 'range' ? v / +t.dataset.scale : v / +t.dataset.scale);
    ed.end({ insp: true });
    return true;
  }
  if (t.dataset.ln !== undefined) {
    const v = parseFloat(t.value),
      [n, a] = t.dataset.ln.split(':').map(Number);
    if (!isFinite(v)) return true;
    const ed = beginEdit();
    setLineEnd(l, n, a, r2(v));
    ed.end({ insp: true });
    return true;
  }
  if (t.dataset.np !== undefined) {
    const v = parseFloat(t.value),
      i = +t.dataset.ni,
      q = l.t.pos && l.t.pos[i];
    if (!isFinite(v) || !q) return true;
    const ed = beginEdit(),
      o = valueAt(l, 'org', S.time) || [0, 0],
      k = +t.dataset.np,
      nv = q[1].slice();
    nv[k] = v - o[k];
    setNodePos(l, i, nv as [number, number]);
    ed.end({ insp: true });
    return true;
  }
  return false;
}
/** The opacity slider, live while dragging. */
export function propsInput(t: HTMLInputElement, l: Layer) {
  if (t.dataset.sh !== undefined && t.type === 'range') {
    if (!S.colorEd) S.colorEd = beginEdit();
    applyShape(l, t.dataset.sh, +t.value / +t.dataset.scale);
    const n = byId('sh-' + t.dataset.sh);
    if (n) n.value = fmt(+t.value);
    renderStage();
    return true;
  }
  if (t.dataset.range !== 'op') return false;
  if (!S.colorEd) S.colorEd = beginEdit();
  setProp(l, 'op', Math.round(+t.value) / 100);
  const n = INSP.querySelector('[data-f="op::100"]') as HTMLInputElement;
  if (n) n.value = t.value;
  return true;
}

/* ---------- Pins (Pin tool): the selected pin's position and rotation, reach, removing ---------- */

export function pinsSection(l: Layer) {
  const ps = l.pins || [];
  if (!ps.length) return '';
  if (S.pinSel == null || !ps.some(p => p.n === S.pinSel)) S.pinSel = ps[ps.length - 1].n;
  const n = S.pinSel,
    reach = l.reach || 100,
    mesh = meshOf(l),
    cur = ps.find(p => p.n === n),
    bone = cur && cur.bone ? layerById(cur.bone) : null;
  return `<section class="sec"><h3>Pins <small>${ps.length} ${ps.length > 1 ? 'pins' : 'pin'}</small></h3>
    ${nrow('Pin', `<div class="pin-chips" role="group" aria-label="Pins">${ps.map(p => `<button type="button" class="pin-chip${p.n === n ? ' on' : ''}${p.bone ? ' bound' : ''}" data-act="pinsel" data-n="${p.n}" aria-pressed="${p.n === n}" aria-label="Pin ${p.n}${p.bone ? ' (on a bone)' : ''}">${p.n}</button>`).join('')}</div>`)}
    ${
      bone
        ? nrow('Bone', `<span class="pin-bone">${esc(bone.name)}</span><span class="pin-val">follows its joint</span>`)
        : krow('pin' + n, 'Position', num(`pin${n}:0`, 'X') + num(`pin${n}:1`, 'Y')) +
          krow('pinr' + n, 'Rotation', num(`pinr${n}`, '∠', '°'))
    }
    ${nrow('Reach', `<input type="range" class="rng" id="pinReach" data-preach data-range min="20" max="400" step="5" value="${reach}" aria-label="Reach"><span class="pin-val" id="pinReachV">${fmt(reach)} %</span>`)}
    ${mesh ? nrow('Mesh', `<input type="range" class="rng" id="pinMesh" data-pmesh data-range min="12" max="240" step="4" value="${Math.min(240, (l.mesh && l.mesh.n) || MESH_DEFAULT)}" aria-label="Mesh density"><span class="pin-val" id="pinMeshV">${mesh.t.length} triangles</span>`) : ''}
    <div class="btns pin-ind"><button class="btn" data-act="pinrm">Remove pin</button><button class="btn" data-act="pinrmall">Remove all pins</button></div>
    <p class="pin-ind">${mesh ? 'Pins bend the artwork through a mesh of triangles; a denser mesh bends more smoothly and makes CSS exports larger.' : 'Pins bend the path through its own nodes.'} Click with the Pin tool (W) to add pins; drag one to bend the ${mesh ? 'artwork' : 'path'} (keyed at the playhead). Bind to bones (in the Pin tool) adds pins that follow bones. Reach sets how far each pin pulls.</p></section>`;
}
