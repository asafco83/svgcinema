// SVGcinema — io/svgator
// Reads the animation of an SVG exported by SVGator and turns it into SVGcinema keyframes.
//
// JS player exports carry their keyframes as JSON (passed to the player); the playback settings and
// the start trigger are scrambled with a key that comes along with them (SVGator's own player
// unscrambles them the same way). Each animated element has tracks for its transform (origin path
// "o" with motion-path handles, rotate "r", skew "k", scale "s", anchor "t"), paint, opacities, stroke
// width, dashes, size, corner radius, shape ("d") and filters.
import type { Keyframe, Layer, PathData } from '../model/types';
import { r3 } from '../core/constants';
import { parsePath } from '../geometry/parse-path';
import { addFilter, fxKey } from '../model/filters';
import type { AnimReader, Converter } from './svg-convert';
import { type Mat, apply, decompose, inv, linOf, rgbaStr, toGrad } from './svg-paint';
import { readCSS } from './css-anim';

type Key<T = any> = { t: number; v: T; e?: number[] | string };
type XY = { x: number; y: number };

/* ---------- the scrambled settings (as SVGator's player reads them) ---------- */

function hexNum(t: string, mod?: number): number {
  const i = '0x' + (String(t).replace(/[^0-9a-fA-F]+/g, '') || '27');
  if (mod && typeof BigInt !== 'undefined' && !Number.isSafeInteger(+i)) return (Number(BigInt(i)) % mod) + mod;
  return +i;
}
function low(t: number, e = 27): number {
  return !t || t % e ? t % e : [0, 1].includes(e) ? e : low(t / e, e);
}
function cut(t: string, e: number, n: number) {
  let r = '';
  while (t && n && e <= t.length) {
    r += t.substring(0, e);
    t = t.substring(e + 1);
    e = n;
  }
  return r + t;
}
/** unscramble one of SVGator's settings strings */
export function unscramble(t: string, root: string, key: string): any {
  const r = hexNum(key),
    i = low(r) + 5;
  let s = cut(t, low(r, 5), i).replace(/\x7c$/g, '==').replace(/\x2f$/g, '=');
  s = atob(s).replace(/[\x41-\x5A]/g, '');
  const R = +('0x' + s.substring(0, 4));
  s = s.substring(4);
  const I = (hexNum(root, R) % R) + (r % 27),
    o: number[] = [];
  for (let k = 0; k < s.length; k += 2) {
    if (s[k] === '|') {
      o.push(+('0x' + s.substring(k + 1, k + 5)) - I);
      k += 3;
      continue;
    }
    o.push(+('0x' + s[k] + s[k + 1]) - I);
  }
  return JSON.parse(String.fromCharCode(...o));
}
/** the JSON object a script passes to SVGator's player, and the key before it */
export function playerData(text: string): { key: string; data: any } | null {
  if (!/__SVGATOR_PLAYER__/.test(text)) return null;
  const m = /'([0-9a-fA-F]{6,})'\s*,\s*\{"root"/.exec(text);
  if (!m) return null;
  let i = text.indexOf('{"root"', m.index),
    depth = 0,
    str = false;
  const start = i;
  for (; i < text.length; i++) {
    const c = text[i];
    if (str) {
      if (c === '\\') i++;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === '{') depth++;
    else if (c === '}' && !--depth) break;
  }
  try {
    return { key: m[1], data: JSON.parse(text.slice(start, i + 1)) };
  } catch (_) {
    return null;
  }
}

/* ---------- reading ---------- */

export function readAnimation(root: Element, text: string): AnimReader | null {
  return readPlayer(root, text) || readCSS(root);
}
const TRIGGERS: Record<string, string> = {
  load: 'load',
  click: 'click',
  hover: 'hover',
  mouseover: 'hover',
  scroll: 'scroll',
  programmatic: 'api',
  api: 'api',
};
function readPlayer(root: Element, text: string): AnimReader | null {
  const pd = playerData(text);
  if (!pd) return null;
  const D = pd.data,
    A = (D.animations || [])[0];
  if (!A || !A.elements) return null;
  const notes: string[] = [];
  const note = (s: string) => !notes.includes(s) && notes.push(s);
  let st: any = {},
    op: any = {};
  try {
    st = A.s ? unscramble(A.s, D.root, pd.key) : {};
  } catch (_) {
    note('The playback settings couldn’t be read; the defaults are used.');
  }
  try {
    op = D.options ? unscramble(D.options, D.root, pd.key) : {};
  } catch (_) {}
  const settings: AnimReader['settings'] = {};
  if (st.duration > 0) settings.dur = st.duration / 1000;
  if (st.iterations != null) settings.it = Math.max(0, st.iterations | 0);
  const rev = st.direction === -1;
  settings.dir = st.alternate ? (rev ? 'alternate-reverse' : 'alternate') : rev ? 'reverse' : 'normal';
  if (st.fill != null) settings.fill = st.fill === -1 ? 'backwards' : 'forwards';
  if (st.speed > 0) settings.speed = st.speed;
  if (st.fps > 0) settings.fps = st.fps;
  if (op.start && TRIGGERS[op.start]) settings.trigger = TRIGGERS[op.start];
  else if (op.start) note(`The “${op.start}” start trigger isn’t available; the animation starts on load.`);
  const els: Record<string, any> = A.elements,
    used = new Set<string>();
  return {
    settings,
    notes,
    animate(l, el, cv) {
      const id = el.getAttribute('id');
      if (!id || !els[id]) return;
      used.add(id);
      animateLayer(l, el, els[id], cv, note);
    },
    done() {
      const missing = Object.keys(els).filter(id => !used.has(id));
      if (missing.length) note(`${missing.length} animated element${missing.length > 1 ? 's' : ''} couldn’t be found.`);
    },
  };
}

const sec = (ms: number) => r3(ms / 1000);
/** keyframes from SVGator keys: easing on a key applies until the next key */
/** an easing: a cubic-bezier, or 'hold' (CSS steps) */
const easeOfKey = (k: Key): any =>
  Array.isArray(k.e) && k.e.length === 4 ? k.e.map(r3) : typeof k.e === 'string' ? k.e : 'linear';
function track<T>(keys: Key<T>[], f: (v: T, k: Key<T>) => any): Keyframe[] {
  return keys.map(k => [sec(k.t), f(k.v, k), easeOfKey(k)] as Keyframe);
}
/** value of SVGator keys at time t (ms), for numbers / points */
function at(keys: Key[], t: number, mix: (a: any, b: any, p: number) => any) {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i],
      b = keys[i + 1];
    if (t <= b.t) {
      const p = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return mix(a.v, b.v, a.e ? easeAt(a.e, p) : p);
    }
  }
  return keys[keys.length - 1].v;
}
function easeAt(e: number[] | string, x: number) {
  if (typeof e === 'string') return e === 'hold' ? (x < 1 ? 0 : 1) : x;
  // cubic-bezier, solved for x by bisection
  const B = (a: number, b: number, t: number) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
  let lo = 0,
    hi = 1,
    t = x;
  for (let i = 0; i < 40; i++) {
    t = (lo + hi) / 2;
    if (B(e[0], e[2], t) < x) lo = t;
    else hi = t;
  }
  return B(e[1], e[3], t);
}
const mixP = (a: XY, b: XY, p: number) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p });
const sameTiming = (a: Key[], b: Key[]) =>
  a.length === b.length &&
  a.every((k, i) => k.t === b[i].t && JSON.stringify(k.e || null) === JSON.stringify(b[i].e || null));

