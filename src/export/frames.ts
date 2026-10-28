// SVGcinema — export/frames
// Still frames of the animation, for the Image, Video and GIF exports. The frames come from the same
// SVG the JavaScript export writes (text as outlines, images embedded), mounted out of sight with its
// player, which is moved to each time and copied without its script. So a frame shows exactly what
// the exported animation shows at that moment, and draws the same in an <img> or on a canvas.
import { doc, S } from '../core/state';
import { bgPaint } from '../model/background';
import { isLocalFamily, prepareFonts, webFont } from '../render/fonts';
import { buildExport } from './build';
import { loadImg } from './images';

const PREFIX = 'cinframe';

export interface FrameSource {
  /** the static SVG markup of the frame at time t (seconds), drawn w × h pixels (0: the canvas size) */
  svgAt(t: number, o?: FrameOpts): string;
  dispose(): void;
}
export interface FrameOpts {
  w?: number;
  h?: number;
  /** a colour painted behind everything; omitted: transparent */
  bg?: Fill | null;
  /** responsive markup (width 100%) instead of a fixed size */
  responsive?: boolean;
}

/** A background colour and its opacity (0–1). */
export interface Fill {
  color: string;
  alpha: number;
}
/** The document background, or null when it is transparent. */
export function docBg(): Fill | null {
  const p = bgPaint(doc);
  return p.alpha > 0 ? { color: p.color, alpha: p.alpha } : null;
}

/** Text in web or local fonts must be ready before the export can draw it as outlines. */
export async function prepareFrameFonts() {
  const texts = doc.layers
    .filter(l => l.type === 'text' && !l.hid && (webFont(l.geo.family) || isLocalFamily(l.geo.family)))
    .map(l => l.geo);
  if (texts.length) await prepareFonts(texts, 'outline');
}

/** The export's markup for frames: the whole animation, played once at its own speed, no background. */
export function frameMarkup() {
  const ex = doc.ex,
    keep = {
      mode: ex.mode,
      fonts: ex.fonts,
      proj: ex.proj,
      size: ex.size,
      trigger: ex.trigger,
      player: ex.player,
      rm: ex.rm,
      speed: ex.speed,
      fps: ex.fps,
      fill: ex.fill,
      prefix: ex.prefix,
      ids: ex.ids,
    },
    dk = { it: doc.it, dir: doc.dir, bg: doc.bg, bgA: doc.bgA },
    only = S.exportOnly;
  Object.assign(ex, {
    mode: 'js',
    fonts: 'outline',
    proj: false,
    size: 'resp',
    trigger: 'api',
    player: 'embed',
    rm: undefined,
    speed: 1,
    fps: 0,
    fill: 'forwards',
    prefix: PREFIX,
    ids: 'gen',
  });
  Object.assign(doc, { it: 1, dir: 'normal', bgA: 0 });
  S.exportOnly = null;
  try {
    return buildExport(null);
  } finally {
    Object.assign(ex, keep);
    Object.assign(doc, dk);
    S.exportOnly = only;
  }
}

/**
 * Mount the animation with its player, ready to draw any frame: out of sight, or inside `into` (the
 * Video preview shows it there, and every frame drawn moves it).
 */
export function frameSource(into?: HTMLElement): FrameSource {
  const r = frameMarkup(),
    host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = into
    ? 'width:100%;height:100%;pointer-events:none'
    : `position:fixed;left:-20000px;top:0;width:${doc.w}px;height:${doc.h}px;overflow:hidden;visibility:hidden;pointer-events:none`;
  host.innerHTML = r.code;
  (into || document.body).appendChild(host);
  const svg = host.querySelector('svg') as SVGSVGElement & { player?: any };
  svg.querySelectorAll('script').forEach(sc => {
    const n = document.createElement('script');
    n.textContent = (sc.textContent || '').replace('<![CDATA[', '').replace(']]>', '');
    sc.remove();
    document.body.appendChild(n);
    n.remove();
  });
  const vb = `${doc.vx || 0} ${doc.vy || 0} ${doc.w} ${doc.h}`;
  return {
    svgAt(t: number, o: FrameOpts = {}) {
      const time = Math.max(0, Math.min(doc.dur, t));
      if (svg.player) svg.player.seekTo(time * 1000);
      const c = svg.cloneNode(true) as SVGSVGElement;
      c.querySelectorAll('script, metadata').forEach(n => n.remove());
      c.removeAttribute('id');
      if (o.responsive) {
        c.setAttribute('width', '100%');
        c.removeAttribute('height');
      } else {
        c.setAttribute('width', String(o.w || doc.w));
        c.setAttribute('height', String(o.h || doc.h));
      }
      c.setAttribute('viewBox', vb);
      if (o.bg) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(doc.vx || 0));
        rect.setAttribute('y', String(doc.vy || 0));
        rect.setAttribute('width', String(doc.w));
        rect.setAttribute('height', String(doc.h));
        rect.setAttribute('fill', o.bg.color);
        if (o.bg.alpha < 1) rect.setAttribute('fill-opacity', String(o.bg.alpha));
        const defs = c.querySelector(':scope > defs');
        c.insertBefore(rect, defs ? defs.nextSibling : c.firstChild);
      }
      return new XMLSerializer().serializeToString(c);
    },
    dispose() {
      try {
        if (svg.player) svg.player.destruct();
      } catch (_) {}
      host.remove();
    },
  };
}

/** Draw one frame onto a new canvas of w × h pixels. */
export async function rasterFrame(src: FrameSource, t: number, w: number, h: number, bg: Fill | null) {
  const url = URL.createObjectURL(new Blob([src.svgAt(t, { w, h, bg })], { type: 'image/svg+xml' }));
  try {
    const img = await loadImg(url),
      cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return cv;
  } finally {
    URL.revokeObjectURL(url);
  }
}
