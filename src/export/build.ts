// SVGcinema — export/build
import { bgAttrs } from '../model/background';
import type { Composite } from '../runtime/engine';
import type { Layer } from '../model/types';
import type { MarkupCtx } from '../render/markup';
import type { OptImage } from './images';
import { $, H, clone, esc, r3 } from '../core/constants';
import { togglePlay } from '../core/playback';
import { ASSETS, S, doc, layerById } from '../core/state';
import { syncExportUI } from './dialog';
import { detectEnc, updateExport } from './images';
import { outDims, syncSizeUI } from './size';
import { markup } from '../render/markup';
import { fontFaceCSS } from '../render/fonts';
import { CinEngine } from '../runtime/engine';
import { isPinKey } from '../model/pins';
import { meshOf } from '../render/markup';
import { drawOrder } from '../model/draw-order';

export function roundV(v: any): any {
  if (typeof v === 'number') return r3(v);
  if (Array.isArray(v)) return v.map(roundV);
  if (v && typeof v === 'object' && v.n) return { c: v.c, n: v.n.map((q: number[]) => q.map(r3)) };
  return v;
}
/** CSS transform for a composite. `bf`: write a bone's own-frame scale (rotate · scale · rotate back) in
 *  every frame, so all keyframes of the layer share one function list and interpolate per function. */
export function cssTf(c: Composite, bf?: boolean, cq?: number[] | null) {
  const sk = (c.kx ? ` skewX(${r3(c.kx)}deg)` : '') + (c.ky ? ` skewY(${r3(c.ky)}deg)` : ''),
    sc = bf
      ? `rotate(${r3(c.ba)}deg) scale(${r3(c.sx)},${r3(c.sy)}) rotate(${r3(-c.ba)}deg)`
      : `scale(${r3(c.sx)},${r3(c.sy)})`;
  // `cq`: a child bone's counter scale [angle, sx, sy, jx, jy] (identity scale in frames without one)
  const q = c.cp || cq,
    sx = c.cp ? q[1] : 1,
    sy = c.cp ? q[2] : 1,
    cs = q
      ? `translate(${r3(q[3])}px,${r3(q[4])}px) rotate(${r3(q[0])}deg) scale(${r3(1 / sx)},${r3(1 / sy)}) rotate(${r3(-q[0])}deg) translate(${r3(-q[3])}px,${r3(-q[4])}px) `
      : '';
  return `${cs}translate(${r3(c.x)}px,${r3(c.y)}px) rotate(${r3(c.r)}deg)${sk} ${sc} translate(${r3(-c.ox)}px,${r3(-c.oy)}px)`;
}
/** a path as SVG path data with only M / C / Z commands, so every frame has the same commands */
export function dstrC(sp: any[] | null | undefined) {
  let o = '';
  const seg = (a: number[], b: number[]) =>
    (o += `C${r3(a[4])} ${r3(a[5])} ${r3(b[2])} ${r3(b[3])} ${r3(b[0])} ${r3(b[1])}`);
  (sp || []).forEach(s => {
    const n = s.n;
    if (!n.length) return;
    o += `M${r3(n[0][0])} ${r3(n[0][1])}`;
    for (let i = 1; i < n.length; i++) seg(n[i - 1], n[i]);
    if (s.c) {
      seg(n[n.length - 1], n[0]);
      o += 'Z';
    }
  });
  return o || 'M0 0';
}
/** CSS mode animates a path's shape with SMIL, not the CSS `d` property: Safari doesn't support
 *  `d: path()`, but every browser plays SMIL. The hover trigger pauses animations through CSS, which
 *  SMIL ignores, so it keeps `d: path()` (frozen in Safari). */
export function smilShapes() {
  return doc.ex.mode === 'css' && doc.ex.trigger !== 'hover';
}
/** pin tracks bend the layer: a path through its shape, other layers through their mesh */
function pinAnimated(l: Layer) {
  return !!(
    l.pins &&
    l.pins.length &&
    (l.pins.some(p => p.bone) || Object.keys(l.t).some(k => isPinKey(k) && l.t[k].length))
  );
}
function pathPinAnimated(l: Layer) {
  return l.type === 'path' && pinAnimated(l);
}
function shapeAnimated(l: Layer) {
  const T = l.t;
  return !!(T.d || T.p0 || T.p1 || (T.rad && l.shape) || (T.sz && l.type === 'path') || pathPinAnimated(l));
}
/**
 * Visitors who ask for less motion see one still frame: every animation is held, paused, on its first
 * or last frame. Shapes animated with SMIL (see smilShapes) are held with the CSS `d` property, which
 * wins over SMIL in Chrome and Firefox (Safari keeps playing them).
 */
