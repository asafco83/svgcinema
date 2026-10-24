import { describe, it, expect } from 'vitest';
import { setDoc, doc, mkLayer, S } from '../src/core/state';
import { blankDoc } from '../src/core/state';
import { PRESETS, writePreset, planPreset, presetById, presetTargets } from '../src/core/presets';
import { valueAt } from '../src/core/constants';

function scene() {
  const d = blankDoc(400, 300);
  d.dur = 3;
  setDoc(d);
  const a = mkLayer('rect', 'A', { x: 0, y: 0, w: 40, h: 40 }, { fill: '#ff0000', stk: 'none', sw: 0 }),
    b = mkLayer('ellipse', 'B', { cx: 100, cy: 100, rx: 20, ry: 20 }, { fill: '#00ff00', stk: '#000', sw: 2 });
  doc.layers.push(a, b);
  S.selSet = new Set([a.id, b.id]);
  return { a, b };
}

describe('animation presets', () => {
  it('every preset has a group, a length and an icon', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(30);
    PRESETS.forEach(p => expect(p.dur > 0 && p.icon.length > 10 && p.name.length > 2).toBe(true));
  });
  it('an entrance ends on the value the layer already has', () => {
    const { a } = scene();
    a.t.op = [
      [0, 0.5, 'ease'],
      [3, 0.5, 'ease'],
    ];
    writePreset(presetById('fade-in'), 1, 0.6, 0, 1, [a.id]);
    expect(valueAt(a, 'op', 1)).toBeCloseTo(0);
    expect(valueAt(a, 'op', 1.6)).toBeCloseTo(0.5);
    expect(valueAt(a, 'op', 2.5)).toBeCloseTo(0.5);
  });
  it('replaces only keys of its own properties inside its span', () => {
    const { a } = scene();
    a.t.op = [
      [0, 1, 'ease'],
      [1.2, 0.2, 'ease'],
      [2.5, 1, 'ease'],
    ];
    a.t.rot = [
      [1.2, 10, 'ease'],
      [2, 0, 'ease'],
    ];
    const plan = planPreset(presetById('fade-out'), 1, 0.6, 0, [a.id]);
    expect(plan.replaced.length).toBe(1);
    const r = writePreset(presetById('fade-out'), 1, 0.6, 0, 1, [a.id]);
    expect(r.replaced).toBe(1);
    expect(a.t.op.map(q => q[0])).toEqual([0, 1, 1.6, 2.5]);
    expect(a.t.rot.length).toBe(2);
  });
  it('emphasis starts and ends on the current value', () => {
    const { a } = scene();
    a.b.scl = [2, 2];
    writePreset(presetById('pulse'), 0.5, 0.8, 0, 1, [a.id]);
    expect(valueAt(a, 'scl', 0.5)).toEqual([2, 2]);
    expect(valueAt(a, 'scl', 1.3)).toEqual([2, 2]);
    expect(valueAt(a, 'scl', 0.9)[0]).toBeGreaterThan(2);
  });
  it('spin turns a full circle and goes on from the old angle', () => {
    const { a } = scene();
    writePreset(presetById('spin'), 0, 1, 0, 1, [a.id]);
    expect(valueAt(a, 'rot', 0.96)).toBeGreaterThan(300);
    expect(valueAt(a, 'rot', 1)).toBeCloseTo(0);
  });
  it('staggers several layers and lengthens the animation', () => {
    const { a, b } = scene();
    const r = writePreset(presetById('slide-up'), 2.6, 0.6, 0.2, 1, [a.id, b.id]);
    expect(r.layers).toBe(2);
    expect(b.t.pos[0][0]).toBeCloseTo(2.8);
    expect(doc.dur).toBeCloseTo(3.4);
    expect(r.grew).toBe(true);
  });
  it('fits presets to the layer: strokes on shapes, flash on a solid fill', () => {
    const { a } = scene();
    const t = mkLayer('text', 'T', { x: 0, y: 0, text: 'x', size: 10, family: 'serif' }, { fill: '#000' });
    doc.layers.push(t);
    expect(presetTargets(presetById('draw-on'), [a.id, t.id]).map(l => l.name)).toEqual(['A']);
    a.b.fill = {
      g: 'lin',
      s: [
        [0, '#000'],
        [1, '#fff'],
      ],
    } as any;
    expect(presetTargets(presetById('flash'), [a.id, t.id]).map(l => l.name)).toEqual(['T']);
  });
  it('filter presets add the filter they need, resting at no effect', () => {
    const { a } = scene();
    writePreset(presetById('blur-in'), 0, 0.6, 0, 1, [a.id]);
    expect(a.fx.length).toBe(1);
    const k = 'fx.' + a.fx[0].id + '.sd';
    expect(valueAt(a, k, 0)).toBe(12);
    expect(valueAt(a, k, 0.6)).toBe(0);
  });
});

describe('preset tiles', () => {
  it('name the tracks each preset animates', async () => {
    const { presetTracks } = await import('../src/core/presets');
    expect(presetTracks(presetById('slide-up'))).toEqual(['Position', 'Opacity']);
    expect(presetTracks(presetById('blur-in'))).toEqual(['Blur']);
    expect(presetTracks(presetById('lift'))).toEqual(['Position', 'Shadow']);
    expect(PRESETS.length).toBeGreaterThanOrEqual(45);
  });
});
