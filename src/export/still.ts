// SVGcinema — export/still
// Export › Image: one frame of the animation as a picture. PNG and JPEG come from the browser's own
// encoders; WebP, AVIF and JPEG XL from the official libraries (export/encoder.worker); SVG is the
// frame as still vector markup. The frame is the editor's playhead: moving it here moves it there.
import { track } from '../core/analytics';
import { $, clamp, esc } from '../core/constants';
import { save, setTime } from '../core/history';
import { S, doc } from '../core/state';
import type { StillSettings } from '../model/types';
import { makeZip } from '../io/zip';
import { toast } from '../io/open';
import { tc } from '../render/stage';
import { kb } from '../ui/inspector';
import { LINK_OFF, LINK_ON } from './size';
import { docBg, frameSource, prepareFrameFonts, rasterFrame } from './frames';
import type { Fill, FrameSource } from './frames';
import { fileName, saveFile, toBlobP, exported } from './images';
import { exportKind, registerKind } from './kind';
import type { EncodeJob, EncodeReply } from './encoder.worker';

export type StillFmt = StillSettings['fmt'];
export const FMT_NAME: Record<StillFmt, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  avif: 'AVIF',
  jxl: 'JPEG XL',
  svg: 'SVG',
};
export const EXT: Record<StillFmt, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  avif: 'avif',
  jxl: 'jxl',
  svg: 'svg',
};
export const MIME: Record<StillFmt, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  jxl: 'image/jxl',
  svg: 'image/svg+xml',
};
const NOTES: Record<StillFmt, string> = {
  png: 'Lossless, keeps transparency. The largest of these files.',
  jpeg: 'Small for gradients and photos. No transparency: the background fills it.',
  webp: 'Smaller than PNG and JPEG, with transparency. Every current browser shows it.',
  avif: 'Usually the smallest file, with transparency. Every current browser shows it; it takes a moment longer to make.',
  jxl: '',
  svg: 'This moment as a still SVG: vector, sharp at any size, no script. Images stay embedded.',
};
/** the largest side a picture can have (browsers' canvas limit, with room to spare) */
export const MAX_SIDE = 8192;
/** the arrows step one frame at this rate */
export const STEP_FPS = 30;

