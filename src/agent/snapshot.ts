// SVGcinema — agent/snapshot
// A picture of the canvas at a given time, for the design agent to look at its own work. Drawn from the
// live stage (the artwork only: no selection handles, guides, grid or onion skins), with the project's
// images inlined, then rasterised to PNG. Nothing is saved: the PNG goes to the model and is dropped.
import { ASSETS, S, URLS, doc } from '../core/state';
import { loadImg, toBlobP } from '../export/images';
import { frame } from '../render/stage';

export const SNAP_MAX = 768;

/** The stage at time t as standalone SVG markup, w × h pixels. */
export function frameSVG(t: number, w: number, h: number) {
  const was = S.time,
    stage = document.getElementById('stage') as unknown as SVGSVGElement;
  S.time = Math.max(0, Math.min(doc.dur, t));
  frame();
  try {
    const c = stage.cloneNode(true) as SVGSVGElement;
    // the artwork only
    for (const id of ['gridBack', 'onion', 'iso', 'overlay']) c.querySelector('#' + id)?.remove();
    c.setAttribute('width', String(w));
    c.setAttribute('height', String(h));
    c.setAttribute('viewBox', `${doc.vx || 0} ${doc.vy || 0} ${doc.w} ${doc.h}`);
    c.removeAttribute('style');
    c.removeAttribute('class');
    // images are blob: links in the editor; an SVG drawn as a picture needs them inline
    const byUrl = new Map(Object.keys(URLS).map(id => [URLS[id], id]));
    c.querySelectorAll('image').forEach(im => {
      for (const attr of ['href', 'xlink:href']) {
        const v = im.getAttribute(attr),
          id = v ? byUrl.get(v) : undefined;
        if (id && ASSETS[id]) im.setAttribute(attr, ASSETS[id].data);
      }
    });
    return new XMLSerializer().serializeToString(c);
  } finally {
    S.time = was;
    frame();
  }
}

/** The canvas at time t as a PNG, at most `width` (≤ 768) pixels wide: base64 data and its size. */
export async function snapshotPNG(t: number, width = SNAP_MAX) {
  const k = Math.min(width, SNAP_MAX) / Math.max(doc.w, doc.h, 1),
    w = Math.max(1, Math.round(doc.w * k)),
    h = Math.max(1, Math.round(doc.h * k));
  const url = URL.createObjectURL(new Blob([frameSVG(t, w, h)], { type: 'image/svg+xml' }));
  try {
    const img = await loadImg(url),
      cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const x = cv.getContext('2d')!;
    x.drawImage(img, 0, 0, w, h);
    const b = await toBlobP(cv, 'image/png');
    if (!b) throw new Error('the canvas could not be drawn');
    const bytes = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { data: btoa(s), mime: 'image/png', w, h, time: Math.max(0, Math.min(doc.dur, t)) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
