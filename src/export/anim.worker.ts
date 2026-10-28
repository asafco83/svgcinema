// SVGcinema — export/anim.worker
// Makes GIFs (export/gif) and animated WebPs (libwebp per frame, export/webp-anim) off the main
// thread. The frames are sent once and kept; each settings change only re-encodes them.
import { encodeGif, viewAt } from './gif';
import type { GifOpts } from './gif';
import { muxAnimatedWebP } from './webp-anim';
import type { WebPFrame } from './webp-anim';

export interface WebPOpts {
  q: number;
  lossless: boolean;
  changed: boolean;
  transparent: boolean;
  loops: number;
}
export type AnimJob =
  | { id: number; kind: 'frames'; w: number; h: number; ms: number[]; frames: Uint8ClampedArray[] }
  /** `extra`: a second file (the fallback in a set); the previews stay those of the main one */
  | { id: number; kind: 'gif'; opts: GifOpts; previewAt: number; extra?: boolean }
  | { id: number; kind: 'webp'; opts: WebPOpts; previewAt: number; extra?: boolean }
  /** a frame of the last file made, as it shows */
  | { id: number; kind: 'preview'; at: number };
export type AnimReply =
  | { id: number; bytes: Uint8Array; frames: number; preview: Uint8ClampedArray | null; w: number; h: number }
  | { id: number; ok: true; preview?: Uint8ClampedArray | null; w?: number; h?: number }
  | { id: number; error: string };

let F: { w: number; h: number; ms: number[]; frames: Uint8ClampedArray[] } | null = null;
/** how the last file made shows a frame */
let view: ((at: number) => Promise<Uint8ClampedArray | null>) | null = null;

/** The smallest rectangle (even corner) holding every pixel that differs from the frame before. */
function changedRect(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number) {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  if (x1 < 0) return null;
  x0 &= ~1;
  y0 &= ~1;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function crop(f: Uint8ClampedArray, w: number, r: { x: number; y: number; w: number; h: number }) {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++)
    out.set(f.subarray(((y + r.y) * w + r.x) * 4, ((y + r.y) * w + r.x + r.w) * 4), y * r.w * 4);
  return out;
}

async function webp(o: WebPOpts, previewAt: number) {
  const enc = (await import('@jsquash/webp/encode')).default,
    { w, h, frames, ms } = F!;
  const out: (WebPFrame & { from: number })[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    let r = { x: 0, y: 0, w, h };
    if (o.changed && i > 0) {
      const c = changedRect(frames[i - 1], f, w, h);
      if (!c) {
        // nothing changed: the frame before just shows longer
        out[out.length - 1].ms += ms[i];
        continue;
      }
      r = c;
    }
    const px = r.w === w && r.h === h ? f : crop(f, w, r),
      buf = await enc(
        new ImageData(px, r.w, r.h),
        o.lossless ? { lossless: 1, quality: 100, exact: 1 } : { quality: o.q, alpha_quality: 100 },
      );
    out.push({ webp: new Uint8Array(buf), x: r.x, y: r.y, w: r.w, h: r.h, ms: ms[i], from: i });
  }
  // the frame showing at a moment, decoded; a cropped one over the picture before it
  const show = async (at: number) => {
    if (!out.length) return null;
    let k = 0;
    while (k + 1 < out.length && out[k + 1].from <= at) k++;
    const f = out[k],
      d = await (await import('@jsquash/webp/decode')).default(f.webp.slice().buffer);
    if (f.w === w && f.h === h) return d.data;
    const p = frames[f.from - 1].slice();
    for (let y = 0; y < f.h; y++) p.set(d.data.subarray(y * f.w * 4, (y + 1) * f.w * 4), ((y + f.y) * w + f.x) * 4);
    return p;
  };
  const bytes = muxAnimatedWebP(out, w, h, o.loops, o.transparent);
  return { bytes, frames: out.length, show, preview: previewAt >= 0 ? await show(previewAt) : null };
}

self.onmessage = async (e: MessageEvent<AnimJob>) => {
  const j = e.data,
    post = (r: AnimReply, t?: Transferable[]) => (self as unknown as Worker).postMessage(r, t || []);
  try {
    if (j.kind === 'frames') {
      F = { w: j.w, h: j.h, ms: j.ms, frames: j.frames };
      view = null;
      return post({ id: j.id, ok: true });
    }
    if (!F) throw new Error('no frames');
    if (j.kind === 'preview')
      return post({ id: j.id, ok: true, preview: view ? await view(j.at) : null, w: F.w, h: F.h });
    if (j.kind === 'gif') {
      const { w, h } = F,
        r = encodeGif(
          F.frames.map((rgba, i) => ({ rgba, ms: F!.ms[i] })),
          w,
          h,
          j.opts,
        );
      if (!j.extra) view = async (at: number) => viewAt(r.views, at, w, h);
      const preview = j.previewAt >= 0 ? viewAt(r.views, j.previewAt, w, h) : null;
      return post({ id: j.id, bytes: r.bytes, frames: r.frames, preview, w, h }, [r.bytes.buffer]);
    }
    const r = await webp(j.opts, j.previewAt);
    if (!j.extra) view = r.show;
    post({ id: j.id, bytes: r.bytes, frames: r.frames, preview: r.preview, w: F.w, h: F.h }, [r.bytes.buffer]);
  } catch (err) {
    post({ id: j.id, error: String((err && (err as Error).message) || err) });
  }
};
