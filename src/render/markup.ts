// SVGcinema — render/markup
import { filterSVG } from '../model/filters';
import { anchorX, textDir, textLines } from './text-layout';
import { ensureFaces, facesFor, familyCSS, isLocalFamily, outlineD, webFont } from './fonts';
import type { Composite } from '../runtime/engine';
import type { Layer } from '../model/types';
import { H, esc, r3 } from '../core/constants';
import { isBox, kids } from '../model/tree';
import { maskFolder, maskedContent } from '../core/masks';
import { meshable } from '../model/mesh';
import { drawOrder, ownOrderBone } from '../model/draw-order';

/** How markup is produced: for the editor canvas or for an exported file. */
export interface MarkupCtx {
  /** element id prefix */
  pre: string;
  /** seconds */
  t: number;
  editor?: boolean;
  /** editor: asset id → URL */
  href?: (id: string) => string;
  /** export: asset id → symbol id (or empty to skip) */
  useImg?: (id: string) => string | null | undefined;
  /** export: how web fonts are written (outlines, or text with an embedded font) */
  fonts?: 'outline' | 'embed';
  /** export: font faces that need embedding (filled while writing markup) */
  faces?: Set<string>;
}
export function attrs(o: Record<string, unknown>) {
  let s = '';
  for (const k in o) {
    const v = o[k];
    if (v == null || v === '') continue;
    s += ` ${k}="${esc(v)}"`;
  }
  return s;
}
export function tfStr(c: Composite) {
  const sk = (c.kx ? ` skewX(${r3(c.kx)})` : '') + (c.ky ? ` skewY(${r3(c.ky)})` : ''),
    // bones scale in their own frame: W along the bone, H across it
    bf = !!c.ba && c.sx !== c.sy,
    sc = bf
      ? `rotate(${r3(c.ba)}) scale(${r3(c.sx)},${r3(c.sy)}) rotate(${r3(-c.ba)})`
      : `scale(${r3(c.sx)},${r3(c.sy)})`;
  const q = c.cp,
    // a child bone that doesn't inherit scale cancels its parent bone's scale around its joint
    cs = q
      ? `translate(${r3(q[3])},${r3(q[4])}) rotate(${r3(q[0])}) scale(${r3(1 / q[1])},${r3(1 / q[2])}) rotate(${r3(-q[0])}) translate(${r3(-q[3])},${r3(-q[4])}) `
      : '';
  return `${cs}translate(${r3(c.x)},${r3(c.y)}) rotate(${r3(c.r)})${sk} ${sc} translate(${r3(-c.ox)},${r3(-c.oy)})`;
}
/** A layer's stroke alignment where it applies: closed shapes (rectangles, ellipses, text, and paths
 *  whose every part is closed). On open paths a stroke can only be centred. */
export function canAlign(l: Layer) {
  if (l.type === 'rect' || l.type === 'ellipse' || l.type === 'text') return true;
  const d = l.type === 'path' ? l.b.d : null;
  return Array.isArray(d) && d.length > 0 && d.every((p: any) => p && p.c);
}
export function alignOf(l: Layer): 'in' | 'out' | null {
  return l.al && canAlign(l) ? l.al : null;
}
const HUGE = 'x="-100000" y="-100000" width="200000" height="200000"';
/** A shape with an aligned stroke (its stroke drawn at twice the width): a stroke-less copy of the shape
 *  (`-sf`, kept in step by the runtime), and the shape clipped to that copy (inside) or masked to
 *  outside it (outside), with the copy drawing the fill so a see-through fill shows no stroke under it. */