function reducedCSS(anim: Layer[], pre: string, svgId: string, rm: 'first' | 'last', run: number) {
  let hold = '';
  if (smilShapes()) {
    const t = rm === 'first' ? 0 : doc.dur;
    anim.forEach(l => {
      if (shapeAnimated(l)) hold += `#${pre}${l.id}-s{d:path("${H.dstr(H.comp(l, t).d)}")}`;
    });
  }
  return (
    `@media (prefers-reduced-motion:reduce){#${svgId} *{animation-play-state:paused!important;animation-direction:normal!important;` +
    `animation-iteration-count:1!important;animation-fill-mode:both!important;animation-delay:${rm === 'first' ? '0s' : -r3(run) + 's'}!important}${hold}}`
  );
}
/** a mesh matrix for CSS: enough digits that neighbouring triangles still meet */
const cssMat = (m: number[]) => `matrix(${m.map((v, i) => (i < 4 ? Math.round(v * 1e5) / 1e5 : r3(v))).join(',')})`;
/** SMIL timing for the document's playback settings, and the frames (sampled at 0 … dur) arranged
 *  for its direction: reversed, or played forth and back for alternate */
function smilTiming() {
  const spd = doc.ex.speed > 0 ? doc.ex.speed : 1,
    dir = ['alternate', 'reverse', 'alternate-reverse'].includes(doc.dir) ? doc.dir : 'normal',
    alt = dir === 'alternate' || dir === 'alternate-reverse';
  return {
    N: Math.max(2, Math.round(doc.dur * 30)),
    attrs: `dur="${r3((doc.dur / spd) * (alt ? 2 : 1))}s" repeatCount="${doc.it > 0 ? String(r3(alt ? doc.it / 2 : doc.it)) : 'indefinite'}" fill="${doc.ex.fill === 'backwards' ? 'remove' : 'freeze'}" calcMode="linear"`,
    arrange(fr: string[]) {
      if (dir === 'reverse' || dir === 'alternate-reverse') fr.reverse();
      if (alt) for (let i = fr.length - 2; i >= 0; i--) fr.push(fr[i]);
      return fr;
    },
  };
}
/** keyTimes and values for SMIL, dropping frames that repeat their neighbours (`even`: no keyTimes
 *  when every frame is kept, as they are then evenly spaced) */
function smilValues(fr: string[], even?: boolean) {
  const M = fr.length - 1,
    vals: string[] = [],
    times: string[] = [];
  fr.forEach((v, i) => {
    if (i === 0 || i === M || v !== fr[i - 1] || v !== fr[i + 1]) {
      vals.push(v);
      times.push(String(r3(i / M)));
    }
  });
  return even && vals.length === fr.length
    ? `values="${vals.join(';')}"`
    : `keyTimes="${times.join(';')}" values="${vals.join(';')}"`;
}
/** an affine matrix as translate · rotate · skewX · scale (what SMIL can animate) */
function decompose(m: number[]) {
  const [a, b, c, d, e, f] = m,
    sx = Math.hypot(a, b) || 1e-9,
    sy = (a * d - b * c) / sx,
    k = (a * c + b * d) / (sx * (sy || 1e-9));
  return [e, f, (Math.atan2(b, a) * 180) / Math.PI, (Math.atan(k) * 180) / Math.PI, sx, sy];
}
/** SMIL for the triangles of a pinned image, text or group (CSS mode): CSS-animated transforms are
 *  drawn apart from each other in Chrome, which opens hairline seams between triangles */
