// Export › GIF & Animated WebP: the GIF encoder (decoded again here and compared), the animated
// WebP container, and the settings helpers.
import { beforeEach, describe, expect, it } from 'vitest';
import { setDoc, doc } from '../src/core/state';
import { sampleDoc } from '../src/model/sample';
import { encodeGif, lzw, medianCut, histogram, viewAt } from '../src/export/gif';
import type { GifOpts } from '../src/export/gif';
import { imageChunks, muxAnimatedWebP } from '../src/export/webp-anim';
import { animFrames, animSettings, animSize, animSnippet, animSpan, plainOpts, savingText } from '../src/export/anim';

/** A small GIF decoder: every frame composed onto the screen, as a browser shows it (RGBA). */
function decodeGif(b: Uint8Array) {
  let o = 6;
  const u16 = () => b[o++] | (b[o++] << 8);
  const W = u16(),
    H = u16(),
    pk = b[o++];
  o += 2;
  let gct: number[][] | null = null;
  const table = (n: number) => {
    const t: number[][] = [];
    for (let i = 0; i < n; i++) t.push([b[o++], b[o++], b[o++]]);
    return t;
  };
  if (pk & 0x80) gct = table(1 << ((pk & 7) + 1));
  const screen = new Uint8ClampedArray(W * H * 4),
    frames: { rgba: Uint8ClampedArray; delay: number }[] = [];
  let loops = -1,
    gce = { disposal: 0, transp: false, ti: 0, delay: 0 },
    last: { x: number; y: number; w: number; h: number; disposal: number } | null = null;
  const blocks = () => {
    const out: number[] = [];
    for (let n = b[o++]; n; n = b[o++]) for (let i = 0; i < n; i++) out.push(b[o++]);
    return out;
  };
  for (;;) {
    const c = b[o++];
    if (c === 0x3b) break;
    if (c === 0x21) {
      const lbl = b[o++];
      if (lbl === 0xf9) {
        o++;
        const f = b[o++];
        gce = { disposal: (f >> 2) & 7, transp: !!(f & 1), ti: 0, delay: 0 };
        gce.delay = u16();
        gce.ti = b[o++];
        o++;
      } else if (lbl === 0xff) {
        const d = blocks();
        if (String.fromCharCode(...d.slice(0, 11)) === 'NETSCAPE2.0') loops = d[12] | (d[13] << 8);
      } else blocks();
      continue;
    }
    expect(c).toBe(0x2c);
    if (last && last.disposal === 2)
      for (let y = 0; y < last.h; y++)
        screen.fill(0, ((last.y + y) * W + last.x) * 4, ((last.y + y) * W + last.x + last.w) * 4);
    const x = u16(),
      y = u16(),
      w = u16(),
      h = u16(),
      ip = b[o++];
    const ct = ip & 0x80 ? table(1 << ((ip & 7) + 1)) : gct!;
    const min = b[o++],
      data = blocks();
    // LZW
    const px: number[] = [];
    const clear = 1 << min,
      eoi = clear + 1;
    let size = min + 1,
      dict: number[][] = [],
      prev: number[] | null = null,
      acc = 0,
      nacc = 0,
      p = 0;
    const reset = () => {
      dict = [];
      for (let i = 0; i < clear; i++) dict[i] = [i];
      dict[clear] = [];
      dict[eoi] = [];
      size = min + 1;
      prev = null;
    };
    reset();
    for (;;) {
      while (nacc < size && p < data.length) {
        acc |= data[p++] << nacc;
        nacc += 8;
      }
      if (nacc < size) break;
      const code = acc & ((1 << size) - 1);
      acc >>>= size;
      nacc -= size;
      if (code === clear) {
        reset();
        continue;
      }
      if (code === eoi) break;
      let e: number[];
      if (code < dict.length) e = dict[code];
      else e = prev!.concat(prev![0]);
      px.push(...e);
      if (prev && dict.length < 4096) dict.push(prev.concat(e[0]));
      prev = e;
      if (dict.length === 1 << size && size < 12) size++;
    }
    expect(px.length).toBe(w * h);
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const k = px[yy * w + xx];
        if (gce.transp && k === gce.ti) continue;
        const j = ((y + yy) * W + x + xx) * 4;
        screen[j] = ct[k][0];
        screen[j + 1] = ct[k][1];
        screen[j + 2] = ct[k][2];
        screen[j + 3] = 255;
      }
    frames.push({ rgba: screen.slice(), delay: gce.delay });
    last = { x, y, w, h, disposal: gce.disposal };
  }
  return { W, H, loops, frames };
}