function alignedSVG(id: string, inner: string, al: 'in' | 'out') {
  // the copy: the shape's own tag with its id and stroke attributes changed
  const tw = inner.replace(new RegExp(`<(\\w+)([^>]*?) id="${id}-s"([^>]*?)(/?)>`), (_m, tag, a1, a2, sl) => {
    const at = (a1 + a2).replace(/\s(?:stroke(?:-[a-z]+)?|pathLength)="[^"]*"/g, '');
    return `<${tag}${at} id="${id}-sf" stroke="none"${sl}>`;
  });
  const own = tw.match(new RegExp(`<(\\w+)[^>]* id="${id}-sf"[\\s\\S]*?(?:/>|</\\1>)`)),
    copy = own ? own[0] : '',
    clip = `<clipPath id="${id}-sc"><use href="#${id}-sf"/></clipPath>`;
  if (al === 'in') return `<defs>${copy}${clip}</defs><g clip-path="url(#${id}-sc)">${inner}</g>`;
  return (
    `<defs>${clip}<mask id="${id}-sm" maskUnits="userSpaceOnUse" ${HUGE}><rect ${HUGE} fill="#fff"/>` +
    `<g clip-path="url(#${id}-sc)"><rect ${HUGE} fill="#000"/></g></mask></defs>${copy}<g mask="url(#${id}-sm)">${inner}</g>`
  );
}
export function layerSVG(l: Layer, ctx: MarkupCtx, c: Composite, children?: string) {
  const id = ctx.pre + l.id,
    G = l.geo;
  const a: Record<string, any> = Object.assign({}, l.extra || {});
  a.id = id + '-s';
  if (l.xf) a.transform = l.xf;
  // gradients: a <linearGradient> / <radialGradient> next to the shape (the runtime updates it)
  let grads = '';
  const paint = (v: any, suf: string) => {
    if (!H.isG(v)) return v;
    const gid = id + suf,
      tag = v.g === 'rad' ? 'radialGradient' : 'linearGradient',
      at = H.gAttrs(v);
    grads += `<${tag} id="${gid}"${Object.keys(at)
      .map(k => ` ${k}="${at[k]}"`)
      .join('')}>${v.s
      .map((q: [number, string]) => {
        const c = H.pc(q[1]) || [0, 0, 0, 1];
        return `<stop offset="${r3(q[0])}" stop-color="rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})" stop-opacity="${r3(c[3])}"/>`;
      })
      .join('')}</${tag}>`;
    return `url(#${gid})`;
  };
  if (c.fill != null) a.fill = paint(c.fill, '-gf');
  if (c.stk != null) a.stroke = paint(c.stk, '-gs');
  const al = alignOf(l);
  // an aligned stroke is drawn twice as wide, and half of it cut away (alignedSVG)
  if (c.sw != null && (c.sw > 0 || (l.t.sw && l.t.sw.length))) a['stroke-width'] = r3(c.sw * (al ? 2 : 1));
  else if (al) a['stroke-width'] = 2;
  if (c.trim) {
    const td = H.trimDash(c.trim);
    a.pathLength = 100;
    a['stroke-dasharray'] = td[0];
    a['stroke-dashoffset'] = td[1];
  } else {
    if (c.dof != null && (c.dof !== 0 || (l.t.dof && l.t.dof.length))) a['stroke-dashoffset'] = r3(c.dof);
    if (c.da) a['stroke-dasharray'] = H.dashStr(c.da);
  }
  if (c.fo != null && (c.fo < 1 || (l.t.fo && l.t.fo.length))) a['fill-opacity'] = r3(c.fo);
  if (c.so != null && (c.so < 1 || (l.t.so && l.t.so.length))) a['stroke-opacity'] = r3(c.so);
  const css = [l.blend && l.blend !== 'normal' ? `mix-blend-mode:${l.blend}` : '', l.iso ? 'isolation:isolate' : '']
    .filter(Boolean)
    .join(';');
  if (css) a.style = a.style ? a.style.replace(/;?\s*$/, ';') + css : css;
  const fx = filterSVG(l, ctx.pre, k => H.get(l, k, ctx.t));
  if (fx) a.filter = `url(#${id}-fx)`;
  // an aligned stroke: the filter and blending apply to the whole result (stroke, fill and copy)
  let wrapA = '';
  if (al && (a.filter || a.style)) {
    wrapA = attrs({ filter: a.filter, style: a.style });
    delete a.filter;
    delete a.style;
  }
  let inner: string;
  // an animated size: the box at this moment
  const gb = c.gb ? c.gb.map(r3) : null;
  if (l.type === 'rect') {
    Object.assign(
      a,
      gb ? { x: gb[0], y: gb[1], width: gb[2], height: gb[3] } : { x: G.x, y: G.y, width: G.w, height: G.h },
    );
    const rx = c.rad != null ? r3(Math.max(0, c.rad)) : G.rx;
    if (rx) a.rx = rx;
    inner = `<rect${attrs(a)}/>`;
  } else if (l.type === 'ellipse') {
    Object.assign(
      a,
      gb
        ? { cx: r3(gb[0] + gb[2] / 2), cy: r3(gb[1] + gb[3] / 2), rx: r3(gb[2] / 2), ry: r3(gb[3] / 2) }
        : { cx: G.cx, cy: G.cy, rx: G.rx, ry: G.ry },
    );
    inner = `<ellipse${attrs(a)}/>`;
  } else if (l.type === 'path') {
    a.d = H.dstr(c.d);
    inner = `<path${attrs(a)}/>`;
  } else if (l.type === 'text') {
    const lines = textLines(G),
      ax = anchorX(G);
    Object.assign(a, {
      x: ax,
      y: G.y,
      'font-size': G.size,
      'font-family': familyCSS(G.family),
      'font-weight': G.weight,
      'font-style': G.italic ? 'italic' : null,
      'text-decoration': G.deco || null,
      'letter-spacing': G.ls ? r3(G.ls) : null,
      'text-anchor': G.anchor,
      direction: textDir(G) === 'rtl' ? 'rtl' : null,
    });
    const lh = r3((G.lh || 1.2) * (G.size || 16)),
      wf = webFont(G.family) || isLocalFamily(G.family),
      od = wf && !ctx.editor && ctx.fonts === 'outline' ? outlineD(G) : null;
    if (wf && ctx.editor) ensureFaces(G);
    if (wf && !ctx.editor && !od && ctx.faces) facesFor(G).forEach(fc => ctx.faces.add(fc.key));
    if (od) {
      [
        'x',
        'y',
        'font-size',
        'font-family',
        'font-weight',
        'font-style',
        'text-decoration',
        'letter-spacing',
        'text-anchor',
        'direction',
      ].forEach(k => delete a[k]);
      a.d = od;
    }
    inner = od
      ? `<path${attrs(a)}/>`
      : lines.length === 1
        ? `<text${attrs(a)}>${esc(lines[0])}</text>`
        : `<text${attrs(a)}>${lines.map((s, i) => `<tspan x="${r3(ax)}"${i ? ` dy="${lh}"` : ''}>${esc(s) || ' '}</tspan>`).join('')}</text>`;
    // editor: a fixed-width text box is selectable (and measured) across its whole width
    if (ctx.editor && G.wrap && G.ww > 0) {
      const sz = G.size || 16;
      inner =
        `<rect class="cin-tbox" x="${r3(G.x)}" y="${r3(G.y - sz * 0.8 - (lh - sz) / 2)}" width="${r3(G.ww)}" height="${r3(Math.max(1, lines.length) * lh)}" fill="transparent"/>` +
        inner;
    }
  } else if (l.type === 'image') {
    Object.assign(
      a,
      gb ? { x: gb[0], y: gb[1], width: gb[2], height: gb[3] } : { x: G.x, y: G.y, width: G.w, height: G.h },
    );
    if (ctx.editor) {
      a.href = ctx.href(G.asset);
      a.preserveAspectRatio = 'none';
      inner = `<image${attrs(a)}/>`;
    } else {
      const sym = ctx.useImg(G.asset);
      inner = sym ? `<use${attrs(Object.assign(a, { href: '#' + sym }))}/>` : '';
    }
  } else if (isBox(l)) inner = `<g${attrs(a)}>${children || ''}</g>`;
  else inner = `<g${attrs(a)}>${G.markup || ''}</g>`;
  if (al && inner) {
    inner = alignedSVG(id, inner, al);
    if (wrapA) inner = `<g${wrapA}>${inner}</g>`;
  }
  const mesh = meshOf(l);
  if (mesh) inner = meshSVG(l, id, inner, mesh, H.meshMats(l, ctx.t));
  return `<g id="${id}" transform="${tfStr(c)}" opacity="${r3(c.op)}"${ctx.editor ? ` data-lid="${l.id}"` : ''}>${fx}${grads}${inner}</g>`;
}
export function markup(list: Layer[], pid: string | null, ctx: MarkupCtx): string {
  const P = pid ? list.find(l => l.id === pid) : null,
    // a rig with its own draw order draws its bones' artwork apart (after the rig's top bone)
    own = !!P && ownOrderBone(P, list);
  return kids(pid, list)
    .filter(l => !l.hid && !(own && l.type !== 'bone'))
    .map(l => layerMarkup(list, l, ctx) + (l.type === 'bone' && l.dord && !own ? orderedArtwork(list, l, ctx) : ''))
    .join('');
}
function layerMarkup(list: Layer[], l: Layer, ctx: MarkupCtx) {
  const inner = l.mask ? maskGroupSVG(list, l, ctx) : isBox(l) ? markup(list, l.id, ctx) : '';
  const svg = layerSVG(l, ctx, H.comp(l, ctx.t), inner);
  // a hyperlink wraps the layer in <a> in exports (in the editor clicks select)
  return l.link && !ctx.editor
    ? `<a href="${esc(l.link.url)}"${l.link.target === '_self' ? '' : ' target="_blank" rel="noopener"'} style="cursor:pointer">${svg}</a>`
    : svg;
}
const m6 = (v: number) => Math.round(v * 1e6) / 1e6;
/** a rig's artwork in its own draw order, each piece in a wrapper carrying the bones' transforms from
 *  the rig's top bone down to the piece's bone */