export function animateLayer(l: Layer, el: Element, E: any, cv: Converter, note: (s: string) => void) {
  for (const prop in E) {
    const v = E[prop];
    switch (prop) {
      case 'transform':
        transform(l, v, cv, note);
        break;
      case 'opacity':
        l.t.op = track(v, (x: number) => r3(x));
        break;
      case 'fill':
      case 'stroke':
        l.t[prop === 'fill' ? 'fill' : 'stk'] = paintTrack(v, cv, l);
        if (prop === 'stroke' && !(l.b.sw > 0) && !(E['stroke-width'] && E['stroke-width'].length)) l.b.sw = 1;
        break;
      case 'fill-opacity':
        l.t.fo = track(v, (x: number) => r3(x));
        break;
      case 'stroke-opacity':
        l.t.so = track(v, (x: number) => r3(x));
        break;
      case 'stroke-width':
        l.t.sw = track(v, (x: number) => r3(x));
        break;
      case 'stroke-dashoffset':
        l.t.dof = track(v, (x: number) => r3(x));
        break;
      case 'stroke-dasharray':
        l.t.da = track(v, (x: number[]) => (x || []).map(r3));
        break;
      case '#size':
        if (l.type === 'rect' || l.type === 'image') {
          l.t.sz = track(v, (x: any) => [r3(x.width), r3(x.height)]);
          // SVGator grows a shape from its own corner
          l.sa = [0, 0];
        } else note('A size animation on an element that has no size wasn’t converted.');
        break;
      case '#radius':
        if (l.type === 'ellipse') {
          l.t.sz = track(v, (x: XY) => [r3(2 * x.x), r3(2 * x.y)]);
          l.sa = [0.5, 0.5];
        } else if (l.type === 'rect') {
          if (v.some((k: Key<XY>) => Math.abs(k.v.x - k.v.y) > 1e-3))
            note('Corner radii with different X and Y use the X radius.');
          l.t.rad = track(v, (x: XY) => r3(x.x));
        }
        break;
      case 'r':
        if (l.type === 'ellipse') {
          l.t.sz = track(v, (x: number) => [r3(2 * x), r3(2 * x)]);
          l.sa = [0.5, 0.5];
        }
        break;
      case 'd':
        if (l.type === 'path')
          morph(
            l,
            track(v, (x: any[]) => parsePath(x.join(' '))),
            note,
          );
        break;
      case 'points':
        if (l.type === 'path') {
          const closed = el.localName === 'polygon';
          morph(
            l,
            track(v, (x: number[]) => {
              const n = [];
              for (let i = 0; i + 1 < x.length; i += 2)
                n.push([x[i], x[i + 1], x[i], x[i + 1], x[i], x[i + 1]].map(r3));
              return [{ c: closed, n }];
            }),
            note,
          );
        }
        break;
      case '#line':
        if (l.type === 'path') {
          l.t.p0 = track(v, (x: number[]) => [r3(x[0]), r3(x[1])]);
          l.t.p1 = track(v, (x: number[]) => [r3(x[2]), r3(x[3])]);
        }
        break;
      case '#filter':
        filters(l, v, note);
        break;
      default:
        note(`“${prop}” animations weren’t converted.`);
    }
  }
}
function morph(l: Layer, tr: Keyframe[], note: (s: string) => void) {
  const count = (d: PathData) => d.map(s => s.n.length + (s.c ? 'c' : 'o')).join();
  if (tr.some(q => count(q[1]) !== count(tr[0][1])))
    note('A shape animation between shapes with different points jumps instead of blending.');
  l.t.d = tr;
}
/** Paint keyframes. SVGator blends colors with colors or gradients, and a gradient with itself;
 *  anything else (no paint ↔ paint, one gradient ↔ another) switches halfway between the keys, which
 *  a hold keyframe and a key at the midpoint reproduce. */
