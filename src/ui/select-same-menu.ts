// SVGcinema — ui/select-same-menu
// The Select same choices as a menu (core/select-same): "Shapes & text" and, when the selection has a
// text layer, "Text". Each choice shows the selected layers' value on the right (a color swatch, a
// number, a font), or "Mixed" when they differ, and only the choices that apply are listed. The
// same list is the properties panel header's Select same dropdown, the layer right-click menu's
// Select same submenu and the main menu's Edit › Select same.
import type { Layer } from '../model/types';
import { H, esc } from '../core/constants';
import { S } from '../core/state';
import { SAME_SHAPES, SAME_TEXT, sameKey, sameSources, shapeName, type SameKind } from '../core/select-same';
import { type Item, openLayerMenu } from './layer-menu';

const pct = (v: unknown, d = 1) => Math.round((v == null ? d : +v) * 100) + '%';
function swatch(v: unknown) {
  if (v == null || v === 'none') return 'None';
  const bg =
    typeof v === 'string'
      ? v
      : `linear-gradient(90deg, ${((v as any).s || []).map((s: [number, string]) => s[1]).join(', ') || '#888, #ccc'})`;
  return `<i class="sw" style="background:${esc(bg)}"></i>${typeof v === 'string' ? '' : 'Gradient'}`;
}
const STYLE: Record<string, string> = {
  '100': 'Thin',
  '200': 'Extra light',
  '300': 'Light',
  '400': 'Regular',
  '500': 'Medium',
  '600': 'Semibold',
  '700': 'Bold',
  '800': 'Extra bold',
  '900': 'Black',
};
const styleName = (l: Layer) => {
  const w = STYLE[String(l.geo.weight || '400')] || String(l.geo.weight);
  return l.geo.italic ? (w === 'Regular' ? 'Italic' : w + ' italic') : w;
};
const family = (l: Layer) =>
  String(l.geo.family || '')
    .split(',')[0]
    .replace(/["']/g, '')
    .trim();
/** what a choice shows on the right for one layer (HTML) */
export function sameValue(l: Layer, kind: SameKind): string {
  const c = H.comp(l, S.time);
  switch (kind) {
    case 'type':
      return esc(shapeName(l));
    case 'fill':
    case 'tfill':
      return swatch(c.fill);
    case 'stk':
    case 'tstk':
      return swatch(c.stk);
    case 'fillstk':
    case 'tfillstk':
      return swatch(c.fill) + (c.stk && c.stk !== 'none' ? swatch(c.stk) : '');
    case 'sw':
      return Math.round((c.sw || 0) * 100) / 100 + ' px';
    case 'op':
      return pct(c.op);
    case 'so':
      return pct(c.so);
    case 'fo':
      return pct(c.fo);
    case 'blend': {
      const b = l.blend || 'normal';
      return esc(b[0].toUpperCase() + b.slice(1).replace(/-/g, ' '));
    }
    case 'font':
      return esc(family(l));
    case 'fontStyle':
      return esc(styleName(l));
    case 'fontAll':
      return esc(styleName(l) + ' · ' + (l.geo.size || 16) + ' px');
    case 'size':
      return (l.geo.size || 16) + ' px';
  }
  return '';
}
/** the Select same menu for the selection (empty when nothing applies) */
export function sameItems(from: Layer[] = sameSources()): Item[] {
  const group = (list: Array<[SameKind, string]>): Item[] =>
    list
      .map(([k, label]): Item | null => {
        const ls = from.filter(l => sameKey(l, k) != null);
        if (!ls.length) return null;
        const vals = [...new Set(ls.map(l => sameValue(l, k)))];
        return { id: 'same:' + k, label, on: true, ind: true, val: vals.length === 1 ? vals[0] : 'Mixed' };
      })
      .filter(Boolean) as Item[];
  const shapes = group(SAME_SHAPES),
    text = group(SAME_TEXT),
    out: Item[] = [];
  if (shapes.length) out.push({ head: 'Shapes & text' }, ...shapes);
  if (text.length) out.push('-', { head: 'Text (selects text layers only)' }, ...text);
  return out;
}

/** the Select same button in the properties panel's header (none for bones) */
export function sameButton(l: Layer | null, multi = false) {
  if (!l || (!multi && l.type === 'bone')) return '';
  const tip = multi
    ? 'Select same: layers that match any of the selected ones'
    : ['rect', 'ellipse', 'path', 'text'].includes(l.type)
      ? 'Select same: layers with the same fill, stroke, stroke width, opacity, blending mode or type'
      : 'Select same: layers of the same kind, opacity or blending mode';
  return `<button class="ih-same" id="bSame" title="${tip}" aria-label="Select same" aria-haspopup="menu" aria-expanded="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="3" width="8" height="8" rx="1.5" fill="currentColor" fill-opacity="0.22"/><rect x="13.5" y="3" width="8" height="8" rx="1.5" fill="currentColor" fill-opacity="0.22"/><path d="M12 13.5l7.5 3-3.2 1.2-1.3 3.3z" fill="currentColor"/></svg><svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg></button>`;
}
/** Open the Select same choices under the header button, its right edge lined up with the button's. */
export function openSameMenu(b: HTMLElement) {
  const list = sameItems();
  if (!list.length) return;
  const r = b.getBoundingClientRect();
  openLayerMenu(r.left, r.bottom + 4, list);
  const m = document.getElementById('layermenu') as HTMLElement;
  m.classList.add('same-menu');
  m.style.left = Math.max(4, r.right - m.getBoundingClientRect().width) + 'px';
  b.setAttribute('aria-expanded', 'true');
}
