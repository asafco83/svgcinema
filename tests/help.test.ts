// Help & tutorials: the topics (src/help/content.json) and the guided tours (src/help/tours.ts) agree.
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { GROUPS, READY, TOPICS, keyHTML, rich, topic } from '../src/help/content';
import { TOURS } from '../src/help/tours';
import { SCENES } from '../src/help/scenes';

describe('help content', () => {
  it('every topic has a unique id and a known group', () => {
    const ids = TOPICS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(GROUPS.map(g => g.id));
    TOPICS.forEach(t => expect(groups.has(t.group), t.id).toBe(true));
  });
  it('a topic with a page has its words', () => {
    expect(READY.length).toBeGreaterThanOrEqual(3);
    READY.forEach(t => {
      expect(t.intro, t.id).toBeTruthy();
      expect(t.steps && t.steps.length, t.id).toBeGreaterThan(1);
      t.steps!.forEach(s => {
        expect(s.title && s.text && s.do, `${t.id}: ${s.title}`).toBeTruthy();
        // the step text is a little HTML: bold, keys and the keyframe diamond only
        expect(s.text.replace(/<\/?(b|kbd)>/g, '').replace(/\{◆\}/g, '')).not.toMatch(/[<>{}]/);
        expect(s.do.replace(/<\/?(b|kbd)>/g, '').replace(/\{◆\}/g, '')).not.toMatch(/[<>{}]/);
      });
    });
  });
  it('related topics point at topics with a page', () => {
    READY.forEach(t => (t.related || []).forEach(r => expect(topic(r), `${t.id} → ${r}`).toBeTruthy()));
  });
  it('every topic with a page has a scene and one behaviour per step (its Show me records its clips)', () => {
    READY.forEach(t => {
      expect(SCENES[t.id], t.id).toBeTruthy();
      expect(TOURS[t.id] && TOURS[t.id].length, t.id).toBe(t.steps!.length);
      TOURS[t.id].forEach(s => {
        expect(typeof s.target).toBe('function');
        expect(typeof s.done).toBe('function');
        expect(typeof s.show).toBe('function');
      });
    });
  });
  it('a guided tour happens in the editor: no step of it is done elsewhere', () => {
    READY.filter(t => t.tour).forEach(t =>
      t.steps!.forEach(s => expect(s.clip, `${t.id}: ${s.title}`).not.toBe(false)),
    );
  });
  it('every step done in the editor has its clip, in both themes', () => {
    READY.forEach(t =>
      t.steps!.forEach((s, i) => {
        if (s.clip === false) return;
        for (const f of [`${t.id}-${i + 1}`, `${t.id}-${i + 1}-dark`])
          for (const x of ['mp4', 'webp']) expect(existsSync(`public/help/${f}.${x}`), `${f}.${x}`).toBe(true);
      }),
    );
  });
  it('Start here: a few topics, each a guided tour', () => {
    const s = READY.filter(t => t.start);
    expect(s.length).toBeGreaterThanOrEqual(3);
    // the hub's card shows what it makes: the topic's goal, exported
    s.forEach(t => expect(t.tour && !!t.goal, t.id).toBe(true));
  });
  it('the diamond and keys render as markup', () => {
    expect(rich('Click {◆} here')).toContain('<i class="hp-dm"');
    expect(keyHTML('Shift F1')).toBe('<kbd>Shift</kbd> <kbd>F1</kbd>');
    expect(keyHTML('Alt + drag')).toBe('<kbd>Alt</kbd> + drag');
    expect(keyHTML('+')).toBe('<kbd>+</kbd>');
  });
});
