// SVGcinema — export/anim
// Export › GIF & Animated WebP: the frames are drawn once (export/frames) at the chosen size, rate and
// part, then encoded in a worker (export/anim.worker) every time a setting changes, so the size and
// the comparison with the original are always those of the real file.
import { track } from '../core/analytics';
import { $, clamp, esc } from '../core/constants';
import { save, setTime } from '../core/history';
import { S, doc } from '../core/state';
import type { AnimSettings } from '../model/types';
import { toast } from '../io/open';
import { tc } from '../render/stage';
import { kb } from '../ui/inspector';
import { docBg, frameSource, prepareFrameFonts, rasterFrame } from './frames';
import type { FrameSource } from './frames';
import { fileName, saveFile } from './images';
import { exportKind, registerKind } from './kind';
import type { AnimJob, AnimReply } from './anim.worker';
import type { GifOpts } from './gif';
import { parseTime, rulerTicks, tickLabel } from './still';

export const ANIM_FPS = [10, 12, 15, 20, 25, 30, 50];
export const SCALES: Record<string, number> = { '50': 0.5, '75': 0.75, '100': 1, '200': 2 };

/** The settings, created with their defaults the first time. */
export function animSettings(): AnimSettings {
  const ex = doc.ex;
  if (!ex.anim)
    ex.anim = {
      fmt: 'gif',
      part: false,
      from: 0,
      to: 0,
      fps: 15,
      loops: 0,
      merge: true,
      scale: '75',
      colours: 128,
      palette: 'one',
      pick: 'best',
      keep: [],
      dither: 'diff',
      strength: 60,
      denoise: 0,
      lossy: 60,
      changed: true,
      tolerance: 3,
      transparent: false,
      matte: '#FFFFFF',
      q: 80,
      lossless: false,
    };
  return ex.anim;
}
export function animSize(a: AnimSettings, w = doc.w, h = doc.h): [number, number] {
  const k = SCALES[a.scale] || 0.75;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}