function smilMesh(l: Layer, pre: string) {
  const M = meshOf(l);
  if (!M || !pinAnimated(l)) return '';
  const T = smilTiming(),
    frames: number[][][] = [];
  for (let i = 0; i <= T.N; i++) frames.push(H.meshMats(l, (i / T.N) * doc.dur));
  // digits: enough that neighbouring triangles still meet to a few hundredths of a pixel
  const n2 = (v: number) => Math.round(v * 100) / 100,
    n3 = (v: number) => Math.round(v * 1000) / 1000,
    n4 = (v: number) => Math.round(v * 1e4) / 1e4;
  let out = '';
  M.t.forEach((_, k) => {
    const parts = frames.map(ms => decompose(ms[k] || [1, 0, 0, 1, 0, 0]));
    // keep the angle continuous from frame to frame
    for (let i = 1; i < parts.length; i++) {
      while (parts[i][2] - parts[i - 1][2] > 180) parts[i][2] -= 360;
      while (parts[i][2] - parts[i - 1][2] < -180) parts[i][2] += 360;
    }
    const href = `xlink:href="#${pre}${l.id}-m${k}" attributeName="transform" ${T.attrs}`,
      // a part that stays at identity in every frame is left out
      anim = (type: string, fr: string[], add: boolean) =>
        add && fr.every(v => v === (type === 'scale' ? '1 1' : '0'))
          ? ''
          : `<animateTransform ${href} type="${type}"${add ? ' additive="sum"' : ''} ${smilValues(T.arrange(fr), true)}/>`;
    out +=
      anim(
        'translate',
        parts.map(q => `${n2(q[0])} ${n2(q[1])}`),
        false,
      ) +
      anim(
        'rotate',
        parts.map(q => String(n3(q[2]))),
        true,
      ) +
      anim(
        'skewX',
        parts.map(q => String(n3(q[3]))),
        true,
      ) +
      anim(
        'scale',
        parts.map(q => `${n4(q[4])} ${n4(q[5])}`),
        true,
      );
  });
  return out;
}
/** SMIL <animate> elements for the shapes of `anim` (CSS mode, see smilShapes) */
export function smilFor(anim: Layer[], pre: string) {
  const T = smilTiming(),
    N = T.N;
  let out = '';
  anim.forEach(l => {
    out += smilMesh(l, pre);
    if (!shapeAnimated(l)) return;
    const ds: any[] = [];
    for (let i = 0; i <= N; i++) ds.push(H.comp(l, (i / N) * doc.dur).d);
    // the same commands in every frame, or the browser jumps instead of blending
    const cmds = ds.map(d => H.dstr(d).replace(/[^A-Za-z]/g, '')),
      same = cmds.every(c => c === cmds[0]),
      fr = T.arrange(ds.map(d => (same ? H.dstr(d) : dstrC(d))));
    out += `<animate xlink:href="#${pre}${l.id}-s" attributeName="d" ${T.attrs} ${smilValues(fr)}/>`;
  });
  return out;
}
/** an animated size as CSS geometry properties. An image (a <use>, which CSS can't size) scales from
 *  its box in the file (`b0`) instead, after its own imported transform. */
