// SVGcinema — core/masks
// Masks and clipping paths. "Create mask" puts the selected layers in a mask group: the top layer goes
// into a "Masks" folder inside it, and everything else in the group shows only where the mask is
// (by the mask's opacity, so soft and semi-transparent masks work; or by its brightness, Mask mode).
// A clipping path is the same group
// but only the mask's shape counts (its colors, strokes and opacity are ignored).
// Mask layers stay ordinary layers: they can be moved, edited and animated.
import { featureUsed } from './analytics';
import type { Layer } from '../model/types';
import { NOFILL } from './constants';
import { beginEdit } from './history';
import { S, doc, mkLayer } from './state';
import { isLocked, kids, pidOf, pmOf, reparentKeep, selectedRoots } from '../model/tree';
import { ungroup } from '../ui/layers-panel';

export function canMask() {
  const r = selectedRoots();
  return r.length >= 2 && !r.some(isLocked);
}
/** The group's mask folder, when it is a mask group. */
export function maskFolder(g: Layer, list = doc.layers) {
  return g && g.mask ? kids(g.id, list).find(k => k.maskSrc) || null : null;
}
export function makeMask(kind: 'mask' | 'clip') {
  if (!canMask()) return;
  featureUsed(kind);
  const roots = selectedRoots(),
    order = (l: Layer) => doc.layers.indexOf(l),
    top = roots.reduce((a, b) => (order(b) > order(a) ? b : a)),
    pid = pidOf(top),
    PM = pmOf(pid),
    ed = beginEdit();
  const n = doc.layers.filter(l => l.mask === kind).length + 1,
    G = mkLayer('group', (kind === 'clip' ? 'Clip group' : 'Mask group') + (n > 1 ? ' ' + n : ''), {}, NOFILL),
    F = mkLayer('group', kind === 'clip' ? 'Clip path' : 'Masks', {}, NOFILL);
  G.mask = kind;
  G.parent = pid;
  F.maskSrc = true;
  F.parent = G.id;
  roots.forEach(l => {
    if (pidOf(l) !== pid) reparentKeep(l, PM);
    l.parent = l === top ? F.id : G.id;
  });
  // the folder sits above the masked layers, the group where the top layer was
  const at = order(top) + 1;
  doc.layers.splice(at, 0, F, G);
  S.lexp[G.id] = true;
  S.lexp[F.id] = true;
  S.sel = G.id;
  S.selSet = new Set([G.id]);
  S.keys.clear();
  ed.end({ insp: true });
}
/** Undo a mask group: its layers (the mask included) go back to where the group was, keeping their
 *  place on the canvas, like Ungroup. */
export function releaseMask(g: Layer) {
  if (!g || !g.mask) return;
  const F = maskFolder(g);
  delete g.mask;
  if (F) {
    delete F.maskSrc;
    ungroup(F);
  }
  ungroup(g);
}
/** Markup for a mask group's content: the mask definition and the masked layers. */
export function maskedContent(g: Layer, pre: string, folderSVG: string, othersSVG: string, hidden: boolean): string {
  if (hidden || !folderSVG) return othersSVG;
  const id = pre + g.id + '-mask',
    clip = g.mask === 'clip';
  // a clipping path is a mask that only looks at shapes
  const css = clip
    ? `<style>#${id} *{fill:#fff!important;fill-opacity:1!important;stroke:none!important;opacity:1!important;filter:none!important}</style>`
    : '';
  // by opacity (alpha) unless the group masks by brightness (luminance)
  const mt = !clip && g.mm === 'lum' ? 'luminance' : 'alpha';
  return `${css}<mask id="${id}" mask-type="${mt}" style="mask-type:${mt}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000">${folderSVG}</mask><g mask="url(#${id})">${othersSVG}</g>`;
}