function orderedArtwork(list: Layer[], top: Layer, ctx: MarkupCtx) {
  const order = drawOrder(top, list) || [],
    up = top.parent ? list.find(l => l.id === top.parent) : null;
  // a hidden bone hides its artwork, as with nesting
  const shown = (l: Layer) => {
    let x: Layer | undefined = l,
      g = 0;
    while (x && x !== top && g++ < 100) {
      if (x.hid) return false;
      x = list.find(b => b.id === x.parent);
    }
    return true;
  };
  return order
    .filter(shown)
    .map(l => {
      const bone = list.find(b => b.id === l.parent),
        M = bone ? H.worldOf(bone, ctx.t, up) : [1, 0, 0, 1, 0, 0];
      // editor: the wrapper names the bone, so a click on the artwork still finds its bones (stage-input)
      return `<g id="${ctx.pre}${l.id}-w" transform="matrix(${M.map(m6).join(',')})"${ctx.editor && bone ? ` data-dw="${bone.id}"` : ''}>${layerMarkup(list, l, ctx)}</g>`;
    })
    .join('');
}
function maskGroupSVG(list: Layer[], g: Layer, ctx: MarkupCtx): string {
  const F = maskFolder(g, list),
    others = kids(g.id, list).filter(k => k !== F && !k.hid);
  const othersSVG: string = others
    .map(
      k =>
        layerSVG(
          k,
          ctx,
          H.comp(k, ctx.t),
          k.mask ? maskGroupSVG(list, k, ctx) : isBox(k) ? markup(list, k.id, ctx) : '',
        ) + (k.type === 'bone' && k.dord ? orderedArtwork(list, k, ctx) : ''),
    )
    .join('');
  const folderSVG = F && !F.hid ? layerSVG(F, ctx, H.comp(F, ctx.t), markup(list, F.id, ctx)) : '';
  return maskedContent(g, ctx.pre, folderSVG, othersSVG, !F || !!F.hid);
}
/** the mesh an image, text or group with pins bends through, if it has one */
export function meshOf(l: Layer) {
  return l.pins && l.pins.length && meshable(l) && l.mesh && l.mesh.t.length ? l.mesh : null;
}
/** pinned content drawn through its mesh: the content itself stays in place but hidden (the runtime
 *  keeps animating it), and each triangle shows it clipped to the triangle at rest, moved by the
 *  triangle's matrix. Triangles add up (plus-lighter) inside an isolated group, so their antialiased
 *  edges sum to full coverage instead of leaving hairline seams. */
function meshSVG(l: Layer, id: string, inner: string, M: NonNullable<Layer['mesh']>, ms: number[][]) {
  let clips = '',
    tris = '';
  M.t.forEach((T, k) => {
    const [a, b, c] = T.map(i => M.v[i]);
    clips += `<clipPath id="${id}-c${k}"><path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}L${c[0]} ${c[1]}Z"/></clipPath>`;
    tris += `<g id="${id}-m${k}" transform="matrix(${(ms[k] || [1, 0, 0, 1, 0, 0]).map(m6).join(',')})" style="mix-blend-mode:plus-lighter"><use href="#${id}-s" clip-path="url(#${id}-c${k})"/></g>`;
  });
  return `<g visibility="hidden">${inner}</g><defs>${clips}</defs><g id="${id}-mesh" style="isolation:isolate">${tris}</g>`;
}
