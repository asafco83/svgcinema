import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chatPrice, loadChatPrices, openRouterId, perMillion, priceTable } from '../src/agent/prices';
import { catalogPrices, imageTokens } from '../src/agent/images';

const LIST = {
  data: [
    { id: 'anthropic/claude-sonnet-5.5', pricing: { prompt: '0.000002', completion: '0.00001' } },
    { id: 'openai/gpt-5.5', pricing: { prompt: '0.000005', completion: '0.00003' } },
    { id: 'openai/gpt-oss-120b', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
    { id: 'free/model', pricing: { prompt: '0', completion: '0' } },
  ],
};
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('design agent: model prices for the Settings menus', () => {
  it('reads input and output prices from OpenRouter’s list', () => {
    const t = priceTable(LIST);
    expect(t['openai/gpt-5.5']).toEqual([0.000005, 0.00003]);
    expect(t['free/model']).toBeUndefined();
  });
  it('looks other providers’ models up under their OpenRouter names', () => {
    expect(openRouterId('anthropic', 'claude-sonnet-5-5')).toBe('anthropic/claude-sonnet-5.5');
    expect(openRouterId('openai', 'gpt-5.5')).toBe('openai/gpt-5.5');
    expect(openRouterId('gemini', 'gemini-3.8-flash')).toBe('google/gemini-3.8-flash');
    expect(openRouterId('groq', 'openai/gpt-oss-120b')).toBe('openai/gpt-oss-120b');
    expect(openRouterId('custom', 'x')).toBe(null);
  });
  it('fetches once a day and shows per million tokens', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(LIST), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(chatPrice('anthropic', 'claude-sonnet-5-5')).toBe(null);
    await loadChatPrices();
    await loadChatPrices();
    expect(f).toHaveBeenCalledTimes(1);
    expect(perMillion(chatPrice('anthropic', 'claude-sonnet-5-5')!)).toBe('$2 · $10 /M');
    expect(perMillion(chatPrice('groq', 'openai/gpt-oss-120b')!)).toBe('$0.15 · $0.6 /M');
    expect(chatPrice('openai', 'unknown')).toBe(null);
  });
  it('prices image models per 1024 × 1024 image from their per-token price', () => {
    const p = catalogPrices({
      data: [
        { id: 'black-forest-labs/flux.2-pro', pricing: { prompt: '0', image_output: '0.00000732421875' } },
        { id: 'recraft/recraft-v4.1-vector', pricing: { prompt: '0', image_output: '0.0000191616766467066' } },
        { id: 'openai/gpt-image-2', pricing: { prompt: '0.000008', image_output: '0.00003' } },
        { id: 'google/gemini-3.1-flash-image', pricing: { prompt: '0.0000005', image_output: '0.00006' } },
      ],
    });
    // FLUX.2 Pro is $0.03 a megapixel and Recraft V4.1 Vector $0.08 an image on OpenRouter
    expect(p['black-forest-labs/flux.2-pro']).toBeCloseTo(0.03, 3);
    expect(p['recraft/recraft-v4.1-vector']).toBeCloseTo(0.0785, 3);
    expect(p['openai/gpt-image-2']).toBeCloseTo(1056 * 0.00003 + 150 * 0.000008, 6);
    expect(p['google/gemini-3.1-flash-image']).toBeCloseTo(1290 * 0.00006 + 150 * 0.0000005, 6);
    expect(imageTokens('black-forest-labs/flux.2-pro', 'landscape')).toBe(6144);
  });
});