export function animSpan(a: AnimSettings, dur = doc.dur): [number, number] {
  if (!a.part) return [0, dur];
  const s = clamp(a.from || 0, 0, dur),
    e = clamp(a.to > 0 ? a.to : dur, 0, dur);
  return e > s ? [s, e] : [0, dur];
}
export function animFrames(a: AnimSettings, dur = doc.dur) {
  const [s, e] = animSpan(a, dur);
  return Math.max(1, Math.round((e - s) * a.fps));
}
const hex = (c: string) => parseInt(c.replace('#', ''), 16) || 0;
/** The document's colors (fills and strokes), most used first, for Keep exact. */
export function docColours(max = 6): string[] {
  const count = new Map<string, number>();
  const add = (v: unknown) => {
    if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) return;
    const k = v.toUpperCase();
    count.set(k, (count.get(k) || 0) + 1);
  };
  doc.layers.forEach(l => {
    add(l.b.fill);
    add(l.b.stk);
  });
  return [...count.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, max)
    .map(e => e[0]);
}
export function gifOpts(a: AnimSettings): GifOpts {
  return {
    colours: clamp(Math.round(a.colours), 2, 256),
    palette: a.palette,
    pick: a.pick,
    keep: (a.keep || []).map(hex),
    dither: a.dither,
    strength: a.strength,
    denoise: a.denoise,
    lossy: a.lossy,
    changed: a.changed && !a.transparent,
    tolerance: a.tolerance,
    transparent: a.transparent,
    matte: hex(a.matte || '#FFFFFF'),
    loops: a.loops,
    merge: a.merge,
  };
}
/** The page code: a GIF as a plain image; an Animated WebP with a GIF behind it. */
export function animSnippet(fmt: 'gif' | 'webp', base: string, alt: string, w: number, h: number) {
  const f = base.replace(/[ #%'()&"]/g, encodeURIComponent),
    a = esc(alt);
  return fmt === 'gif'
    ? `<img src="${f}.gif" alt="${a}"\n     width="${w}" height="${h}">`
    : `<picture>\n  <source srcset="${f}.webp"\n          type="image/webp">\n  <img src="${f}.gif" alt="${a}"\n       width="${w}" height="${h}">\n</picture>`;
}

/* ---------------- the worker ---------------- */

let worker: Worker | null = null,
  jobId = 0;
const waiting = new Map<number, (r: AnimReply) => void>();
function ask(job: Omit<AnimJob, 'id'> & Record<string, any>, transfer: Transferable[] = []): Promise<AnimReply> {
  if (!worker) {
    worker = new Worker(new URL('./anim.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<AnimReply>) => {
      const fn = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      if (fn) fn(e.data);
    };
    worker.onerror = () => {
      waiting.forEach(fn => fn({ id: -1, error: 'The encoder could not start.' }));
      waiting.clear();
      worker = null;
    };
  }
  const id = ++jobId;
  return new Promise(res => {
    waiting.set(id, res);
    worker!.postMessage({ ...job, id }, transfer);
  });
}

/* ---------------- the dialog ---------------- */

let src: FrameSource | null = null,
  srcP: Promise<FrameSource> | null = null,
  framesKey = '',
  framesP: Promise<void> | null = null,
  times: number[] = [],
  seq = 0,
  timer: ReturnType<typeof setTimeout> | null = null,
  result: { blob: Blob; frames: number; fmt: 'gif' | 'webp' } | null = null,
  encodeP: Promise<void> | null = null,
  zoom: 'fit' | '100' | '200' = 'fit',
  split = 50,
  playURL = '',
  /** the size of the same frames as a plain GIF (plainOpts), for the saving shown */
  plainSize = 0;

function source() {
  if (src) return Promise.resolve(src);
  return (
    srcP ||
    (srcP = prepareFrameFonts().then(() => {
      src = frameSource();
      srcP = null;
      return src;
    }))
  );
}
/** Draw every frame (when the size, rate, part or background changed) and hand them to the worker. */
async function ensureFrames(a: AnimSettings) {
  const [w, h] = animSize(a),
    [s] = animSpan(a),
    n = animFrames(a),
    bg = a.transparent ? null : docBg() || { color: '#ffffff', alpha: 1 },
    key = [w, h, s, n, a.fps, bg ? bg.color + bg.alpha : 'none', doc.dur].join('|');
  if (key === framesKey && framesP) return framesP;
  framesKey = key;
  plainSize = 0;
  framesP = (async () => {
    const fs = await source(),
      frames: Uint8ClampedArray[] = [],
      ms: number[] = [];
    times = [];
    for (let i = 0; i < n; i++) {
      // settings changed meanwhile: these frames aren't wanted any more
      if (framesKey !== key) throw new Error('stale');
      const t = s + i / a.fps,
        cv = await rasterFrame(fs, t, w, h, bg);
      frames.push(cv.getContext('2d')!.getImageData(0, 0, w, h).data);
      // timing in whole hundredths keeps GIF's 10 ms clock in step
      ms.push(Math.round(1000 / a.fps));
      times.push(t);
      $('#xFileSub').textContent = `Drawing the frames · ${i + 1} of ${n}`;
    }
    if (framesKey !== key) throw new Error('stale');
    const r = await ask(
      { kind: 'frames', w, h, ms, frames } as any,
      frames.map(f => f.buffer),
    );
    if ('error' in r) throw new Error(r.error);
  })();
  return framesP;
}
/** The frame (by index) nearest the playhead. */
function previewIndex(a: AnimSettings) {
  const [s, e] = animSpan(a),
    t = clamp(S.time, s, e);
  return clamp(Math.round((t - s) * a.fps), 0, animFrames(a) - 1);
}

function schedule(ms = 250) {
  if (timer) clearTimeout(timer);
  $('#xaUpd').textContent = 'Updating…';
  ($('#xaBox') as HTMLElement).classList.add('busy');
  timer = setTimeout(() => {
    timer = null;
    encodeP = encode();
  }, ms);
}
/** The file for the current settings, once it's made. */
async function current() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    encodeP = encode();
  }
  if (encodeP) await encodeP;
  return result;
}
function showPreview(px: Uint8ClampedArray, w: number, h: number) {
  const cv = $('#xaComp') as HTMLCanvasElement;
  cv.width = w;
  cv.height = h;
  cv.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
  layout();
}
async function encode() {
  const my = ++seq,
    a = animSettings();
  try {
    await ensureFrames(a);
    if (my !== seq) return;
    const at = previewIndex(a),
      r =
        a.fmt === 'gif'
          ? await ask({ kind: 'gif', opts: gifOpts(a), previewAt: at } as any)
          : await ask({
              kind: 'webp',
              opts: { q: a.q, lossless: !!a.lossless, changed: a.changed, transparent: a.transparent, loops: a.loops },
              previewAt: at,
            } as any);
    if (my !== seq) return;
    if ('error' in r) throw new Error(r.error);
    if (!('bytes' in r)) return;
    result = {
      blob: new Blob([r.bytes], { type: a.fmt === 'gif' ? 'image/gif' : 'image/webp' }),
      frames: r.frames,
      fmt: a.fmt,
    };
    if (r.preview) showPreview(r.preview, r.w, r.h);
    stopPlay();
    $('#xaUpd').textContent = 'Updates as you change the settings';
    ($('#xaBox') as HTMLElement).classList.remove('busy');
    syncResult();
    if (!plainSize) void baseline(my, a);
  } catch (e) {
    if (framesKey && framesP && String(e).includes('stale')) return;
    // drawn again next time
    framesKey = '';
    if (my !== seq) return;
    ($('#xaBox') as HTMLElement).classList.remove('busy');
    $('#xFileSize').textContent = '—';
    $('#xFileSub').textContent = String((e && (e as Error).message) || e);
    $('#xaUpd').textContent = '';
  }
}
/** The plain GIF the saving is measured against (made once per set of frames). */
async function baseline(my: number, a: AnimSettings) {
  const p = await ask({ kind: 'gif', opts: plainOpts(a), previewAt: -1, extra: true } as any);
  if (my !== seq || !('bytes' in p)) return;
  plainSize = p.bytes.length;
  syncResult();
}
/**
 * A plain GIF of the same frames, as a straightforward GIF export makes it: 256 colors, diffusion
 * dithering at full strength, every pixel of every frame stored.
 */
export function plainOpts(a: AnimSettings): GifOpts {
  return {
    ...gifOpts(a),
    colours: 256,
    palette: 'one',
    pick: 'fast',
    keep: [],
    dither: 'diff',
    strength: 100,
    denoise: 0,
    lossy: 0,
    changed: false,
    tolerance: 0,
    merge: false,
  };
}
/** How the file compares with a plain GIF, in words. */
export function savingText(fmt: 'gif' | 'webp', size: number, plain: number) {
  if (!plain) return '';
  if (fmt !== 'gif') return `a plain GIF would be ${kb(plain)}`;
  const saving = Math.round((1 - size / plain) * 100);
  return saving > 0 ? `${saving}% smaller than a plain GIF` : 'about the size of a plain GIF';
}
function syncResult() {
  const a = animSettings(),
    [w, h] = animSize(a);
  if (!result) return;
  $('#xaSize').textContent = kb(result.blob.size);
  $('#xaSaving').textContent = savingText(a.fmt, result.blob.size, plainSize);
  $('#xaFbKb').textContent =
    '≈ ' + kb(a.fmt === 'gif' ? result.blob.size * 0.35 : (plainSize || result.blob.size * 3) * 0.45);
  $('#xFileSize').textContent = kb(result.blob.size);
  $('#xFileSub').textContent =
    `${a.fmt === 'gif' ? 'GIF' : 'Animated WebP'} · ${w} × ${h} · ${result.frames} frames · ${a.fps} fps`;
  $('#xaFramesSum').textContent = result.frames + ' frames';
  $('#xaOf').textContent = `of ${tc(doc.dur)} · ${result.frames} frames`;
}

const segOn = (sel: string, v: string) =>
  $(sel)
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => {
      b.classList.toggle('on', b.dataset.v === v);
      if (b.getAttribute('role') === 'radio') b.setAttribute('aria-checked', String(b.dataset.v === v));
    });
