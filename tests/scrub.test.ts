// Starts › Linked to scroll: the progress math, the settings as the player reads them, the code the
// export writes (self-contained, so it runs from its source text) and the external player's support.
import { beforeEach, describe, expect, it } from 'vitest';
import { cinScrub } from '../src/runtime/scrub';
import { FORMAT, boot } from '../src/runtime/boot';
import {
  SCRUB_DEFAULT,
  buildExport,
  formatFor,
  playerLoader,
  scrubConfig,
  scrubRange,
  triggerJS,
} from '../src/export/build';
import { doc, setDoc } from '../src/core/state';
import { sampleDoc } from '../src/model/sample';

/** an element whose box we set, and a stand-in player that records seeks */
function fixture(top: number, height: number) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as any;
  document.body.appendChild(s);
  let box = { top, height };
  s.getBoundingClientRect = () => ({ top: box.top, height: box.height, bottom: box.top + box.height });
  const seeks: number[] = [];
  const P: any = { duration: 3000, _cleanup: [], seekTo: (ms: number) => seeks.push(ms) };
  return { s, P, seeks, move: (t: number) => (box = { top: t, height }) };
}
const nextFrame = () => new Promise(r => setTimeout(r, 40));

describe('Linked to scroll: progress', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).innerHeight = 800;
  });
  it('while it crosses the window: 0 when its top meets the bottom, 1 when its bottom leaves the top', () => {
    const { s, P } = fixture(0, 200),
      h = cinScrub(s, P, { r: scrubRange({ ...SCRUB_DEFAULT, range: 'cross' }) });
    expect(h.at(800, 200, 0, 800)).toBe(0);
    expect(h.at(-200, 200, 0, 800)).toBe(1);
    expect(h.at(300, 200, 0, 800)).toBeCloseTo(0.5);
    expect(h.at(900, 200, 0, 800)).toBe(0);
    expect(h.at(-500, 200, 0, 800)).toBe(1);
  });
  it('scrolls in until centred, scrolls out from the centre', () => {
    const { s, P } = fixture(0, 200),
      inn = cinScrub(s, P, { r: scrubRange({ ...SCRUB_DEFAULT, range: 'in' }) }),
      out = cinScrub(s, P, { r: scrubRange({ ...SCRUB_DEFAULT, range: 'out' }) });
    expect(inn.at(800, 200, 0, 800)).toBe(0);
    expect(inn.at(300, 200, 0, 800)).toBe(1); // its centre at the window's centre
    expect(out.at(300, 200, 0, 800)).toBe(0);
    expect(out.at(-200, 200, 0, 800)).toBe(1);
  });
  it('custom: an edge at a point of the window, in a box that scrolls with its own top', () => {
    const r = scrubRange({ ...SCRUB_DEFAULT, range: 'custom', fe: 'top', fp: 80, te: 'center', tp: 35 });
    expect(r).toEqual([0, 80, 0.5, 35]);
    const { s, P } = fixture(0, 100),
      h = cinScrub(s, P, { r });
    // window 100..500: its top at 420 (80%) starts, its centre at 240 (35%) ends
    expect(h.at(420, 100, 100, 400)).toBe(0);
    expect(h.at(190, 100, 100, 400)).toBe(1);
  });
  it('a range that ends before it starts jumps from start to end', () => {
    const { s, P } = fixture(0, 100),
      h = cinScrub(s, P, { r: [0, 20, 0, 80] });
    expect(h.at(500, 100, 0, 1000)).toBe(0);
    expect(h.at(100, 100, 0, 1000)).toBe(1);
  });
  it('seeks at once to where it is, then follows the scroll', async () => {
    const f = fixture(300, 200);
    cinScrub(f.s, f.P, { r: [0, 100, 1, 0] });
    expect(f.seeks[f.seeks.length - 1]).toBeCloseTo(1500); // half way: 1.5 s of 3
    f.move(-200);
    window.dispatchEvent(new Event('scroll'));
    await nextFrame();
    expect(f.seeks[f.seeks.length - 1]).toBe(3000);
    // cleaned up with the player
    f.P._cleanup.forEach((c: () => void) => c());
    const n = f.seeks.length;
    f.move(800);
    window.dispatchEvent(new Event('scroll'));
    await nextFrame();
    expect(f.seeks.length).toBe(n);
  });
  it('smoothing: it catches up over a few frames instead of jumping', async () => {
    const f = fixture(800, 200);
    cinScrub(f.s, f.P, { r: [0, 100, 1, 0], sm: 0.5 });
    expect(f.seeks[f.seeks.length - 1]).toBe(0);
    f.move(-200);
    window.dispatchEvent(new Event('scroll'));
    await nextFrame();
    const mid = f.seeks[f.seeks.length - 1];
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(3000);
    await new Promise(r => setTimeout(r, 2200));
    expect(f.seeks[f.seeks.length - 1]).toBe(3000);
    f.P._cleanup.forEach((c: () => void) => c());
  });
  it('follows the nearest box that scrolls', () => {
    const wrap = document.createElement('div');
    wrap.style.overflowY = 'auto';
    Object.defineProperty(wrap, 'scrollHeight', { value: 2000 });
    Object.defineProperty(wrap, 'clientHeight', { value: 400 });
    document.body.appendChild(wrap);
    const f = fixture(0, 100);
    wrap.appendChild(f.s);
    expect(cinScrub(f.s, f.P, { r: [0, 100, 1, 0] }).box).toBe(wrap);
  });
  it('runs from its source text (as the export writes it)', () => {
    const f = fixture(300, 200),
      run = new Function('s', 'P', `return (${cinScrub.toString()})(s,P,{r:[0,100,1,0]});`);
    run(f.s, f.P);
    expect(f.seeks[f.seeks.length - 1]).toBeCloseTo(1500);
  });
});

