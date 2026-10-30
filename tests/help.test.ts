// Help & tutorials: the topics (src/help/content.json) and the guided tours (src/help/tours.ts) agree.
import { describe, expect, it } from 'vitest';
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
  it('every guided tour has a scene and one behaviour per step', () => {
    READY.filter(t => t.tour).forEach(t => {
      expect(SCENES[t.id], t.id).toBeTruthy();
      expect(TOURS[t.id] && TOURS[t.id].length, t.id).toBe(t.steps!.length);
      TOURS[t.id].forEach(s => {
        expect(typeof s.target).toBe('function');
        expect(typeof s.done).toBe('function');
        expect(typeof s.show).toBe('function');
      });
    });
  });
  it('the diamond and keys render as markup', () => {
    expect(rich('Click {◆} here')).toContain('<i class="hp-dm"');
    expect(keyHTML('Shift F1')).toBe('<kbd>Shift</kbd> <kbd>F1</kbd>');
  });
});
