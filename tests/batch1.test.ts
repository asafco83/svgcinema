// Unicode file names, text direction and case, Select same, reduced motion, Open recent dates.
import { describe, it, expect } from 'vitest';
import { caseText, textDir, textLines, visualAnchor, visualLine, anchorX } from '../src/render/text-layout';
import { fileName, slug } from '../src/export/images';
import { setDoc, doc, S, mkLayer } from '../src/core/state';
import { sampleDoc } from '../src/model/sample';
import { buildExport } from '../src/export/build';
import { snippet } from '../src/export/snippets';
import { layerSVG } from '../src/render/markup';
import { H } from '../src/core/constants';
import { sameKey, sameKinds } from '../src/core/select-same';
import { recentWhen } from '../src/io/recent';

const G = (o: any) => ({ x: 10, y: 0, size: 10, family: 'sans-serif', weight: '400', text: '', ...o });

describe('file names in any language', () => {
  it('keeps the name as typed and drops only illegal characters', () => {
    expect(fileName('אנימציה ראשונה')).toBe('אנימציה ראשונה');
    expect(fileName('Logo: intro / v2?')).toBe('Logo intro v2');
    expect(fileName('  ..hidden.  ')).toBe('hidden');
    expect(fileName('')).toBe('animation');
    expect(fileName('Привет мир')).toBe('Привет мир');
  });
  it('keeps slugs for code identifiers', () => {
    expect(slug('אנימציה')).toBe('animation');
    expect(slug('Sunrise badge')).toBe('sunrise-badge');
  });
  it('names the file in the embed code as typed, escaped for URLs', () => {
    setDoc(sampleDoc());
    doc.name = 'שקיעה #2';
    expect(snippet('html')).toContain('data="שקיעה%20%232.svg"');
  });
});

describe('text direction and case', () => {
  it('reads the direction from the first letter unless set', () => {
    expect(textDir(G({ text: 'שלום world' }))).toBe('rtl');
    expect(textDir(G({ text: '123 hello שלום' }))).toBe('ltr');
    expect(textDir(G({ text: 'hello', dir: 'rtl' }))).toBe('rtl');
    expect(textDir(G({ text: 'שלום', dir: 'ltr' }))).toBe('ltr');
  });
  it('keeps the anchor logical: the start of right-to-left text is on the right', () => {
    expect(visualAnchor(G({ text: 'שלום', anchor: 'start' }))).toBe('end');
    expect(visualAnchor(G({ text: 'שלום', anchor: 'middle' }))).toBe('middle');
    expect(visualAnchor(G({ text: 'hi', anchor: 'end' }))).toBe('end');
    expect(anchorX(G({ text: 'שלום', wrap: true, ww: 100 }))).toBe(110);
  });
  it('writes direction="rtl" for right-to-left text', () => {
    const l = mkLayer('text', 'T', G({ text: 'שלום' }), {});
    expect(layerSVG(l, { pre: 'e-', t: 0 } as any, H.comp(l, 0))).toContain('direction="rtl"');
    const m = mkLayer('text', 'T', G({ text: 'hello' }), {});
    expect(layerSVG(m, { pre: 'e-', t: 0 } as any, H.comp(m, 0))).not.toContain('direction');
  });
  it('applies the letter case', () => {
    expect(caseText('hello big world', 'upper')).toBe('HELLO BIG WORLD');
    expect(caseText('HeLLo', 'lower')).toBe('hello');
    expect(caseText("don't stop me-now", 'title')).toBe("Don't Stop Me-Now");
    expect(textLines(G({ text: 'ab\ncd', tcase: 'upper' }))).toEqual(['AB', 'CD']);
  });
  it('orders right-to-left letters for outlines', () => {
    expect(visualLine('abc', false)).toBe('abc');
    expect(visualLine('שלום', true)).toBe('םולש');
    // numbers keep their order; the line runs right to left
    expect(visualLine('שלום 123', true)).toBe('123 םולש');
    expect(visualLine('hi שלום!', false)).toBe('hi םולש!');
    // brackets mirror, points stay with their letter
    expect(visualLine('(שָׁלוֹם)', true)).toBe('(' + ['ם', 'וֹ', 'ל', 'שָׁ'].join('') + ')');
  });
});

describe('Select same', () => {
  it('compares fill, stroke, font and kind', () => {
    setDoc(sampleDoc());
    S.time = 0;
    const a = mkLayer('rect', 'A', { x: 0, y: 0, w: 10, h: 10 }, { fill: '#FF0000', stk: 'none' }),
      b = mkLayer('ellipse', 'B', { cx: 0, cy: 0, rx: 5, ry: 5 }, { fill: '#ff0000', stk: '#000', sw: 2 }),
      t = mkLayer('text', 'T', G({ text: 'x' }), { fill: '#000' });
    expect(sameKey(a, 'fill')).toBe(sameKey(b, 'fill'));
    expect(sameKey(a, 'type')).not.toBe(sameKey(b, 'type'));
    expect(sameKey(a, 'sw')).toBeNull();
    expect(sameKinds(a)).toEqual(['type', 'fillstk', 'fill', 'stk', 'op', 'fo', 'blend']);
    expect(sameKinds(t)).toContain('font');
  });
});

describe('reduced motion export', () => {
  const build = (ex: any) => {
    setDoc(sampleDoc());
    Object.assign(doc.ex, { prefix: 'cin' }, ex);
    return buildExport(null).code;
  };
  it('adds nothing by default', () => {
    expect(build({ mode: 'js' })).not.toContain('prefers-reduced-motion');
    expect(build({ mode: 'css' })).not.toContain('prefers-reduced-motion');
  });
  it('holds the first or last frame in the JS player', () => {
    const js = build({ mode: 'js', rm: 'first' });
    expect(js).toContain('matchMedia("(prefers-reduced-motion: reduce)").matches)P.seekTo(0);else{');
    expect(build({ mode: 'js', rm: 'last' })).toContain(`P.seekTo(${Math.round(doc.dur * 1000) - 1})`);
  });
  it('pauses CSS animations on the chosen frame', () => {
    const css = build({ mode: 'css', rm: 'last' });
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{#[\w-]+ \*\{animation-play-state:paused!important/);
    expect(css).toMatch(/animation-delay:-[\d.]+s!important/);
    expect(build({ mode: 'css', rm: 'first' })).toContain('animation-delay:0s!important');
  });
});

describe('Open recent', () => {
  it('says when in a few words', () => {
    const now = new Date(2026, 9, 24, 15).getTime();
    expect(recentWhen(now - 3600e3, now)).toBe('Today');
    expect(recentWhen(now - 864e5, now)).toBe('Yesterday');
    expect(recentWhen(new Date(2026, 9, 2).getTime(), now)).toMatch(/2/);
  });
});