describe('Linked to scroll: the export', () => {
  beforeEach(() => setDoc(sampleDoc()));
  it('settings → the player’s config; direction and default smoothing', () => {
    expect(scrubConfig({ ...SCRUB_DEFAULT, range: 'cross', sm: 0.3 })).toEqual({ r: [0, 100, 1, 0], sm: 0.3 });
    expect(scrubConfig({ ...SCRUB_DEFAULT, sm: 0 })).toEqual({ r: [0, 100, 1, 0] });
    expect(scrubConfig(SCRUB_DEFAULT, -1).b).toBe(-1);
    expect(scrubRange({ ...SCRUB_DEFAULT, range: 'custom', fp: 999 })[1]).toBe(200);
  });
  it('the embedded player carries cinScrub; other triggers are unchanged', () => {
    const js = triggerJS('scrub', 'pause', 1, { ...SCRUB_DEFAULT, sm: 0 });
    expect(js).toContain('function cinScrub');
    expect(js).toContain('{"r":[0,100,1,0]}');
    expect(triggerJS('load', 'pause', 1)).not.toContain('cinScrub');
  });
  it('JS export: the SVG plays with the scroll; CSS can’t, so it falls back to On load', () => {
    doc.ex.mode = 'js';
    doc.ex.trigger = 'scrub';
    doc.ex.scrub = { ...SCRUB_DEFAULT, range: 'in' };
    expect(buildExport(null).code).toContain('{"r":[0,100,0.5,50],"sm":0.3}');
    doc.ex.mode = 'css';
    buildExport(null);
    expect(doc.ex.trigger).toBe('load');
  });
  it('external player: format 2 for Linked to scroll, format 1 otherwise', () => {
    expect(FORMAT).toBe(2);
    expect(formatFor('scrub')).toBe(2);
    expect(formatFor('load')).toBe(1);
    expect(playerLoader('x', 2)).toContain('(C.f||0)>=2');
    doc.ex.mode = 'js';
    doc.ex.player = 'external';
    doc.ex.trigger = 'scrub';
    const code = buildExport(null).code,
      json = JSON.parse(code.match(/data-cin="1">(.*?)<\/script>/)![1]);
    expect(json.f).toBe(2);
    expect(json.t).toBe('scrub');
    expect(json.sc.r).toEqual([0, 100, 1, 0]);
  });
  it('the external player starts a Linked to scroll SVG', () => {
    document.body.innerHTML = '';
    (window as any).innerHeight = 800;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as any;
    document.body.appendChild(s);
    s.getBoundingClientRect = () => ({ top: 300, height: 200 });
    const P = boot(s, { f: 2, d: { L: [], dur: 3 } as any, t: 'scrub', sc: { r: [0, 100, 1, 0] } });
    expect(P).toBeTruthy();
    expect(P!.currentTime).toBe(1500);
    P!.destruct();
  });
});
