import { describe, it, expect } from 'vitest';
import {
  addFilter,
  filterSVG,
  fxKeys,
  fxName,
  fxSummary,
  moveFilter,
  removeFilter,
  syncFa,
} from '../src/model/filters';
import { CinEngine } from '../src/runtime/engine';
import { layerSVG } from '../src/render/markup';
import { H } from '../src/core/constants';

const text = (geo: any = {}): any => ({
  id: 'l1',
  type: 'text',
  name: 'T',
  b: { pos: [0, 0], org: [0, 0], rot: 0, scl: [1, 1], op: 1, fill: '#000', stk: 'none', sw: 0 },
  t: {},
  geo: { x: 0, y: 20, size: 10, family: 'sans-serif', weight: '400', anchor: 'start', text: 'Hi', ...geo },
});

describe('filters', () => {
  it('adds filters with default values and a runtime attribute map', () => {
    const l = text();
    addFilter(l, 'blur');
    addFilter(l, 'shadow');
    expect(l.fx.map((f: any) => f.id)).toEqual(['f1', 'f2']);
    expect(l.b['fx.f1.sd']).toBe(4);
    expect(l.fa['fx.f2.col']).toEqual(['-f2', 'flood-color']);
    expect(fxKeys(l)).toContain('fx.f2.op');
  });
  it('removes a filter with its values and keyframes', () => {
    const l = text();
    addFilter(l, 'blur');
    l.t['fx.f1.sd'] = [[0, 1, 'ease']];
    removeFilter(l, 'f1');
    expect(l.fx).toBeUndefined();
    expect(l.fa).toBeUndefined();
    expect('fx.f1.sd' in l.b).toBe(false);
    expect(l.t['fx.f1.sd']).toBeUndefined();
  });
  it('writes the filter markup and links it from the layer', () => {
    const l = text();
    addFilter(l, 'shadow');
    expect(filterSVG(l, 'e-', k => l.b[k])).toContain('<feDropShadow id="e-l1-f1" dx="4" dy="6"');
    const svg = layerSVG(l, { pre: 'e-', t: 0 }, H.comp(l, 0));
    expect(svg).toContain('filter="url(#e-l1-fx)"');
    expect(svg).toContain('<filter id="e-l1-fx"');
  });
});

