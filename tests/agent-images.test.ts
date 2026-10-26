import { describe as group, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  b64ToBytes,
  catalogEntry,
  defaultImageModel,
  generateImage,
  imagePrice,
  money,
  needsKeying,
  pickImagePrice,
  removeBackground,
} from '../src/agent/images';
import { imageChoice, setConfirmImages, confirmImages, setKey, setSettings, vectorChoice } from '../src/agent/settings';
import { offeredTools } from '../src/agent/tools';
import { describe } from '../src/agent/describe';
import { systemPrompt } from '../src/agent/prompt';

const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => localStorage.clear());

group('design agent images: green-screen removal', () => {
  // a 20×20 green picture with a red 8×8 square in the middle
  const img = () => {
    const w = 20,
      px = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4,
          inside = x >= 6 && x < 14 && y >= 6 && y < 14;
        px.set(inside ? [220, 30, 30, 255] : [0, 255, 0, 255], i);
      }
    return px;
  };
  it('clears the flat background and keeps the subject', () => {
    const px = img(),
      cleared = removeBackground(px, 20, 20);
    expect(cleared).toBeCloseTo((400 - 64) / 400, 2);
    expect(px[3]).toBe(0); // a corner
    expect(px[(10 * 20 + 10) * 4 + 3]).toBe(255); // the middle
  });
  it('softens the subject’s edge and takes the green out of it', () => {
    const px = img();
    // a greenish fringe pixel on the subject's edge
    px.set([90, 200, 60, 255], (6 * 20 + 10) * 4);
    removeBackground(px, 20, 20);
    const i = (6 * 20 + 10) * 4;
    expect(px[i + 3]).toBeLessThan(255);
    expect(px[i + 1]).toBeLessThanOrEqual(90);
  });
  it('leaves a picture whose corners disagree alone', () => {
    const px = img();
    px.set([10, 10, 200, 255], 0);
    px.set([200, 200, 10, 255], 19 * 20 * 4);
    px.set([10, 10, 10, 255], (19 * 20 + 19) * 4);
    expect(removeBackground(px, 20, 20)).toBe(0);
  });
});

group('design agent images: prices and models', () => {
  it('reads the per-image price from an endpoints answer', () => {
    expect(
      pickImagePrice({
        data: { endpoints: [{ pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.05 }] }] },
      }),
    ).toBe(0.05);
    expect(
      pickImagePrice({
        endpoints: [
          {
            pricing: [
              { billable: 'output_image', unit: 'image', cost_usd: 0.2, variant: '2K' },
              { billable: 'output_image', unit: 'image', cost_usd: 0.04, variant: '1K' },
              { billable: 'input_image', unit: 'image', cost_usd: 0.001 },
            ],
          },
        ],
      }),
    ).toBe(0.04);
    expect(pickImagePrice({ pricing: [{ billable: 'output_tokens', unit: 'token', cost_usd: 0.00001 }] })).toBe(null);
  });
  it('asks OpenRouter for the price once a day, under the model’s OpenRouter name', async () => {
    const f = vi.fn(async () =>
      json({ data: { endpoints: [{ pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.04 }] }] } }),
    );
    vi.stubGlobal('fetch', f);
    expect(await imagePrice({ provider: 'openai', model: 'gpt-image-2' })).toBe(0.04);
    expect(await imagePrice({ provider: 'openai', model: 'gpt-image-2' })).toBe(0.04);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as any)[0])).toBe(
      'https://openrouter.ai/api/v1/images/models/openai/gpt-image-2/endpoints',
    );
    expect(await imagePrice({ provider: 'custom', model: 'x' })).toBe(null);
  });
  it('reads OpenRouter’s model list entries', () => {
    const m = catalogEntry({
      id: 'recraft/recraft-v4-vector',
      name: 'Recraft: V4 Vector',
      supported_parameters: { output_format: { type: 'enum', values: ['svg'] } },
    })!;
    expect(m.vector).toBe(true);
    const g = catalogEntry({
      id: 'openai/gpt-image-2',
      name: 'x',
      supported_parameters: { background: { values: ['transparent'] } },
    })!;
    expect(g.background).toBe(true);
    expect(defaultImageModel('openrouter')).toBe('openai/gpt-image-2');
    expect(money(0.042)).toBe('$0.042');
    expect(money(0.04)).toBe('$0.04');
  });
});

