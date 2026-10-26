import { describe as group, it, expect, beforeEach } from 'vitest';
import { currentChoice, getSettings, removeKeys, setKey, setSettings, shortModel } from '../src/agent/settings';
import { describe } from '../src/agent/describe';
import { CHAT, chatJSON, loadChat } from '../src/agent/chat';

group('design agent: settings', () => {
  beforeEach(() => localStorage.clear());
  it('starts on OpenRouter, not set up until there is a key', () => {
    expect(getSettings().provider).toBe('openrouter');
    expect(currentChoice()).toBe(null);
    setKey('openrouter', ' test-key ');
    expect(currentChoice()).toEqual({ provider: 'openrouter', model: getSettings().model, key: 'test-key' });
    removeKeys();
    expect(currentChoice()).toBe(null);
  });
  it('Custom needs an address and a model, not a key', () => {
    setSettings({ provider: 'custom', model: 'local-model', base: '' });
    expect(currentChoice()).toBe(null);
    setSettings({ base: 'http://localhost:1234/v1' });
    expect(currentChoice()).toMatchObject({ provider: 'custom', base: 'http://localhost:1234/v1', key: '' });
  });
  it('keeps the step limit sensible', () => {
    setSettings({ maxSteps: 0 });
    expect(getSettings().maxSteps).toBe(20);
    setSettings({ maxSteps: 900 });
    expect(getSettings().maxSteps).toBe(100);
  });
  it('shortens model names for the chip', () =>
    expect(shortModel('anthropic/claude-sonnet-5.5')).toBe('claude-sonnet-5.5'));
});

group('design agent: steps and chat file', () => {
  it('describes steps in words', () => {
    expect(describe({ index: 1, name: 'get_scene', args: {}, ok: true }).label).toBe('Looked at the project');
    expect(describe({ index: 1, name: 'get_scene', args: {}, ok: false, error: 'x' }).icon).toBe('err');
  });
  it('round-trips the chat, lean', () => {
    CHAT.turns = [
      {
        id: 3,
        user: 'Hi',
        reply: 'Hello',
        model: 'm',
        steps: [
          {
            index: 1,
            name: 'get_scene',
            args: { a: 1 },
            ok: true,
            result: { big: 1 },
            icon: 'look',
            label: 'L',
            meta: '',
          },
        ],
        msgs: [{ role: 'user', content: 'Hi' }],
      },
    ];
    const j = chatJSON();
    loadChat(j);
    expect(CHAT.turns.length).toBe(1);
    expect(CHAT.next).toBe(4);
    expect(CHAT.turns[0].steps[0].args).toBeUndefined();
    loadChat('not json');
    expect(CHAT.turns).toEqual([]);
  });
});