function paintTrack(keys: Key[], cv: Converter, l: Layer): Keyframe[] {
  const out: Keyframe[] = [];
  const blends = (a: any, b: any) =>
    (!a && !b) || (!!a && !!b && (a.t === 'c' || b.t === 'c' || (a.t === 'g' && b.t === 'g' && a.r === b.r)));
  keys.forEach((k, i) => {
    const kf: Keyframe = [sec(k.t), paint(k.v, cv, l), easeOfKey(k)];
    out.push(kf);
    const n = keys[i + 1];
    if (n && !blends(k.v, n.v) && n.t > k.t) {
      kf[2] = 'hold';
      out.push([sec((k.t + n.t) / 2), paint(n.v, cv, l), 'hold']);
    }
  });
  return out;
}
/** a fill / stroke value: none, a color or a gradient (in the shape's box) */
function paint(v: any, cv: Converter, l: Layer): any {
  if (!v) return 'none';
  if (v.t === 'c') return rgbaStr(v.v);
  if (v.t !== 'g') return 'none';
  const ge = v.r ? cv.byId(v.r) : null;
  let stops: Array<{ c: any; o: number }> = v.s;
  if (!stops && v.v) {
    const st = ge ? Array.from(ge.querySelectorAll('stop')) : [];
    stops = v.v.map((c: any, i: number) => ({
      c,
      o: st[i] ? parseFloat(st[i].getAttribute('offset')) / 100 : i / Math.max(1, v.v.length - 1),
    }));
  }
  const s: Array<[number, string]> = (stops || []).map(q => [q.o, rgbaStr(q.c)]);
  const bbox = !ge || ge.getAttribute('gradientUnits') !== 'userSpaceOnUse',
    M: Mat = v.gt || [1, 0, 0, 1, 0, 0];
  const g =
    v.c || v.rd != null
      ? { kind: 'rad' as const, c: [v.c ? v.c.x : 0.5, v.c ? v.c.y : 0.5], r: v.rd == null ? 0.5 : v.rd, M, s, bbox }
      : {
          kind: 'lin' as const,
          p: [v.f ? v.f.x : 0, v.f ? v.f.y : 0, v.to ? v.to.x : 1, v.to ? v.to.y : 0],
          M,
          s,
          bbox,
        };
  return toGrad(g, cv.localBox(l)) || 'none';
}
function filters(l: Layer, F: any, note: (s: string) => void) {
  const items: Array<[string, string]> = (F.data && F.data.items) || [],
    keys: Key<Array<{ type: string; value: any }>>[] = F.keys || [];
  items.forEach((it, i) => {
    if (it[0] !== 'blur') {
      note(`Animated “${it[0]}” filters weren’t converted.`);
      return;
    }
    if (items.length > 1) {
      note('Animated chains of several filters weren’t converted.');
      return;
    }
    let fx = (l.fx || []).find(f => f.type === 'blur');
    if (!fx) {
      fx = addFilter(l, 'blur');
      // the filter was kept as markup: it is now this Blur
      delete l.extra.filter;
    }
    if (keys.some(k => k.v[i] && Math.abs(k.v[i].value.x - k.v[i].value.y) > 1e-3))
      note('Blurs with different X and Y amounts use the X amount.');
    l.t[fxKey(fx.id, 'sd')] = track(keys, x => r3((x[i] && x[i].value.x) || 0));
  });
}

