// SVGcinema runtime — the animation player that ships inside every exported SVG.
// Keep it dependency-free: CinEngine.toString() is embedded verbatim in exports.

/** Keyframe: [time in seconds, value, easing to the next key, (position only) curve to the next key].
 *  The curve is [c1x, c1y, c2x, c2y]: the two control points of a cubic, c1 relative to this key's
 *  value and c2 relative to the next key's value. */
/** preset name or cubic-bezier [x1, y1, x2, y2] */
export type Ease = string | number[];
/** index 4 (editor only): the motion-path node type at this key — see tools/motion-path */
export type Keyframe = [number, any, Ease, number[]?, string?];
export interface EngineLayer {
  id: string;
  /** transform origin in the layer's own space */
  o?: [number, number] | null;
  /** base (unanimated) values */
  b: Record<string, any>;
  /** animated tracks, keyed by property */
  t: Record<string, Keyframe[]>;
  /** curved motion path */ sm?: boolean | 1;
  /** even speed along curved motion-path segments (by their length) */ ev?: boolean | 1;
  /** orient along motion path */ or?: boolean | 1;
  /** polygon / star settings, so an animated corner radius ("rad") can rebuild the path */
  shape?: { kind: string; cx: number; cy: number; r: number; rot: number; n: number; ratio?: number };
  /** extra animated attributes (filter parameters): track key → [element id suffix, attribute], or a list
   *  of [suffix, attribute, value kind?, other track?] (see fxv) */
  fa?: Record<string, [string, string] | [string, string, string?, string?][]>;
  /** bones: rest angle (degrees), so scale runs along / across the bone (exported only when it matters) */
  ba?: number;
  /** editor layers: the bone's type and geometry give the rest angle */
  type?: string;
  geo?: Record<string, any>;
  /** parent layer id (bones: a child bone cancels its parent bone's scale) */
  parent?: string | null;
  /** bones: inherit the parent bone's scale (default off: the child rides the stretched tip unstretched) */
  inh?: boolean;
  /** exported child bones: 1 = cancels the parent bone's scale, at its joint `j` */
  cs?: number;
  j?: number[];
  /** pins that bend the path: rest position in the layer's space; tracks `pin<n>` (position) and
   *  `pinr<n>` (rotation, degrees) move them */
  pins?: Array<{ n: number; x: number; y: number; bone?: string; bo?: number[] }>;
  /** an imported layer's own transform (on its content element) */
  xf?: string;
  /** how far each pin pulls (percent, default 100) */
  reach?: number;
  /** artwork drawn by its rig's own draw order: its bone (`dw`) and the layer holding the rig (`du`);
   *  the wrapper `<prefix><id>-w` carries the bones' transforms */
  dw?: string;
  du?: string;
  /** size anchor: the point an animated size grows around, as a share of the shape's box (0–1 on
   *  each axis); default: the origin */
  sa?: number[];
  /** images, text and groups with pins: the triangle mesh they bend through (rest vertices and
   *  vertex-index triples); triangle k is the element `<prefix><id>-m<k>` */
  mesh?: { v: number[][]; t: number[][] };
}
type EaseFn = (p: number) => number;
type Bezier = number[];
type RGBA = number[];
type Vec = number[];
/** subpath: closed flag + cubic nodes [x, y, inX, inY, outX, outY] */
export interface EngineSubPath {
  c: boolean;
  n: number[][];
}
/** A layer's resolved values at one moment. */
export interface Composite {
  x: number;
  y: number;
  r: number;
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  op: number;
  fill: any;
  stk: any;
  sw: any;
  d: EngineSubPath[] | undefined;
  /** skew, degrees */
  kx: number;
  ky: number;
  /** fill / stroke opacity (null = not set) */
  fo: any;
  so: any;
  /** stroke dash offset (null = not set) */
  dof: any;
  /** corner radius (null = not animated) */
  rad: any;
  /** rectangle / image / ellipse box [x, y, w, h] for an animated size (null = not animated) */
  gb: number[] | null;
  /** dash pattern (null = not animated; [] = solid) */
  da: number[] | null;
  /** trim path [start %, end %, offset %], or null when the whole stroke shows */
  trim: number[] | null;
  /** bones: rest angle (degrees); scale W runs along the bone and H across it */
  ba: number;
  /** child bones that don't inherit scale: the parent bone's scale to cancel, at the joint
   *  [angle, sx, sy, jx, jy], or null */
  cp: number[] | null;
}
type Handler = (this: CinPlayer, offsetMs: number) => void;
export interface EngineData {
  /** element id prefix */ p?: string;
  dur?: number;
  it?: number;
  dir?: string;
  speed?: number;
  fps?: number;
  fill?: number | string;
  L: EngineLayer[];
}
/** The public player API. */
export interface CinPlayer {
  play(): CinPlayer;
  pause(): CinPlayer;
  toggle(): CinPlayer;
  togglePlay(): CinPlayer;
  restart(): CinPlayer;
  reverse(): CinPlayer;
  rollback(): CinPlayer;
  stop(): CinPlayer;
  seek(percent: number): CinPlayer;
  seekTo(ms: number): CinPlayer;
  seekBy(ms: number): CinPlayer;
  set(prop: 'speed' | 'fps' | 'iterations' | 'direction' | 'alternate' | 'fill', value: any): CinPlayer;
  ready(cb: (p: CinPlayer) => void): CinPlayer;
  on(events: string, fn: (offsetMs: number) => void, prepend?: boolean): CinPlayer;
  off(event: string, fn?: (offsetMs: number) => void): CinPlayer;
  destruct(): void;
  onEnd(fn: () => void): CinPlayer;
  setRate(v: number): CinPlayer;
  readonly currentTime: number;
  readonly duration: number;
  readonly totalTime: number;
  readonly fps: number;
  readonly speed: number;
  readonly direction: number;
  readonly fill: number;
  readonly iterations: number;
  readonly hasEnded: boolean;
  readonly isAlternate: boolean;
  readonly isBackwards: boolean;
  readonly isInfinite: boolean;
  readonly isPlaying: boolean;
  readonly isReversed: boolean;
  readonly isRollingBack: boolean;
  readonly state: 'playing' | 'paused' | 'ended' | 'rollback' | 'destroyed';
  // editor helpers
  apply(t: number): void;
  comp(L: EngineLayer, t: number): Composite;
  /** editor / export: how to find a layer by id that is not in this engine's own list */
  lookup(fn: ((id: string) => EngineLayer | null | undefined) | null): void;
  /** editor: show pinned paths unbent (their rest shape); returns the previous setting */
  restPins(on: boolean): boolean;
  /** a meshed layer's triangle matrices at t (see EngineLayer.mesh) */
  meshMats(L: EngineLayer, t: number): number[][];
  /** from a layer's inner space up to the inner space of `upTo` (the canvas when null), at t */
  worldOf(L: EngineLayer, t: number, upTo?: EngineLayer | null): number[];
  /** a pin at t: [rest x, rest y, x, y, angle] (a pin bound to a bone follows it) */
  pinAt(L: EngineLayer, p: { n: number; x: number; y: number; bone?: string; bo?: number[] }, t: number): number[];
  get(L: EngineLayer, k: string, t: number): any;
  /** a filter parameter as its attribute value: raw, or by kind (a colour matrix, a sum, a half…) */
  fxv(kind: string | undefined, v: any, w?: number): string;
  dstr(sp: EngineSubPath[] | null | undefined): string;
  /** a dash pattern as stroke-dasharray ('none' for a solid line) */
  dashStr(a: number[]): string;
  /** the exact box [x, y, w, h] of a path */
  pathBox(sp: EngineSubPath[] | null | undefined): number[];
  /** an SVG transform list as a matrix [a, b, c, d, e, f] */
  xfM(s: string): number[];
  /** is the value a gradient ({ g: 'lin' | 'rad', s: stops, … }) */
  isG(v: any): boolean;
  /** gradient geometry attributes */
  gAttrs(v: any): Record<string, string>;
  /** a linear gradient's end points [x1, y1, x2, y2] (0–1 of the box) */
  linP(v: any): number[];
  /** parse a colour into [r, g, b, a] */
  pc(s: unknown): number[] | null;
  /** stroke-dasharray and -dashoffset for a trim [start, end, offset] */
  trimDash(tr: number[]): string[];
  ease(n: Ease, p: number): number;
  loc(x: number): number;
  EZ: Record<string, number[]>;
  _cleanup: Array<() => void>;
}

