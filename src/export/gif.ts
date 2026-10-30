// SVGcinema — export/gif
// A GIF encoder written for SVGcinema (no library): palette (median cut, refined for Best), colors
// kept exact, dithering (diffusion, pattern or noise, with dots that stay still where the picture
// doesn't change), noise reduction, lossy compression, frames that store only what changed, and
// transparency with an edge color. It runs in a worker (export/anim.worker) on frames drawn by
// export/frames.

export interface GifOpts {
  /** 2–256 */
  colours: number;
  /** one palette for every frame, or one per frame */
  palette: 'one' | 'per';
  /** Best refines the palette (a few k-means passes) */
  pick: 'fast' | 'best';
  /** colors that always get a palette slot, as 0xRRGGBB */
  keep: number[];
  dither: 'none' | 'diff' | 'pat' | 'noise';
  /** 0–100 */
  strength: number;
  /** 0–100: smooths grain before the colors are picked */
  denoise: number;
  /** 0–200: allows small errors for a smaller file */
  lossy: number;
  /** each frame stores only the pixels that changed */
  changed: boolean;
  /** 0–20 (%): changes smaller than this count as unchanged */
  tolerance: number;
  transparent: boolean;
  /** 0xRRGGBB: soft edges are blended with it when the background is transparent */
  matte: number;
  /** 0 = loop forever, else the number of times it plays */
  loops: number;
  /** merge frames identical to the one before (it is shown longer) */
  merge: boolean;
}
export interface GifFrame {
  rgba: Uint8ClampedArray;
  /** how long it shows, ms */
  ms: number;
}

/* ---------------- frame preparation ---------------- */

/** Composite onto the matte (transparent GIFs keep a 1-bit alpha) and smooth noise. */
export function prepare(
  f: Uint8ClampedArray,
  w: number,
  h: number,
  o: GifOpts,
): { rgb: Uint8Array; alpha: Uint8Array | null } {
  const n = w * h,
    rgb = new Uint8Array(n * 3),
    mr = (o.matte >> 16) & 255,
    mg = (o.matte >> 8) & 255,
    mb = o.matte & 255;
  const alpha = o.transparent ? new Uint8Array(n) : null;
  for (let i = 0; i < n; i++) {
    const a = f[i * 4 + 3] / 255;
    if (alpha) alpha[i] = a >= 0.5 ? 1 : 0;
    // over the matte (transparent) or as drawn (the frames come with their background)
    const k = o.transparent ? a : 1;
    rgb[i * 3] = Math.round(f[i * 4] * k + mr * (1 - k));
    rgb[i * 3 + 1] = Math.round(f[i * 4 + 1] * k + mg * (1 - k));
    rgb[i * 3 + 2] = Math.round(f[i * 4 + 2] * k + mb * (1 - k));
  }
  if (o.denoise > 0) smooth(rgb, w, h, o.denoise / 100);
  return { rgb, alpha };
}
/** Blend each pixel towards its 3×3 neighbourhood's average, more where the neighbours agree. */
function smooth(rgb: Uint8Array, w: number, h: number, amt: number) {
  const src = rgb.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0,
        c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = (yy * w + xx) * 3;
          r += src[j];
          g += src[j + 1];
          b += src[j + 2];
          c++;
        }
      }
      const i = (y * w + x) * 3,
        dr = r / c - src[i],
        dg = g / c - src[i + 1],
        db = b / c - src[i + 2];
      // edges (big differences) stay sharp: only small differences are smoothed away
      const d = Math.abs(dr) + Math.abs(dg) + Math.abs(db),
        k = amt * Math.max(0, 1 - d / 96);
      rgb[i] = Math.round(src[i] + dr * k);
      rgb[i + 1] = Math.round(src[i + 1] + dg * k);
      rgb[i + 2] = Math.round(src[i + 2] + db * k);
    }
}

/* ---------------- palette ---------------- */

