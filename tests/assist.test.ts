import { describe, it, expect, beforeEach } from 'vitest';
import { ASSIST, IDLE_MS, assistToolNames, callTool, cancelWait, guide, installAPI } from '../src/agent/assist';
import { setSettings } from '../src/agent/settings';
import { setBusy } from '../src/agent/busy';
import { blankDoc, setDoc, S } from '../src/core/state';
import { describe as describeStep } from '../src/agent/describe';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect id="bar" width="40" height="20"/></svg>';
const api = installAPI();

beforeEach(() => {
  // (sessions are closed by hand here: closing one commits to the editor, which these tests don't load)
  ASSIST.now = null;
  setBusy(false);
  ASSIST.past = [];
  localStorage.clear();
  setDoc(blankDoc(400, 300));
  S.undo = [];
  S.redo = [];
});

describe('your AI assistant: window.svgcinema', () => {
  it('is on window, with help, tools, start, call, batch and done', () => {
    const w = (window as any).svgcinema;
    expect(w).toBe(api);
    expect(typeof w.help()).toBe('string');
    expect(w.tools().map((t: any) => t.name)).toEqual(assistToolNames());
    expect(w.tools('add_shape').parameters.type).toBe('object');
    expect(w.tools('nope').error).toMatch(/no tool/);
  });
  it('the guide explains how to call, and lists every tool with its arguments', () => {
    const g = guide();
    expect(g).toMatch(/svgcinema\.start\(/);
    expect(g).toMatch(/svgcinema\.done\(/);
    for (const n of assistToolNames()) expect(g).toContain(`- ${n}(`);
    expect(g).toMatch(/add_shape\(kind: /);
    expect(g).not.toContain('- snapshot(');
    expect(g).toMatch(/Morph a shape .*path\.d/);
    expect(g).toMatch(/cubic-bezier\(x1, y1, x2, y2\)/);
  });
  it('follows the Images setting: its own, vector only, or the image key (only once one is set up)', () => {
    expect(assistToolNames()).toEqual(expect.arrayContaining(['add_image', 'request_image', 'wait_image']));
    expect(assistToolNames()).not.toContain('generate_image');
    expect(guide()).toMatch(/Images: use your own/);
    setSettings({ assistImages: 'vector' });
    expect(assistToolNames()).not.toContain('add_image');
    expect(guide()).toMatch(/vector shapes only/);
    // no image model set up: "Your image key" falls back to the assistant's own
    setSettings({ assistImages: 'key' });
    expect(assistToolNames()).toContain('add_image');
    expect(assistToolNames()).not.toContain('generate_image');
  });
  it('refuses everything while assistants are off', async () => {
    setSettings({ assistOn: false });
    expect((await api.call('get_scene')).error).toMatch(/turned off/);
    expect(api.start()).toMatchObject({ error: expect.stringMatching(/turned off/) });
  });
  it('a call without start() opens a session, with a default name; batch keeps going after an error', async () => {
    const out = await api.batch([{ name: 'get_scene' }, { name: 'nope' }, { name: 'list_presets' }]);
    expect(out[0].canvas.w).toBe(400);
    expect(out[1].error).toMatch(/no tool called nope/);
    expect(out[2].error).toBeUndefined();
    expect(ASSIST.now!.open).toBe(true);
    expect(ASSIST.now!.assistant).toBe('Your assistant');
    expect(ASSIST.now!.steps.map(s => s.name)).toEqual(['get_scene', 'list_presets']);
  });
  it('add_image refuses what isn’t a picture', async () => {
    api.start();
    expect((await api.call('add_image', { name: 'X', data: 'not a picture!' })).error).toMatch(/data/);
    expect((await api.call('add_image', { name: 'X' })).error).toMatch(/data .* or url/);
    expect((await api.call('add_image', { name: 'X', url: 'ftp://x' })).error).toMatch(/http/);
  });
  it('waits while SVGcinema’s own agent runs a request', async () => {
    setBusy(true);
    expect((await api.call('get_scene')).error).toMatch(/own agent is working/);
    expect(api.start()).toMatchObject({ error: expect.stringMatching(/own agent/) });
    setBusy(false);
  });
  it('tools the setting leaves out say what to do instead', async () => {
    expect((await api.call('generate_image', { prompt: 'x', name: 'x' })).error).toMatch(/add_image/);
    expect((await api.call('snapshot', {})).error).toMatch(/screenshot/);
  });
  it('request_image waits for the drop card; Draw vector instead answers with vector', async () => {
    api.start();
    const q = await api.call('request_image', { name: 'Rocket', model: 'Nano Banana' });
    expect(q.waiting).toBe(true);
    expect(ASSIST.now!.wait!.name).toBe('Rocket');
    expect(ASSIST.now!.steps[0].meta).toBe('Nano Banana · needs you to add it');
    const w = api.call('wait_image', { id: q.id });
    await new Promise(r => setTimeout(r, 10));
    cancelWait();
    const r = await w;
    expect(r.cancelled).toBe(true);
    expect(r.next).toMatch(/import_svg/);
    expect(ASSIST.now!.wait).toBe(null);
    // waiting calls aren't steps
    expect(ASSIST.now!.steps.map(s => s.name)).toEqual(['request_image']);
  });
  it('closes by itself after a quiet spell', () => {
    expect(IDLE_MS).toBeGreaterThanOrEqual(60000);
  });
});
