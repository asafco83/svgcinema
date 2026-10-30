// SVGcinema — model/background
// The canvas background is a color (`Doc.bg`) plus an opacity (`Doc.bgA`, 0–1).
// An empty `bg` also means fully transparent (projects saved before `bgA` existed).
import type { Doc } from './types';

export interface BgPaint {
  /** CSS color, never empty */
  color: string;
  /** 0–1 */
  alpha: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** What the canvas background actually paints. */
export function bgPaint(d: Pick<Doc, 'bg' | 'bgA'>): BgPaint {
  if (!d.bg) return { color: '#FFFFFF', alpha: 0 };
  return { color: d.bg, alpha: d.bgA == null || !isFinite(d.bgA) ? 1 : clamp01(d.bgA) };
}

/**
 * Read a background typed by the user. Accepts any CSS color, #rgba / #rrggbbaa, rgba(), and
 * `none` / `transparent`. A color without its own alpha keeps the current opacity, except that a
 * fully transparent background becomes opaque, since typing a color means you want to see it.
 */
export function parseBg(raw: string, cur: BgPaint): BgPaint {
  const v = String(raw || '').trim();
  if (!v || /^(none|transparent)$/i.test(v)) return { color: cur.color, alpha: 0 };
  const keep = cur.alpha > 0 ? cur.alpha : 1;
  let m = /^#([0-9a-f]{3})([0-9a-f])$/i.exec(v);
  if (m) return { color: '#' + m[1], alpha: r3(parseInt(m[2] + m[2], 16) / 255) };
  m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(v);
  if (m) return { color: '#' + m[1], alpha: r3(parseInt(m[2], 16) / 255) };
  m = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length >= 3) {
      const a = p[3] == null ? keep : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]);
      return { color: `rgb(${p.slice(0, 3).join(',')})`, alpha: r3(clamp01(isFinite(a) ? a : keep)) };
    }
  }
  return { color: v, alpha: keep };
}

/** Apply a paint to the document. */
export function setBg(d: Pick<Doc, 'bg' | 'bgA'>, p: BgPaint) {
  d.bg = p.color;
  d.bgA = r3(clamp01(p.alpha));
}

/** Attributes for the background <rect>, or null when nothing should be drawn. */
export function bgAttrs(d: Pick<Doc, 'bg' | 'bgA'>): { fill: string; 'fill-opacity'?: number } | null {
  const p = bgPaint(d);
  if (p.alpha <= 0) return null;
  return p.alpha < 1 ? { fill: p.color, 'fill-opacity': p.alpha } : { fill: p.color };
}