/** Color counts on a 5-bit-per-channel grid (32768 boxes), from every `step`th pixel. */
export function histogram(frames: Uint8Array[], step = 1, mask?: (Uint8Array | null)[]) {
  const hist = new Uint32Array(32768);
  frames.forEach((rgb, fi) => {
    const a = mask && mask[fi];
    for (let i = 0, p = 0; i < rgb.length; i += 3 * step, p += step) {
      if (a && !a[p]) continue;
      hist[((rgb[i] >> 3) << 10) | ((rgb[i + 1] >> 3) << 5) | (rgb[i + 2] >> 3)]++;
    }
  });
  return hist;
}
/** Median cut over the histogram: `n` colors (as [r, g, b]). */
export function medianCut(hist: Uint32Array, n: number): number[][] {
  type Box = { idx: number[]; count: number };
  const all: number[] = [];
  let total = 0;
  for (let i = 0; i < hist.length; i++)
    if (hist[i]) {
      all.push(i);
      total += hist[i];
    }
  if (!all.length) return [[0, 0, 0]];
  const ch = (i: number, c: number) => (c === 0 ? i >> 10 : c === 1 ? (i >> 5) & 31 : i & 31);
  const boxes: Box[] = [{ idx: all, count: total }];
  while (boxes.length < n) {
    // split the box with the most pixels × widest range
    let best = -1,
      bestScore = -1,
      bestCh = 0;
    boxes.forEach((b, bi) => {
      if (b.idx.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 31,
          hi = 0;
        for (const i of b.idx) {
          const v = ch(i, c);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const score = (hi - lo) * Math.sqrt(b.count);
        if (score > bestScore) {
          bestScore = score;
          best = bi;
          bestCh = c;
        }
      }
    });
    if (best < 0 || bestScore <= 0) break;
    const b = boxes[best];
    b.idx.sort((x, y) => ch(x, bestCh) - ch(y, bestCh));
    let acc = 0,
      cut = 0;
    for (; cut < b.idx.length - 1; cut++) {
      acc += hist[b.idx[cut]];
      if (acc >= b.count / 2) break;
    }
    const left = b.idx.slice(0, cut + 1),
      right = b.idx.slice(cut + 1),
      sum = (a: number[]) => a.reduce((s, i) => s + hist[i], 0);
    boxes.splice(best, 1, { idx: left, count: sum(left) }, { idx: right, count: sum(right) });
  }
  return boxes.map(b => {
    let r = 0,
      g = 0,
      bl = 0;
    for (const i of b.idx) {
      const k = hist[i];
      r += (ch(i, 0) * 8 + 4) * k;
      g += (ch(i, 1) * 8 + 4) * k;
      bl += (ch(i, 2) * 8 + 4) * k;
    }
    const c = b.count || 1;
    return [Math.round(r / c), Math.round(g / c), Math.round(bl / c)];
  });
}
/** A few k-means passes over the histogram (Best). */
export function refine(hist: Uint32Array, pal: number[][], passes = 3) {
  const used: number[] = [];
  for (let i = 0; i < hist.length; i++) if (hist[i]) used.push(i);
  for (let p = 0; p < passes; p++) {
    const sum = pal.map(() => [0, 0, 0, 0]);
    for (const i of used) {
      const r = (i >> 10) * 8 + 4,
        g = ((i >> 5) & 31) * 8 + 4,
        b = (i & 31) * 8 + 4,
        k = nearest(pal, r, g, b),
        w = hist[i];
      sum[k][0] += r * w;
      sum[k][1] += g * w;
      sum[k][2] += b * w;
      sum[k][3] += w;
    }
    pal = pal.map((c, k) => (sum[k][3] ? [0, 1, 2].map(j => Math.round(sum[k][j] / sum[k][3])) : c));
  }
  return pal;
}
export function nearest(pal: number[][], r: number, g: number, b: number) {
  let best = 0,
    bd = Infinity;
  for (let k = 0; k < pal.length; k++) {
    const c = pal[k],
      dr = c[0] - r,
      dg = c[1] - g,
      db = c[2] - b,
      // perceptual weights: green counts most
      d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
    if (d < bd) {
      bd = d;
      best = k;
      if (!d) break;
    }
  }
  return best;
}
/** The palette for these frames: kept colors first, then the picked ones. */
export function makePalette(frames: Uint8Array[], masks: (Uint8Array | null)[], o: GifOpts, reserve = o.transparent) {
  // one slot is kept for the transparent index when the file needs it
  const slots = Math.max(2, Math.min(256, o.colours)) - (reserve ? 1 : 0),
    keep = o.keep.slice(0, Math.max(0, slots - 1)).map(c => [(c >> 16) & 255, (c >> 8) & 255, c & 255]),
    total = frames.reduce((s, f) => s + f.length / 3, 0),
    hist = histogram(frames, Math.max(1, Math.floor(total / 400000)), masks);
  let pal = medianCut(hist, Math.max(1, slots - keep.length));
  if (o.pick === 'best') pal = refine(hist, pal);
  return keep.concat(pal);
}

/* ---------------- dithering ---------------- */

const BAYER = (() => {
  const m = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ];
  return m.map(r => r.map(v => v / 64 - 0.5));
})();
/** A noise value for a position, always the same there (so the dots stay still). */
function noiseAt(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xffff) / 0xffff - 0.5;
}
/** The palette's typical gap between neighbouring colors (how far dither must reach). */
function spread(pal: number[][]) {
  return Math.max(8, Math.min(96, 255 / Math.cbrt(Math.max(2, pal.length))));
}
/**
 * Map a frame to palette indices. `prev` (same palette) keeps the dots still where the picture
 * didn't change: those pixels take the previous frame's index.
 */