function cssBox(l: Layer, b: number[] | null, b0: number[] | null) {
  if (!b) return '';
  if (l.type === 'image') {
    const kx = b0 && b0[2] ? b[2] / b0[2] : 1,
      ky = b0 && b0[3] ? b[3] / b0[3] : 1,
      M = [kx, 0, 0, ky, b[0] - (b0 ? b0[0] : 0) * kx, b[1] - (b0 ? b0[1] : 0) * ky],
      X = l.xf ? H.xfM(l.xf) : [1, 0, 0, 1, 0, 0],
      m = [
        X[0] * M[0] + X[2] * M[1],
        X[1] * M[0] + X[3] * M[1],
        X[0] * M[2] + X[2] * M[3],
        X[1] * M[2] + X[3] * M[3],
        X[0] * M[4] + X[2] * M[5] + X[4],
        X[1] * M[4] + X[3] * M[5] + X[5],
      ];
    return `transform:${cssMat(m)}`;
  }
  return l.type === 'ellipse'
    ? `cx:${r3(b[0] + b[2] / 2)}px;cy:${r3(b[1] + b[3] / 2)}px;rx:${r3(b[2] / 2)}px;ry:${r3(b[3] / 2)}px`
    : `x:${r3(b[0])}px;y:${r3(b[1])}px;width:${r3(b[2])}px;height:${r3(b[3])}px`;
}
export function kfBlock(name: string, stops: string[], N: number) {
  const keep = stops.map((s, i) => i === 0 || i === N || s !== stops[i - 1] || s !== stops[i + 1]);
  return `@keyframes ${name}{` + stops.map((s, i) => (keep[i] ? `${r3((i / N) * 100)}%{${s}}` : '')).join('') + '}';
}
/** artwork drawn by a rig's own draw order: [the artwork, its bone, the layer holding the rig] */
type Wrap = [Layer, Layer, Layer | undefined];
export function cssFor(anim: Layer[], pre: string, svgId: string, wraps: Wrap[] = []) {
  const N = Math.max(2, Math.round(doc.dur * 30)),
    it = doc.it > 0 ? doc.it : 'infinite',
    dir = ['alternate', 'reverse', 'alternate-reverse'].includes(doc.dir) ? doc.dir : 'normal',
    spd = doc.ex.speed > 0 ? doc.ex.speed : 1,
    run = `${r3(doc.dur / spd)}s linear ${it} ${dir} ${doc.ex.fill === 'backwards' ? 'backwards' : 'both'}`;
  let css = '';
  anim.forEach(l => {
    const id = pre + l.id,
      T = l.t,
      fr: Composite[] = [];
    for (let i = 0; i <= N; i++) fr.push(H.comp(l, (i / N) * doc.dur));
    const cpf = fr.find(c => !!c.cp),
      cq = cpf ? cpf.cp : null,
      gt = !!(T.pos || T.rot || T.scl || T.org || T.skw || cq),
      go = !!T.op,
      bf = fr.some(c => !!c.ba && c.sx !== c.sy);
    if (gt || go)
      css +=
        kfBlock(
          id + '-g',
          fr.map(c => (gt ? `transform:${cssTf(c, bf, cq)};` : '') + (go ? `opacity:${r3(c.op)}` : '')),
          N,
        ) + `#${id}{transform-box:view-box;transform-origin:0 0;animation:${id}-g ${run}}`;
    // pinned images, text and groups: each triangle of the mesh moves on its own
    const mesh = meshOf(l);
    if (mesh && pinAnimated(l) && !smilShapes()) {
      const ms: number[][][] = [];
      for (let i = 0; i <= N; i++) ms.push(H.meshMats(l, (i / N) * doc.dur));
      mesh.t.forEach((_, k) => {
        css +=
          kfBlock(
            `${id}-m${k}`,
            ms.map(m => `transform:${cssMat(m[k])}`),
            N,
          ) + `#${id}-m${k}{transform-box:view-box;transform-origin:0 0;animation:${id}-m${k} ${run}}`;
      });
    }
    const shapeAnim = !!(T.p0 || T.p1 || (T.rad && l.shape) || (T.sz && l.type === 'path') || pathPinAnimated(l)),
      // a gradient animates through its stops (below), not the fill / stroke property
      gradK = (k: 'fill' | 'stk') => fr.some(c => H.isG(c[k])),
      gk = { fill: !!T.fill && gradK('fill'), stk: !!T.stk && gradK('stk') },
      trimAnim = !!(T.ts || T.te || T.to),
      sk = ['fill', 'fo', 'stk', 'so', 'sw', 'dof', 'da', 'd', 'rad', 'sz', 'trim'].filter(k =>
        k === 'd'
          ? (T.d || shapeAnim) && !smilShapes()
          : k === 'sz'
            ? T.sz && l.type !== 'path'
            : k === 'rad'
              ? T.rad && !l.shape
              : k === 'trim'
                ? trimAnim
                : k === 'fill' || k === 'stk'
                  ? T[k] && !gk[k]
                  : (k === 'dof' || k === 'da') && trimAnim
                    ? false
                    : T[k],
      );
    // gradient stops: CSS can animate their colours (not their positions or the angle)
    (['fill', 'stk'] as const).forEach(k => {
      if (!gk[k]) return;
      const n = Math.max(...fr.map(c => (H.isG(c[k]) ? c[k].s.length : 0)));
      for (let i = 0; i < n; i++) {
        const name = `${id}${k === 'fill' ? '-gf' : '-gs'}-s${i}`;
        css +=
          kfBlock(
            name,
            fr.map(c => {
              const v = c[k],
                col = H.isG(v) ? (v.s[Math.min(i, v.s.length - 1)] || v.s[0])[1] : v,
                q = H.pc(col) || [0, 0, 0, 1];
              return `stop-color:rgb(${Math.round(q[0])},${Math.round(q[1])},${Math.round(q[2])});stop-opacity:${r3(q[3])}`;
            }),
            N,
          ) + `#${id}${k === 'fill' ? '-gf' : '-gs'} stop:nth-child(${i + 1}){animation:${name} ${run}}`;
      }
    });
    if (sk.length)
      css +=
        kfBlock(
          id + '-s',
          fr.map(c =>
            sk
              .map(k =>
                k === 'fill'
                  ? `fill:${c.fill}`
                  : k === 'stk'
                    ? `stroke:${c.stk}`
                    : k === 'fo'
                      ? `fill-opacity:${r3(c.fo)}`
                      : k === 'so'
                        ? `stroke-opacity:${r3(c.so)}`
                        : k === 'dof'
                          ? `stroke-dashoffset:${r3(c.dof)}`
                          : k === 'da'
                            ? `stroke-dasharray:${H.dashStr(c.da)}`
                            : k === 'sz'
                              ? cssBox(l, c.gb, fr[0].gb)
                              : k === 'sw'
                                ? `stroke-width:${r3(c.sw)}px`
                                : k === 'rad'
                                  ? `rx:${r3(c.rad)}px;ry:${r3(c.rad)}px`
                                  : k === 'trim'
                                    ? c.trim
                                      ? `stroke-dasharray:${H.trimDash(c.trim)[0]};stroke-dashoffset:${H.trimDash(c.trim)[1]}`
                                      : ''
                                    : `d:path("${H.dstr(c.d)}")`,
              )
              .join(';'),
          ),
          N,
        ) +
        `#${id}-s{${sk.includes('sz') && l.type === 'image' ? 'transform-box:view-box;transform-origin:0 0;' : ''}animation:${id}-s ${run}}`;
  });
  // a rig's own draw order: each wrapper follows the bones down to its artwork's bone
  wraps.forEach(([l, bone, up]) => {
    const fr: string[] = [];
    for (let i = 0; i <= N; i++)
      fr.push(
        `transform:matrix(${H.worldOf(bone, (i / N) * doc.dur, up)
          .map(v => Math.round(v * 1e4) / 1e4)
          .join(',')})`,
      );
    if (fr.every(v => v === fr[0])) return;
    const id = `${pre}${l.id}-w`;
    css += kfBlock(id, fr, N) + `#${id}{transform-box:view-box;transform-origin:0 0;animation:${id} ${run}}`;
  });
  const rm = doc.ex.rm === 'first' || doc.ex.rm === 'last' ? doc.ex.rm : null;
  if (doc.ex.trigger === 'hover') {
    const h =
      doc.ex.out === 'start'
        ? `#${svgId}:not(:hover) *{animation:none!important}`
        : `#${svgId}:not(:hover) *{animation-play-state:paused!important}`;
    css += rm ? `@media (prefers-reduced-motion:no-preference){${h}}` : h;
  }
  if (rm) css += reducedCSS(anim, pre, svgId, rm, doc.dur / spd);
  return css;
}
/** visitors who ask for less motion: hold one frame (doc time 0, or just before the end) and don't
 *  start; the code after it (the trigger) runs only for everyone else */
