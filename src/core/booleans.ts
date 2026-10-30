// SVGcinema — core/booleans
// Boolean operations on vector layers (rectangles, ellipses, paths, polygons, stars):
//   Union      — everything combined
//   Subtract   — the bottom layer minus the ones above it
//   Intersect  — only where all of them overlap
//   Exclude    — where an odd number of them overlap
// The shapes are combined as they look at the playhead (with all their transforms) into one new path
// layer that takes the bottom layer's place and style. paper.js does the curve maths; it's loaded only
// the first time a boolean is used.
import { featureUsed } from './analytics';
import type { Layer, PathData, PathNode } from '../model/types';
import { H, clone, r2 } from './constants';
import { beginEdit } from './history';
import { S, doc, mkLayer } from './state';
import { shapeNodes } from './layer-ops';
import { isLocked, pidOf, pmOf, selectedRoots } from '../model/tree';
import { localMatrix } from '../render/overlay';
import { toast } from '../io/open';

export type BoolOp = 'unite' | 'subtract' | 'intersect' | 'exclude';
export const BOOL_OPS: Array<[BoolOp, string, string]> = [
  ['unite', 'Union', '<path d="M4 8h8v-4h8v12h-8v4H4z"/>'],
  ['subtract', 'Subtract', '<path d="M4 4h12v4H8v8H4z"/><path d="M8 8h12v12H8z" stroke-dasharray="2 2"/>'],
  [
    'intersect',
    'Intersect',
    '<path d="M4 4h12v12H4zM8 8h12v12H8z" stroke-dasharray="2 2"/><path d="M8 8h8v8H8z" fill="currentColor"/>',
  ],
  [
    'exclude',
    'Exclude',
    '<path d="M4 4h12v4H8v8H4zM16 8h4v12H8v-4h8z" fill="currentColor" fill-opacity=".35"/><path d="M4 4h12v12H4zM8 8h12v12H8z"/>',
  ],
];
const VECTOR = ['rect', 'ellipse', 'path'];
/** Selected layers that booleans can combine (bottom first), or null when fewer than two. */
export function boolTargets(): Layer[] | null {
  const ls = selectedRoots()
    .filter(l => VECTOR.includes(l.type) && !isLocked(l))
    .sort((a, b) => doc.layers.indexOf(a) - doc.layers.indexOf(b));
  return ls.length >= 2 ? ls : null;
}
let paperP: Promise<any> | null = null;
function loadPaper() {
  paperP =
    paperP ||
    import('paper/dist/paper-core').then((m: any) => {
      const paper = m.default || m;
      const scope = new paper.PaperScope();
      scope.setup(new scope.Size(1, 1));
      return scope;
    });
  return paperP;
}
/** A layer's outline as SVG path data in document coordinates, at the playhead. */
function docPathData(l: Layer): string {
  const nodes: PathData = l.type === 'path' ? H.comp(l, S.time).d || l.b.d : shapeNodes(l) || [];
  const M = localMatrix(l),
    P = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(M);
  return nodes
    .map(sp => {
      const n = sp.n;
      if (!n.length) return '';
      const a = P(n[0][0], n[0][1]);
      let d = `M${a.x} ${a.y}`;
      const seg = (p: PathNode, q: PathNode) => {
        const c1 = P(p[4], p[5]),
          c2 = P(q[2], q[3]),
          e = P(q[0], q[1]);
        d += `C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${e.x} ${e.y}`;
      };
      for (let i = 0; i < n.length - 1; i++) seg(n[i], n[i + 1]);
      if (sp.c) {
        seg(n[n.length - 1], n[0]);
        d += 'Z';
      }
      return d;
    })
    .join('');
}
export async function booleanOp(op: BoolOp) {
  const ls = boolTargets();
  if (!ls) return toast('Select two or more shapes or paths for a boolean operation.');
  featureUsed('boolean_' + op);
  let paper: any;
  try {
    paper = await loadPaper();
  } catch (e) {
    return toast('Couldn’t load the boolean tools.');
  }
  const items = ls.map(l => new paper.CompoundPath({ pathData: docPathData(l), insert: false }));
  let res = items[0];
  if (op === 'subtract') for (let i = 1; i < items.length; i++) res = res.subtract(items[i], { insert: false });
  else
    for (let i = 1; i < items.length; i++)
      res =
        op === 'unite'
          ? res.unite(items[i], { insert: false })
          : op === 'intersect'
            ? res.intersect(items[i], { insert: false })
            : res.exclude(items[i], { insert: false });
  const paths: any[] = res.children ? res.children.slice() : [res];
  const bottom = ls[0],
    pid = pidOf(bottom),
    PMi = pmOf(pid).inverse(),
    L = (x: number, y: number) => {
      const q = new DOMPoint(x, y).matrixTransform(PMi);
      return [r2(q.x), r2(q.y)];
    };
  const d: PathData = paths
    .filter(p => p.segments && p.segments.length)
    .map(p => ({
      c: !!p.closed,
      n: p.segments.map((sg: any) => {
        const pt = sg.point,
          hi = sg.handleIn,
          ho = sg.handleOut;
        return [...L(pt.x, pt.y), ...L(pt.x + hi.x, pt.y + hi.y), ...L(pt.x + ho.x, pt.y + ho.y)] as PathNode;
      }),
    }));
  if (!d.length) return toast('The shapes don’t overlap, so nothing is left.');
  const ed = beginEdit(),
    c = H.comp(bottom, S.time),
    names: Record<BoolOp, string> = {
      unite: 'Union',
      subtract: 'Subtract',
      intersect: 'Intersect',
      exclude: 'Exclude',
    },
    out = mkLayer(
      'path',
      names[op],
      {},
      {
        fill: c.fill != null ? c.fill : bottom.b.fill,
        stk: c.stk != null ? c.stk : bottom.b.stk,
        sw: c.sw != null ? c.sw : bottom.b.sw,
        op: c.op,
        d,
      },
    );
  out.parent = pid;
  if (bottom.extra) out.extra = clone(bottom.extra);
  // holes come out with opposite winding; even-odd keeps them open in every browser
  if (d.length > 1) out.extra = { ...(out.extra || {}), 'fill-rule': 'evenodd' };
  const at = doc.layers.indexOf(bottom);
  doc.layers = doc.layers.filter(l => !ls.includes(l));
  doc.layers.splice(Math.min(at, doc.layers.length), 0, out);
  S.sel = out.id;
  S.selSet = new Set([out.id]);
  S.keys.clear();
  ed.end({ insp: true });
}