export function mapFrame(
  rgb: Uint8Array,
  alpha: Uint8Array | null,
  w: number,
  h: number,
  pal: number[][],
  o: GifOpts,
  tIndex: number,
  prev?: { ref: Uint8Array; idx: Uint8Array } | null,
  /** how far (summed over R, G, B) a pixel may drift and keep the index it had */
  tol = 0,
): { idx: Uint8Array; ref: Uint8Array } {
  const n = w * h,
    out = new Uint8Array(n),
    // the color each index was picked for: a kept pixel keeps its reference, so slow drifts add up
    ref = rgb.slice(),
    cache = new Map<number, number>(),
    near = (r: number, g: number, b: number) => {
      const key = (r << 16) | (g << 8) | b;
      let k = cache.get(key);
      if (k === undefined) {
        k = nearest(pal, r, g, b);
        cache.set(key, k);
      }
      return k;
    },
    amt = o.dither === 'none' ? 0 : o.strength / 100,
    sp = spread(pal);
  const err = o.dither === 'diff' ? new Float32Array((w + 2) * 3 * 2) : null;
  for (let y = 0; y < h; y++) {
    if (err) {
      // the next row's errors become this row's
      err.copyWithin(0, (w + 2) * 3, (w + 2) * 6);
      err.fill(0, (w + 2) * 3);
    }
    const rtl = !!err && y % 2 === 1;
    for (let xi = 0; xi < w; xi++) {
      const x = rtl ? w - 1 - xi : xi,
        i = y * w + x,
        j = i * 3;
      if (alpha && !alpha[i]) {
        out[i] = tIndex;
        continue;
      }
      if (
        prev &&
        prev.idx[i] !== tIndex &&
        Math.abs(prev.ref[j] - rgb[j]) +
          Math.abs(prev.ref[j + 1] - rgb[j + 1]) +
          Math.abs(prev.ref[j + 2] - rgb[j + 2]) <=
          tol
      ) {
        // (nearly) unchanged: the same dot as before, so dithering doesn't shimmer and the pixel needn't be stored
        out[i] = prev.idx[i];
        ref[j] = prev.ref[j];
        ref[j + 1] = prev.ref[j + 1];
        ref[j + 2] = prev.ref[j + 2];
        continue;
      }
      let r = rgb[j],
        g = rgb[j + 1],
        b = rgb[j + 2];
      if (o.dither === 'pat' || o.dither === 'noise') {
        const d = (o.dither === 'pat' ? BAYER[y & 7][x & 7] : noiseAt(x, y) * 1.4) * sp * amt;
        r = clamp8(r + d);
        g = clamp8(g + d);
        b = clamp8(b + d);
      } else if (err) {
        const e = (x + 1) * 3;
        r = clamp8(r + err[e]);
        g = clamp8(g + err[e + 1]);
        b = clamp8(b + err[e + 2]);
      }
      const k = near(r, g, b);
      out[i] = k;
      if (err && amt > 0) {
        const c = pal[k],
          er = (r - c[0]) * amt,
          eg = (g - c[1]) * amt,
          eb = (b - c[2]) * amt,
          dir = rtl ? -1 : 1,
          put = (row: number, dx: number, f: number) => {
            const p = row * (w + 2) * 3 + (x + 1 + dx) * 3;
            err[p] += er * f;
            err[p + 1] += eg * f;
            err[p + 2] += eb * f;
          };
        put(0, dir, 7 / 16);
        put(1, -dir, 3 / 16);
        put(1, 0, 5 / 16);
        put(1, dir, 1 / 16);
      }
    }
  }
  return { idx: out, ref };
}
const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/* ---------------- LZW (with lossy matching) ---------------- */

/**
 * LZW-compress palette indices. With `lossy` > 0 a code may be extended by a pixel whose color is
 * close to the one the dictionary expects (the decoded picture then has that color there); the
 * pixels actually decoded are written back into `px`.
 */
