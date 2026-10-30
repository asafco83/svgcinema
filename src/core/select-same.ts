// SVGcinema — core/select-same
// Select same: selects every layer that shares a value with the selected ones. Shapes & text: the
// kind of shape, fill and stroke (together or each alone), stroke width, opacity, stroke and fill
// opacity, blending mode. Text (text layers only, and it selects only text layers): font family,
// family & style, family, style & size, font size, text fill / stroke color. With several layers
// selected, a layer matches when it shares the value with any of them. Values are compared as they
// are at the playhead. Hidden and locked layers are left out; layers inside groups count (as a
// Ctrl+click picks them). Offered from the properties panel's header, the layer right-click menu and
// the main menu's Edit › Select same (ui/select-same-menu).
import type { Layer } from '../model/types';
import { H } from './constants';
import { S, doc, layerById, selLayer } from './state';
import { selectMany } from './history';
import { isHidden, isLocked } from '../model/tree';
import { isInstance } from './symbols';
import { isLine, liveShape } from '../tools/shapes';
import { toast } from '../io/open';

export type SameKind =
  | 'type'
  | 'fillstk'
  | 'fill'
  | 'stk'
  | 'sw'
  | 'op'
  | 'so'
  | 'fo'
  | 'blend'
  | 'font'
  | 'fontStyle'
  | 'fontAll'
  | 'size'
  | 'tfill'
  | 'tstk'
  | 'tfillstk';

/** the menu's two groups, in order */
export const SAME_SHAPES: Array<[SameKind, string]> = [
  ['type', 'Shape'],
  ['fillstk', 'Fill & stroke'],
  ['fill', 'Fill color'],
  ['stk', 'Stroke color'],
  ['sw', 'Stroke width'],
  ['op', 'Opacity'],
  ['so', 'Stroke opacity'],
  ['fo', 'Fill opacity'],
  ['blend', 'Blending mode'],
];
export const SAME_TEXT: Array<[SameKind, string]> = [
  ['font', 'Font family'],
  ['fontStyle', 'Font family & style'],
  ['fontAll', 'Font family, style & size'],
  ['size', 'Font size'],
  ['tfill', 'Text fill color'],
  ['tstk', 'Text stroke color'],
  ['tfillstk', 'Text fill & stroke color'],
];
const LABEL: Record<SameKind, string> = Object.fromEntries(
  [...SAME_SHAPES, ...SAME_TEXT].map(([k, l]) => [k, l.toLowerCase()]),
) as Record<SameKind, string>;
const TEXT_KINDS = new Set(SAME_TEXT.map(([k]) => k));
const PAINTED = ['rect', 'ellipse', 'path', 'text'];

/** what kind of shape a layer is, in words (Rectangle, Star, Line, Text, Image…) */
export function shapeName(l: Layer): string {
  if (isInstance(l)) return 'Symbol instance';
  if (l.type === 'rect') return 'Rectangle';
  if (l.type === 'ellipse') return 'Ellipse';
  if (l.type === 'text') return 'Text';
  if (l.type === 'image') return 'Image';
  if (l.type === 'group') return 'Group';
  if (l.type === 'raw') return 'Imported element';
  if (l.type === 'path') {
    const sh = liveShape(l);
    if (sh) return sh.kind === 'star' ? 'Star' : 'Polygon';
    return isLine(l) ? 'Line' : 'Path';
  }
  return l.type;
}
/** a comparable form of a paint value: colors in lower case with #rgb written out, gradients as JSON */
function paintKey(v: unknown) {
  if (v == null || v === 'none') return 'none';
  if (typeof v !== 'string') return JSON.stringify(v);
  const c = v.trim().toLowerCase();
  return /^#[0-9a-f]{3,4}$/.test(c) ? '#' + [...c.slice(1)].map(x => x + x).join('') : c;
}
const num = (v: unknown, d = 1) => String(Math.round((v == null ? d : +v) * 1000) / 1000);
const fontStyle = (l: Layer) => String(l.geo.weight || '400') + (l.geo.italic ? 'i' : '');

/** the value `kind` compares for this layer, or null when it doesn't apply to it */
export function sameKey(l: Layer, kind: SameKind): string | null {
  if (l.type === 'bone') return null;
  if (kind === 'type') return shapeName(l);
  if (kind === 'op') return num(H.comp(l, S.time).op);
  if (kind === 'blend') return l.blend || 'normal';
  if (TEXT_KINDS.has(kind) && l.type !== 'text') return null;
  if (!PAINTED.includes(l.type)) return null;
  const c = H.comp(l, S.time),
    fill = paintKey(c.fill),
    stk = paintKey(c.stk);
  switch (kind) {
    case 'fill':
    case 'tfill':
      return fill;
    case 'stk':
    case 'tstk':
      return stk;
    case 'fillstk':
    case 'tfillstk':
      return fill + '|' + stk;
    case 'sw':
      return stk === 'none' ? null : num(c.sw, 0);
    case 'so':
      return stk === 'none' ? null : num(c.so);
    case 'fo':
      return fill === 'none' ? null : num(c.fo);
    case 'font':
      return String(l.geo.family || '');
    case 'fontStyle':
      return String(l.geo.family || '') + '|' + fontStyle(l);
    case 'fontAll':
      return String(l.geo.family || '') + '|' + fontStyle(l) + '|' + num(l.geo.size, 16);
    case 'size':
      return num(l.geo.size, 16);
  }
  return null;
}
/** the layers Select same starts from: the selection, or the one selected layer */
export function sameSources(): Layer[] {
  const ls = [...S.selSet].map(id => layerById(id)).filter(Boolean) as Layer[];
  if (ls.length) return ls;
  const l = selLayer();
  return l ? [l] : [];
}
/** which Select same choices apply to these layers (any of them has the value) */
export function sameKinds(ls: Layer | Layer[] | null): SameKind[] {
  const list = (Array.isArray(ls) ? ls : ls ? [ls] : []).filter(Boolean);
  return [...SAME_SHAPES, ...SAME_TEXT].map(([k]) => k).filter(k => list.some(l => sameKey(l, k) != null));
}
/** the layers that match: every visible, unlocked layer sharing the value with one of `from` */
export function sameMatches(kind: SameKind, from: Layer[] = sameSources()): Layer[] {
  const keys = new Set(from.map(l => sameKey(l, kind)).filter(k => k != null));
  if (!keys.size) return [];
  return doc.layers.filter(o => !isHidden(o) && !isLocked(o) && keys.has(sameKey(o, kind) as string));
}
export function selectSame(kind: SameKind) {
  const from = sameSources(),
    matches = sameMatches(kind, from);
  if (!matches.length) return false;
  const ids = new Set(matches.map(o => o.id));
  // the layers it started from stay selected (a hidden or locked one too)
  from.forEach(l => sameKey(l, kind) != null && ids.add(l.id));
  const primary = selLayer(),
    list = [...ids].filter(id => !primary || id !== primary.id);
  if (primary && ids.has(primary.id)) list.push(primary.id);
  selectMany(list);
  const added = ids.size - from.filter(l => ids.has(l.id)).length;
  toast(
    added > 0
      ? `Selected ${ids.size} layers with the same ${LABEL[kind]}.`
      : `No other layer has the same ${LABEL[kind]}.`,
  );
  return true;
}