const OPTS: GifOpts = {
  colours: 64,
  palette: 'one',
  pick: 'best',
  keep: [],
  dither: 'none',
  strength: 60,
  denoise: 0,
  lossy: 0,
  changed: false,
  tolerance: 0,
  transparent: false,
  matte: 0xffffff,
  loops: 0,
  merge: false,
};
/** Frames of a moving square over a gradient. */
function scene(n: number, w = 40, h = 30, alpha = false) {
  const out: { rgba: Uint8ClampedArray; ms: number }[] = [];
  for (let f = 0; f < n; f++) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4,
          inSq = x >= 4 + f * 3 && x < 14 + f * 3 && y >= 8 && y < 18;
        d[i] = inSq ? 250 : (x * 255) / w;
        d[i + 1] = inSq ? 40 : (y * 255) / h;
        d[i + 2] = inSq ? 60 : 128;
        d[i + 3] = alpha && !inSq && x < 6 ? 0 : 255;
      }
    out.push({ rgba: d, ms: 100 });
  }
  return out;
}
/** Each decoded frame equals the encoder's own view of it. */
function matchesViews(o: GifOpts, frames = scene(4), w = 40, h = 30) {
  const r = encodeGif(frames, w, h, o),
    d = decodeGif(r.bytes);
  expect(d.W).toBe(w);
  expect(d.H).toBe(h);
  expect(d.frames.length).toBe(r.frames);
  r.views.forEach((v, i) => {
    const want = viewAt(r.views, v.from, w, h)!,
      got = d.frames[i].rgba;
    for (let k = 0; k < want.length; k += 4) {
      if (want[k + 3] === 0) {
        expect(got[k + 3]).toBe(0);
        continue;
      }
      expect([got[k], got[k + 1], got[k + 2]]).toEqual([want[k], want[k + 1], want[k + 2]]);
    }
  });
  return { r, d };
}
/** Mean error per channel between two RGBA pictures (opaque pixels). */
function err(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let s = 0,
    n = 0;
  for (let i = 0; i < a.length; i += 4)
    if (a[i + 3]) {
      s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n += 3;
    }
  return s / n;
}