export function lzw(px: Uint8Array, minSize: number, pal: number[][], lossy: number, tIndex = -1) {
  const clear = 1 << minSize,
    eoi = clear + 1,
    out = new Out();
  let bits = minSize + 1,
    next = eoi + 1,
    acc = 0,
    nacc = 0;
  const emit = (code: number) => {
    acc |= code << nacc;
    nacc += bits;
    while (nacc >= 8) {
      out.b(acc & 255);
      acc >>>= 8;
      nacc -= 8;
    }
  };
  // dictionary: (prefix code, pixel) → code; children per code for close matches
  let dict = new Map<number, number>(),
    kids: number[][] = [];
  const reset = () => {
    dict = new Map();
    kids = [];
    bits = minSize + 1;
    next = eoi + 1;
  };
  const tol = lossy > 0 ? Math.pow(lossy * 0.35, 2) * 3 : 0,
    dist = (a: number, b: number) => {
      // the transparent index is never swapped for a color, nor a color for it
      if (a === tIndex || b === tIndex) return a === b ? 0 : Infinity;
      const p = pal[a],
        q = pal[b];
      if (!p || !q) return Infinity;
      const dr = p[0] - q[0],
        dg = p[1] - q[1],
        db = p[2] - q[2];
      return dr * dr + dg * dg + db * db;
    };
  // the last pixel each code ends with (for close matches)
  const tail: number[] = [];
  for (let i = 0; i < clear; i++) tail[i] = i;
  // each code's prefix code, to spell out the pixels it stands for
  const parent: number[] = [];
  /**
   * Lossy: at each position, the longest dictionary string whose every pixel is close to the
   * pixels there (searched through the dictionary tree, a bounded number of steps), rather than
   * the longest exact one. The pixels the chosen code stands for replace those in px.
   */
  const lossyRun = () => {
    const n = px.length;
    let i = 0;
    while (i < n) {
      let best = px[i],
        bestLen = 1,
        budget = 256;
      const walk = (code: number, len: number) => {
        if (len > bestLen) {
          best = code;
          bestLen = len;
        }
        const ks = kids[code];
        if (!ks || i + len >= n) return;
        const want = px[i + len];
        // the exact child first, then the close ones
        const exact = dict.get(code * 4096 + want);
        if (exact !== undefined && budget-- > 0) walk(exact, len + 1);
        for (const c of ks) {
          if (budget <= 0) return;
          if (c === exact || dist(tail[c], want) > tol) continue;
          budget--;
          walk(c, len + 1);
        }
      };
      walk(px[i], 1);
      // write the pixels the code stands for
      for (let c = best, k = i + bestLen - 1; k >= i; k--) {
        px[k] = tail[c];
        c = parent[c];
      }
      emit(best);
      i += bestLen;
      if (i >= n) break;
      if (next < 4096) {
        const p = px[i];
        dict.set(best * 4096 + p, next);
        (kids[best] || (kids[best] = [])).push(next);
        tail[next] = p;
        parent[next] = best;
        if (next >= 1 << bits && bits < 12) bits++;
        next++;
      } else {
        emit(clear);
        reset();
      }
    }
  };
  emit(clear);
  if (!px.length) {
    emit(eoi);
    if (nacc) out.b(acc & 255);
    return out.done();
  }
  if (tol > 0) {
    lossyRun();
    emit(eoi);
    if (nacc) out.b(acc & 255);
    return out.done();
  }
  let cur = px[0];
  for (let i = 1; i < px.length; i++) {
    const p = px[i],
      key = cur * 4096 + p;
    const hit = dict.get(key);
    if (hit !== undefined) {
      cur = hit;
      continue;
    }
    emit(cur);
    if (next < 4096) {
      dict.set(key, next);
      (kids[cur] || (kids[cur] = [])).push(next);
      tail[next] = p;
      // the code size grows as the decoder's will: before the first code that needs the extra bit
      if (next >= 1 << bits && bits < 12) bits++;
      next++;
    } else {
      emit(clear);
      reset();
    }
    cur = p;
  }
  emit(cur);
  emit(eoi);
  if (nacc) out.b(acc & 255);
  return out.done();
}

/* ---------------- the file ---------------- */

