// Select same: the values each choice compares, which choices apply, matching from several layers,
// text choices selecting text layers only, and the menu that lists them with the layers' values.
import { beforeEach, describe, expect, it } from 'vitest';
import { S, doc, mkLayer, setDoc } from '../src/core/state';
import { sampleDoc } from '../src/model/sample';
import { sameKey, sameKinds, sameMatches, shapeName } from '../src/core/select-same';
import { sameItems, sameValue } from '../src/ui/select-same-menu';

const T = (o: any) => ({ x: 0, y: 0, size: 24, family: 'Inter', weight: '400', text: 'Hi', ...o });
let rect: any, rect2: any, ell: any, t1: any, t2: any, t3: any;
beforeEach(() => {
  setDoc(sampleDoc());
  doc.layers = [];
  S.time = 0;
  rect = mkLayer('rect', 'R1', { x: 0, y: 0, w: 10, h: 10 }, { fill: '#FF0000', stk: '#000000', sw: 2, op: 0.5 });
  rect2 = mkLayer('rect', 'R2', { x: 0, y: 0, w: 10, h: 10 }, { fill: '#00ff00', stk: '#000', sw: 4 });
  ell = mkLayer('ellipse', 'E', { cx: 0, cy: 0, rx: 5, ry: 5 }, { fill: '#ff0000', stk: 'none', op: 0.5 });
  t1 = mkLayer('text', 'T1', T({}), { fill: '#ff0000' });
  t2 = mkLayer('text', 'T2', T({ weight: '700' }), { fill: '#222222' });
  t3 = mkLayer('text', 'T3', T({ weight: '700', size: 30 }), { fill: '#222222' });
  doc.layers.push(rect, rect2, ell, t1, t2, t3);
});

describe('Select same', () => {
  it('names the kind of shape', () => {
    expect([rect, ell, t1].map(shapeName)).toEqual(['Rectangle', 'Ellipse', 'Text']);
  });
  it('fill, stroke, opacity and blending compare as shown at the playhead', () => {
    expect(sameKey(rect, 'fill')).toBe(sameKey(ell, 'fill'));
    expect(sameKey(rect, 'fillstk')).not.toBe(sameKey(ell, 'fillstk'));
    expect(sameKey(rect, 'stk')).toBe(sameKey(rect2, 'stk'));
    expect(sameKey(rect, 'op')).toBe(sameKey(ell, 'op'));
    expect(sameKey(rect, 'blend')).toBe('normal');
    // no stroke: stroke width and stroke opacity don't apply
    expect(sameKey(ell, 'sw')).toBeNull();
    expect(sameKey(ell, 'so')).toBeNull();
  });
  it('text choices apply to text layers only, and select only text layers', () => {
    expect(sameKey(rect, 'tfill')).toBeNull();
    expect(sameKinds(rect)).not.toContain('font');
    expect(sameKinds(t1)).toEqual(expect.arrayContaining(['font', 'fontStyle', 'fontAll', 'size', 'tfill']));
    expect(sameMatches('tfill', [t1]).map(l => l.name)).toEqual(['T1']);
    expect(sameMatches('fill', [t1]).map(l => l.name)).toEqual(['R1', 'E', 'T1']);
  });
  it('family, style and size combine', () => {
    expect(sameMatches('font', [t1]).length).toBe(3);
    expect(sameMatches('fontStyle', [t2]).map(l => l.name)).toEqual(['T2', 'T3']);
    expect(sameMatches('fontAll', [t2]).map(l => l.name)).toEqual(['T2']);
    expect(sameMatches('size', [t3]).map(l => l.name)).toEqual(['T3']);
  });
  it('several layers: matches any of them', () => {
    expect(sameMatches('type', [rect, t1]).map(l => l.name)).toEqual(['R1', 'R2', 'T1', 'T2', 'T3']);
    expect(sameMatches('fill', [rect2, t2]).map(l => l.name)).toEqual(['R2', 'T2', 'T3']);
  });
  it('hidden and locked layers are left out; bones never match', () => {
    rect2.hid = true;
    expect(sameMatches('type', [rect]).map(l => l.name)).toEqual(['R1']);
    const bone = mkLayer('bone', 'B', { x: 0, y: 0, len: 10, ang: 0 }, {});
    expect(sameKinds(bone)).toEqual([]);
  });
});

describe('Select same menu', () => {
  it('lists the groups with the layer’s values, only what applies', () => {
    const items = sameItems([ell]) as any[];
    expect(items[0]).toEqual({ head: 'Shapes & text' });
    const ids = items.filter(i => i.id).map(i => i.id);
    expect(ids).toEqual(['same:type', 'same:fillstk', 'same:fill', 'same:stk', 'same:op', 'same:fo', 'same:blend']);
    expect(items.find(i => i.id === 'same:type').val).toBe('Ellipse');
    expect(items.find(i => i.id === 'same:op').val).toBe('50%');
    expect(items.every(i => !i.id || i.ind)).toBe(true);
  });
  it('adds the Text group for text, and shows Mixed where the selection differs', () => {
    const items = sameItems([t2, t3]) as any[];
    expect(items.some(i => i.head === 'Text (selects text layers only)')).toBe(true);
    expect(items.find(i => i.id === 'same:fontStyle').val).toBe('Bold');
    expect(items.find(i => i.id === 'same:size').val).toBe('Mixed');
    expect(sameValue(t3, 'fontAll')).toBe('Bold · 30 px');
    expect(sameValue(rect, 'fill')).toContain('class="sw"');
  });
});