/** The Image settings, created with their defaults the first time. */
export function stillSettings(): StillSettings {
  const ex = doc.ex;
  if (!ex.img)
    ex.img = {
      fmt: 'png',
      q: 82,
      scale: '2',
      bg: 'transparent',
      effort: 'bal',
      svgFit: 'resp',
      lock: true,
      fallbacks: true,
      hi: true,
    };
  return ex.img;
}
export const hasQuality = (f: StillFmt) => f === 'jpeg' || f === 'webp' || f === 'avif' || f === 'jxl';
export const canLossless = (f: StillFmt) => f === 'webp' || f === 'avif' || f === 'jxl';
/** The background actually used: JPEG has no transparency, so it falls back to the document's. */
export function stillBg(st: StillSettings): StillSettings['bg'] {
  return st.fmt === 'jpeg' && st.bg === 'transparent' ? 'doc' : st.bg;
}
/** The output size in pixels: a multiple of the canvas, or the size typed in. */
export function outSize(st: StillSettings, w = doc.w, h = doc.h): [number, number] {
  let W: number, H: number;
  if (st.scale === 'c' && st.w > 0 && st.h > 0) {
    W = st.w;
    H = st.h;
  } else {
    const k = st.scale === '1' ? 1 : st.scale === '3' ? 3 : st.scale === 'c' ? 2 : 2;
    W = w * k;
    H = h * k;
  }
  const f = Math.min(1, MAX_SIDE / Math.max(W, H, 1));
  return [Math.max(1, Math.round(W * f)), Math.max(1, Math.round(H * f))];
}
/** Read a typed time: 1.8, 1.8s, 0:01.80 or 1:02.5 (minutes:seconds). */
export function parseTime(s: string): number | null {
  const v = String(s || '')
    .trim()
    .replace(/s$/i, '')
    .replace(',', '.');
  const m = /^(\d+):(\d+(?:\.\d*)?)$/.exec(v);
  const t = m ? +m[1] * 60 + +m[2] : /^\d*\.?\d+$/.test(v) ? +v : NaN;
  return isFinite(t) ? t : null;
}
/** Labels under a timeline of `dur` seconds: whole steps that leave room between them. */
export function rulerTicks(dur: number): number[] {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find(s => dur / s <= 8) || 600,
    out: number[] = [];
  for (let t = 0; t <= dur + 1e-6; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}
export function tickLabel(t: number) {
  return (Math.round(t * 100) / 100).toString() + 's';
}
/** The formats an embed offers, best first: the browser takes the first it can show. */
export function embedFormats(fmt: StillFmt, fallbacks: boolean): StillFmt[] {
  if (!fallbacks || fmt === 'png' || fmt === 'jpeg' || fmt === 'svg') return [fmt];
  return fmt === 'jxl' ? ['jxl', 'avif', 'webp', 'png'] : fmt === 'avif' ? ['avif', 'webp', 'png'] : ['webp', 'png'];
}
/** The page code for the picture (its files named after `base`), w × h CSS pixels. */
export function stillSnippet(
  fmt: StillFmt,
  base: string,
  alt: string,
  w: number,
  h: number,
  fallbacks: boolean,
  hi: boolean,
) {
  const a = esc(alt),
    f = base.replace(/[ #%'()&"]/g, encodeURIComponent),
    two = hi && fmt !== 'svg',
    list = embedFormats(fmt, fallbacks),
    src = (x: StillFmt) => `${f}.${EXT[x]}`,
    set = (x: StillFmt) => (two ? `${f}.${EXT[x]} 1x, ${f}@2x.${EXT[x]} 2x` : src(x));
  if (list.length === 1)
    return `<img src="${src(fmt)}"${two ? ` srcset="${set(fmt)}"` : ''} alt="${a}"\n     width="${w}" height="${h}">`;
  const last = list[list.length - 1];
  return (
    '<picture>\n' +
    list
      .slice(0, -1)
      .map(x => `  <source srcset="${set(x)}"\n          type="${MIME[x]}">\n`)
      .join('') +
    `  <img src="${src(last)}"${two ? ` srcset="${set(last)}"` : ''} alt="${a}"\n       width="${w}" height="${h}">\n</picture>`
  );
}

/* ---------------- encoding ---------------- */

let worker: Worker | null = null,
  jobId = 0;
const waiting = new Map<number, (r: EncodeReply) => void>();
function encodeInWorker(job: Omit<EncodeJob, 'id'>): Promise<ArrayBuffer> {
  if (!worker) {
    worker = new Worker(new URL('./encoder.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<EncodeReply>) => {
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
  return new Promise((res, rej) => {
    waiting.set(id, r => ('buf' in r ? res(r.buf) : rej(new Error(r.error))));
    worker!.postMessage({ ...job, id });
  });
}
/** Encode a drawn frame in one format. */
export async function encodeCanvas(
  cv: HTMLCanvasElement,
  fmt: StillFmt,
  st: Pick<StillSettings, 'q' | 'lossless' | 'effort'>,
) {
  if (fmt === 'png' || fmt === 'jpeg') {
    const b = await toBlobP(cv, MIME[fmt], fmt === 'jpeg' ? clamp(st.q, 1, 100) / 100 : undefined);
    if (!b) throw new Error('The browser could not make the ' + FMT_NAME[fmt] + '.');
    return b;
  }
  const img = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height),
    buf = await encodeInWorker({
      fmt: fmt as EncodeJob['fmt'],
      img,
      q: clamp(st.q, 1, 100),
      lossless: !!st.lossless,
      effort: st.effort || 'bal',
    });
  return new Blob([buf], { type: MIME[fmt] });
}

/* ---------------- the dialog ---------------- */

let src: FrameSource | null = null,
  srcP: Promise<FrameSource> | null = null,
  seq = 0,
  timer: ReturnType<typeof setTimeout> | null = null,
  shown: { blob: Blob; url: string; fmt: StillFmt; w: number; h: number; cv: HTMLCanvasElement | null } | null = null,
  zoom: 'fit' | 'actual' = 'fit';

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
function fill(st: StillSettings): Fill | null {
  const bg = stillBg(st);
  if (bg === 'doc') return docBg() || (st.fmt === 'jpeg' ? { color: '#ffffff', alpha: 1 } : null);
  if (bg === 'colour') return { color: st.bgc || '#ffffff', alpha: 1 };
  return null;
}
const segOn = (sel: string, v: string) =>
  $(sel)
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => {
      b.classList.toggle('on', b.dataset.v === v);
      if (b.getAttribute('role') === 'radio') b.setAttribute('aria-checked', String(b.dataset.v === v));
    });

/** Bring the options column in step with the settings. */
export function syncStillUI() {
  const st = stillSettings(),
    f = st.fmt,
    raster = f !== 'svg',
    bg = stillBg(st);
  segOn('#xiFmt', f);
  $('#xiFmtNote').hidden = f === 'jxl';
  $('#xiFmtNote').textContent = NOTES[f];
  $('#xiJxlWarn').hidden = f !== 'jxl';
  const ll = canLossless(f) && !!st.lossless;
  $('#xiQRow').hidden = !hasQuality(f) || ll;
  ($('#xiQ') as HTMLInputElement).value = String(st.q);
  $('#xiQv').textContent = st.q + '%';
  $('#xiLlRow').hidden = !canLossless(f);
  ($('#xiLl') as HTMLInputElement).checked = ll;
  $('#xiEffRow').hidden = !(f === 'avif' || f === 'jxl');
  segOn('#xiEff', st.effort || 'bal');
  // size
  $('#xiScaleRow').hidden = $('#xiDimRow').hidden = !raster;
  $('#xiFitRow').hidden = raster;
  segOn('#xiScale', st.scale);
  segOn('#xiFit', st.svgFit || 'resp');
  const [W, H] = outSize(st);
  for (const [id, v] of [
    ['xiW', W],
    ['xiH', H],
  ] as const) {
    const e = $('#' + id) as HTMLInputElement;
    if (e !== document.activeElement) e.value = String(v);
  }
  const lk = $('#xiLink'),
    lock = st.lock !== false;
  lk.innerHTML = lock ? LINK_ON : LINK_OFF;
  lk.classList.toggle('on', lock);
  lk.setAttribute('aria-pressed', String(lock));
  // background: JPEG can't be transparent, so that choice isn't offered
  const tb = $('#xiBg').querySelector('[data-v="transparent"]') as HTMLElement;
  tb.hidden = f === 'jpeg';
  segOn('#xiBg', bg);
  $('#xiBgcRow').hidden = bg !== 'colour';
  const c = st.bgc || '#FFFFFF';
  ($('#xiBgPick') as HTMLInputElement).value = /^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff';
  if ($('#xiBgc') !== document.activeElement) ($('#xiBgc') as HTMLInputElement).value = c.toUpperCase();
  const d = docBg();
  $('#xiBgNote').textContent =
    bg === 'transparent'
      ? d
        ? `The document background (${d.color}) is left out. Shapes that cover it stay.`
        : 'Nothing behind the artwork.'
      : bg === 'doc'
        ? d
          ? `The document background, ${d.color}.`
          : 'The document has no background: white fills it.'
        : 'Fills behind the artwork.';
  // summaries for closed sections
  $('#xiSumFmt').textContent =
    FMT_NAME[f] + (hasQuality(f) ? (ll ? ' · lossless' : ` · ${st.q}%`) : canLossless(f) && ll ? ' · lossless' : '');
  $('#xiSumFrame').textContent = S.time.toFixed(2) + 's';
  $('#xiSumSize').textContent = raster
    ? `${W} × ${H} px`
    : st.svgFit === 'fixed'
      ? `${doc.w} × ${doc.h} px`
      : 'Responsive';
  $('#xiSumBg').textContent = bg === 'transparent' ? 'Transparent' : bg === 'doc' ? 'Document' : c.toUpperCase();
  syncPlayhead();
  syncEmbed();
  $('#xCopy').textContent = raster ? 'Copy image' : 'Copy SVG code';
  $('#xDlT').textContent = 'Download .' + EXT[f];
}

/** The playhead under the preview, the Time field and the time chip. */
function syncPlayhead() {
  const t = S.time,
    dur = doc.dur || 1,
    pct = (t / dur) * 100;
  $('#xiT').textContent = tc(t);
  $('#xiOf').textContent = 'of ' + tc(doc.dur);
  $('#xiPhLine').style.left = pct + '%';
  const flag = $('#xiPhFlag');
  flag.textContent = t.toFixed(2) + 's';
  flag.style.left = pct + '%';
  flag.style.transform = pct < 4 ? 'none' : pct > 96 ? 'translateX(-100%)' : 'translateX(-50%)';
  const sc = $('#xiScrub') as HTMLInputElement;
  sc.max = String(doc.dur);
  if (sc !== document.activeElement) sc.value = String(t);
  const tm = $('#xiTime') as HTMLInputElement;
  if (tm !== document.activeElement) tm.value = tc(t);
  $('#xiRuler').innerHTML = rulerTicks(doc.dur)
    .map(x => {
      const p = (x / dur) * 100,
        tf = p < 2 ? 'none' : p > 98 ? 'translateX(-100%)' : 'translateX(-50%)';
      return `<span style="left:${p}%;transform:${tf}">${tickLabel(x)}</span>`;
    })
    .join('');
}

function syncEmbed() {
  const st = stillSettings(),
    f = st.fmt,
    list = embedFormats(f, st.fallbacks !== false),
    hi = st.hi !== false && f !== 'svg',
    base = fileName(doc.name);
  $('#xiSnip').value = stillSnippet(f, base, doc.name, doc.w, doc.h, st.fallbacks !== false, hi);
  const fb = f === 'webp' || f === 'avif' || f === 'jxl';
  $('#xiFbRow').hidden = !fb;
  ($('#xiFb') as HTMLInputElement).checked = st.fallbacks !== false;
  const rest = embedFormats(f, true).slice(1);
  $('#xiFbT').textContent =
    'Fallbacks: ' +
    rest
      .map(x => FMT_NAME[x])
      .join(rest.length > 2 ? ', ' : ' and ')
      .replace(/, ([^,]*)$/, ' and $1');
  $('#xiFbKb').textContent = `+ ${rest.length} file${rest.length > 1 ? 's' : ''}`;
  $('#xiHiRow').hidden = f === 'svg';
  ($('#xiHi') as HTMLInputElement).checked = st.hi !== false;
  $('#xiEmbNote').textContent =
    list.length > 1
      ? `The browser takes the first format it can show; ${FMT_NAME[list[list.length - 1]]} is the fallback for the rest.${hi ? ' The 2× files keep it sharp on high-density screens.' : ''}`
      : `Every browser shows ${FMT_NAME[f]}, so a plain <img> is enough. Width and height keep the page from jumping while it loads.`;
  const many = list.length > 1 || hi;
  $('#xiSetT').textContent = many ? 'Download the set (.zip)' : 'Download .' + EXT[f];
}

function setBusy(on: boolean) {
  $('#xiBox').classList.toggle('busy', on);
  if (on) {
    $('#xFileSize').textContent = '…';
    $('#xFileSub').textContent =
      stillSettings().fmt === 'avif' || stillSettings().fmt === 'jxl' ? 'Encoding…' : 'Drawing…';
  }
}
function schedule(ms = 120) {
  if (timer) clearTimeout(timer);
  setBusy(true);
  timer = setTimeout(() => {
    timer = null;
    render();
  }, ms);
}
/** Draw and encode the frame, then show it with its size. */
async function render() {
  const my = ++seq,
    st = stillSettings(),
    f = st.fmt,
    t = S.time;
  try {
    const s = await source();
    if (my !== seq) return;
    let blob: Blob,
      cv: HTMLCanvasElement | null = null,
      w: number,
      h: number;
    if (f === 'svg') {
      const fixed = st.svgFit === 'fixed';
      w = doc.w;
      h = doc.h;
      blob = new Blob([s.svgAt(t, fixed ? { w, h, bg: fill(st) } : { responsive: true, bg: fill(st) })], {
        type: MIME.svg,
      });
    } else {
      [w, h] = outSize(st);
      cv = await rasterFrame(s, t, w, h, fill(st));
      if (my !== seq) return;
      blob = await encodeCanvas(cv, f, st);
    }
    if (my !== seq) return;
    show({ blob, url: URL.createObjectURL(blob), fmt: f, w, h, cv });
  } catch (e) {
    if (my !== seq) return;
    setBusy(false);
    $('#xFileSize').textContent = '—';
    $('#xFileSub').textContent = (e && (e as Error).message) || 'This picture could not be made.';
  }
}
let fellBack = false;
/** Size the preview (fitted, or at the picture's own pixels) and say how it is shown. */
function layout() {
  if (!shown) return;
  const r = shown,
    st = stillSettings(),
    box = $('#xiBox') as HTMLElement,
    el = (fellBack ? $('#xiCv') : $('#xiImg')) as HTMLElement;
  const k = zoom === 'actual' ? 1 : Math.min(1, (box.clientWidth - 24) / r.w, (box.clientHeight - 24) / r.h) || 1;
  el.style.width = Math.round(r.w * k) + 'px';
  el.style.height = Math.round(r.h * k) + 'px';
  const pct = Math.round(k * 100);
  $('#xPrevLbl').textContent =
    r.fmt === 'svg'
      ? st.svgFit === 'fixed'
        ? `${r.w} × ${r.h} px · shown at ${pct}%`
        : `Responsive · fills its container · ${r.w} px wide shown at ${pct}%`
      : `${r.w} × ${r.h} px · shown at ${pct}%` +
        (fellBack ? ` · shown as PNG: this browser can’t show ${FMT_NAME[r.fmt]}` : '');
  $('#xPrevZoom')
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => b.classList.toggle('on', b.dataset.v === zoom));
}
function show(r: NonNullable<typeof shown>) {
  if (shown) URL.revokeObjectURL(shown.url);
  shown = r;
  setBusy(false);
  const img = $('#xiImg') as HTMLImageElement,
    cv = $('#xiCv') as HTMLCanvasElement,
    st = stillSettings();
  img.onload = () => {
    if (shown !== r) return;
    fellBack = false;
    img.hidden = false;
    cv.hidden = true;
    layout();
  };
  img.onerror = () => {
    if (shown !== r) return;
    // a format this browser can't show (JPEG XL in most): show the frame as drawn
    fellBack = true;
    img.hidden = true;
    if (r.cv) {
      cv.width = r.cv.width;
      cv.height = r.cv.height;
      cv.getContext('2d')!.drawImage(r.cv, 0, 0);
    }
    cv.hidden = false;
    layout();
  };
  img.alt = `The frame at ${S.time.toFixed(2)}s as ${FMT_NAME[r.fmt]}`;
  img.src = r.url;
  const ll = canLossless(r.fmt) && !!st.lossless;
  $('#xFileSize').textContent = kb(r.blob.size);
  $('#xFileSub').textContent =
    FMT_NAME[r.fmt] + (r.fmt === 'svg' ? ' · still vector' : ` · ${r.w} × ${r.h}`) + ` · ${S.time.toFixed(2)}s`;
  const chip = (k: string, v: string) => `<span>${k} <b>${esc(v)}</b></span>`;
  $('#xiStats').innerHTML =
    chip('Time', S.time.toFixed(2) + 's') +
    chip('Output', r.fmt === 'svg' ? 'vector' : `${r.w} × ${r.h}`) +
    chip('Format', FMT_NAME[r.fmt] + (hasQuality(r.fmt) ? (ll ? ' · lossless' : ` · ${st.q}%`) : ''));
}

/** One file for the embed set: the frame in this format, k × the canvas size. */
async function setFile(f: StillFmt, k: number, st: StillSettings, base: string) {
  const s = await source(),
    t = S.time;
  if (f === 'svg') return { name: base + '.svg', data: new TextEncoder().encode(s.svgAt(t, { bg: fill(st) })) };
  const cv = await rasterFrame(
      s,
      t,
      doc.w * k,
      doc.h * k,
      f === 'jpeg' ? fill(st) || { color: '#ffffff', alpha: 1 } : fill(st),
    ),
    b = await encodeCanvas(cv, f, f === 'png' ? { q: 100 } : st);
  return { name: `${base}${k > 1 ? '@2x' : ''}.${EXT[f]}`, data: new Uint8Array(await b.arrayBuffer()) };
}
async function downloadSet() {
  const st = stillSettings(),
    f = st.fmt,
    base = fileName(doc.name),
    list = embedFormats(f, st.fallbacks !== false),
    hi = st.hi !== false && f !== 'svg';
  if (list.length === 1 && !hi) {
    const one = await setFile(f, 1, st, base);
    return saveFile(one.name, one.data, MIME[f]);
  }
  toast('Making the files…');
  const files: { name: string; data: Uint8Array }[] = [];
  for (const x of list) {
    files.push(await setFile(x, 1, st, base));
    if (hi) files.push(await setFile(x, 2, st, base));
  }
  saveFile(base + '.zip', await makeZip(files), 'application/zip');
}

function changed(rerender = true) {
  save();
  syncStillUI();
  if (rerender) schedule();
}
function open() {
  $('#xiBox').classList.toggle('actual', zoom === 'actual');
  syncStillUI();
  schedule(0);
}
function close() {
  seq++;
  if (timer) clearTimeout(timer);
  timer = null;
  if (shown) URL.revokeObjectURL(shown.url);
  shown = null;
  if (src) src.dispose();
  src = null;
  srcP = null;
}

export function init(): void {
  registerKind('image', { open, close });
  const st = () => stillSettings();
  const seg = (sel: string, fn: (v: string) => void) =>
    $(sel).addEventListener('click', (e: MouseEvent) => {
      const b = (e.target as Element).closest('button') as HTMLElement | null;
      if (b && b.dataset.v) fn(b.dataset.v);
    });
  seg('#xiFmt', v => {
    st().fmt = v as StillFmt;
    changed();
  });
  $('#xiQ').addEventListener(
    'input',
    (e: Event) => ($('#xiQv').textContent = (e.target as HTMLInputElement).value + '%'),
  );
  $('#xiQ').addEventListener('change', (e: Event) => {
    st().q = clamp(parseInt((e.target as HTMLInputElement).value) || 82, 1, 100);
    changed();
  });
  $('#xiLl').addEventListener('change', (e: Event) => {
    st().lossless = (e.target as HTMLInputElement).checked;
    changed();
  });
  seg('#xiEff', v => {
    st().effort = v as StillSettings['effort'];
    changed();
  });
  seg('#xiScale', v => {
    const s = st();
    if (v === 'c' && !(s.w > 0 && s.h > 0)) [s.w, s.h] = outSize(s);
    s.scale = v as StillSettings['scale'];
    changed();
  });
  seg('#xiFit', v => {
    st().svgFit = v as StillSettings['svgFit'];
    changed();
  });
  seg('#xiBg', v => {
    st().bg = v as StillSettings['bg'];
    changed();
  });
  const typed = (which: 'w' | 'h') => (e: Event) => {
    const s = st(),
      v = parseInt((e.target as HTMLInputElement).value);
    if (!(v > 0)) return syncStillUI();
    const [W, H] = outSize(s),
      lock = s.lock !== false,
      n = Math.min(MAX_SIDE, v);
    s.scale = 'c';
    if (which === 'w') {
      s.w = n;
      s.h = lock ? Math.max(1, Math.round((n * doc.h) / doc.w)) : H;
    } else {
      s.h = n;
      s.w = lock ? Math.max(1, Math.round((n * doc.w) / doc.h)) : W;
    }
    changed();
  };
  $('#xiW').addEventListener('change', typed('w'));
  $('#xiH').addEventListener('change', typed('h'));
  $('#xiLink').addEventListener('click', () => {
    st().lock = st().lock === false;
    changed(false);
  });
  $('#xiBgPick').addEventListener('input', (e: Event) => {
    st().bgc = (e.target as HTMLInputElement).value.toUpperCase();
    changed();
  });
  $('#xiBgc').addEventListener('change', (e: Event) => {
    const v = (e.target as HTMLInputElement).value.trim();
    if (CSS.supports('color', v)) st().bgc = v;
    changed();
  });
  // the playhead: the frame to export, and the editor's playhead with it
  const moveTo = (t: number) => {
    setTime(clamp(t, 0, doc.dur));
    syncPlayhead();
    $('#xiSumFrame').textContent = S.time.toFixed(2) + 's';
    schedule(60);
  };
  $('#xiScrub').addEventListener('input', (e: Event) => moveTo(parseFloat((e.target as HTMLInputElement).value) || 0));
  $('#xiTime').addEventListener('change', (e: Event) => {
    const t = parseTime((e.target as HTMLInputElement).value);
    if (t == null) return syncPlayhead();
    moveTo(t);
  });
  $('#xiPrevF').addEventListener('click', () => moveTo(Math.round((S.time - 1 / STEP_FPS) * 1000) / 1000));
  $('#xiNextF').addEventListener('click', () => moveTo(Math.round((S.time + 1 / STEP_FPS) * 1000) / 1000));
  // zoom (the shared Fit / Actual size buttons)
  $('#xPrevZoom').addEventListener('click', (e: MouseEvent) => {
    if (exportKind() !== 'image') return;
    const b = (e.target as Element).closest('button') as HTMLElement | null;
    if (!b) return;
    zoom = b.dataset.v === 'actual' ? 'actual' : 'fit';
    $('#xiBox').classList.toggle('actual', zoom === 'actual');
    layout();
  });
  // embed
  $('#xiFb').addEventListener('change', (e: Event) => {
    st().fallbacks = (e.target as HTMLInputElement).checked;
    changed(false);
  });
  $('#xiHi').addEventListener('change', (e: Event) => {
    st().hi = (e.target as HTMLInputElement).checked;
    changed(false);
  });
  $('#xiSnipCopy').addEventListener('click', () => {
    track('embed_code_copied', { kind: 'image' });
    const ta = $('#xiSnip') as HTMLTextAreaElement;
    navigator.clipboard.writeText(ta.value).then(
      () => toast('Snippet copied.'),
      () => {
        ta.select();
        toast('Press Ctrl+C to copy the selected code.');
      },
    );
  });
  $('#xiSet').addEventListener('click', () => downloadSet().catch(e => toast(String((e && e.message) || e))));
  // the shared footer
  $('#xDl').addEventListener('click', () => {
    if (exportKind() !== 'image' || !shown) return;
    saveFile(fileName(doc.name) + '.' + EXT[shown.fmt], shown.blob, MIME[shown.fmt]);
  });
  $('#xCopy').addEventListener('click', async () => {
    if (exportKind() !== 'image' || !shown) return;
    try {
      if (shown.fmt === 'svg') {
        await navigator.clipboard.writeText(await shown.blob.text());
        toast('SVG code copied.');
        exported('copy', 'svg');
        return;
      }
      // pictures are pasted as PNG everywhere, whatever the format chosen
      const png = shown.fmt === 'png' ? shown.blob : shown.cv && (await toBlobP(shown.cv, 'image/png'));
      if (!png) throw new Error('png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast('Image copied (as PNG).');
      exported('copy', 'png');
    } catch (_) {
      toast('Copying images isn’t allowed here. Use Download instead.');
    }
  });
}