/** A growing byte buffer. */
class Out {
  buf = new Uint8Array(1 << 16);
  n = 0;
  room(k: number) {
    if (this.n + k <= this.buf.length) return;
    let m = this.buf.length * 2;
    while (m < this.n + k) m *= 2;
    const b = new Uint8Array(m);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }
  b(...v: number[]) {
    this.room(v.length);
    for (const x of v) this.buf[this.n++] = x & 255;
  }
  u16(v: number) {
    this.b(v & 255, v >> 8);
  }
  bytes(a: ArrayLike<number>) {
    this.room(a.length);
    for (let i = 0; i < a.length; i++) this.buf[this.n++] = a[i];
  }
  done() {
    return this.buf.slice(0, this.n);
  }
  /** data in sub-blocks of at most 255 bytes, then the terminator */
  blocks(d: Uint8Array) {
    for (let i = 0; i < d.length; i += 255) {
      const n = Math.min(255, d.length - i);
      this.b(n);
      this.bytes(d.subarray(i, i + n));
    }
    this.b(0);
  }
}
const tableBits = (n: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
function table(o: Out, pal: number[][], size: number) {
  for (let i = 0; i < size; i++) {
    const c = pal[i] || [0, 0, 0];
    o.b(c[0], c[1], c[2]);
  }
}

export interface GifView {
  /** the first input frame it shows (merged frames show the same picture) */
  from: number;
  /** the picture as decoded, RGB */
  rgb: Uint8Array;
  /** which pixels show (transparent GIFs), else null */
  alpha: Uint8Array | null;
}
export interface GifResult {
  bytes: Uint8Array;
  /** frames written (after merging) */
  frames: number;
  /** what each written frame looks like once decoded */
  views: GifView[];
}
/** One input frame, as the GIF shows it: RGBA. */
export function viewAt(views: GifView[], at: number, w: number, h: number) {
  if (!views.length) return null;
  let k = 0;
  while (k + 1 < views.length && views[k + 1].from <= at) k++;
  const v = views[k],
    out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = v.rgb[i * 3];
    out[i * 4 + 1] = v.rgb[i * 3 + 1];
    out[i * 4 + 2] = v.rgb[i * 3 + 2];
    out[i * 4 + 3] = v.alpha && !v.alpha[i] ? 0 : 255;
  }
  return out;
}

