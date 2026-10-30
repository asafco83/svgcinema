// SVGcinema — export/webp-anim
// An animated WebP from still WebP frames (each encoded by libwebp in export/anim.worker): the frames'
// image chunks go into ANMF chunks behind a VP8X + ANIM header. A frame that changes only in part is
// cropped to the part that changed (it replaces that rectangle, no blending).

const le = (v: number, n: number) => {
  const b: number[] = [];
  for (let i = 0; i < n; i++) b.push((v >>> (8 * i)) & 255);
  return b;
};
const fourcc = (s: string) => Array.from(s, c => c.charCodeAt(0));
const id4 = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** The image chunks (ALPH, VP8 , VP8L) of a still WebP file, as they are in it. */
export function imageChunks(webp: Uint8Array): Uint8Array[] {
  if (webp.length < 12 || id4(webp, 0) !== 'RIFF' || id4(webp, 8) !== 'WEBP') throw new Error('not a WebP file');
  const out: Uint8Array[] = [];
  let o = 12;
  while (o + 8 <= webp.length) {
    const c = id4(webp, o),
      n = (webp[o + 4] | (webp[o + 5] << 8) | (webp[o + 6] << 16) | (webp[o + 7] << 24)) >>> 0,
      end = Math.min(o + 8 + n + (n & 1), webp.length);
    if (c === 'ALPH' || c === 'VP8 ' || c === 'VP8L') out.push(webp.subarray(o, end));
    o = o + 8 + n + (n & 1);
  }
  return out;
}
export interface WebPFrame {
  /** a still WebP of the rectangle */
  webp: Uint8Array;
  /** where it goes (even numbers) and its size */
  x: number;
  y: number;
  w: number;
  h: number;
  ms: number;
}
/** Concatenate byte runs into one array. */
function join(parts: (Uint8Array | number[])[]) {
  const n = parts.reduce((s, p) => s + p.length, 0),
    out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function chunk(id: string, data: Uint8Array) {
  return join([fourcc(id), le(data.length, 4), data, data.length & 1 ? [0] : []]);
}
/** The animated file: canvas w × h, `loops` (0 = forever), frames in order. */
export function muxAnimatedWebP(frames: WebPFrame[], w: number, h: number, loops: number, alpha: boolean) {
  const parts: Uint8Array[] = [
    Uint8Array.from(fourcc('WEBP')),
    chunk('VP8X', Uint8Array.from([0x02 | (alpha ? 0x10 : 0), 0, 0, 0, ...le(w - 1, 3), ...le(h - 1, 3)])),
    // background color (unused by browsers), then the loop count
    chunk('ANIM', Uint8Array.from([...le(0, 4), ...le(loops, 2)])),
  ];
  for (const f of frames) {
    const head = [
      ...le(f.x >> 1, 3),
      ...le(f.y >> 1, 3),
      ...le(f.w - 1, 3),
      ...le(f.h - 1, 3),
      ...le(Math.max(1, Math.round(f.ms)), 3),
      // no blending (the rectangle is replaced), nothing disposed
      0x02,
    ];
    parts.push(chunk('ANMF', join([head, ...imageChunks(f.webp)])));
  }
  const body = join(parts);
  return join([fourcc('RIFF'), le(body.length, 4), body]);
}
