// SVGcinema — core/layer-ops
import type { Layer, PathData } from '../model/types';
import { H, clone, fmt, r2, r3, xfp } from './constants';
import { beginEdit } from './history';
import { S, doc, layerById, sortTrack } from './state';
import { facesFor, needsShaping, outlineD, prepareFonts } from '../render/fonts';
import { parsePath } from '../geometry/parse-path';
import { alignTo, ellNodes, equalizeTrack, equalizeValues, rectNodes } from '../geometry/nodes';
import { toast } from '../io/open';
import { isHidden } from '../model/tree';
import { localMatrix } from '../render/overlay';
import { renderInspector } from '../ui/inspector';
import { needsPlainPath, plainPath } from './plain-path';

/** can this text layer be turned into shapes? (its font has to be one the app can read: a Google Font
 *  or a font on this computer, and Arabic-script letters would need joining) */
export function textConvertible(l: Layer) {
  return !!l && l.type === 'text' && facesFor(l.geo).length > 0 && !needsShaping(l.geo.text);
}
/** Text ▸ shapes: the letters become one path layer (same name, place, style and animation). */
export async function textToPath(l: Layer) {
  const G = l.geo;
  if (!facesFor(G).length)
    return toast(
      'Basic fonts look different on every computer, so they can’t become shapes. Pick a Google Font or a font on this computer first.',
    );
  if (needsShaping(G.text)) return toast('Arabic-script text can’t become shapes yet: its letters need joining.');
  if (!String(G.text || '').trim()) return toast('The text is empty.');
  await prepareFonts([G], 'outline');
  const d = outlineD(G);
  if (!d || !layerById(l.id) || l.type !== 'text')
    return toast('Couldn’t load the font, so the text wasn’t converted.');
  const ed = beginEdit();
  l.b.d = parsePath(d);
  l.type = 'path';
  l.geo = {};
  ed.end({ insp: true });
  toast('Converted to shapes. You can now edit the letters’ nodes; the text can’t be edited any more.');
}
export function convertToPath(l: Layer) {
  if (l.type === 'text') {
    textToPath(l);
    return;
  }
  if (!needsPlainPath(l)) return;
  const ed = beginEdit();
  plainPath(l);
  ed.end({ insp: true });
  toast('Converted to a path. You can now edit nodes and morph it.');
}
export function shapeNodes(l: Layer): PathData | null {
  if (l.type === 'path') return clone(H.get(l, 'd', S.time));
  if (l.type === 'rect') return rectNodes(l.geo);
  if (l.type === 'ellipse') return ellNodes(l.geo);
  return null;
}
export function morphTo(l: Layer, tg: Layer) {
  let tn = shapeNodes(tg);
  if (!tn || !tn.length) return;
  if (isHidden(tg)) {
    toast('Show the target layer first so its position can be read.');
    renderInspector();
    return;
  }
  const M = localMatrix(l).inverse().multiply(localMatrix(tg));
  tn.forEach(sp =>
    sp.n.forEach(q => {
      for (let k = 0; k < 6; k += 2) {
        const p = xfp(M, q[k], q[k + 1]);
        q[k] = r2(p.x);
        q[k + 1] = r2(p.y);
      }
    }),
  );
  const ed = beginEdit();
  // rectangles, ellipses, polygons and stars morph as plain paths (an animated radius is kept)
  plainPath(l);
  let t = S.time;
  if (t < 0.01) t = Math.min(doc.dur, 1);
  if (!l.t.d || !l.t.d.length) l.t.d = [[0, clone(l.b.d), 'inOut']];
  const cur = clone(H.get(l, 'd', t));
  equalizeValues([cur, tn]);
  tn = alignTo(cur, tn);
  const ex = l.t.d.find(q => Math.abs(q[0] - t) < 0.005);
  if (ex) ex[1] = tn;
  else {
    l.t.d.push([r3(t), tn, 'inOut']);
    sortTrack(l.t.d);
  }
  const prev = l.t.d[l.t.d.findIndex(q => q[1] === tn) - 1];
  if (prev && prev[2] === 'ease') prev[2] = 'inOut';
  equalizeTrack(l);
  tg.hid = true;
  S.time = t;
  S.ptime = t;
  S.exp[l.id] = true;
  ed.end({ insp: true });
  toast(`Morph keyframe added at ${fmt(t)}s. “${tg.name}” is now hidden.`);
}