describe('filters, round 1', () => {
  const get = (l: any) => (k: string) => H.get(l, k, 0);
  it('turns amounts into colour matrices', () => {
    const id = '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0';
    expect(H.fxv('bri', 1)).toBe(id);
    expect(H.fxv('con', 1)).toBe(id);
    expect(H.fxv('gray', 0)).toBe(id);
    expect(H.fxv('sep', 0)).toBe(id);
    expect(H.fxv('inv', 0)).toBe(id);
    expect(H.fxv('bri', 1.5).split(' ').slice(0, 5)).toEqual(['1.5', '0', '0', '0', '0']);
    expect(H.fxv('con', 2).split(' ')[4]).toBe('-0.5');
    expect(H.fxv('inv', 1).split(' ').slice(0, 5)).toEqual(['-1', '0', '0', '0', '1']);
    expect(H.fxv('gray', 1).split(' ').slice(0, 3)).toEqual(['0.213', '0.715', '0.072']);
    expect(H.fxv('add', 2, 3)).toBe('5');
    expect(H.fxv('half', 3)).toBe('1.5');
    expect(H.fxv(undefined, '#fff')).toBe('#fff');
  });
  it('keeps one feDropShadow until the shadow spreads', () => {
    const l = text();
    addFilter(l, 'shadow');
    expect(filterSVG(l, 'e-', get(l))).toContain('<feDropShadow');
    l.b['fx.f1.sp'] = 3;
    const s = filterSVG(l, 'e-', get(l));
    expect(s).not.toContain('feDropShadow');
    expect(s).toContain('<feMorphology id="e-l1-f1m" radius="3" in="SourceGraphic" operator="dilate"');
    expect(l.fa['fx.f1.sp']).toEqual(['-f1m', 'radius']);
    expect(l.fa['fx.f1.dx']).toEqual(['-f1o', 'dx']);
  });
  it('adds Glow and Inner glow as named versions of the shadows', () => {
    const l = text();
    const g = addFilter(l, 'shadow', 'glow'),
      i = addFilter(l, 'inner', 'innerglow');
    expect(fxName(g)).toBe('Glow');
    expect(fxName(i)).toBe('Inner glow');
    expect(l.b['fx.f1.sp']).toBe(2);
    expect(l.b['fx.f1.dx']).toBe(0);
    expect(fxName(addFilter(l, 'blur'))).toBe('Blur');
  });
  it('builds the outline ring: outside with a gap, inside, centred', () => {
    const l = text();
    const f = addFilter(l, 'outline');
    l.b['fx.f1.w'] = 2;
    l.b['fx.f1.g'] = 3;
    let s = filterSVG(l, 'e-', get(l));
    expect(s).toContain('<feMorphology id="e-l1-f1a" radius="5" in="SourceGraphic" operator="dilate"');
    expect(s).toContain('<feMorphology id="e-l1-f1b" radius="3" in="SourceGraphic" operator="dilate"');
    // the gap and the width both move the outer ring
    expect(l.fa['fx.f1.g']).toEqual([
      ['-f1a', 'radius', 'add', 'fx.f1.w'],
      ['-f1b', 'radius'],
    ]);
    expect(l.fa['fx.f1.w']).toEqual([['-f1a', 'radius', 'add', 'fx.f1.g']]);
    f.pos = 'in';
    syncFa(l);
    s = filterSVG(l, 'e-', get(l));
    expect(s).toContain('operator="erode"');
    expect(s).not.toContain('f1a');
    expect(l.fa['fx.f1.g']).toBeUndefined();
    f.pos = 'mid';
    syncFa(l);
    expect(filterSVG(l, 'e-', get(l))).toContain(
      '<feMorphology id="e-l1-f1a" radius="1" in="SourceGraphic" operator="dilate"',
    );
  });
  it('chains filters: the next one reads the result it needs', () => {
    const l = text();
    addFilter(l, 'blur');
    addFilter(l, 'overlay');
    const s = filterSVG(l, 'e-', get(l));
    expect(s).toContain('<feGaussianBlur id="e-l1-f1" stdDeviation="4" result="rf1"/>');
    expect(s).toContain('in2="rf1"');
    // a blur after a colour filter reads its result without names
    const m = text();
    addFilter(m, 'bright');
    addFilter(m, 'blur');
    expect(filterSVG(m, 'e-', get(m))).not.toContain('result=');
  });
  it('reorders filters and summarises them', () => {
    const l = text();
    addFilter(l, 'blur');
    addFilter(l, 'sat');
    addFilter(l, 'hue');
    expect(moveFilter(l, 'f3', 0)).toBe(true);
    expect(l.fx.map((f: any) => f.id)).toEqual(['f3', 'f1', 'f2']);
    expect(moveFilter(l, 'f3', 0)).toBe(false);
    expect(fxSummary(l, l.fx[0], get(l))).toBe('90°');
    expect(fxSummary(l, l.fx[2], get(l))).toBe('60%');
  });
  it('animates every target of a parameter in the runtime', () => {
    const l = text();
    addFilter(l, 'outline');
    l.b['fx.f1.g'] = 0;
    l.t['fx.f1.g'] = [
      [0, 0, 'linear'],
      [1, 4, 'linear'],
    ];
    syncFa(l);
    document.body.innerHTML = `<svg>${layerSVG(l, { pre: 'e-', t: 0 }, H.comp(l, 0))}</svg>`;
    const E = CinEngine({ p: 'e-', L: [l], dur: 1 } as any, document.body);
    E.apply(0.5);
    expect(document.getElementById('e-l1-f1b').getAttribute('radius')).toBe('2');
    expect(document.getElementById('e-l1-f1a').getAttribute('radius')).toBe('4');
  });
});

describe('text markup', () => {
  it('writes style, decoration and letter spacing only when set', () => {
    const plain = layerSVG(text(), { pre: 'e-', t: 0 }, H.comp(text(), 0));
    expect(plain).not.toMatch(/font-style|text-decoration|letter-spacing|tspan/);
    const l = text({ italic: true, deco: 'underline line-through', ls: 2 });
    const s = layerSVG(l, { pre: 'e-', t: 0 }, H.comp(l, 0));
    expect(s).toContain('font-style="italic"');
    expect(s).toContain('text-decoration="underline line-through"');
    expect(s).toContain('letter-spacing="2"');
  });
  it('writes one tspan per line', () => {
    const l = text({ text: 'a\nb\nc', lh: 1.5 });
    const s = layerSVG(l, { pre: 'e-', t: 0 }, H.comp(l, 0));
    expect(s.match(/<tspan/g).length).toBe(3);
    expect(s).toContain('dy="15"');
  });
  it('adds blending, isolation and paint opacities', () => {
    const l = text();
    l.blend = 'multiply';
    l.iso = true;
    l.b.fo = 0.5;
    const s = layerSVG(l, { pre: 'e-', t: 0 }, H.comp(l, 0));
    expect(s).toContain('style="mix-blend-mode:multiply;isolation:isolate"');
    expect(s).toContain('fill-opacity="0.5"');
    expect(s).not.toContain('stroke-opacity');
  });
});