/** SVGator's transform: translate(o) · rotate(r) · skewX(k.x) · skewY(k.y) · scale(s) · translate(t).
 *  In SVGcinema terms the anchor t is minus the origin, and the position is o + t. */
function transform(l: Layer, T: any, cv: Converter, note: (s: string) => void) {
  const K = T.keys || {},
    D = T.data || {},
    has = (k: string) => !!(K[k] && K[k].length);
  // the element's drawn matrix at 0 s (as the static import placed it)
  const sk0 = l.b.skw || [0, 0],
    L0 = linOf(l.b.rot || 0, sk0[0] || 0, sk0[1] || 0, l.b.scl[0], l.b.scl[1]),
    oL = l.o || [0, 0],
    Lo = apply(L0, oL[0], oL[1]),
    M0: Mat = [L0[0], L0[1], L0[2], L0[3], l.b.pos[0] + oL[0] - Lo[0], l.b.pos[1] + oL[1] - Lo[1]],
    q = decompose(M0);
  const ok: Key<any>[] | null = has('o') ? K.o : null,
    tk: Key<XY>[] | null = has('t') ? K.t : null;
  // turning along the motion path adds the path's direction to the rotation
  const ang0 = D.a && ok && ok.length > 1 ? (Math.atan2(...dir0(ok)) * 180) / Math.PI : 0;
  const r0: number = has('r') ? K.r[0].v : D.r != null ? D.r : q.r - ang0,
    k0: XY = has('k') ? K.k[0].v : D.k || { x: q.kx, y: 0 },
    s0: XY = has('s') ? K.s[0].v : D.s || { x: q.sx, y: q.sy },
    L = linOf(r0 + ang0, k0.x, k0.y, s0.x, s0.y);
  let t0: XY | undefined = tk ? tk[0].v : D.t,
    o0: XY | undefined = ok ? ok[0].v : D.o;
  if (!t0 && !o0) {
    // no anchor given: turn around the middle of the shape
    const b = cv.localBox(l) || [0, 0, 0, 0];
    t0 = { x: -(b[0] + b[2] / 2), y: -(b[1] + b[3] / 2) };
  }
  if (!o0) {
    const p = apply(L, t0.x, t0.y);
    o0 = { x: M0[4] - p[0], y: M0[5] - p[1] };
  }
  if (!t0) {
    const p = apply(inv(L), M0[4] - o0.x, M0[5] - o0.y);
    t0 = { x: p[0], y: p[1] };
  }
  // origin = −t
  l.o = [r3(-t0.x), r3(-t0.y)];
  if (tk) l.t.org = track(tk, v => [r3(-v.x), r3(-v.y)]);
  // rotate, skew, scale
  l.b.rot = r3(r0);
  if (has('r')) l.t.rot = track(K.r, (v: number) => r3(v));
  l.b.skw = [r3(k0.x), r3(k0.y)];
  if (!k0.x && !k0.y) delete l.b.skw;
  if (has('k')) l.t.skw = track(K.k as Key<XY>[], v => [r3(v.x), r3(v.y)]);
  l.b.scl = [r3(s0.x), r3(s0.y)];
  if (has('s')) l.t.scl = track(K.s as Key<XY>[], v => [r3(v.x), r3(v.y)]);
  if (D.a) l.or = true;
  // SVGator moves along curves at an even speed
  if (ok && ok.length > 1) l.ev = true;
  // position = o + t
  l.b.pos = [r3(o0.x + t0.x), r3(o0.y + t0.y)];
  const ease = easeOfKey;
  if (ok && (!tk || sameTiming(ok, tk))) {
    // exact: an anchor moving on the same keys adds a straight line to each segment, which moves the
    // segment's handles by a third of that line
    l.t.pos = ok.map((k, i) => {
      const tv = tk ? tk[i].v : t0,
        kf: Keyframe = [sec(k.t), [r3(k.v.x + tv.x), r3(k.v.y + tv.y)], ease(k)],
        n = ok[i + 1],
        c = n && pathCurve(k.v, n.v);
      if (c) {
        const dt = tk ? { x: tk[i + 1].v.x - tv.x, y: tk[i + 1].v.y - tv.y } : { x: 0, y: 0 };
        if (dt.x || dt.y)
          note('An anchor point that moves while following a curved path is placed within about a pixel.');
        kf[3] = [c[0] + dt.x / 3, c[1] + dt.y / 3, c[2] - dt.x / 3, c[3] - dt.y / 3].map(r3);
      }
      return kf;
    });
  } else if (tk && !ok) l.t.pos = tk.map(k => [sec(k.t), [r3(o0.x + k.v.x), r3(o0.y + k.v.y)], ease(k)] as Keyframe);
  else if (ok && tk) {
    // the motion and the anchor change on different keys: their sum at every key of either
    note('A moving anchor point with its own timing was approximated.');
    const times = [...new Set([...ok.map(k => k.t), ...tk.map(k => k.t)])].sort((a, b) => a - b);
    l.t.pos = times.map(t => {
      const o = motionAt(ok, t),
        tv: XY = at(tk, t, mixP);
      return [sec(t), [r3(o.x + tv.x), r3(o.y + tv.y)], 'linear'] as Keyframe;
    });
  }
  cv.keepOrigin.add(l);
}
/** the direction a motion path starts in [dy, dx] */
function dir0(ok: Key<any>[]): [number, number] {
  const a = ok[0].v,
    c = pathCurve(a, ok[1].v);
  if (c && (c[0] || c[1])) return [c[1], c[0]];
  return [ok[1].v.y - a.y, ok[1].v.x - a.x];
}
const corner = (v: any) => !v.type || v.type === 'corner';
/** the curve between two motion-path keys as [c1x, c1y, c2x, c2y] (c1 from the first key, c2 from
 *  the second), or null for a straight segment. One handle makes a quadratic curve. */
