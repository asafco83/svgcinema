import { describe, it, expect } from 'vitest';
import {
  type Att,
  attachNote,
  atQuery,
  attMeta,
  isAttachable,
  matches,
  refAt,
  refName,
  segments,
  svgParts,
} from '../src/agent/attach';
import { compactHistory } from '../src/agent/loop';
import { systemPrompt } from '../src/agent/prompt';
import type { Msg } from '../src/agent/clients/types';

const L: Att[] = [
  { id: 'a1', name: 'rocket.png', kind: 'image', w: 512, h: 512 },
  { id: 'a2', name: 'logo.svg', kind: 'svg', parts: 3 },
];

describe('agent attachments', () => {
  it('accepts PNG, JPG, WebP, GIF and SVG only', () => {
    expect(isAttachable({ name: 'a.png', type: 'image/png' })).toBe(true);
    expect(isAttachable({ name: 'a.JPG', type: '' })).toBe(true);
    expect(isAttachable({ name: 'a.svg', type: 'image/svg+xml' })).toBe(true);
    expect(isAttachable({ name: 'a.webp', type: '' })).toBe(true);
    expect(isAttachable({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
    expect(isAttachable({ name: 'a.tiff', type: 'image/tiff' })).toBe(false);
  });
  it('reference names have no spaces and are unique', () => {
    expect(refName('My Rocket.PNG', [])).toBe('My-Rocket.png');
    expect(refName('rocket.png', ['rocket.png'])).toBe('rocket-2.png');
    expect(refName('rocket.png', ['Rocket.png', 'rocket-2.png'])).toBe('rocket-3.png');
  });
  it('chips say the size, or vector and its parts', () => {
    expect(attMeta(L[0])).toBe('512 × 512');
    expect(attMeta(L[1])).toBe('vector · 3 parts');
    expect(svgParts('<svg><rect/><path d=""/><circle/><g></g></svg>')).toBe(3);
  });
  it('splits text into references, broken references and plain text', () => {
    const s = segments('Use @rocket.png and @old.png, then @logo.svg. Mail me@x.png', L);
    expect(s.map(g => `${g.t}:${g.s}`)).toEqual([
      'text:Use ',
      'ref:@rocket.png',
      'text: and ',
      'bad:@old.png',
      'text:, then ',
      'ref:@logo.svg',
      'text:. Mail me@x.png',
    ]);
    // names match whatever the case
    expect(segments('@ROCKET.PNG', L)[0].t).toBe('ref');
    expect(segments('just @someone here', L).every(g => g.t === 'text')).toBe(true);
  });
  it('finds the reference at the caret, to delete it whole', () => {
    const t = 'Use @rocket.png now';
    expect(refAt(t, 15, L, 'end')).toEqual({ from: 4, to: 15 });
    expect(refAt(t, 4, L, 'start')).toEqual({ from: 4, to: 15 });
    expect(refAt(t, 10, L, 'end')).toBe(null);
    expect(refAt('Use @old.png', 12, L, 'end')).toBe(null);
  });
  it('"@" before the caret opens the list, filtered by what follows', () => {
    expect(atQuery('Use @', 5)).toEqual({ from: 4, q: '' });
    expect(atQuery('Use @lo', 7)).toEqual({ from: 4, q: 'lo' });
    expect(atQuery('me@x', 4)).toBe(null);
    expect(atQuery('Use @lo now', 11)).toBe(null);
    expect(matches('', L).map(a => a.name)).toEqual(['rocket.png', 'logo.svg']);
    expect(matches('o', L).map(a => a.name)).toEqual(['rocket.png', 'logo.svg']);
    expect(matches('lo', L).map(a => a.name)).toEqual(['logo.svg']);
  });
  it('the model reads each file’s asset id, and whether it gets the pictures', () => {
    expect(attachNote([], true)).toBe('');
    const n = attachNote(L, true);
    expect(n).toMatch(/<attachments note=/);
    expect(n).toContain('@rocket.png: asset a1, image 512 × 512');
    expect(n).toContain('@logo.svg: asset a2, SVG (placed as editable layers)');
    expect(n).toMatch(/pictures follow/);
    expect(attachNote(L, false)).toMatch(/can't see them/);
  });
  it('the system prompt explains attachments', () => {
    expect(systemPrompt()).toMatch(/attach images and SVG files.*place_image/);
  });
  it('later requests keep the text of a message with pictures, not the pictures', () => {
    const m: Msg[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Use @rocket.png\n\n<project note="x">{}</project>' },
          { type: 'image', mime: 'image/png', data: 'AAAA' },
        ],
      },
      { role: 'assistant', text: 'Done.', calls: [] },
      { role: 'user', content: 'Bigger' },
    ];
    const h = compactHistory(m, 10);
    expect(h[0]).toEqual({ role: 'user', content: 'Use @rocket.png' });
    // a message with pictures still counts as a turn
    expect(compactHistory(m, 1)).toEqual([{ role: 'user', content: 'Bigger' }]);
  });
});
