// Anonymous usage counts (core/analytics): only on svgcinema.com, and only short plain values.
import { describe, expect, it } from 'vitest';
import { analyticsOn, bucket, clean, track } from '../src/core/analytics';

describe('analytics', () => {
  it('runs on svgcinema.com only', () => {
    expect(analyticsOn('svgcinema.com')).toBe(true);
    expect(analyticsOn('www.svgcinema.com')).toBe(true);
    for (const h of ['localhost', '127.0.0.1', 'asafco83.github.io', 'svgcinema.com.evil.example', ''])
      expect(analyticsOn(h), h).toBe(false);
  });
  it('sends nothing here (not svgcinema.com) and loads no script', () => {
    (window as any).umami = { track: () => (window as any).__sent++ };
    (window as any).__sent = 0;
    track('editor_open', { theme: 'dark' });
    expect((window as any).__sent).toBe(0);
    expect(document.querySelector('script[src*="umami"]')).toBeNull();
  });
  it('keeps only short plain values: never names, text or data', () => {
    const d = clean({
      kind: 'svg',
      layers: 12.345,
      ok: true,
      name: 'My secret project <b>',
      text: 'x'.repeat(41),
      data: 'data:image/png;base64,AAAA',
      none: null,
      nan: NaN,
    });
    expect(d).toEqual({ kind: 'svg', layers: 12.35, ok: true });
  });
  it('counts become ranges', () => {
    expect([0, 1, 2, 5, 6, 20, 21, 50, 51, 100, 101].map(bucket)).toEqual([
      '0',
      '1',
      '2-5',
      '2-5',
      '6-20',
      '6-20',
      '21-50',
      '21-50',
      '51-100',
      '51-100',
      '100+',
    ]);
  });
});
