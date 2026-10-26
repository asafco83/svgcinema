import { describe as group, it, expect, beforeEach } from 'vitest';
import { toOpenAI } from '../src/agent/clients/openai';
import { toAnthropic } from '../src/agent/clients/anthropic';
import { compactHistory } from '../src/agent/loop';
import type { Msg } from '../src/agent/clients/types';
import {
  canSee,
  imageChoice,
  imageKeyId,
  imageSetup,
  setCanSee,
  setImageTest,
  setKey,
  setSettings,
  vectorChoice,
} from '../src/agent/settings';
import { offeredTools } from '../src/agent/tools';
import { systemPrompt } from '../src/agent/prompt';
import { describe } from '../src/agent/describe';

const IMG = { mime: 'image/png', data: 'AAAA' };
const turn: Msg[] = [
  { role: 'user', content: 'Make it' },
  {
    role: 'assistant',
    text: '',
    calls: [
      { id: 'a', name: 'snapshot', args: {} },
      { id: 'b', name: 'get_scene', args: {} },
    ],
  },
  { role: 'tool', id: 'a', name: 'snapshot', content: '{"time":1}', image: IMG },
  { role: 'tool', id: 'b', name: 'get_scene', content: '{}' },
];

beforeEach(() => localStorage.clear());

group('design agent snapshot: pictures in tool results', () => {
  it('OpenAI format: the picture follows all the tool results as a user message', () => {
    const out = toOpenAI('sys', turn);
    expect(out.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'tool', 'user']);
    const pic = out[5].content;
    expect(pic[0].text).toMatch(/tool call a/);
    expect(pic[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
    expect(out[3].content).toBe('{"time":1}');
  });
  it('Anthropic format: the picture sits inside its tool result', () => {
    const out = toAnthropic(turn);
    const results = out[2].content;
    expect(results[0].type).toBe('tool_result');
    expect(results[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
    expect(results[1].content).toBe('{}');
  });
  it('later requests don’t send old pictures again', () => {
    const h = compactHistory(turn);
    expect((h[2] as any).image).toBeUndefined();
    expect((h[2] as any).content).toBe('{"time":1}');
  });
});

group('design agent snapshot: offered to models that can see', () => {
  it('listed models can see; the Test decides for others', () => {
    setSettings({ provider: 'groq', model: 'openai/gpt-oss-120b' });
    setKey('groq', 'test-key');
    expect(canSee()).toBe(false);
    expect(offeredTools()).not.toContain('snapshot');
    setSettings({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    setKey('anthropic', 'test-key');
    expect(canSee()).toBe(true);
    expect(offeredTools()).toContain('snapshot');
    setSettings({ model: 'some-other-model' });
    expect(canSee()).toBe(false);
    setCanSee({ provider: 'anthropic', model: 'some-other-model', key: 'test-key' }, true);
    expect(canSee()).toBe(true);
    expect(systemPrompt({ see: true })).toMatch(/call snapshot once/);
    expect(systemPrompt({ see: false })).not.toMatch(/snapshot/);
  });
  it('describes a look at the canvas', () => {
    const v = describe({ index: 1, name: 'snapshot', args: {}, ok: true, result: { time: 1.2 } });
    expect([v.icon, v.label, v.meta]).toEqual(['look', 'Looked at the canvas', 'at 1.2 s']);
  });
});

group('design agent: Custom image services', () => {
  beforeEach(() => {
    setSettings({
      provider: 'custom',
      base: 'https://api.example.com/v1',
      model: 'm',
      imgProvider: 'custom',
      imgModel: 'img-1',
    });
    setKey('custom', 'test-key');
  });
  it('share the agent’s address and key by default, or use their own', () => {
    expect(imageKeyId()).toBe('custom');
    expect(imageSetup()).toMatchObject({ base: 'https://api.example.com/v1', key: 'test-key', model: 'img-1' });
    setSettings({ imgSame: false, imgBase: 'https://img.example.com/v1' });
    setKey('customImages', 'test-key-2');
    expect(imageKeyId()).toBe('customImages');
    expect(imageSetup()).toMatchObject({ base: 'https://img.example.com/v1', key: 'test-key-2' });
  });
  it('are used only after their Test passes; a vector model only after it returned SVG', () => {
    expect(imageChoice()).toBe(null);
    expect(offeredTools()).not.toContain('generate_image');
    setImageTest(imageSetup()!, { ok: false });
    expect(imageChoice()).toBe(null);
    setImageTest(imageSetup()!, { ok: true });
    expect(imageChoice()).not.toBe(null);
    expect(offeredTools()).toContain('generate_image');
    setSettings({ vector: 'vec-1' });
    expect(vectorChoice()).toBe(null);
    setImageTest(imageSetup()!, { ok: true, vector: 'vec-1' });
    expect(vectorChoice()).toMatchObject({ model: 'vec-1' });
    // a changed model is a new setup: its Test hasn't run
    setSettings({ imgModel: 'img-2' });
    expect(imageChoice()).toBe(null);
  });
});