describe('GIF encoder', () => {
  it('writes a GIF that decodes to what it says it shows', () => {
    const { d } = matchesViews(OPTS);
    expect(d.loops).toBe(0);
    expect(d.frames.every(f => f.delay === 10)).toBe(true);
  });
  it('stays close to the original', () => {
    const fr = scene(3),
      r = encodeGif(fr, 40, 30, { ...OPTS, colours: 256 });
    expect(err(viewAt(r.views, 1, 40, 30)!, fr[1].rgba)).toBeLessThan(6);
  });
  it('per-frame palettes, dithering, noise reduction and lossy all decode correctly', () => {
    matchesViews({ ...OPTS, palette: 'per', pick: 'fast' });
    for (const dither of ['diff', 'pat', 'noise'] as const) matchesViews({ ...OPTS, dither });
    matchesViews({ ...OPTS, denoise: 60 });
    matchesViews({ ...OPTS, lossy: 120, dither: 'diff' });
  });
  it('stores only the pixels that change, in a cropped rectangle', () => {
    const full = encodeGif(scene(6), 40, 30, OPTS).bytes.length,
      { r } = matchesViews({ ...OPTS, changed: true, tolerance: 2 }, scene(6));
    expect(r.bytes.length).toBeLessThan(full);
  });
  it('a slowly changing background keeps its dots within the tolerance (smaller, still exact on decode)', () => {
    const drift = (f: number) => {
      const d = new Uint8ClampedArray(40 * 30 * 4);
      for (let i = 0; i < d.length; i += 4) {
        const x = (i / 4) % 40;
        d[i] = (x * 6 + f) & 255;
        d[i + 1] = 90 + f;
        d[i + 2] = 200 - x;
        d[i + 3] = 255;
      }
      return { rgba: d, ms: 100 };
    };
    const fr = [0, 1, 2, 3, 4, 5].map(drift),
      o = { ...OPTS, dither: 'diff' as const, changed: true },
      strict = matchesViews({ ...o, tolerance: 0 }, fr).r.bytes.length,
      loose = matchesViews({ ...o, tolerance: 5 }, fr).r.bytes.length;
    expect(loose).toBeLessThan(strict * 0.7);
  });
  it('keeps the colours asked for exactly', () => {
    const r = encodeGif(scene(2), 40, 30, { ...OPTS, colours: 4, keep: [0xfa283c] }),
      v = viewAt(r.views, 0, 40, 30)!,
      i = (12 * 40 + 8) * 4; // inside the square
    expect([v[i], v[i + 1], v[i + 2]]).toEqual([250, 40, 60]);
  });
  it('the colour count is honoured, with a slot for transparency', () => {
    for (const colours of [2, 7, 256]) {
      const r = encodeGif(scene(3), 40, 30, { ...OPTS, colours, changed: true }),
        set = new Set<string>();
      r.views.forEach(v => {
        for (let i = 0; i < v.rgb.length; i += 3) set.add(v.rgb[i] + ',' + v.rgb[i + 1] + ',' + v.rgb[i + 2]);
      });
      expect(set.size).toBeLessThanOrEqual(colours);
      decodeGif(r.bytes);
    }
  });
  it('transparent backgrounds: see-through pixels stay see-through', () => {
    const fr = scene(3, 40, 30, true),
      { d } = matchesViews({ ...OPTS, transparent: true, lossy: 80 }, fr);
    expect(d.frames[1].rgba[3]).toBe(0); // (0,0) was transparent
    expect(d.frames[1].rgba[(12 * 40 + 10) * 4 + 3]).toBe(255);
  });
  it('merges frames that do not change, showing the earlier one longer', () => {
    const fr = scene(3);
    fr.splice(1, 0, { rgba: fr[0].rgba.slice(), ms: 100 });
    const { r, d } = matchesViews({ ...OPTS, merge: true }, fr);
    expect(r.frames).toBe(3);
    expect(d.frames[0].delay).toBe(20);
    expect(viewAt(r.views, 1, 40, 30)).toEqual(viewAt(r.views, 0, 40, 30));
  });
  it('plays a set number of times', () => {
    expect(decodeGif(encodeGif(scene(2), 40, 30, { ...OPTS, loops: 3 }).bytes).loops).toBe(2);
    expect(decodeGif(encodeGif(scene(2), 40, 30, { ...OPTS, loops: 1 }).bytes).loops).toBe(0);
  });
  it('LZW restarts its table on long, varied input (and still decodes)', () => {
    const w = 160,
      h = 120,
      noise = (f: number) => {
        const d = new Uint8ClampedArray(w * h * 4);
        let x = 12345 + f;
        for (let i = 0; i < d.length; i++) {
          x = (Math.imul(x, 1103515245) + 12345) >>> 0;
          d[i] = (i & 3) === 3 ? 255 : x >>> 24;
        }
        return { rgba: d, ms: 50 };
      };
    for (const lossy of [0, 150])
      matchesViews({ ...OPTS, colours: 256, pick: 'fast', lossy }, [noise(1), noise(2)], w, h);
    const px = new Uint8Array(60000);
    for (let i = 0; i < px.length; i++) px[i] = (i * 7919) % 251 ^ (i >> 5) % 5;
    const pal = Array.from({ length: 256 }, (_, i) => [i, i, i]);
    expect(lzw(px.slice(), 8, pal, 0).length).toBeGreaterThan(1000);
  });
  it('median cut gives the colours there are when there are few', () => {
    const rgb = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 0]),
      pal = medianCut(histogram([rgb]), 8);
    expect(pal.length).toBe(3);
  });
});

