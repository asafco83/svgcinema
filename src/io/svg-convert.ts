// SVGcinema — io/svg-convert
// Turns an SVG document into editable layers: groups keep their hierarchy and names, transforms become
// position / rotate / skew / scale, shapes keep their geometry and paint (gradients included), text
// stays text, images become assets, filters become Filters, clip paths and masks become mask groups.
// What can't be converted is kept as an "imported element" (raw markup) and listed in the notes.
// An animation reader (SVGator JS or CSS) can add tracks to the layers as they are made.
import type { Layer, PathData, PathNode } from '../model/types';
import { FONTS, H, NOFILL, NS, r3 } from '../core/constants';
import { mkLayer } from '../core/state';
import { N } from '../geometry/nodes';
import { parsePath } from '../geometry/parse-path';
import { addFilter, fxKey } from '../model/filters';
import { webFont } from '../render/fonts';
import { textWidth } from '../render/text-layout';
import {
  type GradSpec,
  type Mat,
  type Rule,
  ID,
  INHERITED,
  apply,
  autoName,
  decodeId,
  kindName,
  meaningless,
  mul,
  normColor,
  num,
  ownProps,
  parseSheet,
  parseTransform,
  placeLayer,
  rgbaStr,
  sc,
  toGrad,
  tr,
  withAlpha,
} from './svg-paint';