/** Encode the frames (all w × h). */
export function encodeGif(frames: GifFrame[], w: number, h: number, o: GifOpts): GifResult {
  const prepared = frames.map(f => prepare(f.rgba, w, h, o)),
    rgbs = prepared.map(p => p.rgb),
    masks = prepared.map(p => p.alpha);
  // transparency: the transparent pixels, or the unchanged ones, use the last slot
  const needT = o.transparent || (o.changed && frames.length > 1);
  const onePal = o.palette === 'one' ? makePalette(rgbs, masks, o, needT) : null;
  const out = new Out();
  out.bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  const gPal = onePal ? (needT ? onePal.concat([[0, 0, 0]]) : onePal) : null,
    gBits = gPal ? tableBits(gPal.length) : 0;
  out.u16(w);
  out.u16(h);
  out.b(gPal ? 0x80 | ((gBits - 1) << 4) | (gBits - 1) : 0, 0, 0);
  if (gPal) table(out, gPal, 1 << gBits);
  if (frames.length > 1 || o.loops !== 1) {
    // NETSCAPE2.0: loop count (0 = forever; n plays = n − 1 repeats)
    out.b(0x21, 0xff, 11);
    out.bytes(Array.from('NETSCAPE2.0', c => c.charCodeAt(0)));
    out.b(3, 1);
    out.u16(o.loops === 0 ? 0 : Math.max(0, o.loops - 1));
    out.b(0);
  }
  let prevShown: Uint8Array | null = null, // the picture on screen so far (RGB)
    prevMap: { ref: Uint8Array; idx: Uint8Array } | null = null;
  const views: GifView[] = [];
  const tolSum = Math.round((o.tolerance / 100) * 255 * 3);
  // frames identical to the one before are merged into it (longer delay)
  const groups: { i: number; ms: number }[] = [];
  frames.forEach((f, i) => {
    const g = groups[groups.length - 1];
    if (o.merge && g && sameRGB(rgbs[g.i], rgbs[i], masks[g.i], masks[i])) g.ms += f.ms;
    else groups.push({ i, ms: f.ms });
  });
  const paint = (shown: Uint8Array, i: number, c: number[]) => {
    shown[i * 3] = c[0];
    shown[i * 3 + 1] = c[1];
    shown[i * 3 + 2] = c[2];
  };
  groups.forEach((g, gi) => {
    const rgb = rgbs[g.i],
      alpha = masks[g.i],
      pal = onePal || makePalette([rgb], [alpha], o, needT),
      full = needT ? pal.concat([[0, 0, 0]]) : pal,
      tIndex = needT ? full.length - 1 : -1,
      bitsN = tableBits(full.length),
      minSize = Math.max(2, onePal ? gBits : bitsN),
      useDiff = o.changed && !o.transparent && !!prevShown && gi > 0;
    // map; with one palette, pixels that (nearly) didn't change keep their dot
    const m = mapFrame(
        rgb,
        alpha,
        w,
        h,
        pal,
        o,
        tIndex < 0 ? 0 : tIndex,
        onePal ? prevMap : null,
        useDiff ? tolSum : 0,
      ),
      idx = m.idx;
    let x0 = 0,
      y0 = 0,
      x1 = w - 1,
      y1 = h - 1,
      rect: Uint8Array,
      data: Uint8Array,
      transparentUnchanged = false;
    if (useDiff) {
      // crop to what changed on screen
      const same = new Uint8Array(w * h);
      x0 = w;
      y0 = h;
      x1 = -1;
      y1 = -1;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x,
            c = full[idx[i]];
          if (c[0] === prevShown![i * 3] && c[1] === prevShown![i * 3 + 1] && c[2] === prevShown![i * 3 + 2])
            same[i] = 1;
          else {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      if (x1 < 0) x0 = y0 = x1 = y1 = 0;
      const rw = x1 - x0 + 1,
        rh = y1 - y0 + 1,
        crop = new Uint8Array(rw * rh),
        holes = new Uint8Array(rw * rh);
      for (let y = 0; y < rh; y++)
        for (let x = 0; x < rw; x++) {
          const i = (y + y0) * w + (x + x0);
          crop[y * rw + x] = idx[i];
          holes[y * rw + x] = same[i] ? tIndex : idx[i];
        }
      // unchanged pixels as see-through holes, or simply drawn again: whichever compresses better
      const a = lzw(crop, minSize, full, o.lossy, tIndex),
        bh = lzw(holes, minSize, full, o.lossy, tIndex);
      transparentUnchanged = bh.length < a.length;
      rect = transparentUnchanged ? holes : crop;
      data = transparentUnchanged ? bh : a;
    } else {
      rect = idx.slice();
      data = lzw(rect, minSize, full, o.lossy, tIndex);
    }
    const rw = x1 - x0 + 1,
      rh = y1 - y0 + 1;
    // graphic control: delay, transparency, disposal (keep for changed-only, restore for transparent)
    const disposal = o.transparent ? 2 : 1;
    out.b(0x21, 0xf9, 4, (disposal << 2) | (needT ? 1 : 0));
    out.u16(Math.max(2, Math.round(g.ms / 10)));
    out.b(needT ? tIndex : 0, 0);
    // image descriptor (+ its own table when there's one palette per frame)
    out.b(0x2c);
    out.u16(x0);
    out.u16(y0);
    out.u16(rw);
    out.u16(rh);
    out.b(onePal ? 0 : 0x80 | (bitsN - 1));
    if (!onePal) table(out, full, 1 << bitsN);
    out.b(minSize);
    out.blocks(data);
    // the picture as it now shows (lossy matching wrote the pixels it changed back into rect)
    const shown = prevShown && useDiff ? prevShown.slice() : new Uint8Array(w * h * 3);
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) {
        const k = rect[y * rw + x];
        if (k === tIndex && (transparentUnchanged || o.transparent)) continue;
        paint(shown, (y + y0) * w + (x + x0), full[k] || [0, 0, 0]);
      }
    // what the next frame keeps: the indices as they show
    if (onePal) {
      const shownIdx = prevMap && useDiff ? prevMap.idx.slice() : new Uint8Array(w * h);
      for (let y = 0; y < rh; y++)
        for (let x = 0; x < rw; x++) {
          const k = rect[y * rw + x],
            i = (y + y0) * w + (x + x0);
          if (k === tIndex && transparentUnchanged) continue;
          shownIdx[i] = k;
        }
      prevMap = { ref: m.ref, idx: shownIdx };
    }
    prevShown = shown;
    views.push({ from: g.i, rgb: shown, alpha });
  });
  out.b(0x3b);
  return { bytes: out.done(), frames: views.length, views };
}
function sameRGB(a: Uint8Array, b: Uint8Array, ma: Uint8Array | null, mb: Uint8Array | null) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  if (ma && mb) for (let i = 0; i < ma.length; i++) if (ma[i] !== mb[i]) return false;
  return true;
}
