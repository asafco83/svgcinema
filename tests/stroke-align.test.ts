import { describe, it, expect, beforeEach } from 'vitest';
import { blankDoc, doc, mkLayer, setDoc } from '../src/core/state';
import { H } from '../src/core/constants';
import { alignOf, canAlign, layerSVG } from '../src/render/markup';
import { buildExport } from '../src/export/build';
import { N } from '../src/geometry/nodes';
import type { Layer } from '../src/model/types';

const CTX = { pre: 'e-', t: 0, editor: true, href: () => '' };
function rect(al?: 'in' | 'out') {
  const l = mkLayer('rect', 'Box', { x: 10, y: 10, w: 100, h: 60 }, { fill: '#3366ff', stk: '#ff0000', sw: 8 });
  if (al) l.al = al;
  return l;
}
const svgOf = (l: Layer) => layerSVG(l, CTX, H.comp(l, 0));

beforeEach(() => setDoc(blankDoc(400, 300)));

describe('stroke alignment', () => {
  it('centred: the shape as before', () => {
    const s = svgOf(rect());
    expect(s).toContain('stroke-width="8"');
    expect(s).not.toContain('-sf');
  });
  it('inside: twice the width, clipped to a stroke-less copy of the shape', () => {
    const l = rect('in'),
      s = svgOf(l),
      id = 'e-' + l.id;
    expect(s).toContain(`id="${id}-s"`);
    expect(s).toMatch(/id="e-[^"]+-s"[^>]*stroke-width="16"|stroke-width="16"[^>]*id="e-[^"]+-s"/);
    const twin = s.match(new RegExp(`<rect[^>]* id="${id}-sf"[^>]*/>`))![0];
    expect(twin).toContain('stroke="none"');
    expect(twin).not.toMatch(/stroke-width|stroke="#/);
    expect(twin).toContain('width="100"');
    expect(s).toContain(`<clipPath id="${id}-sc"><use href="#${id}-sf"/></clipPath>`);
    expect(s).toContain(`<g clip-path="url(#${id}-sc)"><rect`);
    // the copy is only a clip: kept in <defs>, not drawn
    expect(s.indexOf(`id="${id}-sf"`)).toBeGreaterThan(s.indexOf('<defs>'));
    expect(s.indexOf(`id="${id}-sf"`)).toBeLessThan(s.indexOf('</defs>'));
  });
  it('outside: the copy draws the fill, the shape is masked to outside it', () => {
    const l = rect('out'),
      s = svgOf(l),
      id = 'e-' + l.id;
    expect(s).toContain(`<mask id="${id}-sm"`);
    expect(s).toContain(`<g clip-path="url(#${id}-sc)"><rect x="-100000"`);
    expect(s).toContain(`<g mask="url(#${id}-sm)">`);
    // the copy is drawn (after </defs>), before the masked stroke
    const tw = s.indexOf(`id="${id}-sf"`);
    expect(tw).toBeGreaterThan(s.indexOf('</defs>'));
    expect(tw).toBeLessThan(s.indexOf(`mask="url(#${id}-sm)"`));
  });
  it('only closed shapes: an open path strokes on the centre', () => {
    const open = mkLayer('path', 'Line', {}, { d: [{ c: false, n: [N(0, 0), N(50, 0)] }], stk: '#000', sw: 4 });
    open.al = 'in';
    expect(canAlign(open)).toBe(false);
    expect(alignOf(open)).toBe(null);
    expect(svgOf(open)).not.toContain('-sf');
    const closed = mkLayer(
      'path',
      'Tri',
      {},
      { d: [{ c: true, n: [N(0, 0), N(50, 0), N(0, 50)] }], stk: '#000', sw: 4 },
    );
    closed.al = 'out';
    expect(alignOf(closed)).toBe('out');
    expect(canAlign(mkLayer('image', 'Pic', {}))).toBe(false);
  });
  it('a filter applies to the whole result, not just the clipped stroke', () => {
    const l = rect('in');
    l.extra = { style: 'mix-blend-mode:multiply' };
    const s = svgOf(l);
    expect(s).toMatch(/<g style="mix-blend-mode:multiply"><defs>/);
    expect(s.match(new RegExp(`id="e-${l.id}-s"[^>]*`))![0]).not.toContain('mix-blend-mode');
  });
  it('exports: the CSS doubles an animated width and moves the copy with the shape', () => {
    const l = rect('out');
    l.t.sw = [
      [0, 8, 'linear'],
      [1, 12, 'linear'],
    ];
    l.t.sz = [
      [0, [100, 60], 'linear'],
      [1, [160, 60], 'linear'],
    ];
    doc.layers.push(l);
    doc.dur = 1;
    Object.assign(doc.ex, { mode: 'css', prefix: 'cin', ids: 'gen' });
    const css = buildExport(null).code;
    expect(css).toMatch(/stroke-width:16px/);
    expect(css).toMatch(/stroke-width:24px/);
    expect(css).toMatch(/-sf\{animation:/);
    expect(css).toMatch(/@keyframes [^{]+-sf\{[^}]*width:/);
    // the copy never gets a stroke from CSS
    const sfFrames = css.match(/@keyframes [^{]+-sf\{[\s\S]*?\}\}/)![0];
    expect(sfFrames).not.toMatch(/stroke/);
    Object.assign(doc.ex, { mode: 'js' });
    const js = buildExport(null).code;
    expect(js).toMatch(/-sf"[^>]*stroke="none"/);
  });
});