/** the external player's version (player/package.json) and its address on jsDelivr */
export const PLAYER_VERSION = __PLAYER_VERSION__;
export const PLAYER_CDN = `https://cdn.jsdelivr.net/npm/svgcinema-player@${PLAYER_VERSION}/cin-player.min.js`;
/** where an export with Player › External loads the player from */
export function playerURL(ex: { playerSrc?: string; playerUrl?: string }) {
  return ex.playerSrc === 'own' && ex.playerUrl && ex.playerUrl.trim() ? ex.playerUrl.trim() : PLAYER_CDN;
}
export function reducedJS(rm: string | undefined) {
  if (rm !== 'first' && rm !== 'last') return '';
  return `if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)P.seekTo(${rm === 'first' ? 0 : Math.max(0, Math.round(doc.dur * 1000) - 1)});else{`;
}
export function triggerJS(t: string, out: string, base: number) {
  const pre =
    'P._cleanup=[];function L(t,e,f){t.addEventListener(e,f);P._cleanup.push(function(){t.removeEventListener(e,f);});}' +
    `function fwd(){if(P.direction!==${base}||P.isRollingBack)P.set("direction",${base});P.play();}` +
    `function out(){var a=${JSON.stringify(out || 'pause')};if(a==="pause")P.pause();else if(a==="reverse")P.rollback();else if(a==="start")P.stop();else if(a==="restart")P.restart();}`;
  if (t === 'hover') return pre + 'L(s,"mouseenter",fwd);L(s,"mouseleave",out);';
  if (t === 'click')
    return (
      pre +
      `s.style.cursor="pointer";L(s,"click",function(){if(P.isPlaying&&!P.isRollingBack){if(${JSON.stringify(out)}!=="none")out();}else fwd();});`
    );
  if (t === 'scroll')
    return (
      pre +
      `if("IntersectionObserver" in window){var io=new IntersectionObserver(function(e){if(e[0].isIntersecting)fwd();else if(${JSON.stringify(out)}!=="none"&&(P.isPlaying||P.currentTime>0))out();},{threshold:.35});io.observe(s);P._cleanup.push(function(){io.disconnect();});}else P.play();`
    );
  if (t === 'api') return pre;
  return pre + 'P.play();';
}
/** symbol instances that can be written as a <use> of an earlier instance: id → that instance's id.
 *  Only visible, unmasked, unpinned instances with the same time offset share. */
export function symbolUses(prep: Layer[]): Record<string, string> {
  const byId: Record<string, Layer> = {};
  prep.forEach(l => (byId[l.id] = l));
  const hidden = (l: Layer) => {
    let p: Layer | undefined = l,
      g = 0;
    while (p && g++ < 100) {
      if (p.hid) return true;
      p = p.parent ? byId[p.parent] : undefined;
    }
    return false;
  };
  const first: Record<string, string> = {},
    out: Record<string, string> = {};
  prep.forEach(l => {
    if (!l.sym || l.mask || (l.pins && l.pins.length) || hidden(l)) return;
    const key = l.sym + '@' + (l.symOff || 0);
    if (!first[key]) first[key] = l.id;
    else out[l.id] = first[key];
  });
  return out;
}
export function idMapFor(prep: Layer[]) {
  const map: Record<string, string> = {},
    used = new Set<string>();
  prep.forEach(l => {
    let b =
      String(l.name || 'layer')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'layer';
    if (!/^[a-z]/.test(b)) b = 'l-' + b;
    let id = b,
      n = 2;
    while (used.has(id)) id = b + '-' + n++;
    used.add(id);
    map[l.id] = id;
  });
  return map;
}
/** the images the layers use (their assets) */
function used0(list: Layer[]) {
  return [...new Set(list.filter(l => l.type === 'image' && ASSETS[l.geo.asset]).map(l => l.geo.asset as string))];
}
/** The editable project, carried in the SVG's metadata: the document (the exported layers) and the
 *  list of images, whose pictures are the SVG's own image symbols. */