describe('Animated WebP container', () => {
  /** A still WebP's skeleton: RIFF, WEBP, one VP8L chunk of n bytes. */
  const still = (n: number) => {
    const b = new Uint8Array(20 + n + (n & 1));
    b.set([82, 73, 70, 70], 0);
    new DataView(b.buffer).setUint32(4, b.length - 8, true);
    b.set([87, 69, 66, 80, 86, 80, 56, 76], 8);
    new DataView(b.buffer).setUint32(16, n, true);
    for (let i = 0; i < n; i++) b[20 + i] = i + 1;
    return b;
  };
  it('takes the image chunks of each frame', () => {
    const c = imageChunks(still(5));
    expect(c.length).toBe(1);
    expect(c[0].length).toBe(14); // header + 5 bytes + pad
  });
  it('writes VP8X, ANIM and one ANMF per frame', () => {
    const f = muxAnimatedWebP(
        [
          { webp: still(4), x: 0, y: 0, w: 40, h: 30, ms: 100 },
          { webp: still(3), x: 6, y: 4, w: 10, h: 8, ms: 200 },
        ],
        40,
        30,
        0,
        true,
      ),
      v = new DataView(f.buffer),
      s = (o: number) => String.fromCharCode(f[o], f[o + 1], f[o + 2], f[o + 3]);
    expect(s(0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(f.length - 8);
    expect(s(8)).toBe('WEBP');
    expect(s(12)).toBe('VP8X');
    expect(f[20] & 0x12).toBe(0x12); // animation + alpha
    let o = 12;
    const ids: string[] = [];
    while (o < f.length) {
      ids.push(s(o));
      const n = v.getUint32(o + 4, true);
      if (s(o) === 'ANMF' && ids.length === 4) {
        expect(f[o + 8]).toBe(3); // x / 2
        expect(f[o + 11]).toBe(2); // y / 2
        expect(f[o + 14] + 1).toBe(10);
        expect(f[o + 20] | (f[o + 21] << 8)).toBe(200);
      }
      o += 8 + n + (n & 1);
    }
    expect(ids).toEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF']);
  });
});

describe('GIF & Animated WebP settings', () => {
  beforeEach(() => setDoc(sampleDoc()));
  it('starts with the defaults from the mockup', () => {
    delete doc.ex.anim;
    const a = animSettings();
    expect(a.fmt).toBe('gif');
    expect(a.fps).toBe(15);
    expect(a.scale).toBe('75');
    expect(a.colours).toBe(128);
    expect(a.dither).toBe('diff');
    expect(a.changed).toBe(true);
  });
  it('size, span and frame count', () => {
    const a = animSettings();
    a.scale = '50';
    expect(animSize(a, 640, 400)).toEqual([320, 200]);
    a.part = true;
    a.from = 0.5;
    a.to = 2.5;
    expect(animSpan(a, 3)).toEqual([0.5, 2.5]);
    a.fps = 12;
    expect(animFrames(a, 3)).toBe(24);
    a.to = 0.2; // backwards: the whole animation
    expect(animSpan(a, 3)).toEqual([0, 3]);
  });
  it('the plain GIF it compares with, and the saving shown', () => {
    const p = plainOpts(animSettings());
    expect(p.colours).toBe(256);
    expect([p.dither, p.strength]).toEqual(['diff', 100]);
    expect(p.lossy).toBe(0);
    expect(p.changed).toBe(false);
    expect(savingText('gif', 300, 1000)).toBe('70% smaller than a plain GIF');
    expect(savingText('gif', 1000, 900)).toBe('about the size of a plain GIF');
    expect(savingText('webp', 300, 1000)).toMatch(/^a plain GIF would be/);
    expect(savingText('gif', 300, 0)).toBe('');
  });
  it('embed code: a plain image for GIF, a picture with a GIF behind the WebP', () => {
    expect(animSnippet('gif', 'my badge', 'My "badge"', 480, 300)).toBe(
      '<img src="my%20badge.gif" alt="My &quot;badge&quot;"\n     width="480" height="300">',
    );
    const w = animSnippet('webp', 'b', 'b', 10, 10);
    expect(w).toContain('<source srcset="b.webp"');
    expect(w).toContain('<img src="b.gif"');
  });
});
