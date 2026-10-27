import { describe, it, expect } from 'vitest';
import { check } from '../src/agent/schema';
import { EASES, TOOLS, cleanSVG, resultText, runTool, toolSpecs } from '../src/agent/tools';
import { blankDoc, setDoc } from '../src/core/state';

describe('design agent: argument checks', () => {
  const s = {
    type: 'object' as const,
    properties: {
      id: { type: 'string' as const },
      n: { type: 'integer' as const, minimum: 1 },
      mode: { type: 'string' as const, enum: ['a', 'b'] },
      xy: { type: 'array' as const, items: { type: 'number' as const }, minItems: 2, maxItems: 2 },
    },
    required: ['id'],
    additionalProperties: false,
  };
  it('accepts what fits', () => expect(check({ id: 'l1', n: 2, mode: 'a', xy: [1, 2] }, s)).toBe(null));
  it('names what is missing or wrong', () => {
    expect(check({}, s)).toBe('arguments.id is missing');
    expect(check({ id: 1 }, s)).toBe('arguments.id must be text');
    expect(check({ id: 'x', n: 1.5 }, s)).toBe('arguments.n must be a whole number');
    expect(check({ id: 'x', n: 0 }, s)).toBe('arguments.n must be at least 1');
    expect(check({ id: 'x', mode: 'c' }, s)).toBe('arguments.mode must be one of: a, b');
    expect(check({ id: 'x', xy: [1] }, s)).toBe('arguments.xy needs at least 2 item(s)');
    expect(check({ id: 'x', xy: [1, 'a'] }, s)).toBe('arguments.xy[1] must be a number');
    expect(check({ id: 'x', extra: 1 }, s)).toBe('arguments.extra is not an argument of this tool');
  });
});

describe('design agent: tools', () => {
  it('every tool has a unique name, a description and an object schema', () => {
    const names = TOOLS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    TOOLS.forEach(t => {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.parameters.type).toBe('object');
      expect(/^[a-z_]+$/.test(t.name)).toBe(true);
    });
    expect(names).toEqual(
      expect.arrayContaining([
        'get_scene',
        'get_layer',
        'list_presets',
        'add_shape',
        'import_svg',
        'update_layer',
        'apply_preset',
        'set_keyframes',
        'delete',
      ]),
    );
    expect(toolSpecs(['get_scene']).map(t => t.name)).toEqual(['get_scene']);
  });
  it('knows the runtime easings', () => {
    expect(EASES).toEqual(expect.arrayContaining(['linear', 'hold', 'ease', 'inOut', 'outBack', 'inOutBounce']));
  });
  it('refuses unknown tools, bad arguments and unknown layers without throwing', async () => {
    setDoc(blankDoc(400, 300));
    expect(await runTool('nope', {})).toEqual({ ok: false, error: 'There is no tool called nope.' });
    expect(await runTool('get_layer', {})).toEqual({ ok: false, error: 'arguments.id is missing' });
    const r = await runTool('get_layer', { id: 'l99' });
    expect(r.ok).toBe(false);
    expect('error' in r && r.error).toMatch(/no layer with id "l99".*get_scene/);
  });
  it('lists presets with their length and whether CSS plays them', async () => {
    const r = await runTool('list_presets', { group: 'filter' });
    expect(r.ok && r.result.length).toBeGreaterThan(0);
    expect(r.ok && r.result.every((p: any) => p.group === 'filter' && p.cssOk === false && p.length > 0)).toBe(true);
  });
});

describe('design agent: SVG from a model is cleaned before import', () => {
  it('drops scripts, event handlers, embedded HTML and outside links', () => {
    const s = cleanSVG(
      '<svg onload="alert(1)"><script>alert(2)</script><script src="x.js"/><foreignObject><p>hi</p></foreignObject>' +
        '<circle r="4" onclick=\'x()\' fill="red"/><image href="https://evil.example/a.png"/><use href="#a"/></svg>',
    );
    expect(s).not.toMatch(/alert|script|foreignObject|onclick|onload|evil/);
    expect(s).toContain('<circle r="4" fill="red"/>');
    expect(s).toContain('<use href="#a"/>');
  });
});

describe('design agent: results sent back to the model', () => {
  it('are short JSON, cut with a note when long', () => {
    expect(resultText({ ok: true, result: { id: 'l1' } })).toBe('{"id":"l1"}');
    expect(resultText({ ok: false, error: 'no' })).toBe('{"error":"no"}');
    const long = resultText({ ok: true, result: 'x'.repeat(20000) }, 1000);
    expect(long.length).toBeLessThanOrEqual(1000);
    expect(long).toMatch(/cut: \d+ more characters/);
  });
});

import { easeName } from '../src/agent/tools';
import { gist } from '../src/agent/describe';
describe('design agent: easing names from other tools', () => {
  it('reads CSS, Penner and GSAP names', () => {
    const cases: Record<string, string> = {
      easeIn: 'in',
      'ease-in-out': 'inOut',
      'ease-out': 'out',
      easeInOutCubic: 'inOutCubic',
      EaseOutBack: 'outBack',
      'power2.out': 'outCubic',
      power3: 'outQuart',
      'power1.in': 'inQuad',
      'back.out(1.7)': 'outBack',
      'sine.inOut': 'inOutSine',
      'expo.in': 'inExpo',
      'step-end': 'hold',
      none: 'linear',
      linear: 'linear',
      inOutQuad: 'inOutQuad',
      ease: 'ease',
    };
    for (const [k, v] of Object.entries(cases)) expect([k, easeName(k)]).toEqual([k, v]);
    expect(easeName('wobbly')).toBe(null);
  });
  it('the panel shows the gist of a refusal', () => {
    expect(gist('Unknown easing "easeIn2". Use one of linear, hold, ease, in, out.')).toBe('Unknown easing "easeIn2".');
    expect(gist('"Logo" is locked. Ask the user whether to unlock it.')).toBe('"Logo" is locked.');
  });
});