const slider = (id: string, v: number, min: number, max: number, label: string) => {
  ($('#' + id) as HTMLInputElement).value = String(v);
  $('#' + id + 'v').textContent = label;
  void min;
  void max;
};

/** Bring the options, the comparison and the footer in step with the settings. */
export function syncAnimUI() {
  const a = animSettings(),
    gif = a.fmt === 'gif',
    [w, h] = animSize(a),
    [s, e] = animSpan(a);
  segOn('#xaFmt', a.fmt);
  $('#xaFmtNote').textContent = gif
    ? 'Plays everywhere, including email and chat apps. At most 256 colors per frame.'
    : 'Full color and transparency, much smaller than GIF. Every current browser; most email apps don’t show it.';
  // frames
  segOn('#xaPart', a.part ? 'part' : 'whole');
  $('#xaFromRow').hidden = !a.part;
  if ($('#xaFrom') !== document.activeElement) ($('#xaFrom') as HTMLInputElement).value = tc(s);
  if ($('#xaTo') !== document.activeElement) ($('#xaTo') as HTMLInputElement).value = tc(e);
  ($('#xaFps') as HTMLSelectElement).value = String(a.fps);
  ($('#xaLoops') as HTMLSelectElement).value = String(a.loops);
  ($('#xaMerge') as HTMLInputElement).checked = a.merge !== false;
  // size
  segOn('#xaScale', a.scale);
  ($('#xaW') as HTMLInputElement).value = String(w);
  ($('#xaH') as HTMLInputElement).value = String(h);
  // GIF compression
  $('#xaSecGif').hidden = !gif;
  $('#xaSecWebp').hidden = gif;
  slider('xaCol', a.colours, 2, 256, String(a.colours));
  segOn('#xaPal', a.palette);
  segOn('#xaPick', a.pick);
  const cols = docColours();
  $('#xaKeep').innerHTML = cols
    .map(c => {
      const on = (a.keep || []).includes(c);
      return `<button type="button" class="xkeep${on ? ' on' : ''}" data-c="${c}" aria-pressed="${on}" title="${c}"><span style="background:${c}"></span>${on ? '✓' : ''}</button>`;
    })
    .join('');
  $('#xaKeepRow').hidden = !cols.length;
  segOn('#xaDither', a.dither);
  $('#xaStrRow').hidden = a.dither === 'none';
  slider('xaStr', a.strength, 0, 100, a.strength + '%');
  slider('xaNr', a.denoise, 0, 100, a.denoise ? a.denoise + '%' : 'Off');
  slider('xaLossy', a.lossy, 0, 200, a.lossy ? String(a.lossy) : 'Off');
  $('#xaChangedRow').hidden = a.transparent;
  ($('#xaChanged') as HTMLInputElement).checked = !!a.changed;
  $('#xaTolRow').hidden = !a.changed || a.transparent;
  slider('xaTol', a.tolerance, 0, 20, a.tolerance + '%');
  ($('#xaAlpha') as HTMLInputElement).checked = !!a.transparent;
  $('#xaMatteRow').hidden = !a.transparent;
  $('#xaMatteNote').hidden = !a.transparent;
  const m = a.matte || '#FFFFFF';
  ($('#xaMattePick') as HTMLInputElement).value = /^#[0-9a-f]{6}$/i.test(m) ? m : '#ffffff';
  if ($('#xaMatte') !== document.activeElement) ($('#xaMatte') as HTMLInputElement).value = m.toUpperCase();
  // WebP compression
  $('#xaWqRow').hidden = !!a.lossless;
  slider('xaWq', a.q, 1, 100, a.q + '%');
  ($('#xaWll') as HTMLInputElement).checked = !!a.lossless;
  ($('#xaWchanged') as HTMLInputElement).checked = !!a.changed;
  ($('#xaWalpha') as HTMLInputElement).checked = !!a.transparent;
  // summaries
  $('#xaSumFmt').textContent = gif ? 'GIF' : 'Animated WebP';
  $('#xaSumSize').textContent = `${w} × ${h}`;
  $('#xaSumGif').textContent =
    `${a.colours} colors · ${a.dither === 'none' ? 'no dithering' : 'dithered'}${a.lossy ? ' · lossy ' + a.lossy : ''}`;
  $('#xaSumWebp').textContent = a.lossless ? 'Lossless' : `Quality ${a.q}%`;
  // compare and track
  $('#xaCompLbl').textContent = gif
    ? `GIF · ${a.colours} colors${a.dither === 'none' ? '' : ' · dithered'}`
    : `Animated WebP · ${a.lossless ? 'lossless' : a.q + '%'}`;
  syncTrack();
  $('#xPrevLbl').textContent = `${w} × ${h} · drag the divider to compare` + (zoom === 'fit' ? '' : ' · zoomed in');
  segOnZoom();
  // embed
  const base = fileName(doc.name);
  $('#xaSnip').value = animSnippet(a.fmt, base, doc.name, w, h);
  $('#xaEmbNote').textContent = gif
    ? 'A GIF works as a plain <img>, and in email and chat apps.'
    : 'Browsers that show Animated WebP take it; email and older apps get the GIF.';
  $('#xaFbT').textContent = gif ? 'Also an Animated WebP (smaller, for browsers)' : 'GIF fallback';
  ($('#xaFb') as HTMLInputElement).checked = gif ? !!a.alsoWebp : a.gifFallback !== false;
  $('#xaSetT').textContent = (gif ? a.alsoWebp : a.gifFallback !== false)
    ? 'Download the set (.zip)'
    : 'Download .' + a.fmt;
  $('#xDlT').textContent = 'Download .' + a.fmt;
  if (result) syncResult();
}
function segOnZoom() {
  $('#xPrevZoom')
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => b.classList.toggle('on', (b.dataset.v === 'actual' ? '100' : b.dataset.v) === zoom));
  layout();
}
/** Size the two pictures (and the playing file) alike: fitted, or at 100% / 200%, centred. */
function layout() {
  const box = $('#xaBox') as HTMLElement,
    o = $('#xaOrig') as HTMLCanvasElement,
    a = animSettings(),
    [w, h] = animSize(a),
    k =
      zoom === 'fit'
        ? Math.min((box.clientWidth - 24) / w, (box.clientHeight - 24) / h) || 0.3
        : zoom === '200'
          ? 2
          : 1;
  box.dataset.zoom = zoom;
  box.classList.toggle('alpha', !!a.transparent);
  [o, $('#xaComp'), $('#xaPlayImg')].forEach((el: HTMLElement) => {
    el.style.width = Math.round(w * k) + 'px';
    el.style.height = Math.round(h * k) + 'px';
  });
}
/** Play the file itself, as made (the browser decodes it), in place of the comparison. */
function play() {
  if (!result) return;
  const img = $('#xaPlayImg') as HTMLImageElement;
  if (playURL) URL.revokeObjectURL(playURL);
  playURL = URL.createObjectURL(result.blob);
  img.src = playURL;
  img.hidden = false;
  $('#xaBox').classList.add('playing');
  $('#xaPlay').classList.add('on');
  $('#xaPlay').setAttribute('aria-label', 'Stop');
}
function stopPlay() {
  const img = $('#xaPlayImg') as HTMLImageElement;
  img.hidden = true;
  img.removeAttribute('src');
  if (playURL) URL.revokeObjectURL(playURL);
  playURL = '';
  $('#xaBox').classList.remove('playing');
  $('#xaPlay').classList.remove('on');
  $('#xaPlay').setAttribute('aria-label', 'Play the file');
}
function syncTrack() {
  const a = animSettings(),
    dur = doc.dur || 1,
    [s, e] = animSpan(a),
    t = S.time,
    pct = (t / dur) * 100;
  $('#xaT').textContent = tc(t);
  ($('#xaLine') as HTMLElement).style.left = pct + '%';
  const flag = $('#xaFlag') as HTMLElement;
  flag.textContent = t.toFixed(2) + 's';
  flag.style.left = pct + '%';
  flag.style.transform = pct < 4 ? 'none' : pct > 96 ? 'translateX(-100%)' : 'translateX(-50%)';
  const sp = $('#xaSpan') as HTMLElement;
  sp.style.left = (s / dur) * 100 + '%';
  sp.style.width = ((e - s) / dur) * 100 + '%';
  const n = Math.round(dur * a.fps),
    ticks: string[] = [];
  for (let i = 0; i <= n && i <= 600; i++) {
    const x = i / a.fps,
      p = (x / dur) * 100,
      inside = x >= s - 1e-6 && x <= e + 1e-6;
    ticks.push(`<span class="${inside ? 'in' : ''}" style="left:${p}%"></span>`);
  }
  $('#xaTicks').innerHTML = ticks.join('');
  $('#xaRuler').innerHTML = rulerTicks(doc.dur)
    .map(x => {
      const p = (x / dur) * 100,
        tf = p < 2 ? 'none' : p > 98 ? 'translateX(-100%)' : 'translateX(-50%)';
      return `<span style="left:${p}%;transform:${tf}">${tickLabel(x)}</span>`;
    })
    .join('');
  const sc = $('#xaScrub') as HTMLInputElement;
  sc.max = String(doc.dur);
  if (sc !== document.activeElement) sc.value = String(t);
  // the original: the frame at the playhead, drawn as is
  drawOriginal();
}
let prevSeq = 0;
/** The compressed side at the playhead, from the file already made. */
async function previewFrame() {
  if (timer || !result) return; // the file being made brings its own
  const my = ++prevSeq,
    r = await ask({ kind: 'preview', at: previewIndex(animSettings()) } as any);
  if (my !== prevSeq || !('ok' in r) || !r.preview) return;
  showPreview(r.preview, r.w!, r.h!);
}
let origSeq = 0;
async function drawOriginal() {
  const my = ++origSeq,
    a = animSettings(),
    [w, h] = animSize(a),
    fs = await source();
  if (my !== origSeq) return;
  const [s, e] = animSpan(a),
    i = previewIndex(a),
    t = clamp(s + i / a.fps, s, e),
    cv = await rasterFrame(fs, t, w, h, a.transparent ? null : docBg() || { color: '#ffffff', alpha: 1 });
  if (my !== origSeq) return;
  const o = $('#xaOrig') as HTMLCanvasElement;
  o.width = w;
  o.height = h;
  o.getContext('2d')!.drawImage(cv, 0, 0);
  layout();
}

