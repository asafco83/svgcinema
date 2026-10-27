// SVGcinema — core/plain-path
// Rectangles, ellipses, polygons and stars become plain paths before their nodes are edited, morphed,
// pinned or stretched out of shape. An animated corner radius can't stay a Radius track on a plain path,
// so its keyframes are baked into Morph keyframes (same times, easing and curves): the animation looks
// the same afterwards.
import type { Layer, PathData } from '../model/types';
import { H, clone } from './constants';
import { ellNodes, equalizeTrack, rectNodes } from '../geometry/nodes';

/** Forgets keyframes that no longer exist in the key selection (set by core/state, which this module
 *  can't import: core/constants uses it while state is still loading). */
export const dropKeys: { fn: ((q: unknown) => void) | null } = { fn: null };

/** Does the layer have to become a plain path first (a rectangle, an ellipse, or a polygon / star)? */
export function needsPlainPath(l: Layer) {
  return !!l && (l.type === 'rect' || l.type === 'ellipse' || (l.type === 'path' && !!l.shape));
}
/** Turn the layer into a plain path, keeping how it looks at every moment. Call it inside an edit.
 *  Returns false when there is nothing to convert. */
export function plainPath(l: Layer): boolean {
  if (!needsPlainPath(l)) return false;
  const rt = l.t.rad && l.t.rad.length ? l.t.rad : null,
    bake = (nodes: (rad: number) => PathData) =>
      rt.map(q => {
        const k = clone(q);
        k[1] = nodes(q[1]);
        return k;
      });
  if (l.type === 'rect' || l.type === 'ellipse') {
    const G = l.geo;
    l.b.d = l.type === 'rect' ? rectNodes(G) : ellNodes(G);
    if (rt && l.type === 'rect') l.t.d = bake(rad => rectNodes({ ...G, rx: rad }));
    l.type = 'path';
    l.geo = {};
  } else {
    // a polygon / star: an animated radius rebuilt the path at every moment; it becomes Morph keys,
    // unless the path already has its own Morph keys (they are what is shown from now on)
    const sh = l.shape;
    if (rt && !(l.t.d && l.t.d.length)) l.t.d = bake(rad => (H as any).poly(sh, rad, true));
    delete l.shape;
  }
  if (rt && dropKeys.fn) rt.forEach(q => dropKeys.fn(q));
  delete l.t.rad;
  if (l.ft) {
    delete l.ft.rad;
    if (!Object.keys(l.ft).length) delete l.ft;
  }
  if (l.t.d && l.t.d.length) equalizeTrack(l);
  return true;
}