export function projectPayload(list: Layer[] = doc.layers, assets: string[] = used0(list)) {
  return JSON.stringify({
    format: 'svgcinema-project',
    version: 1,
    doc: Object.assign({}, doc, { layers: list }),
    assets: assets.map(id => {
      const a = ASSETS[id];
      return { id, name: a.name, kind: a.kind, mime: a.mime, w: a.w, h: a.h };
    }),
  });
}
function projectMetadata(list: Layer[], assets: string[], pre: string) {
  const json = projectPayload(list, assets).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<metadata><svgcinema-project xmlns="${PROJECT_NS}" version="1" prefix="${pre}">${json}</svgcinema-project></metadata>`;
}
export const PROJECT_NS = 'https://asafco83.github.io/svgcinema/project';
export function buildExport(imgs: Record<string, OptImage> | null) {
  const ex = doc.ex,
    pre =
      (String(ex.prefix || 'cin')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .replace(/^[^a-z]+/, '') || 'cin') + '-',
    svgId = pre + 'svg';
  if (ex.mode === 'css' && (ex.trigger === 'click' || ex.trigger === 'scroll' || ex.trigger === 'api'))
    ex.trigger = 'load';
  // Export selection: only the chosen layers, inside the groups that hold them
  let src = doc.layers;
  if (S.exportOnly && S.exportOnly.size) {
    const keep = new Set(S.exportOnly);
    doc.layers.forEach(l => {
      if (!S.exportOnly.has(l.id)) return;
      let p = l.parent && doc.layers.find(x => x.id === l.parent);
      while (p && !keep.has(p.id)) {
        keep.add(p.id);
        p = p.parent && doc.layers.find(x => x.id === p.parent);
      }
    });
    src = doc.layers.filter(l => keep.has(l.id));
  }
  let prep = src.map(l => {
    const c = clone(l);
    for (const k in c.t) {
      if (!c.t[k].length) {
        delete c.t[k];
        continue;
      }
      c.t[k] = c.t[k].map(q => (q[3] ? [r3(q[0]), roundV(q[1]), q[2], q[3].map(r3)] : [r3(q[0]), roundV(q[1]), q[2]]));
    }
    return c;
  });
  if (ex.ids === 'names') {
    const m = idMapFor(prep);
    prep.forEach(l => {
      l.id = m[l.id];
      if (l.parent) l.parent = m[l.parent];
      (l.pins || []).forEach(p => p.bone && (p.bone = m[p.bone]));
      if (l.dord) l.dord = l.dord.map(id => m[id] || id);
    });
  }
  // symbols (JS export): an instance with the same time offset as an earlier visible one is written as
  // a <use> of that one's contents, which the player animates for both
  const useOf = ex.mode === 'css' ? {} : symbolUses(prep);
  if (Object.keys(useOf).length) {
    const drop = new Set<string>(),
      walk = (id: string) =>
        prep.forEach(c => {
          if (c.parent === id) {
            drop.add(c.id);
            walk(c.id);
          }
        });
    Object.keys(useOf).forEach(walk);
    prep = prep.filter(l => !drop.has(l.id));
  }
  const byId: Record<string, Layer> = {};
  prep.forEach(l => (byId[l.id] = l));
  const hiddenUp = (l: Layer) => {
    let p = l,
      g = 0;
    while (p && g++ < 100) {
      if (p.hid) return true;
      p = p.parent && byId[p.parent];
    }
    return false;
  };
  const anim = prep.filter(l => !hiddenUp(l) && Object.keys(l.t).length);
  // child bones that don't inherit scale cancel their parent bone's scale: both are animated layers
  // when that parent is scaled (the child's transform follows the parent's scale over time)
  const scaledBone = (b: Layer | undefined) =>
      !!b &&
      b.type === 'bone' &&
      ((b.t.scl && b.t.scl.length > 0) || (!!b.b.scl && (b.b.scl[0] !== 1 || b.b.scl[1] !== 1))),
    counter = new Set<string>(),
    csParents = new Set<string>();
  prep.forEach(l => {
    if (l.type !== 'bone' || l.inh || hiddenUp(l)) return;
    const P = l.parent ? byId[l.parent] : undefined;
    if (!scaledBone(P)) return;
    counter.add(l.id);
    csParents.add(P.id);
    if (!anim.includes(l)) anim.push(l);
    if (!anim.includes(P)) anim.push(P);
  });
  // pins bound to bones follow them: the runtime works out where the bone and the pinned layer are,
  // so both (and every group above them) go into its data
  const chain = new Set<string>(),
    boundB = new Set<string>(),
    addUp = (x: Layer | undefined) => {
      let g = 0;
      while (x && !chain.has(x.id) && g++ < 100) {
        chain.add(x.id);
        if (!anim.includes(x)) anim.push(x);
        x = x.parent ? byId[x.parent] : undefined;
      }
    };
  prep.forEach(l => {
    if (!l.pins || hiddenUp(l)) return;
    const bs = l.pins.filter(p => p.bone && byId[p.bone] && !hiddenUp(byId[p.bone]));
    if (!bs.length) return;
    addUp(l);
    bs.forEach(p => {
      boundB.add(p.bone);
      addUp(byId[p.bone]);
    });
  });
  // a rig's own draw order: its artwork is drawn apart from the bones, in wrappers that the runtime
  // moves with them, so the artwork, its bones and the groups above go into the data too
  const wraps: Wrap[] = [];
  prep.forEach(top => {
    if (top.type !== 'bone' || !top.dord || hiddenUp(top)) return;
    const up = top.parent ? byId[top.parent] : undefined;
    (drawOrder(top, prep) || []).forEach(it => {
      const bone = byId[it.parent];
      if (!bone || hiddenUp(it)) return;
      wraps.push([it, bone, up]);
      addUp(it);
    });
  });
  // composites look parent bones up among the exported layers while the export is written, and
  // pinned paths are always exported bent (the editor may be showing them at rest)
  H.lookup(id => byId[id]);
  const restWas = H.restPins(false);
  const used: Record<string, 1> = {};
  const ctx: MarkupCtx = {
    pre,
    editor: false,
    t: 0,
    useImg: (id: string) => {
      if (!ASSETS[id]) return null;
      used[id] = 1;
      return pre + 'img-' + id;
    },
    fonts: ex.fonts === 'embed' ? 'embed' : 'outline',
    faces: new Set<string>(),
  };
  let body = markup(prep, null, ctx);
  for (const id in useOf) {
    const re = new RegExp(`(<g [^>]*id="${(pre + id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-s"[^>]*>)</g>`);
    body = body.replace(re, `$1<use href="#${pre}${useOf[id]}-s"/></g>`);
  }
  const faceCSS = fontFaceCSS(ctx.faces);
  const syms = Object.keys(used)
    .map(id => {
      const a = ASSETS[id];
      return `<symbol id="${pre}img-${id}" viewBox="0 0 ${a.w} ${a.h}" preserveAspectRatio="none"><image href="${imgs && imgs[id] ? imgs[id].data : a.data}" width="${a.w}" height="${a.h}" preserveAspectRatio="none"/></symbol>`;
    })
    .join('');
  const [OW, OH] = outDims(),
    size = ex.size === 'fixed' ? `width="${OW}" height="${OH}"` : 'width="100%"';
  let out = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" id="${svgId}" viewBox="${doc.vx || 0} ${doc.vy || 0} ${doc.w} ${doc.h}" ${size} shape-rendering="geometricPrecision" text-rendering="geometricPrecision">`;
  out += `<title>${esc(doc.name)}</title>`;
  if (ex.proj) out += projectMetadata(src, used0(src), pre);
  if (doc.defs || syms || faceCSS)
    out += `<defs>${faceCSS ? `<style>${faceCSS}</style>` : ''}${doc.defs || ''}${syms}</defs>`;
  const bga = bgAttrs(doc);
  if (bga)
    out += `<rect x="${doc.vx || 0}" y="${doc.vy || 0}" width="${doc.w}" height="${doc.h}" fill="${esc(bga.fill)}"${bga['fill-opacity'] != null ? ` fill-opacity="${bga['fill-opacity']}"` : ''}/>`;
  out += body;
  if (anim.length) {
    if (ex.mode === 'css')
      out += (smilShapes() ? smilFor(anim, pre) : '') + `<style>${cssFor(anim, pre, svgId, wraps)}</style>`;
    else {
      const data = {
        p: pre,
        dur: doc.dur,
        it: doc.it || 0,
        dir: doc.dir,
        speed: doc.ex.speed > 0 ? doc.ex.speed : 1,
        fps: doc.ex.fps || 0,
        fill: doc.ex.fill === 'backwards' ? -1 : 1,
        L: anim.map(l => {
          const b: Record<string, any> = {
            pos: l.b.pos,
            rot: l.b.rot,
            scl: l.b.scl,
            op: l.b.op,
            fill: null,
            stk: null,
            sw: null,
          };
          if (l.b.skw && (l.b.skw[0] || l.b.skw[1])) b.skw = l.b.skw;
          (['ts', 'te', 'to'] as const).forEach(k => l.b[k] != null && (b[k] = l.b[k]));
          const o: any = { id: l.id, o: l.o || [0, 0], b, t: l.t };
          if (l.fa) o.fa = l.fa;
          // animated line ends move the nodes of the path; an animated corner radius rebuilds it
          if (l.t.p0 || l.t.p1) b.d = l.b.d;
          // an animated size resizes the shape's box (paths: from the box of their base shape)
          if (l.t.sz) {
            o.type = l.type;
            if (l.sa) o.sa = l.sa;
            if (l.type === 'path') b.d = l.b.d;
            else {
              const G = l.geo;
              o.geo =
                l.type === 'ellipse' ? { cx: G.cx, cy: G.cy, rx: G.rx, ry: G.ry } : { x: G.x, y: G.y, w: G.w, h: G.h };
            }
          }
          if (l.t.rad && l.shape) {
            const { kind, cx, cy, r, rot, n, ratio } = l.shape;
            o.shape = { kind, cx, cy, r, rot, n, ...(ratio != null ? { ratio } : {}) };
          }
          // bones scale in their own frame; the runtime needs the rest angle when the scale is
          // non-uniform, or when a child bone cancels this bone's scale
          if (l.type === 'bone' && l.geo.ang) {
            const sc = [l.b.scl || [1, 1]].concat((l.t.scl || []).map(q => q[1]));
            if (csParents.has(l.id) || sc.some(v => v[0] !== v[1])) o.ba = l.geo.ang;
          }
          if (l.pins && l.pins.length) {
            // pins bend the path every frame: the runtime needs the path, the pins and their resting values
            o.pins = l.pins;
            if (l.reach) o.reach = l.reach;
            const mesh = meshOf(l);
            if (mesh) o.mesh = { v: mesh.v, t: mesh.t };
            else b.d = l.b.d;
            for (const k in l.b) if (isPinKey(k)) b[k] = (l.b as Record<string, any>)[k];
          }
          if (chain.has(l.id)) {
            if (l.parent) o.parent = l.parent;
            if (l.xf) o.xf = l.xf;
          }
          if (boundB.has(l.id)) o.geo = Object.assign(o.geo || {}, { x: l.geo.x, y: l.geo.y, ang: l.geo.ang || 0 });
          const wr = wraps.find(q => q[0] === l);
          if (wr) {
            o.dw = wr[1].id;
            if (wr[2]) o.du = wr[2].id;
          }
          if (counter.has(l.id)) {
            o.parent = l.parent;
            o.cs = 1;
            o.j = [l.geo.x, l.geo.y];
          }
          if (l.sm) o.sm = 1;
          if (l.ev) o.ev = 1;
          if (l.or) o.or = 1;
          return o;
        }),
      };
      if (ex.player === 'external') {
        // the animation as JSON for the external player (runtime/player.ts), and a link to it; JSON
        // text is escaped so the XML parser can't read markup in it
        const cfg: Record<string, unknown> = { d: data, t: ex.trigger, o: ex.out, b: /reverse/.test(doc.dir) ? -1 : 1 };
        if (ex.rm === 'first' || ex.rm === 'last') cfg.rm = ex.rm;
        const json = JSON.stringify(cfg).replace(/[<>&]/g, c => '\\u00' + c.charCodeAt(0).toString(16));
        out += `<script type="application/json" data-cin="1">${json}</script><script href="${esc(playerURL(ex))}"></script>`;
      } else
        out += `<script><![CDATA[\n(function(){var CinEngine=${CinEngine.toString()};\nvar s=document.getElementById(${JSON.stringify(svgId)});if(!s)return;var P=CinEngine(${JSON.stringify(data)},s);s.player=s.cinPlayer=P;P.stop();${reducedJS(ex.rm)}${triggerJS(ex.trigger, ex.out, /reverse/.test(doc.dir) ? -1 : 1)}${ex.rm === 'first' || ex.rm === 'last' ? '}' : ''}})();\n]]><\/script>`;
    }
  }
  H.lookup(id => layerById(id));
  H.restPins(restWas);
  return {
    code: out + '</svg>',
    svgId,
    anim: anim.length,
    tracks: anim.reduce((s, l) => s + Object.keys(l.t).length, 0),
    images: Object.keys(used).length,
    /** some layer changes shape over time (morph, line ends, corner radius, pins) */
    shapes: anim.some(l => shapeAnimated(l) || (!!meshOf(l) && pinAnimated(l))),
  };
}
export function openExport() {
  if (S.playing) togglePlay();
  syncExportUI();
  $('#mExport').hidden = false;
  detectEnc().then(() => {
    syncSizeUI();
    updateExport();
  });
}