export function CinEngine(D: EngineData, root: ParentNode | null): CinPlayer {
  // NOTE: this function is serialised with Function.prototype.toString() and embedded in every
  // exported SVG, so it must stay fully self-contained: no imports, no references to module scope.
  var K: Record<string, string> = {
    pos: 'v',
    org: 'v',
    p0: 'v',
    p1: 'v',
    rad: 'n',
    ts: 'n',
    te: 'n',
    to: 'n',
    rot: 'n',
    scl: 'v',
    op: 'n',
    fill: 'c',
    stk: 'c',
    sw: 'n',
    d: 'm',
    skw: 'v',
    fo: 'n',
    so: 'n',
    dof: 'n',
    sz: 'v',
    da: 'a',
  };
  var EZ: Record<string, Bezier> = {
    ease: [0.25, 0.1, 0.25, 1],
    in: [0.42, 0, 1, 1],
    out: [0, 0, 0.58, 1],
    inOut: [0.42, 0, 0.58, 1],
    inSine: [0.12, 0, 0.39, 0],
    outSine: [0.61, 1, 0.88, 1],
    inOutSine: [0.37, 0, 0.63, 1],
    inQuad: [0.11, 0, 0.5, 0],
    outQuad: [0.5, 1, 0.89, 1],
    inOutQuad: [0.45, 0, 0.55, 1],
    inCubic: [0.32, 0, 0.67, 0],
    outCubic: [0.33, 1, 0.68, 1],
    inOutCubic: [0.65, 0, 0.35, 1],
    inQuart: [0.5, 0, 0.75, 0],
    outQuart: [0.25, 1, 0.5, 1],
    inOutQuart: [0.76, 0, 0.24, 1],
    inQuint: [0.64, 0, 0.78, 0],
    outQuint: [0.22, 1, 0.36, 1],
    inOutQuint: [0.83, 0, 0.17, 1],
    inExpo: [0.7, 0, 0.84, 0],
    outExpo: [0.16, 1, 0.3, 1],
    inOutExpo: [0.87, 0, 0.13, 1],
    inCirc: [0.55, 0, 1, 0.45],
    outCirc: [0, 0.55, 0.45, 1],
    inOutCirc: [0.85, 0, 0.15, 1],
    inBack: [0.36, 0, 0.66, -0.56],
    outBack: [0.34, 1.56, 0.64, 1],
    inOutBack: [0.68, -0.6, 0.32, 1.6],
  };
  var BC: Record<string, EaseFn> = {},
    EL: Record<string, Element | null> = {},
    C4 = (2 * Math.PI) / 3,
    C5 = (2 * Math.PI) / 4.5;
  var FN: Record<string, EaseFn> = {
    hold: function (p: number) {
      return p < 1 ? 0 : 1;
    },
    outBounce: bounce,
    inBounce: function (p: number) {
      return 1 - bounce(1 - p);
    },
    inOutBounce: function (p: number) {
      return p < 0.5 ? (1 - bounce(1 - 2 * p)) / 2 : (1 + bounce(2 * p - 1)) / 2;
    },
    outElastic: function (p: number) {
      return p === 0 || p === 1 ? p : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * C4) + 1;
    },
    inElastic: function (p: number) {
      return p === 0 || p === 1 ? p : -Math.pow(2, 10 * p - 10) * Math.sin((p * 10 - 10.75) * C4);
    },
    inOutElastic: function (p: number) {
      return p === 0 || p === 1
        ? p
        : p < 0.5
          ? -(Math.pow(2, 20 * p - 10) * Math.sin((20 * p - 11.125) * C5)) / 2
          : (Math.pow(2, -20 * p + 10) * Math.sin((20 * p - 11.125) * C5)) / 2 + 1;
    },
  };
  function bez(q: Bezier): EaseFn {
    var cx = 3 * q[0],
      bx = 3 * (q[2] - q[0]) - cx,
      ax = 1 - cx - bx,
      cy = 3 * q[1],
      by = 3 * (q[3] - q[1]) - cy,
      ay = 1 - cy - by;
    function sx(t: number) {
      return ((ax * t + bx) * t + cx) * t;
    }
    function sy(t: number) {
      return ((ay * t + by) * t + cy) * t;
    }
    function dx(t: number) {
      return (3 * ax * t + 2 * bx) * t + cx;
    }
    return function (x: number) {
      var t = x,
        i: number,
        e: number,
        d: number,
        lo = 0,
        hi = 1;
      for (i = 0; i < 8; i++) {
        e = sx(t) - x;
        if (Math.abs(e) < 1e-6) return sy(t);
        d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      t = x;
      while (hi - lo > 1e-6) {
        e = sx(t);
        if (Math.abs(e - x) < 1e-6) break;
        if (x > e) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  }
  function bounce(x: number) {
    var n = 7.5625,
      d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  }
  function ez(n: Ease, p: number): number {
    if (!n || n === 'linear') return p;
    if (typeof n !== 'string') {
      var key = n.join(',');
      return (BC[key] || (BC[key] = bez(n)))(p);
    }
    if (FN[n]) return FN[n](p);
    var f = BC[n] || (BC[n] = bez(EZ[n] || EZ.ease));
    return f(p);
  }
  function pc(s: unknown): RGBA | null {
    if (typeof s !== 'string') return null;
    var str = s.trim();
    if (str[0] === '#') {
      var h = str.slice(1);
      if (h.length === 3 || h.length === 4) h = h.replace(/./g, '$&$&');
      if (h.length === 6) h += 'ff';
      if (h.length !== 8) return null;
      return [
        parseInt(h.substr(0, 2), 16),
        parseInt(h.substr(2, 2), 16),
        parseInt(h.substr(4, 2), 16),
        parseInt(h.substr(6, 2), 16) / 255,
      ];
    }
    var m = str.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      var a = m[1]
        .split(/[\s,\/]+/)
        .filter(Boolean)
        .map(parseFloat);
      if (a.length === 3) a.push(1);
      return a.length === 4 ? a : null;
    }
    return null;
  }
  /* ---- gradients: { g: 'lin' | 'rad', s: [[offset 0–1, colour], …], a: angle°, cx, cy, r (0–1 of the box) }
     linear: p = [x1, y1, x2, y2] places the end points (else they follow the angle a)
     radial: ra = direction of the radius (°), rr = the other radius as a share of r (an ellipse) ---- */
  function isG(v: any): boolean {
    return !!v && typeof v === 'object' && (v.g === 'lin' || v.g === 'rad') && v.s && v.s.length > 0;
  }
  /** colour of a gradient at offset o */
  function gAt(G: any, o: number): string {
    var st = G.s;
    if (o <= st[0][0]) return st[0][1];
    for (var i = 0; i < st.length - 1; i++)
      if (o <= st[i + 1][0]) {
        var w = st[i + 1][0] - st[i][0];
        return mixC(st[i][1], st[i + 1][1], w > 0 ? (o - st[i][0]) / w : 0);
      }
    return st[st.length - 1][1];
  }
  function mixG(a: any, b: any, p: number): any {
    // a solid colour blends into a gradient as a gradient of that one colour
    if (!isG(a))
      a = {
        g: b.g,
        a: b.a,
        cx: b.cx,
        cy: b.cy,
        r: b.r,
        p: b.p,
        ra: b.ra,
        rr: b.rr,
        s: [
          [0, a],
          [1, a],
        ],
      };
    if (!isG(b))
      b = {
        g: a.g,
        a: a.a,
        cx: a.cx,
        cy: a.cy,
        r: a.r,
        p: a.p,
        ra: a.ra,
        rr: a.rr,
        s: [
          [0, b],
          [1, b],
        ],
      };
    if (a.g !== b.g) return p < 1 ? a : b;
    var offs: number[] = [];
    a.s.concat(b.s).forEach(function (q: any[]) {
      if (offs.indexOf(q[0]) < 0) offs.push(q[0]);
    });
    offs.sort(function (x: number, y: number) {
      return x - y;
    });
    // same stop count: blend stop by stop (offsets move); otherwise resample both on all offsets
    var st =
      a.s.length === b.s.length
        ? a.s.map(function (q: any[], i: number) {
            return [q[0] + (b.s[i][0] - q[0]) * p, mixC(q[1], b.s[i][1], p)];
          })
        : offs.map(function (o: number) {
            return [o, mixC(gAt(a, o), gAt(b, o), p)];
          });
    var n = function (x: any, y: any, d: number) {
      return (x == null ? d : x) + ((y == null ? d : y) - (x == null ? d : x)) * p;
    };
    var o: any = {
      g: a.g,
      a: n(a.a, b.a, 90),
      cx: n(a.cx, b.cx, 0.5),
      cy: n(a.cy, b.cy, 0.5),
      r: n(a.r, b.r, 0.5),
      s: st,
    };
    if (a.p || b.p) {
      var pa = linP(a),
        pb = linP(b);
      o.p = pa.map(function (x: number, i: number) {
        return x + (pb[i] - x) * p;
      });
    }
    if (a.ra != null || b.ra != null) o.ra = n(a.ra, b.ra, 0);
    if (a.rr != null || b.rr != null) o.rr = n(a.rr, b.rr, 1);
    return o;
  }
  function mixC(a: any, b: any, p: number): any {
    if (isG(a) || isG(b)) return mixG(a, b, p);
    var A = pc(a),
      B = pc(b);
    if (!A || !B) return p < 1 ? a : b;
    var c = [0, 1, 2].map(function (i: number) {
        return Math.round(A[i] + (B[i] - A[i]) * p);
      }),
      al = A[3] + (B[3] - A[3]) * p;
    return al >= 0.999 ? 'rgb(' + c.join(',') + ')' : 'rgba(' + c.join(',') + ',' + Math.round(al * 1000) / 1000 + ')';
  }
  function same(a: EngineSubPath[], b: EngineSubPath[]) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i].n.length !== b[i].n.length) return false;
    return true;
  }
  function mixM(a: EngineSubPath[], b: EngineSubPath[], p: number): EngineSubPath[] {
    if (!same(a, b)) return p < 1 ? a : b;
    return a.map(function (s: EngineSubPath, i: number) {
      return {
        c: s.c,
        n: s.n.map(function (q: number[], j: number) {
          var r = b[i].n[j];
          return q.map(function (v: number, k: number) {
            return v + (r[k] - v) * p;
          });
        }),
      };
    });
  }
  /** number lists (dash patterns), as CSS blends them: an empty list counts as zeros, and
   *  lists of different lengths repeat to their least common multiple */
  function mixA(a: number[], b: number[], p: number): number[] {
    a = a || [];
    b = b || [];
    var i = a.length,
      j = b.length,
      o: number[] = [],
      k: number;
    if (i !== j) {
      if (!i) a = rep(b.map(zero), 1);
      else if (!j) b = rep(a.map(zero), 1);
      else {
        var m = (i * j) / gcd(i, j);
        a = rep(a, m / i);
        b = rep(b, m / j);
      }
    }
    for (k = 0; k < a.length; k++) o.push(a[k] + (b[k] - a[k]) * p);
    return o;
  }
  function zero() {
    return 0;
  }
  function gcd(x: number, y: number): number {
    return y ? gcd(y, x % y) : x || 1;
  }
  function rep(a: number[], n: number): number[] {
    var o: number[] = [];
    for (var r = 0; r < n; r++) o = o.concat(a);
    return o;
  }
  function mix(k: string, a: any, b: any, p: number): any {
    if (k === 'c') return mixC(a, b, p);
    if (k === 'a') return mixA(a, b, p);
    if (k === 'm') return mixM(a, b, p);
    if (k === 'v') return [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p];
    return a + (b - a) * p;
  }
  function cr(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
    var t2 = t * t,
      t3 = t2 * t;
    return [0, 1].map(function (i: number) {
      return (
        0.5 *
        (2 * p1[i] +
          (-p0[i] + p2[i]) * t +
          (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
          (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3)
      );
    });
  }
  function cb(A: Vec, h: number[], B: Vec, t: number): Vec {
    var u = 1 - t,
      w0 = u * u * u,
      w1 = 3 * u * u * t,
      w2 = 3 * u * t * t,
      w3 = t * t * t;
    return [
      w0 * A[0] + w1 * (A[0] + h[0]) + w2 * (B[0] + h[2]) + w3 * B[0],
      w0 * A[1] + w1 * (A[1] + h[1]) + w2 * (B[1] + h[3]) + w3 * B[1],
    ];
  }
  /** the curve parameter at a share p of the curve's length (lengths sampled once per curve) */
  var ARC: Record<string, number[]> = {},
    ARCN = 0;
  function byLength(A: Vec, h: number[], B: Vec, p: number): number {
    if (p <= 0 || p >= 1) return p;
    var key = A.join() + ';' + h.join() + ';' + B.join(),
      tb = ARC[key],
      n = 64,
      i: number;
    if (!tb) {
      if (++ARCN > 400) {
        ARC = {};
        ARCN = 1;
      }
      tb = [0];
      var prev = A;
      for (i = 1; i <= n; i++) {
        var q = cb(A, h, B, i / n);
        tb.push(tb[i - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1]));
        prev = q;
      }
      ARC[key] = tb;
    }
    var want = p * tb[n];
    if (!(tb[n] > 0)) return p;
    for (i = 1; i <= n; i++) if (tb[i] >= want) return (i - 1 + (want - tb[i - 1]) / (tb[i] - tb[i - 1] || 1)) / n;
    return 1;
  }
  function at(L: EngineLayer, k: string, t: number): any {
    var tr = L.t[k],
      n = tr.length,
      i: number,
      a: Keyframe,
      b: Keyframe,
      p: number;
    if (n === 1 || t <= tr[0][0]) return tr[0][1];
    if (t >= tr[n - 1][0]) return tr[n - 1][1];
    for (i = 0; i < n - 1; i++) {
      a = tr[i];
      b = tr[i + 1];
      if (t < b[0]) {
        p = ez(a[2], (t - a[0]) / (b[0] - a[0]));
        if (k === 'pos' && a[3]) return cb(a[1], a[3], b[1], L.ev ? byLength(a[1], a[3], b[1], p) : p);
        if (k === 'pos' && L.sm && n > 2) return cr((tr[i - 1] || a)[1], a[1], b[1], (tr[i + 2] || b)[1], p);
        return mix(K[k] || (typeof a[1] === 'string' ? 'c' : typeof a[1] === 'object' ? 'v' : 'n'), a[1], b[1], p);
      }
    }
    return tr[n - 1][1];
  }
  /** while set, layers are read at their base values (the rest pose), ignoring their keys */
  var RESTV = false;
  function get(L: EngineLayer, k: string, t: number): any {
    var tr = !RESTV && L.t && L.t[k];
    return tr && tr.length ? at(L, k, t) : k === 'org' ? L.o || [0, 0] : L.b[k];
  }
  /** `tfOnly`: only the transform parts (no shape, paint or pins) */
  function comp(L: EngineLayer, t: number, tfOnly?: boolean): Composite {
    var o = get(L, 'org', t) || [0, 0],
      p = get(L, 'pos', t) || [0, 0],
      r = get(L, 'rot', t) || 0,
      s = get(L, 'scl', t) || [1, 1],
      k = get(L, 'skw', t) || [0, 0],
      tr = L.t && L.t.pos,
      op = get(L, 'op', t);
    if (L.or && tr && tr.length > 1 && !RESTV) {
      var t0 = tr[0][0],
        t1 = tr[tr.length - 1][0],
        e = Math.min(0.02, (t1 - t0) / 4),
        ta = Math.max(t0, Math.min(t - e, t1 - 2 * e)),
        A = get(L, 'pos', ta),
        B = get(L, 'pos', ta + 2 * e);
      if (B[0] !== A[0] || B[1] !== A[1]) r += (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI;
    }
    if (tfOnly)
      return {
        x: p[0] + o[0],
        y: p[1] + o[1],
        r: r,
        sx: s[0],
        sy: s[1],
        ox: o[0],
        oy: o[1],
        kx: k[0],
        ky: k[1],
        ba: boneAng(L),
        cp: counterScale(L, t),
      } as Composite;
    return {
      x: p[0] + o[0],
      y: p[1] + o[1],
      r: r,
      sx: s[0],
      sy: s[1],
      ox: o[0],
      oy: o[1],
      op: op == null ? 1 : op,
      fill: get(L, 'fill', t),
      stk: get(L, 'stk', t),
      sw: get(L, 'sw', t),
      d: shapeOf(L, t),
      kx: k[0],
      ky: k[1],
      fo: get(L, 'fo', t),
      so: get(L, 'so', t),
      dof: get(L, 'dof', t),
      rad: L.t && L.t.rad && L.t.rad.length ? get(L, 'rad', t) : null,
      gb: geoBox(L, t),
      da: L.t && L.t.da && L.t.da.length ? get(L, 'da', t) : null,
      trim: trimOf(L, t),
      ba: boneAng(L),
      cp: counterScale(L, t),
    };
  }
  /** layers by id: this engine's list, else the editor's lookup */
  var IDX: Record<string, EngineLayer> = {},
    EXT: ((id: string) => EngineLayer | null | undefined) | null = null;
  for (var ii = 0; ii < D.L.length; ii++) IDX[D.L[ii].id] = D.L[ii];
  function layerOf(id: string | null | undefined): EngineLayer | null {
    if (!id) return null;
    return IDX[id] || (EXT && EXT(id)) || null;
  }
  /** a child bone that doesn't inherit scale cancels its parent bone's scale around its own joint, so
   *  it rides the stretched tip without being stretched: [parent angle, sx, sy, joint x, joint y] */
  function counterScale(L: EngineLayer, t: number): number[] | null {
    var P = L.cs || (L.type === 'bone' && !L.inh) ? layerOf(L.parent) : null;
    if (!P || (!L.cs && P.type !== 'bone')) return null;
    var s = get(P, 'scl', t) || [1, 1];
    if (s[0] === 1 && s[1] === 1) return null;
    var j = L.j || (L.geo ? [L.geo.x, L.geo.y] : [0, 0]);
    return [boneAng(P), s[0] || 1e-6, s[1] || 1e-6, j[0], j[1]];
  }
  /** a bone's rest angle: scale is applied in the bone's own frame (W along it, H across it) */
  function boneAng(L: EngineLayer): number {
    if (L.ba != null) return L.ba;
    return L.type === 'bone' && L.geo && L.geo.ang ? L.geo.ang : 0;
  }
  /** trim start / end / offset (percent of the stroke), or null when nothing is trimmed */
  function trimOf(L: EngineLayer, t: number): number[] | null {
    var T = L.t || {},
      on = ['ts', 'te', 'to'].some(function (k) {
        return (T[k] && T[k].length) || (L.b && L.b[k] != null && L.b[k] !== (k === 'te' ? 100 : 0));
      });
    if (!on) return null;
    var a = get(L, 'ts', t),
      b = get(L, 'te', t),
      o = get(L, 'to', t);
    return [a == null ? 0 : a, b == null ? 100 : b, o == null ? 0 : o];
  }
  /** stroke-dasharray / dashoffset for a trim (with pathLength 100) */
  function trimDash(tr: number[]): string[] {
    var s0 = Math.max(0, Math.min(100, Math.min(tr[0], tr[1]))),
      e0 = Math.max(0, Math.min(100, Math.max(tr[0], tr[1]))),
      len = e0 - s0,
      raw = s0 + (tr[2] || 0),
      a = ((raw % 100) + 100) % 100;
    // A zero-length dash still paints its line cap (a dot with round caps), so nothing may sit on
    // the path unless it is part of the trim: an empty trim parks its dash off the path (repeats
    // at a ± 150), and a trim that doesn't cross the end repeats every 200 (never at 100, the end).
    if (len < 1e-6) return ['0 300', String(f(150 - a))];
    if (a + len <= 100 + 1e-6) return [f(len) + ' ' + f(200 - len), String(f(-a))];
    // crossing the end: one dash per pathLength (100), so it wraps around to the start
    return [f(len) + ' ' + f(100 - len), String(f(-raw))];
  }
  /** the path at time t, resized (an animated size) and bent by its pins (unless the editor shows the
   *  rest shape) */
  function shapeOf(L: EngineLayer, t: number): EngineSubPath[] | undefined {
    var d = shapeBase(L, t);
    if (d && L.t && L.t.sz && L.t.sz.length) d = sizePath(L, d, t);
    return d && L.pins && L.pins.length && !NOPIN ? pinWarp(L, d, t) : d;
  }
  /* ---- size: a shape's box grows or shrinks around the layer's origin ---- */
  /** box [x, y, w, h] resized to s = [w, h] around the point o */
  function fitBox(b: number[], s: number[], o: number[]): number[] {
    var kx = b[2] ? s[0] / b[2] : 1,
      ky = b[3] ? s[1] / b[3] : 1;
    return [o[0] - (o[0] - b[0]) * kx, o[1] - (o[1] - b[1]) * ky, Math.max(0, s[0]), Math.max(0, s[1])];
  }
  /** the point a size grows around: the size anchor (a share of the box), else the origin */
  function anchorOf(L: EngineLayer, b: number[], t: number): number[] {
    return L.sa ? [b[0] + L.sa[0] * b[2], b[1] + L.sa[1] * b[3]] : get(L, 'org', t) || [0, 0];
  }
  /** a rectangle's, image's or ellipse's box at t, when its size is animated */
  function geoBox(L: EngineLayer, t: number): number[] | null {
    var G = L.geo;
    if (!G || !L.t || !L.t.sz || !L.t.sz.length || (L.type !== 'rect' && L.type !== 'image' && L.type !== 'ellipse'))
      return null;
    var b =
      L.type === 'ellipse'
        ? [(G.cx || 0) - (G.rx || 0), (G.cy || 0) - (G.ry || 0), 2 * (G.rx || 0), 2 * (G.ry || 0)]
        : [G.x || 0, G.y || 0, G.w || 0, G.h || 0];
    return fitBox(b, get(L, 'sz', t), anchorOf(L, b, t));
  }
  /** a path scaled from its resting size (the box of its base shape) to the size at t */
  function sizePath(L: EngineLayer, d: EngineSubPath[], t: number): EngineSubPath[] {
    var b = pathBox((L.b && L.b.d) || d),
      s = get(L, 'sz', t),
      o = anchorOf(L, b, t),
      kx = b[2] > 1e-9 ? s[0] / b[2] : 1,
      ky = b[3] > 1e-9 ? s[1] / b[3] : 1;
    return d.map(function (sp: EngineSubPath) {
      return {
        c: sp.c,
        n: sp.n.map(function (q: number[]) {
          return q.map(function (v: number, i: number) {
            return i % 2 ? o[1] + (v - o[1]) * ky : o[0] + (v - o[0]) * kx;
          });
        }),
      };
    });
  }
  /** the exact box [x, y, w, h] of a path (its curves, not just its control points) */
  function pathBox(sp: EngineSubPath[] | null | undefined): number[] {
    var x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    function pt(x: number, y: number) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    function ext(p0: number, p1: number, p2: number, p3: number): number[] {
      // where the derivative of one coordinate of the cubic is zero (0 < t < 1)
      var a = -p0 + 3 * p1 - 3 * p2 + p3,
        b = 2 * (p0 - 2 * p1 + p2),
        c = p1 - p0,
        out: number[] = [];
      if (Math.abs(a) < 1e-12) {
        if (Math.abs(b) > 1e-12) out.push(-c / b);
      } else {
        var D = b * b - 4 * a * c;
        if (D >= 0) {
          var r = Math.sqrt(D);
          out.push((-b + r) / (2 * a), (-b - r) / (2 * a));
        }
      }
      return out.filter(function (v: number) {
        return v > 0 && v < 1;
      });
    }
    function seg(A: number[], B: number[]) {
      var X = [A[0], A[4], B[2], B[0]],
        Y = [A[1], A[5], B[3], B[1]];
      pt(B[0], B[1]);
      ext(X[0], X[1], X[2], X[3])
        .concat(ext(Y[0], Y[1], Y[2], Y[3]))
        .forEach(function (t: number) {
          var u = 1 - t,
            w0 = u * u * u,
            w1 = 3 * u * u * t,
            w2 = 3 * u * t * t,
            w3 = t * t * t;
          pt(w0 * X[0] + w1 * X[1] + w2 * X[2] + w3 * X[3], w0 * Y[0] + w1 * Y[1] + w2 * Y[2] + w3 * Y[3]);
        });
    }
    (sp || []).forEach(function (s: EngineSubPath) {
      var n = s.n;
      if (!n.length) return;
      pt(n[0][0], n[0][1]);
      for (var i = 1; i < n.length; i++) seg(n[i - 1], n[i]);
      if (s.c && n.length > 1) seg(n[n.length - 1], n[0]);
    });
    return isFinite(x0) ? [x0, y0, x1 - x0, y1 - y0] : [0, 0, 0, 0];
  }
  var NOPIN = false;
  /* ---- matrices [a, b, c, d, e, f]: where layers are on the canvas (pins that follow bones) ---- */
  function mmul(A: number[], B: number[]): number[] {
    return [
      A[0] * B[0] + A[2] * B[1],
      A[1] * B[0] + A[3] * B[1],
      A[0] * B[2] + A[2] * B[3],
      A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4],
      A[1] * B[4] + A[3] * B[5] + A[5],
    ];
  }
  function minv(M: number[]): number[] {
    var d = M[0] * M[3] - M[1] * M[2] || 1e-12;
    return [M[3] / d, -M[1] / d, -M[2] / d, M[0] / d, (M[2] * M[5] - M[3] * M[4]) / d, (M[1] * M[4] - M[0] * M[5]) / d];
  }
  function mT(x: number, y: number) {
    return [1, 0, 0, 1, x, y];
  }
  function mR(deg: number) {
    var a = (deg * Math.PI) / 180;
    return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
  }
  function mS(x: number, y: number) {
    return [x, 0, 0, y, 0, 0];
  }
  /** a layer's transform as a matrix, in the same order as tf() */
  function matOf(c: Composite): number[] {
    var M = [1, 0, 0, 1, 0, 0],
      q = c.cp;
    if (q) {
      M = mmul(M, mT(q[3], q[4]));
      M = mmul(M, mR(q[0]));
      M = mmul(M, mS(1 / q[1], 1 / q[2]));
      M = mmul(M, mR(-q[0]));
      M = mmul(M, mT(-q[3], -q[4]));
    }
    M = mmul(M, mT(c.x, c.y));
    M = mmul(M, mR(c.r));
    if (c.kx) M = mmul(M, [1, 0, Math.tan((c.kx * Math.PI) / 180), 1, 0, 0]);
    if (c.ky) M = mmul(M, [1, Math.tan((c.ky * Math.PI) / 180), 0, 1, 0, 0]);
    var bf = c.ba && c.sx !== c.sy;
    if (bf) M = mmul(M, mR(c.ba));
    M = mmul(M, mS(c.sx, c.sy));
    if (bf) M = mmul(M, mR(-c.ba));
    return mmul(M, mT(-c.ox, -c.oy));
  }
  /** an SVG transform list as a matrix (imported layers keep their own transform) */
  var XFC: Record<string, number[]> = {};
  function xfM(s: string): number[] {
    if (XFC[s]) return XFC[s];
    var M = [1, 0, 0, 1, 0, 0],
      re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g,
      m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      var v = m[2]
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number),
        k = m[1];
      if (k === 'matrix' && v.length === 6) M = mmul(M, v);
      else if (k === 'translate') M = mmul(M, mT(v[0] || 0, v[1] || 0));
      else if (k === 'scale') M = mmul(M, mS(v[0], v.length > 1 ? v[1] : v[0]));
      else if (k === 'rotate')
        M = v.length > 2 ? mmul(mmul(mmul(M, mT(v[1], v[2])), mR(v[0])), mT(-v[1], -v[2])) : mmul(M, mR(v[0] || 0));
      else if (k === 'skewX') M = mmul(M, [1, 0, Math.tan(((v[0] || 0) * Math.PI) / 180), 1, 0, 0]);
      else if (k === 'skewY') M = mmul(M, [1, Math.tan(((v[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]);
    }
    return (XFC[s] = M);
  }
  /** from a layer's inner space (where its children and geometry are) up to the inner space of the
   *  ancestor `upTo` (the canvas when null), at t */
  function worldOf(L: EngineLayer, t: number, upTo?: EngineLayer | null): number[] {
    var M = matOf(comp(L, t, true)),
      p = layerOf(L.parent),
      g = 0;
    while (p && p !== upTo && g++ < 100) {
      // children sit inside the parent's content element, which carries its imported transform
      if (p.xf) M = mmul(xfM(p.xf), M);
      M = mmul(matOf(comp(p, t, true)), M);
      p = layerOf(p.parent);
    }
    return M;
  }
  /** the space a layer's pins live in: a path's own coordinates, or a meshed layer's content space */
  function pinSpace(L: EngineLayer, t: number, upTo?: EngineLayer | null): number[] {
    var W = worldOf(L, t, upTo),
      path = L.type ? L.type === 'path' : !L.mesh;
    return path && L.xf ? mmul(W, xfM(L.xf)) : W;
  }
  /** where a pin bound to a bone is, in the layer's pin space: at the bone's joint (moved by `o`, an
   *  offset in the bone's own space, for a pin bound where it was), turned as the bone is turned;
   *  [x, y, angle] at t, or in the rest pose */
  function boundAt(L: EngineLayer, B: EngineLayer, t: number, rest: boolean, o?: number[]): number[] {
    // measured up to the nearest group holding both, so a group scaled to nothing doesn't matter
    var up: EngineLayer[] = [],
      q = layerOf(B.parent),
      C: EngineLayer | null = null,
      g = 0;
    while (q && g++ < 100) {
      up.push(q);
      q = layerOf(q.parent);
    }
    for (q = layerOf(L.parent), g = 0; q && g++ < 100; q = layerOf(q.parent))
      if (up.indexOf(q) >= 0) {
        C = q;
        break;
      }
    var was = RESTV;
    RESTV = rest;
    var S = pinSpace(L, t, C),
      M = Math.abs(S[0] * S[3] - S[1] * S[2]) < 1e-12 ? [1, 0, 0, 1, 0, 0] : mmul(minv(S), worldOf(B, t, C));
    RESTV = was;
    var G = B.geo || {},
      a = ((G.ang || 0) * Math.PI) / 180,
      x = (G.x || 0) + (o ? o[0] || 0 : 0),
      y = (G.y || 0) + (o ? o[1] || 0 : 0),
      dx = M[0] * Math.cos(a) + M[2] * Math.sin(a),
      dy = M[1] * Math.cos(a) + M[3] * Math.sin(a);
    return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5], (Math.atan2(dy, dx) * 180) / Math.PI];
  }
  /** a pin at t: [rest x, rest y, x, y, angle in degrees] (a bound pin follows its bone) */
  function pinAt(
    L: EngineLayer,
    p: { n: number; x: number; y: number; bone?: string; bo?: number[] },
    t: number,
  ): number[] {
    var B = p.bone ? layerOf(p.bone) : null;
    if (B) {
      var r = boundAt(L, B, t, true, p.bo),
        c = boundAt(L, B, t, false, p.bo);
      return [r[0], r[1], c[0], c[1], c[2] - r[2]];
    }
    var P = get(L, 'pin' + p.n, t) || [p.x, p.y];
    return [p.x, p.y, P[0], P[1], get(L, 'pinr' + p.n, t) || 0];
  }
  /** the pins' moves at t: [rest x, rest y, x, y, cos, sin] each, and the falloff power */
  function pinMoves(L: EngineLayer, t: number): [number[][], number] {
    var ps = L.pins || [],
      rc = Math.max(10, Math.min(1000, L.reach || 100)),
      pw = Math.max(0.5, Math.min(8, 200 / rc));
    return [
      ps.map(function (p) {
        var q = pinAt(L, p, t),
          a = (q[4] * Math.PI) / 180;
        return [q[0], q[1], q[2], q[3], Math.cos(a), Math.sin(a)];
      }),
      pw,
    ];
  }
  /** blends the pins' moves for the point (x, y), weighed at (wx, wy): nearer pins weigh more.
   *  `out` gets the warped point at [o, o + 1] */
  function warpXY(mv: number[][], pw: number, wx: number, wy: number, x: number, y: number, out: number[], o: number) {
    var W = 0,
      X = 0,
      Y = 0,
      i: number;
    for (i = 0; i < mv.length; i++) {
      var m = mv[i],
        ex = wx - m[0],
        ey = wy - m[1],
        w = 1 / (Math.pow(ex * ex + ey * ey, pw / 2) + 1e-6),
        dx = x - m[0],
        dy = y - m[1];
      W += w;
      X += w * (m[2] + dx * m[4] - dy * m[5]);
      Y += w * (m[3] + dx * m[5] + dy * m[4]);
    }
    out[o] = W ? X / W : x;
    out[o + 1] = W ? Y / W : y;
  }
  function pinWarp(L: EngineLayer, d: EngineSubPath[], t: number): EngineSubPath[] {
    var q = pinMoves(L, t),
      mv = q[0],
      pw = q[1];
    return d.map(function (sp: EngineSubPath) {
      return {
        c: sp.c,
        n: sp.n.map(function (p: number[]) {
          var out = [0, 0, 0, 0, 0, 0];
          // handles take their anchor's blend, so smooth nodes stay smooth
          for (var j = 0; j < 6; j += 2) warpXY(mv, pw, p[0], p[1], p[j], p[j + 1], out, j);
          return out;
        }),
      };
    });
  }
  /** the mesh's triangles at t: an affine matrix [a, b, c, d, e, f] each, mapping the triangle at
   *  rest onto its warped corners (identity with no pins, or while pins show at rest) */
  function meshMats(L: EngineLayer, t: number): number[][] {
    var M = L.mesh,
      out: number[][] = [];
    if (!M) return out;
    var on = !NOPIN && L.pins && L.pins.length,
      q = on ? pinMoves(L, t) : null,
      W: number[] = [],
      i: number;
    for (i = 0; i < M.v.length; i++)
      if (q) warpXY(q[0], q[1], M.v[i][0], M.v[i][1], M.v[i][0], M.v[i][1], W, i * 2);
      else {
        W[i * 2] = M.v[i][0];
        W[i * 2 + 1] = M.v[i][1];
      }
    for (i = 0; i < M.t.length; i++) {
      var T = M.t[i],
        a = M.v[T[0]],
        b = M.v[T[1]],
        c = M.v[T[2]],
        // rest edges
        ux = b[0] - a[0],
        uy = b[1] - a[1],
        vx = c[0] - a[0],
        vy = c[1] - a[1],
        det = ux * vy - uy * vx;
      if (!q || !det) {
        out.push([1, 0, 0, 1, 0, 0]);
        continue;
      }
      var A0 = W[T[0] * 2],
        A1 = W[T[0] * 2 + 1],
        px = W[T[1] * 2] - A0,
        py = W[T[1] * 2 + 1] - A1,
        rx = W[T[2] * 2] - A0,
        ry = W[T[2] * 2 + 1] - A1,
        // warped edges = L · rest edges  →  L = [p r] · [u v]^-1
        ia = vy / det,
        ib = -vx / det,
        ic = -uy / det,
        id = ux / det,
        ma = px * ia + rx * ic,
        mc = px * ib + rx * id,
        mb = py * ia + ry * ic,
        md = py * ib + ry * id;
      out.push([ma, mb, mc, md, A0 - ma * a[0] - mc * a[1], A1 - mb * a[0] - md * a[1]]);
    }
    return out;
  }
  function shapeBase(L: EngineLayer, t: number): EngineSubPath[] | undefined {
    var d = get(L, 'd', t),
      T = L.t || {};
    if (L.shape && T.rad && T.rad.length) return poly(L.shape, get(L, 'rad', t), true);
    if (d && d[0] && d[0].n.length === 2 && ((T.p0 && T.p0.length) || (T.p1 && T.p1.length))) {
      var n = d[0].n.map(function (q: number[], i: number) {
        var e = T['p' + i] && T['p' + i].length ? get(L, 'p' + i, t) : null;
        if (!e) return q;
        var dx = e[0] - q[0],
          dy = e[1] - q[1];
        return [q[0] + dx, q[1] + dy, q[2] + dx, q[3] + dy, q[4] + dx, q[5] + dy];
      });
      return [{ c: d[0].c, n: n }];
    }
    return d;
  }
  /** corners of a polygon / star, clockwise from the top */
  function corners(s: NonNullable<EngineLayer['shape']>): number[][] {
    var out: number[][] = [],
      star = s.kind === 'star',
      m = star ? s.n * 2 : s.n;
    for (var i = 0; i < m; i++) {
      var a = ((-90 + s.rot + (i * 360) / m) * Math.PI) / 180,
        r = star && i % 2 ? s.r * (s.ratio == null ? 0.45 : s.ratio) : s.r;
      out.push([s.cx + r * Math.cos(a), s.cy + r * Math.sin(a)]);
    }
    return out;
  }
  function dd(a: number[], b: number[]) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  /** largest corner radius every corner can take */
  function maxRad(c: number[][]) {
    var m = c.length,
      best = Infinity;
    for (var i = 0; i < m; i++) {
      var p = c[(i + m - 1) % m],
        v = c[i],
        q = c[(i + 1) % m],
        a = Math.atan2(p[1] - v[1], p[0] - v[0]),
        b = Math.atan2(q[1] - v[1], q[0] - v[0]),
        th = Math.abs(a - b);
      if (th > Math.PI) th = 2 * Math.PI - th;
      best = Math.min(best, (Math.min(dd(p, v), dd(q, v)) / 2) * Math.tan(th / 2));
    }
    return isFinite(best) ? Math.max(0, best) : 0;
  }
  function r2(v: number) {
    return Math.round(v * 100) / 100;
  }
  /** polygon / star path; a corner radius > 0 makes each corner two nodes joined by a circular arc.
   *  With an animated radius every corner is always two nodes, so the path keeps its node count. */
  function poly(s: NonNullable<EngineLayer['shape']>, rad: number, keep?: boolean): EngineSubPath[] {
    var c = corners(s),
      m = c.length,
      R = Math.max(0, Math.min(rad || 0, maxRad(c))),
      n: number[][] = [];
    for (var i = 0; i < m; i++) {
      var v = c[i];
      if (R <= 0 && !keep) {
        n.push([r2(v[0]), r2(v[1]), r2(v[0]), r2(v[1]), r2(v[0]), r2(v[1])]);
        continue;
      }
      var p = c[(i + m - 1) % m],
        q = c[(i + 1) % m],
        up = [(p[0] - v[0]) / dd(p, v), (p[1] - v[1]) / dd(p, v)],
        uq = [(q[0] - v[0]) / dd(q, v), (q[1] - v[1]) / dd(q, v)],
        th = Math.acos(Math.max(-1, Math.min(1, up[0] * uq[0] + up[1] * uq[1]))),
        d = R / Math.tan(th / 2),
        h = (4 / 3) * Math.tan((Math.PI - th) / 4) * R,
        A = [v[0] + up[0] * d, v[1] + up[1] * d],
        B = [v[0] + uq[0] * d, v[1] + uq[1] * d];
      n.push([r2(A[0]), r2(A[1]), r2(A[0]), r2(A[1]), r2(A[0] - up[0] * h), r2(A[1] - up[1] * h)]);
      n.push([r2(B[0]), r2(B[1]), r2(B[0] - uq[0] * h), r2(B[1] - uq[1] * h), r2(B[0]), r2(B[1])]);
    }
    return [{ c: true, n: n }];
  }
  /** gradient geometry attributes (in the shape's bounding box, 0–1) */
  function gAttrs(v: any): Record<string, string> {
    if (v.g === 'rad') {
      var cx = v.cx == null ? 0.5 : v.cx,
        cy = v.cy == null ? 0.5 : v.cy,
        r = v.r == null ? 0.5 : v.r,
        ra = v.ra || 0,
        rr = v.rr == null ? 1 : v.rr,
        o: Record<string, string> = {
          cx: String(f(cx)),
          cy: String(f(cy)),
          r: String(f(r)),
          fx: String(f(cx)),
          fy: String(f(cy)),
        };
      // an ellipse, turned: scale the other axis around the centre
      if (f(ra) || f(rr) !== 1)
        o.gradientTransform =
          'translate(' +
          f(cx) +
          ',' +
          f(cy) +
          ') rotate(' +
          f(ra) +
          ') scale(1,' +
          f(rr) +
          ') translate(' +
          f(-cx) +
          ',' +
          f(-cy) +
          ')';
      return o;
    }
    var q = linP(v);
    return { x1: String(f(q[0])), y1: String(f(q[1])), x2: String(f(q[2])), y2: String(f(q[3])) };
  }
  function linP(v: any): number[] {
    if (v.p && v.p.length === 4) return v.p.slice();
    var a = (((v.a == null ? 90 : v.a) - 90) * Math.PI) / 180,
      dx = Math.cos(a) / 2,
      dy = Math.sin(a) / 2;
    return [0.5 - dx, 0.5 - dy, 0.5 + dx, 0.5 + dy];
  }
  function f(n: number) {
    return Math.round(n * 1000) / 1000;
  }
  /* filter parameters: colour matrices (amounts as fractions, 1 = 100%), the outline's ring radii */
  var GRAY = [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
    SEP = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
  function fxv(k: string | undefined, v: any, w?: number) {
    if (!k) return typeof v === 'number' ? String(f(v)) : String(v);
    var a = Math.max(0, +v || 0),
      m: number[];
    if (k === 'add') return String(f(a + Math.max(0, +(w as number) || 0)));
    if (k === 'half') return String(f(a / 2));
    if (k === 'bri') m = [a, 0, 0, 0, 0, 0, a, 0, 0, 0, 0, 0, a, 0, 0];
    else if (k === 'con') {
      var o = 0.5 - 0.5 * a;
      m = [a, 0, 0, 0, o, 0, a, 0, 0, o, 0, 0, a, 0, o];
    } else if (k === 'inv') {
      a = Math.min(1, a);
      var d = 1 - 2 * a;
      m = [d, 0, 0, 0, a, 0, d, 0, 0, a, 0, 0, d, 0, a];
    } else {
      // grayscale / sepia: between no change (identity) and the full matrix
      a = Math.min(1, a);
      var S = k === 'sep' ? SEP : GRAY;
      m = [];
      for (var r = 0; r < 3; r++) {
        for (var c = 0; c < 3; c++) m.push(S[r * 3 + c] * a + (r === c ? 1 - a : 0));
        m.push(0, 0);
      }
    }
    return m.concat([0, 0, 0, 1, 0]).map(f).join(' ');
  }
  /** matrices keep more digits, so neighbouring triangles meet exactly */
  function f6(n: number) {
    return Math.round(n * 1e6) / 1e6;
  }
  function tf(c: Composite) {
    var q = c.cp;
    return (
      (q
        ? 'translate(' +
          f(q[3]) +
          ',' +
          f(q[4]) +
          ') rotate(' +
          f(q[0]) +
          ') scale(' +
          f(1 / q[1]) +
          ',' +
          f(1 / q[2]) +
          ') rotate(' +
          f(-q[0]) +
          ') translate(' +
          f(-q[3]) +
          ',' +
          f(-q[4]) +
          ') '
        : '') +
      'translate(' +
      f(c.x) +
      ',' +
      f(c.y) +
      ') rotate(' +
      f(c.r) +
      (c.kx ? ') skewX(' + f(c.kx) : '') +
      (c.ky ? ') skewY(' + f(c.ky) : '') +
      (c.ba && c.sx !== c.sy ? ') rotate(' + f(c.ba) : '') +
      ') scale(' +
      f(c.sx) +
      ',' +
      f(c.sy) +
      (c.ba && c.sx !== c.sy ? ') rotate(' + f(-c.ba) : '') +
      ') translate(' +
      f(-c.ox) +
      ',' +
      f(-c.oy) +
      ')'
    );
  }
  /** a dash pattern as stroke-dasharray ('none' for a solid line) */
  function dashStr(a: number[]): string {
    return a && a.length
      ? a
          .map(function (v: number) {
            return String(f(Math.max(0, v)));
          })
          .join(' ')
      : 'none';
  }
  function dstr(sp: EngineSubPath[] | null | undefined) {
    var o = '';
    function seg(a: number[], b: number[]) {
      if (a[4] === a[0] && a[5] === a[1] && b[2] === b[0] && b[3] === b[1]) o += 'L' + f(b[0]) + ' ' + f(b[1]);
      else o += 'C' + f(a[4]) + ' ' + f(a[5]) + ' ' + f(b[2]) + ' ' + f(b[3]) + ' ' + f(b[0]) + ' ' + f(b[1]);
    }
    (sp || []).forEach(function (s: EngineSubPath) {
      var n = s.n,
        i: number;
      if (!n.length) return;
      o += 'M' + f(n[0][0]) + ' ' + f(n[0][1]);
      for (i = 1; i < n.length; i++) seg(n[i - 1], n[i]);
      if (s.c) {
        seg(n[n.length - 1], n[0]);
        o += 'Z';
      }
    });
    return o || 'M0 0';
  }
  function el(id: string) {
    if (!(id in EL)) EL[id] = root ? root.querySelector('#' + id) : null;
    return EL[id];
  }
  /** a fill / stroke value as an attribute; a gradient updates (or makes) its element */
  function paint(s: Element, id: string, v: any): string {
    if (!isG(v)) return v;
    var tag = v.g === 'rad' ? 'radialGradient' : 'linearGradient',
      ge = el(id);
    if (!ge || ge.tagName !== tag) {
      var n = (s.ownerDocument || document).createElementNS('http://www.w3.org/2000/svg', tag);
      n.setAttribute('id', id);
      if (ge && ge.parentNode) ge.parentNode.replaceChild(n, ge);
      else s.parentNode.insertBefore(n, s);
      ge = n;
      EL[id] = n;
    }
    var at = gAttrs(v);
    for (var k in at) ge.setAttribute(k, at[k]);
    var stops = ge.getElementsByTagName('stop');
    while (stops.length > v.s.length) ge.removeChild(stops[stops.length - 1]);
    while (stops.length < v.s.length)
      ge.appendChild((s.ownerDocument || document).createElementNS('http://www.w3.org/2000/svg', 'stop'));
    for (var i = 0; i < v.s.length; i++) {
      var c = pc(v.s[i][1]) || [0, 0, 0, 1];
      stops[i].setAttribute('offset', String(f(v.s[i][0])));
      stops[i].setAttribute(
        'stop-color',
        'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')',
      );
      stops[i].setAttribute('stop-opacity', String(f(c[3])));
    }
    return 'url(#' + id + ')';
  }
  function apply(t: number) {
    for (var i = 0; i < D.L.length; i++) {
      var L = D.L[i],
        g = el(D.p + L.id),
        s = el(D.p + L.id + '-s');
      if (!g || !s) continue;
      var c = comp(L, t);
      g.setAttribute('transform', tf(c));
      g.setAttribute('opacity', String(f(c.op)));
      if (c.fill != null) s.setAttribute('fill', paint(s, D.p + L.id + '-gf', c.fill));
      if (c.stk != null) s.setAttribute('stroke', paint(s, D.p + L.id + '-gs', c.stk));
      if (c.sw != null) s.setAttribute('stroke-width', String(f(c.sw)));
      if (c.trim) {
        var td = trimDash(c.trim);
        s.setAttribute('pathLength', '100');
        s.setAttribute('stroke-dasharray', td[0]);
        s.setAttribute('stroke-dashoffset', td[1]);
      } else {
        if (c.dof != null) s.setAttribute('stroke-dashoffset', String(f(c.dof)));
        if (c.da) s.setAttribute('stroke-dasharray', dashStr(c.da));
      }
      if (c.fo != null) s.setAttribute('fill-opacity', String(f(c.fo)));
      if (c.so != null) s.setAttribute('stroke-opacity', String(f(c.so)));
      if (c.d) s.setAttribute('d', dstr(c.d));
      if (c.gb) {
        var gb = c.gb,
          ga =
            L.type === 'ellipse'
              ? { cx: gb[0] + gb[2] / 2, cy: gb[1] + gb[3] / 2, rx: gb[2] / 2, ry: gb[3] / 2 }
              : { x: gb[0], y: gb[1], width: gb[2], height: gb[3] };
        for (var gk in ga) s.setAttribute(gk, String(f((ga as Record<string, number>)[gk])));
      }
      if (c.rad != null && !L.shape) {
        s.setAttribute('rx', String(f(c.rad)));
        s.setAttribute('ry', String(f(c.rad)));
      }
      if (L.dw) {
        var wb = layerOf(L.dw),
          we = el(D.p + L.id + '-w');
        if (wb && we) we.setAttribute('transform', 'matrix(' + worldOf(wb, t, layerOf(L.du)).map(f6).join(',') + ')');
      }
      if (L.mesh) {
        var ms = meshMats(L, t);
        for (var mk = 0; mk < ms.length; mk++) {
          var me = el(D.p + L.id + '-m' + mk);
          if (me) me.setAttribute('transform', 'matrix(' + ms[mk].map(f6).join(',') + ')');
        }
      }
      if (L.fa)
        for (var fk in L.fa) {
          var fv = get(L, fk, t),
            fl: any = L.fa[fk];
          if (fv == null) continue;
          if (typeof fl[0] === 'string') fl = [fl];
          for (var fi = 0; fi < fl.length; fi++) {
            var ft = fl[fi],
              fe = el(D.p + L.id + ft[0]);
            if (fe) fe.setAttribute(ft[1], fxv(ft[2], fv, ft[3] ? get(L, ft[3], t) : 0));
          }
        }
    }
  }
  /* ---- player API ---- */
  var T = D.dur || 1,
    IT = D.it > 0 ? Math.floor(D.it) : 0,
    AL = /alternate/.test(D.dir || ''),
    BASE = /reverse/.test(D.dir || '') ? -1 : 1,
    DIR = BASE,
    SPD = D.speed > 0 ? D.speed : 1,
    FPS = D.fps > 0 ? Math.min(100, D.fps) : 100,
    FILL = D.fill === -1 || D.fill === 'backwards' ? -1 : 1,
    on = false,
    last = 0,
    lastDraw = -1e9,
    ended = false,
    rb = false,
    dead = false,
    HD: Record<string, Handler[]> = {},
    raf = 0;
  function tot() {
    return IT ? IT * T : T;
  }
  function s0() {
    return BASE > 0 ? 0 : tot();
  }
  var cur = s0();
  function loc(x: number) {
    var c = Math.floor(x / T),
      r = x - c * T;
    if (IT) {
      if (x <= 0) {
        c = 0;
        r = 0;
      } else if (c >= IT) {
        c = IT - 1;
        r = T;
      }
    }
    return AL && ((c % 2) + 2) % 2 === 1 ? T - r : r;
  }
  function emit(n: string) {
    var a = HD[n];
    if (!a) return;
    a.slice().forEach(function (fn: Handler) {
      try {
        fn.call(P, Math.round(cur * 1000));
      } catch (e) {}
    });
  }
  function draw() {
    apply(loc(cur));
    emit('keyframe');
  }
  function halt() {
    on = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function finish() {
    halt();
    if (rb) {
      rb = false;
      DIR = BASE;
    }
    ended = true;
    if (FILL < 0) {
      cur = s0();
    }
    draw();
    emit('end');
  }
  function tick(now: number) {
    if (!on || dead) return;
    cur += ((now - last) / 1000) * SPD * DIR;
    last = now;
    if (DIR > 0 && (IT || (rb && BASE < 0)) && cur >= tot()) {
      cur = tot();
      return finish();
    }
    if (DIR < 0 && (IT || (rb && BASE > 0)) && cur <= 0) {
      cur = 0;
      return finish();
    }
    if (now - lastDraw >= 1000 / FPS - 1) {
      lastDraw = now;
      draw();
    }
    raf = requestAnimationFrame(tick);
  }
  function start() {
    if (on || dead) return;
    on = true;
    ended = false;
    last = performance.now();
    lastDraw = -1e9;
    raf = requestAnimationFrame(tick);
  }
  var P = {
    play: function () {
      if (dead || on) return P;
      if (ended) {
        DIR = BASE;
        rb = false;
        cur = s0();
      }
      start();
      emit('play');
      return P;
    },
    pause: function () {
      if (dead || !on) return P;
      halt();
      emit('pause');
      return P;
    },
    toggle: function () {
      return on ? P.pause() : P.play();
    },
    togglePlay: function () {
      return P.toggle();
    },
    restart: function () {
      if (dead) return P;
      halt();
      rb = false;
      DIR = BASE;
      cur = s0();
      ended = false;
      draw();
      start();
      emit('restart');
      return P;
    },
    reverse: function () {
      if (dead) return P;
      DIR = -DIR;
      rb = false;
      ended = false;
      start();
      emit('reverse');
      return P;
    },
    rollback: function () {
      if (dead) return P;
      if (!IT) {
        var per = AL ? 2 * T : T;
        cur = ((cur % per) + per) % per;
      }
      if (Math.abs(cur - s0()) < 1e-6 && !on) return P;
      DIR = -BASE;
      rb = true;
      ended = false;
      start();
      emit('reverse');
      return P;
    },
    stop: function () {
      if (dead) return P;
      halt();
      rb = false;
      DIR = BASE;
      cur = s0();
      ended = false;
      draw();
      emit('stop');
      return P;
    },
    seek: function (pct: number) {
      if (dead) return P;
      cur = (Math.max(0, Math.min(100, +pct || 0)) / 100) * tot();
      ended = false;
      draw();
      return P;
    },
    seekTo: function (ms: number) {
      if (dead) return P;
      cur = (+ms || 0) / 1000;
      if (IT) cur = Math.max(0, Math.min(tot(), cur));
      ended = false;
      draw();
      return P;
    },
    seekBy: function (ms: number) {
      return P.seekTo(cur * 1000 + (+ms || 0));
    },
    set: function (k: string, v: any) {
      if (dead) return P;
      if (k === 'speed') SPD = Math.max(0.01, Math.min(100, +v || 1));
      else if (k === 'fps') FPS = Math.max(1, Math.min(100, +v || 100));
      else if (k === 'iterations') IT = v === Infinity || !(+v > 0) ? 0 : Math.floor(+v);
      else if (k === 'direction') {
        DIR = +v < 0 ? -1 : 1;
        rb = false;
      } else if (k === 'alternate') AL = !!v;
      else if (k === 'fill') FILL = +v < 0 ? -1 : 1;
      return P;
    },
    ready: function (cb: (p: CinPlayer) => void) {
      if (typeof cb === 'function')
        setTimeout(function () {
          cb.call(P, P);
        }, 0);
      return P;
    },
    on: function (names: string, fn: Handler, prepend?: boolean) {
      if (typeof fn !== 'function') return P;
      String(names)
        .split(/[\s,]+/)
        .forEach(function (n: string) {
          if (!n) return;
          HD[n] = HD[n] || [];
          if (prepend) HD[n].unshift(fn);
          else HD[n].push(fn);
        });
      return P;
    },
    off: function (n: string, fn?: Handler) {
      if (HD[n])
        HD[n] = fn
          ? HD[n].filter(function (f: Handler) {
              return f !== fn;
            })
          : [];
      return P;
    },
    destruct: function () {
      if (dead) return;
      halt();
      HD = {};
      (P._cleanup || []).forEach(function (f: () => void) {
        try {
          f();
        } catch (e) {}
      });
      P._cleanup = [];
      apply(loc(s0()));
      dead = true;
    },
    onEnd: function (fn: Handler) {
      return P.on('end', fn);
    },
    setRate: function (v: number) {
      return P.set('speed', v);
    },
    apply: apply,
    comp: comp,
    lookup: function (fn: ((id: string) => EngineLayer | null | undefined) | null) {
      EXT = fn;
    },
    meshMats: meshMats,
    pinAt: pinAt,
    worldOf: worldOf,
    restPins: function (on: boolean) {
      var was = NOPIN;
      NOPIN = !!on;
      return was;
    },
    get: get,
    fxv: fxv,
    gAttrs: gAttrs,
    linP: linP,
    trimDash: trimDash,
    isG: isG,
    pc: pc,
    dstr: dstr,
    dashStr: dashStr,
    pathBox: pathBox,
    xfM: xfM,
    poly: poly,
    corners: corners,
    maxRad: maxRad,
    ease: ez,
    loc: loc,
    EZ: EZ,
    _cleanup: [] as Array<() => void>,
  } as unknown as CinPlayer;
  var G = function (f: () => unknown): PropertyDescriptor {
    return { get: f, enumerable: true };
  };
  Object.defineProperties(P, {
    currentTime: G(function () {
      return Math.round(cur * 1000);
    }),
    duration: G(function () {
      return Math.round(T * 1000);
    }),
    totalTime: G(function () {
      return Math.round(tot() * 1000);
    }),
    fps: G(function () {
      return FPS;
    }),
    speed: G(function () {
      return SPD;
    }),
    direction: G(function () {
      return DIR;
    }),
    fill: G(function () {
      return FILL;
    }),
    iterations: G(function () {
      return IT;
    }),
    hasEnded: G(function () {
      return ended;
    }),
    isAlternate: G(function () {
      return AL;
    }),
    isBackwards: G(function () {
      return FILL < 0;
    }),
    isInfinite: G(function () {
      return !IT;
    }),
    isPlaying: G(function () {
      return on;
    }),
    isReversed: G(function () {
      return DIR < 0;
    }),
    isRollingBack: G(function () {
      return on && rb;
    }),
    state: G(function () {
      return dead ? 'destroyed' : on ? (rb ? 'rollback' : 'playing') : ended ? 'ended' : 'paused';
    }),
  });
  return P;
}
