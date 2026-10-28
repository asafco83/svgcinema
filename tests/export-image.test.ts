import { beforeEach, describe, expect, it } from 'vitest';
import { doc, setDoc } from '../src/core/state';
import { sampleDoc } from '../src/model/sample';
import {
  embedFormats,
  outSize,
  parseTime,
  rulerTicks,
  stillBg,
  stillSettings,
  stillSnippet,
  tickLabel,
  MAX_SIDE,
} from '../src/export/still';
import { frameMarkup } from '../src/export/frames';
import type { StillSettings } from '../src/model/types';

beforeEach(() => setDoc(sampleDoc()));

const st = (o: Partial<StillSettings>): StillSettings => ({
  fmt: 'png',
  q: 82,
  scale: '2',
  bg: 'transparent',
  ...o,
});

describe('Export › Image: sizes and times', () => {
  it('1×, 2× and 3× multiply the canvas; Custom uses the typed size', () => {
    expect(outSize(st({ scale: '1' }), 640, 400)).toEqual([640, 400]);
    expect(outSize(st({ scale: '2' }), 640, 400)).toEqual([1280, 800]);
    expect(outSize(st({ scale: '3' }), 640, 400)).toEqual([1920, 1200]);
    expect(outSize(st({ scale: 'c', w: 500, h: 300 }), 640, 400)).toEqual([500, 300]);
  });
  it('never makes a picture larger than the browser can draw', () => {
    const [w, h] = outSize(st({ scale: 'c', w: 40000, h: 20000 }), 640, 400);
    expect(Math.max(w, h)).toBe(MAX_SIDE);
    expect(w / h).toBeCloseTo(2, 2);
  });
  it('reads typed times in seconds or minutes:seconds', () => {
    expect(parseTime('1.8')).toBe(1.8);
    expect(parseTime('1.8s')).toBe(1.8);
    expect(parseTime('0:01.80')).toBe(1.8);
    expect(parseTime('1:02.5')).toBe(62.5);
    expect(parseTime('soon')).toBeNull();
  });
  it('labels the playhead track with whole steps that leave room', () => {
    expect(rulerTicks(3)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    expect(rulerTicks(30).length).toBeLessThanOrEqual(9);
    expect(tickLabel(1.5)).toBe('1.5s');
  });
  it('JPEG can’t be transparent: it uses the document background', () => {
    expect(stillBg(st({ fmt: 'jpeg', bg: 'transparent' }))).toBe('doc');
    expect(stillBg(st({ fmt: 'png', bg: 'transparent' }))).toBe('transparent');
  });
  it('starts with PNG at 2× on a transparent background', () => {
    const was = doc.ex.img;
    delete doc.ex.img;
    try {
      expect(stillSettings()).toMatchObject({ fmt: 'png', q: 82, scale: '2', bg: 'transparent' });
    } finally {
      doc.ex.img = was;
    }
  });
});

describe('Export › Image: embed code', () => {
  it('newer formats get <picture> with fallbacks, best first', () => {
    expect(embedFormats('jxl', true)).toEqual(['jxl', 'avif', 'webp', 'png']);
    expect(embedFormats('avif', true)).toEqual(['avif', 'webp', 'png']);
    expect(embedFormats('avif', false)).toEqual(['avif']);
    const s = stillSnippet('avif', 'Sunrise badge', 'Sunrise badge', 640, 400, true, true);
    expect(s).toMatch(/^<picture>/);
    expect(s).toContain('srcset="Sunrise%20badge.avif 1x, Sunrise%20badge@2x.avif 2x"');
    expect(s).toContain('type="image/webp"');
    expect(s).toContain('<img src="Sunrise%20badge.png"');
    expect(s).toContain('width="640" height="400"');
  });
  it('formats every browser shows get a plain <img>', () => {
    const s = stillSnippet('png', 'a', 'A "quoted" name', 640, 400, true, false);
    expect(s).toBe('<img src="a.png" alt="A &quot;quoted&quot; name"\n     width="640" height="400">');
    expect(stillSnippet('svg', 'a', 'A', 640, 400, true, true)).not.toContain('2x');
  });
});

describe('Export › Image: the frames come from the JavaScript export', () => {
  it('plays once, starts only when asked, leaves the background out, and restores every setting', () => {
    const ex = JSON.stringify(doc.ex),
      d = { it: doc.it, dir: doc.dir, bg: doc.bg, bgA: doc.bgA };
    doc.bg = '#123456';
    doc.bgA = 1;
    try {
      const r = frameMarkup();
      expect(r.svgId).toBe('cinframe-svg');
      expect(r.code).not.toContain('#123456');
      expect(JSON.stringify(doc.ex)).toBe(ex);
      expect(doc.bgA).toBe(1);
    } finally {
      Object.assign(doc, d);
    }
  });
});