async function downloadSet() {
  const a = animSettings(),
    base = fileName(doc.name),
    other = a.fmt === 'gif' ? a.alsoWebp : a.gifFallback !== false;
  const res = await current();
  if (!res) return;
  if (!other) return saveFile(base + '.' + res.fmt, res.blob, res.blob.type);
  toast('Making the files…');
  const { makeZip } = await import('../io/zip');
  const files = [{ name: `${base}.${res.fmt}`, data: new Uint8Array(await res.blob.arrayBuffer()) }];
  const r =
    res.fmt === 'gif'
      ? await ask({
          kind: 'webp',
          opts: { q: 80, lossless: false, changed: true, transparent: a.transparent, loops: a.loops },
          previewAt: -1,
          extra: true,
        } as any)
      : await ask({ kind: 'gif', opts: gifOpts({ ...a, colours: 128 }), previewAt: -1, extra: true } as any);
  if ('error' in r) return toast(r.error);
  if ('bytes' in r) files.push({ name: `${base}.${res.fmt === 'gif' ? 'webp' : 'gif'}`, data: r.bytes });
  saveFile(base + '.zip', await makeZip(files.map(f => ({ ...f, compress: false }))), 'application/zip');
}

function changed(frames = false) {
  save();
  if (frames) framesKey = '';
  syncAnimUI();
  schedule();
}
/** The zoom offers Fit, 100% and 200% here (the other kinds: Fit and Actual size). */
function zoomButtons(on: boolean) {
  const z = $('#xPrevZoom'),
    act = z.querySelector('[data-v="actual"]') as HTMLElement,
    two = z.querySelector('[data-v="200"]') as HTMLElement;
  act.textContent = on ? '100%' : 'Actual size';
  two.hidden = !on;
}
function open() {
  zoomButtons(true);
  syncAnimUI();
  schedule(0);
}
function close() {
  zoomButtons(false);
  stopPlay();
  seq++;
  origSeq++;
  if (timer) clearTimeout(timer);
  timer = null;
  if (src) src.dispose();
  src = null;
  srcP = null;
  framesKey = '';
  framesP = null;
  encodeP = null;
  result = null;
  plainSize = 0;
  if (worker) worker.terminate();
  worker = null;
  waiting.clear();
}

