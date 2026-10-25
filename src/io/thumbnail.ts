// SVGcinema — io/thumbnail
// A picture of the animation's first frame, saved in every project file as `thumbnail.png` (the first
// entry of the zip, stored uncompressed, so other programs can read it without unpacking the
// project: the SVGcinema thumbnail handlers for Windows Explorer and Linux file managers do that).
// It is drawn from the exported SVG at time 0 (no script runs in an <img>, so the export's own
// markup, written at time 0, is what shows), with web fonts as outlines and images embedded.
import { doc, S } from '../core/state';
import { buildExport } from '../export/build';
import { loadImg, toBlobP } from '../export/images';
import { isLocalFamily, prepareFonts, webFont } from '../render/fonts';

export const THUMB_NAME = 'thumbnail.png';
/** the longest side of the picture, in pixels */
export const THUMB_MAX = 512;

/** the size of the thumbnail for a canvas of w × h */
export function thumbSize(w: number, h: number, max = THUMB_MAX) {
  const k = max / Math.max(w, h, 1);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}
/** The first frame's SVG, ready to draw as an image of w × h pixels. */
export async function firstFrameSVG(w: number, h: number) {
  const ex = doc.ex,
    keep = { mode: ex.mode, fonts: ex.fonts, proj: ex.proj, size: ex.size, w: ex.w, h: ex.h, trigger: ex.trigger },
    only = S.exportOnly;
  const texts = doc.layers
    .filter(l => l.type === 'text' && !l.hid && (webFont(l.geo.family) || isLocalFamily(l.geo.family)))
    .map(l => l.geo);
  if (texts.length) await prepareFonts(texts, 'outline');
  Object.assign(ex, { mode: 'js', fonts: 'outline', proj: false, size: 'fixed', w, h, trigger: 'load' });
  S.exportOnly = null;
  try {
    return buildExport(null).code.replace(/<script>[\s\S]*?<\/script>/g, '');
  } finally {
    Object.assign(ex, keep);
    S.exportOnly = only;
  }
}
/** The thumbnail as PNG bytes, or null when it can't be drawn (the project still saves). */
export async function thumbnailPNG(max = THUMB_MAX): Promise<Uint8Array | null> {
  try {
    const [w, h] = thumbSize(doc.w, doc.h, max),
      svg = await firstFrameSVG(w, h),
      url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const img = await loadImg(url),
        cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      const b = await toBlobP(cv, 'image/png');
      return b ? new Uint8Array(await b.arrayBuffer()) : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    return null;
  }
}