group('design agent images: calling the services', () => {
  it('OpenRouter: the images endpoint, transparent when the model can, the reported cost', async () => {
    const f = vi.fn(async () => json({ data: [{ b64_json: PNG1, media_type: 'image/png' }], usage: { cost: 0.041 } }));
    vi.stubGlobal('fetch', f);
    const r = await generateImage(
      { provider: 'openrouter', model: 'openai/gpt-image-2', key: 'test-key' },
      { prompt: 'a rocket', transparent: true },
    );
    const [url, init] = f.mock.calls[0] as any,
      body = JSON.parse(init.body);
    expect(url).toBe('https://openrouter.ai/api/v1/images');
    expect(init.headers.authorization).toBe('Bearer test-key');
    expect(body).toMatchObject({ model: 'openai/gpt-image-2', prompt: 'a rocket', n: 1, background: 'transparent' });
    expect(r.mime).toBe('image/png');
    expect(r.cost).toBe(0.041);
    expect(r.keyed).toBe(false);
  });
  it('asks for a green background when the model can’t make it transparent', async () => {
    const f = vi.fn(async () => json({ data: [{ b64_json: PNG1 }] }));
    vi.stubGlobal('fetch', f);
    const c = { provider: 'openrouter' as const, model: 'black-forest-labs/flux.2-pro', key: 'test-key' };
    expect(needsKeying(c)).toBe(true);
    const r = await generateImage(c, { prompt: 'a rocket', transparent: true });
    expect(JSON.parse((f.mock.calls[0] as any)[1].body).prompt).toMatch(/#00FF00/);
    expect(JSON.parse((f.mock.calls[0] as any)[1].body).background).toBeUndefined();
    expect(r.keyed).toBe(true);
  });
  it('OpenAI: size and background', async () => {
    const f = vi.fn(async () => json({ data: [{ b64_json: PNG1 }] }));
    vi.stubGlobal('fetch', f);
    await generateImage(
      { provider: 'openai', model: 'gpt-image-2', key: 'test-key' },
      { prompt: 'p', aspect: 'landscape', transparent: true },
    );
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(JSON.parse(init.body)).toMatchObject({ size: '1536x1024', background: 'transparent', output_format: 'png' });
  });
  it('Gemini: generateContent, the image in inline data', async () => {
    const f = vi.fn(async () =>
      json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG1 } }] } }] }),
    );
    vi.stubGlobal('fetch', f);
    const r = await generateImage(
      { provider: 'gemini', model: 'gemini-2.5-flash-image', key: 'test-key' },
      { prompt: 'p' },
    );
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toMatch(/models\/gemini-2\.5-flash-image:generateContent$/);
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    expect(r.bytes.length).toBe(b64ToBytes(PNG1).length);
  });
  it('passes on refusals and checks vector answers are SVG', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { message: 'No auth credentials found' } }, 401)),
    );
    await expect(
      generateImage({ provider: 'openrouter', model: 'm', key: 'bad' }, { prompt: 'p' }),
    ).rejects.toMatchObject({ kind: 'auth' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ data: [{ b64_json: PNG1, media_type: 'image/png' }] })),
    );
    await expect(
      generateImage({ provider: 'openrouter', model: 'recraft/x-vector', key: 'k' }, { prompt: 'p', vector: true }),
    ).rejects.toMatchObject({ kind: 'format' });
    const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ data: [{ b64_json: svg, media_type: 'image/svg+xml' }] })),
    );
    const r = await generateImage(
      { provider: 'openrouter', model: 'recraft/x-vector', key: 'k' },
      { prompt: 'p', vector: true },
    );
    expect(r.mime).toBe('image/svg+xml');
  });
});

group('design agent images: settings decide what is offered', () => {
  it('no image tools without a working image model', () => {
    setSettings({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    setKey('anthropic', 'test-key');
    expect(imageChoice()).toBe(null);
    expect(offeredTools()).not.toContain('generate_image');
    expect(offeredTools()).toContain('place_image');
    expect(systemPrompt({ images: false })).toMatch(/cannot make raster images/);
  });
  it('the agent’s own provider makes images when it can; a vector model only when chosen', () => {
    setSettings({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5' });
    setKey('openrouter', 'test-key');
    expect(imageChoice()).toMatchObject({ provider: 'openrouter', key: 'test-key' });
    expect(offeredTools()).toContain('generate_image');
    expect(offeredTools()).not.toContain('generate_vector');
    setSettings({ vector: 'recraft/recraft-v4.1-vector' });
    expect(vectorChoice()).toMatchObject({ model: 'recraft/recraft-v4.1-vector' });
    expect(offeredTools()).toContain('generate_vector');
    setSettings({ imgProvider: 'none' });
    expect(imageChoice()).toBe(null);
  });
  it('asks before generating until told not to', () => {
    expect(confirmImages()).toBe(true);
    setConfirmImages(false);
    expect(confirmImages()).toBe(false);
    setConfirmImages(true);
    expect(confirmImages()).toBe(true);
  });
  it('describes generated images with their cost', () => {
    const asked = describe({
      index: 1,
      name: 'generate_image',
      args: { name: 'Rocket' },
      ok: true,
      result: { model: 'GPT Image 2', cost: { usd: 0.04, exact: false }, asked: true },
    });
    expect(asked.label).toBe('Generated image “Rocket”');
    expect(asked.meta).toBe('GPT Image 2 · approved · about $0.04');
    expect(asked.costLine).toBeUndefined();
    const quiet = describe({
      index: 1,
      name: 'generate_vector',
      args: { name: 'Smoke' },
      ok: true,
      result: { model: 'Recraft V4 Vector', layers: 4, cost: { usd: 0.08, exact: true }, asked: false },
    });
    expect(quiet.meta).toBe('Recraft V4 Vector · imported as 4 layers');
    expect(quiet.costLine).toBe('Generated · Recraft V4 Vector · $0.08');
    expect(
      describe({ index: 1, name: 'generate_image', args: { name: 'R' }, ok: true, result: { cancelled: true } }).label,
    ).toMatch(/Didn’t/);
  });
});
