import { describe, it, expect } from 'vitest';
import { H, resizeBase, valueAt } from '../src/core/constants';
import { mkLayer } from '../src/core/state';
import { needsPlainPath, plainPath } from '../src/core/plain-path';
import { ellNodes, rectNodes, shapeD } from '../src/geometry/nodes';
import { setShape } from '../src/tools/shapes';

const node = (d: any) => d[0].n.length;

describe('shapes becoming plain paths', () => {
  it('turns a rectangle into a path and bakes its radius keyframes into Morph keyframes', () => {
    const l = mkLayer('rect', 'Card', { x: 0, y: 0, w: 100, h: 60, rx: 0 });
    l.t.rad = [
      [0, 0, 'linear'],
      [1, 20, 'ease'],
    ];
    expect(needsPlainPath(l)).toBe(true);
    expect(plainPath(l)).toBe(true);
    expect(l.type).toBe('path');
    expect(l.t.rad).toBeUndefined();
    expect(l.t.d.map(q => q[0])).toEqual([0, 1]);
    expect(l.t.d.map(q => q[2])).toEqual(['linear', 'ease']);
    // the rounded keyframe is the rectangle with that radius; the square one gets matching nodes
    expect(JSON.stringify(l.t.d[1][1])).toBe(JSON.stringify(rectNodes({ x: 0, y: 0, w: 100, h: 60, rx: 20 })));
    expect(node(l.t.d[0][1])).toBe(node(l.t.d[1][1]));
    expect(needsPlainPath(l)).toBe(false);
    expect(plainPath(l)).toBe(false);
  });
  it('turns an ellipse into a path with no Morph keyframes', () => {
    const l = mkLayer('ellipse', 'Sun', { cx: 50, cy: 50, rx: 40, ry: 30 });
    plainPath(l);
    expect(l.type).toBe('path');
    expect(JSON.stringify(l.b.d)).toBe(JSON.stringify(ellNodes({ cx: 50, cy: 50, rx: 40, ry: 30 })));
    expect(l.t.d).toBeUndefined();
  });
  it('bakes a star’s animated radius when it becomes a plain path', () => {
    const l = mkLayer('path', 'Star');
    setShape(l, { kind: 'star', cx: 0, cy: 0, r: 100, rot: 0, n: 5, ratio: 0.45, rad: 0 });
    l.t.rad = [
      [0, 0, 'ease'],
      [2, 12, 'ease'],
    ];
    const sh = { ...l.shape };
    plainPath(l);
    expect(l.shape).toBeUndefined();
    expect(l.t.rad).toBeUndefined();
    expect(JSON.stringify(l.t.d[1][1])).toBe(JSON.stringify((H as any).poly(sh, 12, true)));
    // drawn the same way it was drawn before, at the second keyframe
    expect(node(l.t.d[0][1])).toBe(node(l.t.d[1][1]));
    expect(node(l.t.d[1][1])).toBe(node(shapeD({ ...sh, rad: 12 } as any)));
  });
  it('keeps a stretched star’s radius animation as Morph keyframes (it used to be dropped)', () => {
    const l = mkLayer('path', 'Star');
    setShape(l, { kind: 'star', cx: 0, cy: 0, r: 50, rot: 0, n: 5, ratio: 0.45, rad: 0 });
    l.t.rad = [
      [0, 0, 'ease'],
      [1, 6, 'ease'],
    ];
    const sh = { ...l.shape },
      b0 = H.pathBox(l.b.d),
      k0 = H.pathBox((H as any).poly(sh, 6, true));
    resizeBase(l, [200, 50]);
    expect(l.shape).toBeUndefined();
    expect(l.t.d && l.t.d.length).toBe(2);
    // the Morph keyframes were stretched with the shape (by the same factors as its box)
    const box = H.pathBox(l.t.d[1][1]);
    expect(box[2]).toBeCloseTo((k0[2] * 200) / b0[2], 0);
    expect(box[3]).toBeCloseTo((k0[3] * 50) / b0[3], 0);
  });
  it('keeps a star a star when it is resized evenly', () => {
    const l = mkLayer('path', 'Star');
    setShape(l, { kind: 'star', cx: 0, cy: 0, r: 50, rot: 0, n: 5, ratio: 0.45, rad: 4 });
    l.t.rad = [
      [0, 4, 'ease'],
      [1, 8, 'ease'],
    ];
    const b = H.pathBox(l.b.d);
    resizeBase(l, [b[2] * 2, b[3] * 2]);
    expect(l.shape).toBeTruthy();
    expect(l.t.rad.map(q => q[1])).toEqual([8, 16]);
  });
});

describe('Size on an imported element', () => {
  it('stretches the element from its own box, around its origin, like Scale', () => {
    const l = mkLayer('raw', 'Badge', { markup: '<rect width="100" height="50"/>', box: [0, 0, 100, 50] });
    expect(valueAt(l, 'sz', 0)).toEqual([100, 50]);
    resizeBase(l, [200, 25]);
    expect(l.b.sz).toEqual([200, 25]);
    expect(valueAt(l, 'sz', 0)).toEqual([200, 25]);
    const c = H.comp(l, 0);
    expect(c.sx).toBeCloseTo(2);
    expect(c.sy).toBeCloseTo(0.5);
    // with its own scale too
    l.b.scl = [2, 2];
    expect(H.comp(l, 0).sx).toBeCloseTo(4);
  });
  it('animates the stretch from its Size keyframes', () => {
    const l = mkLayer('raw', 'Badge', { markup: '', box: [10, 10, 40, 40] });
    l.t.sz = [
      [0, [40, 40], 'linear'],
      [1, [80, 40], 'linear'],
    ];
    expect(H.comp(l, 0.5).sx).toBeCloseTo(1.5);
    expect(H.comp(l, 1).sy).toBeCloseTo(1);
  });
});