function pathCurve(a: any, b: any): number[] | null {
  const h1 = !corner(a) && a.end ? a.end : null,
    h2 = !corner(b) && b.start ? b.start : null;
  if (h1 && h2) return [h1.x - a.x, h1.y - a.y, h2.x - b.x, h2.y - b.y];
  const h = h1 || h2;
  if (!h) return null;
  return [((h.x - a.x) * 2) / 3, ((h.y - a.y) * 2) / 3, ((h.x - b.x) * 2) / 3, ((h.y - b.y) * 2) / 3];
}
/** where a motion path is at time t (ms) */
function motionAt(keys: Key<any>[], t: number): XY {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i],
      b = keys[i + 1];
    if (t <= b.t) {
      const p = a.e ? easeAt(a.e, b.t > a.t ? (t - a.t) / (b.t - a.t) : 1) : b.t > a.t ? (t - a.t) / (b.t - a.t) : 1,
        c = pathCurve(a.v, b.v);
      if (!c) return mixP(a.v, b.v, p);
      const u = 1 - p,
        P1 = { x: a.v.x + c[0], y: a.v.y + c[1] },
        P2 = { x: b.v.x + c[2], y: b.v.y + c[3] };
      return {
        x: u * u * u * a.v.x + 3 * u * u * p * P1.x + 3 * u * p * p * P2.x + p * p * p * b.v.x,
        y: u * u * u * a.v.y + 3 * u * u * p * P1.y + 3 * u * p * p * P2.y + p * p * p * b.v.y,
      };
    }
  }
  return keys[keys.length - 1].v;
}