export type Props = Record<string, string>;
/** What an animation reader can do while layers are made. */
export interface AnimReader {
  /** project settings found in the file */
  settings: {
    dur?: number;
    it?: number;
    dir?: string;
    fill?: string;
    speed?: number;
    fps?: number;
    trigger?: string;
    out?: string;
  };
  notes: string[];
  /** a wrapper group to fold into the element it wraps: the element, or null */
  unwrap?(g: Element): Element | null;
  /** add tracks to a layer made from `el` (`wraps`: the folded wrappers, outermost first) */
  animate?(l: Layer, el: Element, cv: Converter, wraps: Element[]): void;
  /** called once every layer is made */
  done?(cv: Converter): void;
}
export interface ConvertOptions {
  /** asset id for an image (data URL); dims are its natural size */
  image?(href: string, name: string): { id: string; w: number; h: number } | null;
  anim?: AnimReader | null;
}
const SKIP = ['title', 'desc', 'metadata', 'script', 'style', 'namedview', 'defs', 'foreignObject'];
const DEFS = ['linearGradient', 'radialGradient', 'pattern', 'filter', 'clipPath', 'mask', 'symbol', 'marker'];
/** attributes kept on a layer (written back onto its element) */
const KEEP = [
  'fill-rule',
  'clip-rule',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'paint-order',
  'marker-start',
  'marker-mid',
  'marker-end',
  'vector-effect',
  'pathLength',
  'shape-rendering',
];
export class Converter {
  root: Element;
  rules: Rule[];
  layers: Layer[] = [];
  notes: string[] = [];
  /** ids of definitions still referenced by the layers (kept in the document's defs) */
  refs = new Set<string>();
  /** layer → the element it was made from */
  src = new Map<Layer, Element>();
  rootId: string | null;
  counters: Record<string, number> = {};
  raw = 0;
  /** layers whose origin comes from the file (an animation turns around it) */
  keepOrigin = new Set<Layer>();
  constructor(
    root: Element,
    public opts: ConvertOptions = {},
  ) {
    this.root = root;
    this.rootId = root.getAttribute('id');
    let css = '';
    root.querySelectorAll('style').forEach(s => (css += s.textContent + '\n'));
    this.rules = parseSheet(css);
  }
  get anim() {
    return this.opts.anim || null;
  }
  note(s: string) {
    if (!this.notes.includes(s)) this.notes.push(s);
  }
  byId(id: string | null): Element | null {
    if (!id) return null;
    const all = this.root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) if (all[i].getAttribute('id') === id) return all[i];
    return null;
  }
  /** the id in url(#id) or #id */
  refId(v: string | null | undefined) {
    const m = /url\(\s*["']?#([^"')\s]+)["']?\s*\)/.exec(v || '') || /^#(.+)$/.exec((v || '').trim());
    return m ? m[1] : null;
  }
  href(el: Element) {
    return (
      el.getAttribute('href') ||
      el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
      el.getAttribute('xlink:href') ||
      ''
    );
  }
  /** a layer name from the element (SVGator's names, data-name, Inkscape labels, ids) or its kind */
  nameFor(el: Element | null, kind: string) {
    const id = el && el.getAttribute('id'),
      rid = this.rootId;
    if (el) {
      if (id && rid) {
        const m = new RegExp('^' + rid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-([us])-(.+)$').exec(id);
        if (m) return m[1] === 'u' ? m[2] : autoName(m[2]);
      }
      const lab =
        el.getAttribute('data-name') ||
        el.getAttribute('inkscape:label') ||
        el.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label');
      if (lab) return lab;
      const t = Array.from(el.children).find(c => c.localName === 'title');
      if (t && t.textContent.trim()) return t.textContent.trim();
      if (id && !meaningless(id, rid)) return decodeId(id);
    }
    const k = kindName(kind);
    this.counters[k] = (this.counters[k] || 0) + 1;
    return `${k} ${this.counters[k]}`;
  }
  push(l: Layer, pid: string | null, el: Element | null) {
    l.parent = pid;
    this.layers.push(l);
    if (el) this.src.set(l, el);
    return l;
  }
  /** computed properties: inherited ones from the parent, then the element's own */
  props(el: Element, inh: Props): Props {
    const p: Props = {};
    INHERITED.forEach(k => inh[k] != null && (p[k] = inh[k]));
    return Object.assign(p, ownProps(el, this.rules));
  }
  inheritable(p: Props): Props {
    const o: Props = {};
    INHERITED.forEach(k => p[k] != null && (o[k] = p[k]));
    return o;
  }

  run() {
    this.walk(this.root, null, this.inheritable(this.props(this.root, {})), true);
    if (this.anim && this.anim.done) this.anim.done(this);
    return this;
  }
  walk(node: Element, pid: string | null, inh: Props, top = false) {
    for (const el of Array.from(node.children)) {
      if (el.namespaceURI !== NS) continue;
      const tag = el.localName;
      if (SKIP.includes(tag) || DEFS.includes(tag)) {
        if (tag === 'foreignObject') this.note('HTML content (foreignObject) was left out.');
        continue;
      }
      this.element(el, pid, inh, ID);
    }
    void top;
  }
  /** Convert one element (and its children). `pre`: a transform before the element's own (use x / y,
   *  folded wrappers). */
  element(el: Element, pid: string | null, inh: Props, pre: Mat, wraps: Element[] = []): Layer | null {
    // folded wrappers (SVGator CSS): the element they wrap carries their transforms
    const A = this.anim;
    if (el.localName === 'g' && A && A.unwrap) {
      const inner = A.unwrap(el);
      if (inner) {
        const p = this.props(el, inh);
        return this.element(inner, pid, this.inheritable(p), mul(pre, parseTransform(el.getAttribute('transform'))), [
          ...wraps,
          el,
        ]);
      }
    }
    const p = this.props(el, inh),
      M = mul(pre, parseTransform(el.getAttribute('transform'))),
      clip = this.refId(p['clip-path']),
      mask = this.refId(p.mask),
      clipEl = clip ? this.byId(clip) : null,
      maskEl = mask ? this.byId(mask) : null;
    const tag = el.localName;
    // a clip path / mask on a shape: a mask group around it (on a group, the group itself)
    const isGroup = ['g', 'a', 'switch', 'svg'].includes(tag);
    if ((clipEl || maskEl) && !isGroup) {
      let host: string | null = pid;
      if (clipEl) host = this.maskGroup('clip', clipEl, host, M, el).id;
      if (maskEl) host = this.maskGroup('mask', maskEl, host, M, el).id;
      const l = this.make(el, p, M, host, inh, wraps);
      return l;
    }
    const l = this.make(el, p, M, pid, inh, wraps);
    if (l && isGroup) {
      if (clipEl) this.maskFolderOn(l, 'clip', clipEl);
      if (maskEl) {
        if (clipEl) {
          // both: the clip stays on the group, the mask goes on a group inside it
          const g = mkLayer('group', 'Mask group', {}, NOFILL);
          this.reparentKids(l, g);
          this.maskFolderOn(g, 'mask', maskEl);
        } else this.maskFolderOn(l, 'mask', maskEl);
      }
    }
    return l;
  }
  reparentKids(from: Layer, to: Layer) {
    const ids = new Set<string>();
    this.layers.forEach(k => k.parent === from.id && !k.maskSrc && ids.add(k.id));
    this.push(to, from.id, null);
    this.layers.forEach(k => ids.has(k.id) && (k.parent = to.id));
  }
  /** a mask group for one shape: the group, with its folder drawn with the shape's transform */
  maskGroup(kind: 'clip' | 'mask', def: Element, pid: string | null, M: Mat, el: Element): Layer {
    const g = mkLayer('group', kind === 'clip' ? 'Clip group' : 'Mask group', {}, NOFILL);
    g.o = [0, 0];
    this.push(g, pid, null);
    this.maskFolderOn(g, kind, def, M, el);
    return g;
  }
  /** turn a group into a mask group: a folder (the clip path / mask content) inside it */
  maskFolderOn(g: Layer, kind: 'clip' | 'mask', def: Element, M: Mat = ID, target?: Element) {
    g.mask = kind;
    if (kind === 'mask') {
      const mt = def.getAttribute('mask-type') || this.props(def, {})['mask-type'];
      if (mt !== 'alpha') g.mm = 'lum';
    }
    const F = mkLayer('group', this.nameFor(def, kind === 'clip' ? 'Clip path' : 'Masks'), {}, NOFILL);
    F.maskSrc = true;
    let FM = mul(M, parseTransform(def.getAttribute('transform')));
    const units = def.getAttribute(kind === 'clip' ? 'clipPathUnits' : 'maskContentUnits');
    if (units === 'objectBoundingBox') {
      const b = target ? this.boxOf(target) : null;
      if (b) FM = mul(FM, [b[2], 0, 0, b[3], b[0], b[1]]);
      else this.note('A clip path or mask in object units was placed approximately.');
    }
    placeLayer(F, FM);
    this.push(F, g.id, def);
    this.walk(def, F.id, {});
  }
  /** an element's own box (its geometry, before transforms), when it is easy to know */
  boxOf(el: Element): number[] | null {
    const a = (k: string) => num(el.getAttribute(k), 0, 0);
    switch (el.localName) {
      case 'rect':
      case 'image':
        return [a('x'), a('y'), a('width'), a('height')];
      case 'circle':
        return [a('cx') - a('r'), a('cy') - a('r'), 2 * a('r'), 2 * a('r')];
      case 'ellipse':
        return [a('cx') - a('rx'), a('cy') - a('ry'), 2 * a('rx'), 2 * a('ry')];
      case 'path':
        return H.pathBox(parsePath(el.getAttribute('d')));
    }
    return null;
  }

  /** Make the layer for an element (and its children, for groups). */
  make(el: Element, p: Props, M: Mat, pid: string | null, inh: Props, wraps: Element[]): Layer | null {
    const tag = el.localName;
    let l: Layer | null = null;
    if (['g', 'a', 'switch', 'svg'].includes(tag)) l = this.group(el, p, M, pid);
    else if (tag === 'use') return this.use(el, p, M, pid, inh, wraps);
    else if (tag === 'image') l = this.image(el, el, p, M, pid, ID);
    else if (tag === 'text') l = this.text(el, p, M, pid);
    else l = this.shape(el, p, M, pid);
    if (!l) return null;
    this.common(l, el, p);
    if (this.anim && this.anim.animate) this.anim.animate(l, el, this, wraps);
    return l;
  }
  /** settings every layer shares: opacity, visibility, blending, filters */
  common(l: Layer, el: Element, p: Props) {
    const op = num(p.opacity, 1);
    if (op < 1) l.b.op = r3(Math.max(0, op));
    if (p.display === 'none' || p.visibility === 'hidden' || p.visibility === 'collapse') l.hid = true;
    if (p['mix-blend-mode'] && p['mix-blend-mode'] !== 'normal') l.blend = p['mix-blend-mode'];
    if (p.isolation === 'isolate') l.iso = true;
    if (p.filter && p.filter !== 'none') this.filter(l, p.filter, el);
  }
  group(el: Element, p: Props, M: Mat, pid: string | null): Layer {
    const g = mkLayer('group', this.nameFor(el, el.localName === 'a' ? 'a' : 'g'), {}, NOFILL);
    let inner = M;
    if (el.localName === 'svg') inner = mul(M, this.viewportM(el));
    placeLayer(g, inner);
    if (el.localName === 'a') {
      const u = this.href(el);
      if (u) g.link = { url: u, target: el.getAttribute('target') === '_self' ? '_self' : '_blank' };
    }
    this.push(g, pid, el);
    // a switch shows its first child
    if (el.localName === 'switch') {
      const first = Array.from(el.children).find(c => c.namespaceURI === NS && !SKIP.includes(c.localName));
      if (first) this.element(first, g.id, this.inheritable(p), ID);
    } else this.walk(el, g.id, this.inheritable(p));
    return g;
  }
  /** a nested <svg> / <symbol>: x, y and its viewBox fitted into width × height (meet, centred) */
  viewportM(el: Element, w?: number, h?: number): Mat {
    const x = num(el.getAttribute('x'), 0, 0),
      y = num(el.getAttribute('y'), 0, 0),
      vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
    if (vb.length !== 4 || !vb.every(isFinite) || !vb[2] || !vb[3]) return tr(x, y);
    const W = w != null ? w : num(el.getAttribute('width'), vb[2], 0),
      Hh = h != null ? h : num(el.getAttribute('height'), vb[3], 0),
      pa = el.getAttribute('preserveAspectRatio') || '';
    if (/none/.test(pa)) return mul(tr(x, y), mul(sc(W / vb[2], Hh / vb[3]), tr(-vb[0], -vb[1])));
    const s = Math.min(W / vb[2], Hh / vb[3]);
    return mul(tr(x + (W - vb[2] * s) / 2, y + (Hh - vb[3] * s) / 2), mul(sc(s, s), tr(-vb[0], -vb[1])));
  }
  use(el: Element, p: Props, M: Mat, pid: string | null, inh: Props, wraps: Element[]): Layer | null {
    const t = this.byId(this.refId(this.href(el)));
    if (!t) return null;
    const at = mul(M, tr(num(el.getAttribute('x'), 0, 0), num(el.getAttribute('y'), 0, 0)));
    const ip = this.inheritable(p);
    let l: Layer | null = null;
    if (t.localName === 'image') {
      l = this.image(t, el, this.props(t, ip), at, pid, parseTransform(t.getAttribute('transform')));
      if (l) this.common(l, el, p);
    } else if (t.localName === 'symbol') {
      const g = mkLayer('group', this.nameFor(el, 'g'), {}, NOFILL);
      placeLayer(
        g,
        mul(
          at,
          this.viewportM(
            t,
            num(el.getAttribute('width'), undefined as any, 0),
            num(el.getAttribute('height'), undefined as any, 0),
          ),
        ),
      );
      this.push(g, pid, el);
      this.walk(t, g.id, this.inheritable(this.props(t, ip)));
      this.common(g, el, p);
      l = g;
    } else {
      // another element: drawn here, with the use's styles inherited
      l = this.element(t, pid, ip, at, wraps);
      if (l && el.getAttribute('id')) l.name = this.nameFor(el, t.localName);
      if (l) {
        this.src.set(l, el);
        this.common(l, el, p);
      }
      return l;
    }
    if (l && this.anim && this.anim.animate) this.anim.animate(l, el, this, wraps);
    return l;
  }
  /** an image (or a <use> of one): an image layer with its picture in Assets */
  image(img: Element, el: Element, p: Props, M: Mat, pid: string | null, inner: Mat): Layer | null {
    const href = this.href(img),
      name = this.nameFor(el, 'image');
    const a = /^data:image\//i.test(href) && this.opts.image ? this.opts.image(href, name) : null;
    if (!a) {
      this.note('Linked images (not embedded in the file) were kept as they are.');
      return this.rawLayer(el === img ? img : el, p, pid, M, name);
    }
    let x = num(img.getAttribute('x'), 0, 0),
      y = num(img.getAttribute('y'), 0, 0),
      w = num(img.getAttribute('width'), a.w, 0),
      h = num(img.getAttribute('height'), a.h, 0);
    // fit the picture in its box (preserveAspectRatio, default: meet, centred)
    const pa = img.getAttribute('preserveAspectRatio') || 'xMidYMid meet';
    if (!/none/.test(pa) && a.w && a.h) {
      const s = /slice/.test(pa) ? Math.max(w / a.w, h / a.h) : Math.min(w / a.w, h / a.h),
        fw = a.w * s,
        fh = a.h * s,
        ax = /xMin/.test(pa) ? 0 : /xMax/.test(pa) ? 1 : 0.5,
        ay = /YMin/.test(pa) ? 0 : /YMax/.test(pa) ? 1 : 0.5;
      if (/slice/.test(pa)) this.note('Cropped images (preserveAspectRatio slice) show uncropped.');
      x += (w - fw) * ax;
      y += (h - fh) * ay;
      w = fw;
      h = fh;
    }
    const l = mkLayer('image', name, { x: r3(x), y: r3(y), w: r3(w), h: r3(h), asset: a.id }, NOFILL);
    placeLayer(l, mul(M, inner));
    return this.push(l, pid, el);
  }

  /* ---------- shapes ---------- */

  shape(el: Element, p: Props, M: Mat, pid: string | null): Layer | null {
    const tag = el.localName,
      a = (k: string) => num(el.getAttribute(k), 0, 0);
    let l: Layer | null = null;
    if (tag === 'rect') {
      let rx = el.getAttribute('rx'),
        ry = el.getAttribute('ry');
      if (rx == null || rx === 'auto') rx = ry;
      if (ry == null || ry === 'auto') ry = rx;
      const w = a('width'),
        h = a('height'),
        rxv = Math.min(num(rx, 0, 0), w / 2),
        ryv = Math.min(num(ry, 0, 0), h / 2);
      if (Math.abs(rxv - ryv) > 0.01)
        this.note('Rectangles with different horizontal and vertical corner radii use one radius.');
      l = mkLayer('rect', this.nameFor(el, 'rect'), { x: a('x'), y: a('y'), w, h, rx: r3(Math.min(rxv, ryv)) }, {});
    } else if (tag === 'circle')
      l = mkLayer('ellipse', this.nameFor(el, 'circle'), { cx: a('cx'), cy: a('cy'), rx: a('r'), ry: a('r') }, {});
    else if (tag === 'ellipse') {
      const rx = el.getAttribute('rx'),
        ry = el.getAttribute('ry');
      l = mkLayer(
        'ellipse',
        this.nameFor(el, 'ellipse'),
        {
          cx: a('cx'),
          cy: a('cy'),
          rx: num(rx == null || rx === 'auto' ? ry : rx, 0, 0),
          ry: num(ry == null || ry === 'auto' ? rx : ry, 0, 0),
        },
        {},
      );
    } else {
      let d: PathData | null = null;
      if (tag === 'path') d = parsePath(el.getAttribute('d'));
      else if (tag === 'line') d = [{ c: false, n: [N(a('x1'), a('y1')), N(a('x2'), a('y2'))] }];
      else if (tag === 'polygon' || tag === 'polyline') {
        const v = (el.getAttribute('points') || '')
          .trim()
          .split(/[\s,]+/)
          .map(parseFloat);
        const n: PathNode[] = [];
        for (let i = 0; i + 1 < v.length; i += 2) n.push(N(v[i], v[i + 1]));
        if (n.length >= 2) d = [{ c: tag === 'polygon', n }];
      } else {
        this.raw++;
        return this.rawLayer(el, p, pid, M, this.nameFor(el, tag));
      }
      if (!d || !d.length) return null;
      l = mkLayer('path', this.nameFor(el, tag), {}, { d });
    }
    placeLayer(l, M);
    this.paint(l, el, p, tag === 'line' || tag === 'polyline' ? 'none' : '#000000');
    this.keep(l, el, p);
    return this.push(l, pid, el);
  }
  /** fill / stroke / opacities / dashes */
  paint(l: Layer, el: Element, p: Props, defFill: string) {
    const box = this.localBox(l);
    l.b.fill = this.paintOf(p.fill == null ? defFill : p.fill, p, box);
    const stroke = this.paintOf(p.stroke == null ? 'none' : p.stroke, p, box);
    l.b.stk = stroke;
    const sw = p['stroke-width'] != null ? num(p['stroke-width'], 1, 0) : 1;
    l.b.sw = stroke !== 'none' ? r3(sw) : 0;
    const fo = num(p['fill-opacity'], 1),
      so = num(p['stroke-opacity'], 1);
    if (fo < 1) l.b.fo = r3(Math.max(0, fo));
    if (so < 1) l.b.so = r3(Math.max(0, so));
    const da = p['stroke-dasharray'];
    if (da && da !== 'none') {
      const v = da
        .split(/[\s,]+/)
        .map(parseFloat)
        .filter(isFinite);
      if (v.length && v.some(x => x > 0)) l.extra['stroke-dasharray'] = v.map(r3).join(', ');
    }
    const dof = num(p['stroke-dashoffset'], 0, 0);
    if (dof) l.b.dof = r3(dof);
    void el;
  }
  localBox(l: Layer): number[] | null {
    const G = l.geo;
    if (l.type === 'rect' || l.type === 'image') return [G.x, G.y, G.w, G.h];
    if (l.type === 'ellipse') return [G.cx - G.rx, G.cy - G.ry, 2 * G.rx, 2 * G.ry];
    if (l.type === 'path' && l.b.d) return H.pathBox(l.b.d);
    if (l.type === 'text') {
      const lines = String(G.text || '').split('\n'),
        w = Math.max(...lines.map(s => textWidth(s, G))),
        sz = G.size || 16,
        lh = (G.lh || 1.2) * sz,
        x = G.anchor === 'middle' ? G.x - w / 2 : G.anchor === 'end' ? G.x - w : G.x;
      return [x, G.y - sz * 0.8, w, sz + lh * (lines.length - 1)];
    }
    return null;
  }
  /** a paint value in SVGcinema's terms: a color, 'none' or a gradient (else kept as url(#…)) */
  paintOf(v: string, p: Props, box: number[] | null): any {
    const s = String(v).trim();
    if (!s || s === 'none') return 'none';
    if (s === 'currentColor') return normColor(p.color || '#000000') || '#000000';
    const id = this.refId(s);
    if (id) {
      const g = this.gradient(id);
      if (g) {
        const out = toGrad(g, box);
        if (out) return out;
      }
      const fb = s.replace(/^url\([^)]*\)\s*/, '');
      const ref = this.byId(id);
      if (!ref && fb) return normColor(fb) || 'none';
      if (!ref) return 'none';
      this.refs.add(id);
      if (ref.localName === 'pattern') this.note('Pattern fills were kept as they are (not editable).');
      return `url(#${id})`;
    }
    return normColor(s) || '#000000';
  }
  /** a gradient definition (following href chains for stops and attributes) */
  gradient(id: string, seen = new Set<string>()): GradSpec | null {
    const el = this.byId(id);
    if (!el || seen.has(id) || (el.localName !== 'linearGradient' && el.localName !== 'radialGradient')) return null;
    seen.add(id);
    const base = this.gradient(this.refId(this.href(el)) || '', seen);
    const at = (k: string) => el.getAttribute(k);
    const stops: Array<[number, string]> = [];
    Array.from(el.children)
      .filter(c => c.localName === 'stop')
      .forEach(st => {
        const ss = ownProps(st, this.rules),
          col = normColor(ss['stop-color'] || st.getAttribute('stop-color') || '#000000') || '#000000',
          op = num(ss['stop-opacity'] != null ? ss['stop-opacity'] : st.getAttribute('stop-opacity'), 1),
          o = Math.max(0, Math.min(1, num(st.getAttribute('offset'), 0)));
        stops.push([Math.max(o, stops.length ? stops[stops.length - 1][0] : 0), withAlpha(col, op)]);
      });
    const units =
        at('gradientUnits') || (base ? (base.bbox ? 'objectBoundingBox' : 'userSpaceOnUse') : 'objectBoundingBox'),
      bbox = units !== 'userSpaceOnUse',
      len = (k: string, d: number) => (at(k) != null ? num(at(k), d, bbox ? 0.01 : 0.01) : undefined),
      M = at('gradientTransform') != null ? parseTransform(at('gradientTransform')) : base ? base.M : ID;
    if (!bbox && ['x1', 'x2', 'cx', 'r'].some(k => /%$/.test(at(k) || '')))
      this.note('Gradients sized in percent of the canvas were placed approximately.');
    const s = stops.length ? stops : base ? base.s : [];
    if (el.localName === 'linearGradient') {
      const bp = base && base.kind === 'lin' && base.p ? base.p : [0, 0, 1, 0];
      return {
        kind: 'lin',
        p: [len('x1', 0) ?? bp[0], len('y1', 0) ?? bp[1], len('x2', 1) ?? bp[2], len('y2', 0) ?? bp[3]],
        M,
        s,
        bbox,
      };
    }
    const bc = base && base.kind === 'rad' && base.c ? base.c : [0.5, 0.5];
    if (at('fx') != null || at('fy') != null) this.note('Radial gradients with a moved focal point use their centre.');
    return {
      kind: 'rad',
      c: [len('cx', 0.5) ?? bc[0], len('cy', 0.5) ?? bc[1]],
      r: len('r', 0.5) ?? (base && base.r != null ? base.r : 0.5),
      M,
      s,
      bbox,
    };
  }
  styleOf(el: Element) {
    const o: Props = {};
    String(el.getAttribute('style') || '')
      .split(';')
      .forEach(q => {
        const i = q.indexOf(':');
        if (i > 0) o[q.slice(0, i).trim()] = q.slice(i + 1).trim();
      });
    return o;
  }
  /** attributes kept as they are (line ends, joins, markers, fill rule …) */
  keep(l: Layer, el: Element, p: Props) {
    KEEP.forEach(k => {
      const v = p[k] != null ? p[k] : el.getAttribute(k);
      if (v == null || v === '') return;
      if (k === 'stroke-linecap' && v === 'butt') return;
      if (k === 'stroke-linejoin' && v === 'miter') return;
      if (k === 'fill-rule' && v === 'nonzero') return;
      if (k === 'stroke-miterlimit' && +v === 4) return;
      l.extra[k] = v;
      const r = this.refId(v);
      if (r) this.refs.add(r);
    });
  }
  /** filters: a blur or a drop shadow become editable Filters; anything else is kept as it is */
  filter(l: Layer, v: string, el: Element) {
    const css = /^\s*(blur|drop-shadow)\(/i.exec(v);
    if (css) {
      const m = /blur\(\s*([\d.]+)/i.exec(v);
      if (m) {
        const f = addFilter(l, 'blur');
        l.b[fxKey(f.id, 'sd')] = r3(parseFloat(m[1]));
        return;
      }
    }
    const id = this.refId(v),
      fe = id ? this.byId(id) : null;
    if (!fe) return;
    const prims = Array.from(fe.children).filter(c => c.namespaceURI === NS);
    const blur = prims.length === 1 && prims[0].localName === 'feGaussianBlur' ? prims[0] : null,
      shadow = prims.length === 1 && prims[0].localName === 'feDropShadow' ? prims[0] : null;
    const sd = (e: Element) => {
      const q = (e.getAttribute('stdDeviation') || '0').split(/[\s,]+/).map(parseFloat);
      if (q.length > 1 && Math.abs(q[0] - q[1]) > 1e-6)
        this.note('Blurs with different X and Y amounts use one amount.');
      return r3(q[0] || 0);
    };
    if (blur && (blur.getAttribute('in') || 'SourceGraphic') === 'SourceGraphic') {
      const f = addFilter(l, 'blur');
      l.b[fxKey(f.id, 'sd')] = sd(blur);
      if (l.extra.filter) delete l.extra.filter;
      return;
    }
    if (shadow) {
      const f = addFilter(l, 'shadow'),
        sp = this.props(shadow, {}),
        k = (n: string) => fxKey(f.id, n);
      l.b[k('dx')] = num(shadow.getAttribute('dx'), 2, 0);
      l.b[k('dy')] = num(shadow.getAttribute('dy'), 2, 0);
      l.b[k('sd')] = sd(shadow);
      l.b[k('col')] = normColor(shadow.getAttribute('flood-color') || sp['flood-color'] || '#000000') || '#000000';
      l.b[k('op')] = num(shadow.getAttribute('flood-opacity') || sp['flood-opacity'], 1);
      return;
    }
    l.extra.filter = `url(#${id})`;
    this.refs.add(id);
    this.note('Some filters were kept as they are (not editable).');
    void el;
  }

  /* ---------- text ---------- */

  text(el: Element, p: Props, M: Mat, pid: string | null): Layer | null {
    if (el.querySelector('textPath')) {
      this.note('Text on a path was kept as it is (not editable).');
      return this.rawLayer(el, p, pid, M, this.nameFor(el, 'text'));
    }
    const fx = num(el.getAttribute('x'), 0, 0) + num(el.getAttribute('dx'), 0, 0),
      fy = num(el.getAttribute('y'), 0, 0) + num(el.getAttribute('dy'), 0, 0);
    // lines: the text's own words, then a new line at every tspan that sets y / dy (or x)
    type Run = { s: string; x: number | null; y: number | null; dy: number; p: Props };
    const runs: Run[] = [];
    const preserve = el.getAttribute('xml:space') === 'preserve';
    const clean = (s: string) => (preserve ? s.replace(/[\r\n\t]/g, ' ') : s.replace(/\s+/g, ' '));
    const visit = (node: Element, np: Props, depth: number) => {
      for (const c of Array.from(node.childNodes)) {
        if (c.nodeType === 3 || c.nodeType === 4) {
          const s = clean(c.textContent || '');
          if (s.trim() || (runs.length && s)) runs.push({ s, x: null, y: null, dy: 0, p: np });
        } else if (c.nodeType === 1 && (c as Element).localName === 'tspan') {
          const e = c as Element,
            ep = this.props(e, this.inheritable(np)),
            x = e.getAttribute('x'),
            y = e.getAttribute('y'),
            dy = e.getAttribute('dy');
          const start = runs.length;
          visit(e, ep, depth + 1);
          if (runs.length > start) {
            const r = runs[start];
            if (x != null) r.x = num(x.split(/[\s,]+/)[0], 0, 0);
            if (y != null) r.y = num(y.split(/[\s,]+/)[0], 0, 0);
            if (dy != null) r.dy = num(dy.split(/[\s,]+/)[0], 0, 0);
          }
        }
      }
    };
    visit(el, p, 0);
    type Line = { x: number; y: number; s: string; p: Props; mixed: boolean };
    const lines: Line[] = [];
    let cy = fy;
    runs.forEach(r => {
      const newLine = !lines.length || r.y != null || r.dy !== 0 || r.x != null;
      if (r.y != null) cy = r.y + r.dy;
      else cy += r.dy;
      if (newLine && (lines.length === 0 || r.y != null || r.dy !== 0)) {
        lines.push({
          x: r.x != null ? r.x : lines.length ? lines[lines.length - 1].x : fx,
          y: cy,
          s: r.s,
          p: r.p,
          mixed: false,
        });
      } else {
        const L = lines[lines.length - 1];
        if (r.x != null && L.s.trim()) L.mixed = true;
        if (styleKey(r.p) !== styleKey(L.p)) L.mixed = true;
        L.s += r.s;
      }
    });
    lines.forEach(L => (L.s = preserve ? L.s : L.s.trim()));
    const kept = lines.filter(L => L.s);
    if (!kept.length) return null;
    if (kept.some(L => L.mixed)) this.note('Text with mixed styles in one line uses one style per line.');
    const one = (L: Line, name: string) => this.textLayer(L.s, L.x, L.y, L.p, name);
    // one text: every line starts at the same x with the same style and an even line spacing
    const step = kept.length > 1 ? kept[1].y - kept[0].y : 0,
      even =
        kept.length > 1 &&
        step > 0 &&
        kept.every(
          (L, i) =>
            Math.abs(L.x - kept[0].x) < 0.01 &&
            styleKey(L.p) === styleKey(kept[0].p) &&
            Math.abs(L.y - (kept[0].y + step * i)) < 0.05,
        );
    let l: Layer;
    if (kept.length === 1 || even) {
      l = one(kept[0], this.nameFor(el, 'text'));
      l.geo.text = kept.map(L => L.s).join('\n');
      if (kept.length > 1) l.geo.lh = r3(step / (l.geo.size || 16));
      placeLayer(l, M);
      return this.push(l, pid, el);
    }
    // lines placed apart: a group with a text per line
    const g = mkLayer('group', this.nameFor(el, 'text'), {}, NOFILL);
    placeLayer(g, M);
    this.push(g, pid, el);
    kept.forEach(L => {
      const t = one(L, L.s.slice(0, 40));
      t.o = [0, 0];
      this.push(t, g.id, null);
    });
    return g;
  }
  textLayer(s: string, x: number, y: number, p: Props, name: string): Layer {
    const fam = family(p['font-family']),
      w = String(p['font-weight'] || '400'),
      weight =
        w === 'bold' || w === 'bolder' ? '700' : w === 'normal' || w === 'lighter' ? '400' : String(parseInt(w) || 400);
    const geo: any = {
      x: r3(x),
      y: r3(y),
      text: s,
      size: r3(num(p['font-size'], 16, 0) || 16),
      family: fam,
      weight,
      anchor: p['text-anchor'] || 'start',
    };
    if (/italic|oblique/.test(p['font-style'] || '')) geo.italic = true;
    const deco = (p['text-decoration'] || '').match(/underline|overline|line-through/g);
    if (deco) geo.deco = deco.join(' ');
    const ls = num(p['letter-spacing'], 0, 0);
    if (ls) geo.ls = r3(ls);
    const l = mkLayer('text', name, geo, {});
    this.paint(l, null as any, p, '#000000');
    return l;
  }

  /** an element kept as it is: it can still move, turn, scale and fade */
  rawLayer(el: Element, p: Props, pid: string | null, M: Mat, name: string): Layer {
    const c = el.cloneNode(true) as Element;
    c.removeAttribute('transform');
    // what it inherited is written onto it, so it looks the same on its own
    INHERITED.forEach(k => {
      if (p[k] != null && !c.getAttribute(k) && k !== 'visibility') c.setAttribute(k, p[k]);
    });
    const markup = new XMLSerializer().serializeToString(c);
    (markup.match(/url\(\s*#([^)\s]+)\s*\)|href="#([^"]+)"/g) || []).forEach(m => {
      const id = this.refId(m.startsWith('href') ? m.slice(6, -1) : m);
      if (id) this.refs.add(id);
    });
    const l = mkLayer('raw', name, { markup }, NOFILL);
    placeLayer(l, M);
    this.note('Some elements were kept as they are: they can move, turn, scale and fade, but not be edited.');
    return this.push(l, pid, el);
  }

  /** The definitions the layers still use (gradients that couldn't be converted, patterns, filters,
   *  markers …), with whatever they refer to. */
  defsMarkup(): string {
    const ser = new XMLSerializer(),
      done = new Set<string>(),
      out: string[] = [];
    const add = (id: string) => {
      if (done.has(id)) return;
      done.add(id);
      const e = this.byId(id);
      if (!e) return;
      const s = ser.serializeToString(e);
      out.push(s);
      (s.match(/url\(\s*#[^)\s]+\s*\)|href="#[^"]+"/g) || []).forEach(m => {
        const r = this.refId(m.startsWith('href') ? m.slice(6, -1) : m);
        if (r) add(r);
      });
    };
    this.refs.forEach(add);
    return out.join('');
  }
}
/** the first font family, without quotes or SVGator's prefix ("e…1:::Roboto"); generic families map to
 *  the basic stacks */
export function family(v: string | undefined): string {
  const first = String(v || '')
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^.*:::/, '');
  if (!first) return FONTS[0][0];
  if (webFont(first)) return first;
  const gen: Record<string, string> = {
    'sans-serif': FONTS[0][0],
    'system-ui': FONTS[0][0],
    serif: FONTS[1][0],
    monospace: FONTS[2][0],
  };
  if (gen[first]) return gen[first];
  // a web font in other casing
  const wf = webFont(first.replace(/\b\w/g, c => c.toUpperCase()));
  return wf ? wf.family : first;
}
function styleKey(p: Props) {
  return ['font-family', 'font-size', 'font-weight', 'font-style', 'fill', 'stroke', 'text-anchor', 'letter-spacing']
    .map(k => p[k] || '')
    .join('|');
}
export { rgbaStr, apply };