export function init(): void {
  registerKind('anim', { open, close });
  const a = () => animSettings();
  const seg = (sel: string, fn: (x: string) => void) =>
    $(sel).addEventListener('click', (e: MouseEvent) => {
      const b = (e.target as Element).closest('button') as HTMLElement | null;
      if (b && b.dataset.v) fn(b.dataset.v);
    });
  seg('#xaFmt', x => {
    a().fmt = x as AnimSettings['fmt'];
    changed();
  });
  seg('#xaPart', x => {
    const s = a();
    s.part = x === 'part';
    if (s.part && !(s.to > s.from)) {
      s.from = Math.round(doc.dur * 0.17 * 100) / 100;
      s.to = Math.round(doc.dur * 0.83 * 100) / 100;
    }
    changed(true);
  });
  const time = (k: 'from' | 'to') => (e: Event) => {
    const t = parseTime((e.target as HTMLInputElement).value);
    if (t != null) a()[k] = clamp(t, 0, doc.dur);
    changed(true);
  };
  $('#xaFrom').addEventListener('change', time('from'));
  $('#xaTo').addEventListener('change', time('to'));
  $('#xaFps').addEventListener('change', (e: Event) => {
    a().fps = parseInt((e.target as HTMLSelectElement).value) || 15;
    changed(true);
  });
  $('#xaLoops').addEventListener('change', (e: Event) => {
    a().loops = parseInt((e.target as HTMLSelectElement).value) || 0;
    changed();
  });
  $('#xaMerge').addEventListener('change', (e: Event) => {
    a().merge = (e.target as HTMLInputElement).checked;
    changed();
  });
  seg('#xaScale', x => {
    a().scale = x as AnimSettings['scale'];
    changed(true);
  });
  const range = (id: string, k: keyof AnimSettings, fmt: (v: number) => string) => {
    $('#' + id).addEventListener(
      'input',
      (e: Event) => ($('#' + id + 'v').textContent = fmt(+(e.target as HTMLInputElement).value)),
    );
    $('#' + id).addEventListener('change', (e: Event) => {
      (a() as any)[k] = +(e.target as HTMLInputElement).value;
      changed();
    });
  };
  range('xaCol', 'colours', v => String(v));
  range('xaStr', 'strength', v => v + '%');
  range('xaNr', 'denoise', v => (v ? v + '%' : 'Off'));
  range('xaLossy', 'lossy', v => (v ? String(v) : 'Off'));
  range('xaTol', 'tolerance', v => v + '%');
  range('xaWq', 'q', v => v + '%');
  seg('#xaPal', x => {
    a().palette = x as AnimSettings['palette'];
    changed();
  });
  seg('#xaPick', x => {
    a().pick = x as AnimSettings['pick'];
    changed();
  });
  $('#xaKeep').addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as Element).closest('[data-c]') as HTMLElement | null;
    if (!b) return;
    const s = a(),
      c = b.dataset.c!,
      k = s.keep || (s.keep = []);
    s.keep = k.includes(c) ? k.filter(x => x !== c) : k.concat(c);
    changed();
  });
  seg('#xaDither', x => {
    a().dither = x as AnimSettings['dither'];
    changed();
  });
  $('#xaChanged').addEventListener('change', (e: Event) => {
    a().changed = (e.target as HTMLInputElement).checked;
    changed();
  });
  $('#xaWchanged').addEventListener('change', (e: Event) => {
    a().changed = (e.target as HTMLInputElement).checked;
    changed();
  });
  const alpha = (e: Event) => {
    a().transparent = (e.target as HTMLInputElement).checked;
    changed(true);
  };
  $('#xaAlpha').addEventListener('change', alpha);
  $('#xaWalpha').addEventListener('change', alpha);
  $('#xaMattePick').addEventListener('input', (e: Event) => {
    a().matte = (e.target as HTMLInputElement).value.toUpperCase();
    changed();
  });
  $('#xaMatte').addEventListener('change', (e: Event) => {
    const x = (e.target as HTMLInputElement).value.trim();
    if (/^#[0-9a-f]{6}$/i.test(x)) a().matte = x.toUpperCase();
    changed();
  });
  $('#xaWll').addEventListener('change', (e: Event) => {
    a().lossless = (e.target as HTMLInputElement).checked;
    changed();
  });
  // the playhead
  $('#xaScrub').addEventListener('input', (e: Event) => {
    setTime(parseFloat((e.target as HTMLInputElement).value) || 0);
    stopPlay();
    syncTrack();
    previewFrame();
  });
  $('#xaPlay').addEventListener('click', () => (playURL ? stopPlay() : current().then(r => r && play())));
  // compare: the divider, and zoom
  $('#xaSplit').addEventListener('input', (e: Event) => {
    split = +(e.target as HTMLInputElement).value;
    ($('#xaBox') as HTMLElement).style.setProperty('--split', split + '%');
  });
  $('#xPrevZoom').addEventListener('click', (e: MouseEvent) => {
    if (exportKind() !== 'anim') return;
    const b = (e.target as Element).closest('button') as HTMLElement | null;
    if (!b) return;
    zoom = (b.dataset.v === 'actual' ? '100' : b.dataset.v) as typeof zoom;
    segOnZoom();
    syncAnimUI();
  });
  // embed
  $('#xaFb').addEventListener('change', (e: Event) => {
    const s = a(),
      on = (e.target as HTMLInputElement).checked;
    if (s.fmt === 'gif') s.alsoWebp = on;
    else s.gifFallback = on;
    save();
    syncAnimUI();
  });
  $('#xaSnipCopy').addEventListener('click', () => {
    track('embed_code_copied', { kind: 'anim' });
    const ta = $('#xaSnip') as HTMLTextAreaElement;
    navigator.clipboard.writeText(ta.value).then(
      () => toast('Snippet copied.'),
      () => {
        ta.select();
        toast('Press Ctrl+C to copy the selected code.');
      },
    );
  });
  $('#xaSet').addEventListener('click', () => downloadSet().catch(err => toast(String((err && err.message) || err))));
  $('#xDl').addEventListener('click', () => {
    if (exportKind() !== 'anim') return;
    current().then(r => r && saveFile(fileName(doc.name) + '.' + r.fmt, r.blob, r.blob.type));
  });
  window.addEventListener('resize', () => {
    if (exportKind() === 'anim' && !$('#mExport').hidden) layout();
  });
}
