// SVGcinema — export/video
// Export › Video: the animation as MP4 (H.264), WebM (VP9 or AV1) or a zip of PNG frames. Every frame
// is drawn exactly (export/frames) and encoded by the browser's own video encoder (WebCodecs), faster
// than real time, then written into the file by export/mux. Codecs the browser can't encode aren't
// offered; with no video encoder at all, the Video tab isn't shown.
import { track } from '../core/analytics';
import { $, clamp, esc } from '../core/constants';
import { save, setTime } from '../core/history';
import { S, doc } from '../core/state';
import type { VideoSettings } from '../model/types';
import { makeZip } from '../io/zip';
import { toast } from '../io/open';
import { tc } from '../render/stage';
import { kb } from '../ui/inspector';
import { docBg, frameSource, prepareFrameFonts, rasterFrame } from './frames';
import type { FrameSource } from './frames';
import { fileName, saveFile, toBlobP } from './images';
import { exportKind, registerKind } from './kind';
import { muxMP4, muxWebM } from './mux';
import type { VSample, VTrack } from './mux';
import { encodeCanvas, parseTime, rulerTicks, tickLabel } from './still';

export const PRESETS: Record<string, [number, number] | null> = {
  doc: null,
  '720': [1280, 720],
  '1080': [1920, 1080],
  sq: [1080, 1080],
  p45: [1080, 1350],
  story: [1080, 1920],
};
export const FPS = [24, 25, 30, 50, 60];

/** What this browser can encode (checked once). */
export const CAN = { h264: false, vp9: false, av1: false, vp9alpha: false, quantizer: false, done: false };

/** The Video settings, created with their defaults the first time. */
export function videoSettings(): VideoSettings {
  const ex = doc.ex;
  if (!ex.vid)
    ex.vid = {
      fmt: 'mp4',
      codec: 'vp9',
      part: false,
      from: 0,
      to: 0,
      fps: 30,
      preset: '1080',
      fit: 'fit',
      alpha: false,
      aim: 'q',
      q: 70,
      mb: 2,
      mbps: 4,
      key: 2,
      fast: true,
      small: false,
      other: true,
      poster: true,
    };
  return ex.vid;
}
/** The frame size in pixels (even numbers: H.264 and VP9 need them). */
export function frameSize(v: VideoSettings, w = doc.w, h = doc.h): [number, number] {
  const p = v.preset === 'c' && v.w > 0 && v.h > 0 ? [v.w, v.h] : PRESETS[v.preset] || [w, h];
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return [even(Math.min(p[0], 4096)), even(Math.min(p[1], 4096))];
}
/** The part of the timeline the video holds, in seconds. */
export function span(v: VideoSettings, dur = doc.dur): [number, number] {
  if (!v.part) return [0, dur];
  const a = clamp(v.from || 0, 0, dur),
    b = clamp(v.to > 0 ? v.to : dur, 0, dur);
  return b > a ? [a, b] : [0, dur];
}
export function frameCount(v: VideoSettings, dur = doc.dur) {
  const [a, b] = span(v, dur);
  return Math.max(1, Math.round((b - a) * v.fps));
}
/** Where the animation sits in the frame: fitted with bars, or filling it and cropped. */
export function artRect(v: VideoSettings, W: number, H: number, w = doc.w, h = doc.h) {
  const k = v.fit === 'fill' ? Math.max(W / w, H / h) : Math.min(W / w, H / h),
    aw = Math.round(w * k),
    ah = Math.round(h * k);
  return { x: Math.round((W - aw) / 2), y: Math.round((H - ah) / 2), w: aw, h: ah };
}
/** The quality slider (0–100) as the encoder's quantizer: lower is sharper and larger. */
export function quantizer(q: number, codec: 'h264' | 'vp9' | 'av1') {
  const max = codec === 'h264' ? 51 : 63,
    min = codec === 'h264' ? 14 : 10;
  return Math.round(max - (clamp(q, 0, 100) / 100) * (max - min));
}
/** About how big the file will be, in bytes (before it is made). */
export function estimate(v: VideoSettings, W: number, H: number, frames: number) {
  const len = frames / v.fps;
  if (v.fmt === 'seq') return W * H * frames * (v.small ? 0.28 : 0.35);
  if (v.aim === 'size') return (v.mb || 2) * 1e6;
  if (v.aim === 'rate') return ((v.mbps || 4) * 1e6 * len) / 8;
  const bpp = 0.02 + 0.1 * Math.pow(v.q / 100, 2),
    cm = v.fmt === 'mp4' ? 1 : v.codec === 'av1' ? 0.55 : 0.7;
  return (W * H * frames * bpp * cm * (v.alpha ? 1.35 : 1)) / 8;
}
const codecOf = (v: VideoSettings): 'h264' | 'vp9' | 'av1' =>
  v.fmt === 'mp4' ? 'h264' : v.codec === 'av1' ? 'av1' : 'vp9';
/** The codec string WebCodecs needs, with a level that fits the size and frame rate. */
export function codecString(c: 'h264' | 'vp9' | 'av1', W: number, H: number, fps: number) {
  const mbs = Math.ceil(W / 16) * Math.ceil(H / 16),
    rate = mbs * fps;
  if (c === 'h264') {
    const lv = [
      [3600, 108000, 0x1f],
      [8192, 245760, 0x28],
      [8704, 522240, 0x2a],
      [36864, 983040, 0x33],
      [36864, 2073600, 0x34],
    ].find(([m, r]) => mbs <= m && rate <= r);
    return 'avc1.6400' + (lv ? lv[2] : 0x34).toString(16).padStart(2, '0');
  }
  if (c === 'vp9') return 'vp09.00.41.08';
  const big = W * H > 2228224 || fps > 30;
  return big ? 'av01.0.09M.08' : 'av01.0.08M.08';
}
export const FMT_NAME = { mp4: 'MP4', webm: 'WebM', seq: 'PNG frames' };
const codecName = (v: VideoSettings) =>
  v.fmt === 'mp4' ? 'MP4 · H.264' : v.fmt === 'webm' ? 'WebM · ' + (v.codec === 'av1' ? 'AV1' : 'VP9') : 'PNG frames';

/** Check what the browser can encode; with nothing at all the Video tab stays hidden. */
export async function detectVideo() {
  if (CAN.done) return CAN;
  const VE = (globalThis as any).VideoEncoder;
  if (VE && VE.isConfigSupported) {
    const ok = async (cfg: any) => {
      try {
        return !!(await VE.isConfigSupported(cfg)).supported;
      } catch (_) {
        return false;
      }
    };
    const base = { width: 1280, height: 720, framerate: 30, bitrate: 2e6 };
    CAN.h264 = await ok({ ...base, codec: 'avc1.64001f', avc: { format: 'avc' } });
    CAN.vp9 = await ok({ ...base, codec: 'vp09.00.41.08' });
    CAN.av1 = await ok({ ...base, codec: 'av01.0.08M.08' });
    CAN.vp9alpha = CAN.vp9 && (await ok({ ...base, codec: 'vp09.00.41.08', alpha: 'keep' }));
    CAN.quantizer = await ok({ ...base, codec: CAN.h264 ? 'avc1.64001f' : 'vp09.00.41.08', bitrateMode: 'quantizer' });
  }
  CAN.done = true;
  return CAN;
}
/** The settings, nudged to what this browser can do. */
function usable(v: VideoSettings) {
  if (v.fmt === 'mp4' && !CAN.h264) v.fmt = CAN.vp9 || CAN.av1 ? 'webm' : 'seq';
  if (v.fmt === 'webm' && !(CAN.vp9 || CAN.av1)) v.fmt = CAN.h264 ? 'mp4' : 'seq';
  if (v.fmt === 'webm' && v.codec === 'av1' && !CAN.av1) v.codec = 'vp9';
  if (v.fmt === 'webm' && v.codec === 'vp9' && !CAN.vp9) v.codec = 'av1';
  if (v.alpha && !(v.fmt === 'seq' || (v.fmt === 'webm' && v.codec === 'vp9' && CAN.vp9alpha))) v.alpha = false;
  if (v.aim === 'q' && !CAN.quantizer && v.fmt !== 'seq') {
    /* quality still works: it becomes a bitrate (see encode) */
  }
  return v;
}

/* ---------------- encoding ---------------- */

export interface Progress {
  frame: number;
  frames: number;
  bytes: number;
  /** seconds left, roughly */
  left: number;
}

/** Draw frame i into the output canvas (bars or crop, background unless transparent). */
async function drawFrame(src: FrameSource, out: CanvasRenderingContext2D, v: VideoSettings, t: number) {
  const W = out.canvas.width,
    H = out.canvas.height,
    r = artRect(v, W, H),
    bg = v.alpha ? null : bgFill(v);
  const art = await rasterFrame(src, t, r.w, r.h, null);
  out.clearRect(0, 0, W, H);
  if (bg) {
    out.globalAlpha = bg.alpha;
    out.fillStyle = bg.color;
    out.fillRect(0, 0, W, H);
    out.globalAlpha = 1;
  }
  out.drawImage(art, r.x, r.y, r.w, r.h);
}
function bgFill(v: VideoSettings) {
  if (v.bgc) return { color: v.bgc, alpha: 1 };
  return docBg() || { color: '#000000', alpha: 1 };
}

/** Make the video file. `onFrame` reports progress; `stop()` returning true cancels. */
export async function makeVideo(
  src: FrameSource,
  v: VideoSettings,
  onFrame: (p: Progress) => void,
  stop: () => boolean,
): Promise<Blob | null> {
  const [W, H] = frameSize(v),
    [a] = span(v),
    n = frameCount(v),
    cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { alpha: true })!,
    t0 = performance.now();
  const tick = (i: number, bytes: number) => {
    const el = (performance.now() - t0) / 1000;
    onFrame({ frame: i, frames: n, bytes, left: i ? (el / i) * (n - i) : 0 });
  };
  if (v.fmt === 'seq') {
    const files: { name: string; data: Uint8Array }[] = [],
      base = fileName(doc.name),
      digits = Math.max(4, String(n).length);
    let bytes = 0;
    for (let i = 0; i < n; i++) {
      if (stop()) return null;
      await drawFrame(src, ctx, v, a + i / v.fps);
      const b = v.small ? await encodeCanvas(cv, 'png', { q: 100 }) : await toBlobP(cv, 'image/png');
      if (!b) throw new Error('A frame could not be drawn.');
      const data = new Uint8Array(await b.arrayBuffer());
      bytes += data.length;
      files.push({ name: `${base}_${String(i + 1).padStart(digits, '0')}.png`, data });
      tick(i + 1, bytes);
    }
    return makeZip(files.map(f => ({ ...f, compress: false })));
  }
  const codec = codecOf(v),
    VE = (globalThis as any).VideoEncoder,
    samples: VSample[] = [];
  let desc: Uint8Array | null = null,
    failure: any = null,
    bytes = 0;
  const len = n / v.fps,
    quality = v.aim === 'q' && CAN.quantizer;
  const bitrate =
    v.aim === 'size'
      ? Math.max(50e3, ((v.mb || 2) * 8e6 * 0.95) / len)
      : v.aim === 'rate'
        ? Math.max(50e3, (v.mbps || 4) * 1e6)
        : Math.max(100e3, (estimate(v, W, H, n) * 8) / len);
  const enc = new VE({
    output(chunk: any, meta: any) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !desc)
        desc = new Uint8Array(
          meta.decoderConfig.description.buffer
            ? meta.decoderConfig.description.buffer.slice(
                meta.decoderConfig.description.byteOffset,
                meta.decoderConfig.description.byteOffset + meta.decoderConfig.description.byteLength,
              )
            : meta.decoderConfig.description,
        );
      let alpha: Uint8Array | null = null;
      if (meta && meta.alphaSideData) {
        const s = meta.alphaSideData;
        alpha = new Uint8Array(s.buffer ? s.buffer.slice(s.byteOffset || 0, (s.byteOffset || 0) + s.byteLength) : s);
      }
      bytes += data.length;
      samples.push({ data, key: chunk.type === 'key', ts: chunk.timestamp, alpha });
    },
    error(e: any) {
      failure = e;
    },
  });
  const cfg: any = {
    codec: codecString(codec, W, H, v.fps),
    width: W,
    height: H,
    framerate: v.fps,
    latencyMode: 'quality',
    alpha: v.alpha ? 'keep' : 'discard',
  };
  if (quality) cfg.bitrateMode = 'quantizer';
  else {
    cfg.bitrate = Math.round(bitrate);
    cfg.bitrateMode = 'variable';
  }
  if (codec === 'h264') cfg.avc = { format: 'avc' };
  enc.configure(cfg);
  const qp = quantizer(v.q, codec),
    keyEvery = v.key > 0 ? Math.max(1, Math.round(v.key * v.fps)) : 0,
    perFrame = 1e6 / v.fps;
  try {
    for (let i = 0; i < n; i++) {
      if (stop() || failure) break;
      await drawFrame(src, ctx, v, a + i / v.fps);
      const VF = (globalThis as any).VideoFrame,
        frame = new VF(cv, {
          timestamp: Math.round(i * perFrame),
          duration: Math.round(perFrame),
          alpha: v.alpha ? 'keep' : 'discard',
        });
      const opts: any = { keyFrame: i === 0 || (keyEvery > 0 && i % keyEvery === 0) };
      if (quality) opts[codec === 'h264' ? 'avc' : codec] = { quantizer: qp };
      enc.encode(frame, opts);
      frame.close();
      // don't run far ahead of the encoder
      while (enc.encodeQueueSize > 3) await new Promise(r => setTimeout(r, 4));
      tick(i + 1, bytes);
    }
    if (stop()) {
      enc.close();
      return null;
    }
    await enc.flush();
    enc.close();
  } catch (e) {
    try {
      enc.close();
    } catch (_) {}
    throw failure || e;
  }
  if (failure) throw failure;
  const track: VTrack = { width: W, height: H, fps: v.fps, samples, description: desc };
  const file = v.fmt === 'mp4' ? muxMP4(track) : muxWebM(track, codec === 'av1' ? 'av1' : 'vp9', v.alpha);
  return new Blob([file], { type: v.fmt === 'mp4' ? 'video/mp4' : 'video/webm' });
}

/* ---------------- the dialog ---------------- */

let src: FrameSource | null = null,
  srcP: Promise<FrameSource> | null = null,
  busy = false,
  cancel = false,
  playId = 0,
  zoom: 'fit' | 'actual' = 'fit',
  last: { blob: Blob; name: string } | null = null;

function source() {
  if (src) return Promise.resolve(src);
  return (
    srcP ||
    (srcP = prepareFrameFonts().then(() => {
      src = frameSource($('#xvArt'));
      srcP = null;
      layoutStage();
      return src;
    }))
  );
}
const segOn = (sel: string, v: string) =>
  $(sel)
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => {
      b.classList.toggle('on', b.dataset.v === v);
      b.setAttribute('aria-checked', String(b.dataset.v === v));
    });

/** The preview: the frame's shape, the animation fitted or cropped in it, bars in the background. */
function layoutStage() {
  const v = videoSettings(),
    [W, H] = frameSize(v),
    stage = $('#xvStage') as HTMLElement,
    k = zoom === 'actual' ? 1 : Math.min((stage.clientWidth - 2) / W, (stage.clientHeight - 2) / H) || 0.3,
    fw = Math.round(W * k),
    fh = Math.round(H * k),
    fr = $('#xvFrame') as HTMLElement,
    r = artRect(v, fw, fh),
    art = $('#xvArt') as HTMLElement;
  stage.classList.toggle('actual', zoom === 'actual');
  $('#xPrevZoom')
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => b.classList.toggle('on', b.dataset.v === zoom));
  fr.style.width = fw + 'px';
  fr.style.height = fh + 'px';
  fr.classList.toggle('alpha', !!v.alpha);
  fr.style.backgroundColor = v.alpha ? '' : bgFill(v).color;
  Object.assign(art.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  const svg = art.querySelector('svg');
  if (svg) {
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
  }
  const same = Math.abs(W / H - doc.w / doc.h) < 0.01;
  $('#xPrevLbl').textContent = busy
    ? 'Encoding · the frame being encoded'
    : `${W} × ${H} · ${same ? 'same shape as the animation' : v.fit === 'fill' ? 'filled, edges cropped' : 'fitted, with bars'} · shown at ${Math.round(k * 100)}%`;
}

/** Bring the options column, the preview and the footer in step with the settings. */
export function syncVideoUI() {
  const v = usable(videoSettings()),
    [W, H] = frameSize(v),
    n = frameCount(v),
    [a, b] = span(v),
    seq = v.fmt === 'seq',
    codec = codecOf(v);
  // format
  ($('#xvFmt [data-v="mp4"]') as HTMLElement).hidden = !CAN.h264;
  ($('#xvFmt [data-v="webm"]') as HTMLElement).hidden = !(CAN.vp9 || CAN.av1);
  segOn('#xvFmt', v.fmt);
  $('#xvCodecMp4').hidden = v.fmt !== 'mp4';
  $('#xvCodecWebm').hidden = v.fmt !== 'webm';
  ($('#xvCodec [data-v="vp9"]') as HTMLElement).hidden = !CAN.vp9;
  ($('#xvCodec [data-v="av1"]') as HTMLElement).hidden = !CAN.av1;
  segOn('#xvCodec', v.codec);
  $('#xvFmtNote').textContent =
    v.fmt === 'mp4'
      ? 'Plays everywhere: every browser, phone, editor and social site.'
      : v.fmt === 'webm'
        ? v.codec === 'av1'
          ? 'The smallest files. Older devices can’t play AV1: keep an MP4 as a fallback (the Embed tab does).'
          : 'Smaller than MP4 and can be transparent. Every current browser plays it; keep an MP4 for older Apple devices.'
        : 'Every frame as a PNG, for video editors.';
  // timing
  segOn('#xvPart', v.part ? 'part' : 'whole');
  $('#xvFromRow').hidden = !v.part;
  if ($('#xvFrom') !== document.activeElement) ($('#xvFrom') as HTMLInputElement).value = tc(a);
  if ($('#xvTo') !== document.activeElement) ($('#xvTo') as HTMLInputElement).value = tc(b);
  ($('#xvFps') as HTMLSelectElement).value = String(v.fps);
  // size
  ($('#xvPreset option[value="doc"]') as HTMLOptionElement).textContent =
    `Document (${frameSize({ ...v, preset: 'doc' }).join(' × ')})`;
  ($('#xvPreset') as HTMLSelectElement).value = v.preset === 'c' ? '' : v.preset;
  for (const [id, val] of [
    ['xvW', W],
    ['xvH', H],
  ] as const)
    if ($('#' + id) !== document.activeElement) ($('#' + id) as HTMLInputElement).value = String(val);
  const same = Math.abs(W / H - doc.w / doc.h) < 0.01;
  $('#xvFitRow').hidden = same;
  segOn('#xvFit', v.fit);
  const alphaOk = seq || (v.fmt === 'webm' && v.codec === 'vp9' && CAN.vp9alpha);
  $('#xvAlphaRow').hidden = !alphaOk;
  ($('#xvAlpha') as HTMLInputElement).checked = !!v.alpha;
  $('#xvBgRow').hidden = !!v.alpha;
  const bg = bgFill(v);
  ($('#xvBgPick') as HTMLInputElement).value = /^#[0-9a-f]{6}$/i.test(bg.color) ? bg.color : '#000000';
  if ($('#xvBgc') !== document.activeElement) ($('#xvBgc') as HTMLInputElement).value = bg.color.toUpperCase();
  $('#xvBgDoc').hidden = !!v.bgc;
  const note =
    v.fmt === 'mp4' || (v.fmt === 'webm' && v.codec === 'av1')
      ? 'MP4 and AV1 can’t be transparent: the background color fills it. For a transparent video, choose WebM with VP9.'
      : v.alpha && v.fmt === 'webm'
        ? 'Transparent in Chrome, Edge and Firefox. Safari needs a different kind of file for transparency, so it shows the WebM on black.'
        : '';
  $('#xvAlphaNote').hidden = !note || (v.fmt === 'webm' && v.codec === 'av1' && !CAN.vp9alpha);
  $('#xvAlphaNote').textContent = note;
  // compression
  $('#xvSecComp').hidden = seq;
  $('#xvSecFiles').hidden = !seq;
  segOn('#xvAim', v.aim);
  $('#xvQRow').hidden = v.aim !== 'q';
  $('#xvSizeRow').hidden = v.aim !== 'size';
  $('#xvRateRow').hidden = v.aim !== 'rate';
  ($('#xvQ') as HTMLInputElement).value = String(v.q);
  $('#xvQv').textContent = String(v.q);
  if ($('#xvMb') !== document.activeElement) ($('#xvMb') as HTMLInputElement).value = String(v.mb || 2);
  if ($('#xvMbps') !== document.activeElement) ($('#xvMbps') as HTMLInputElement).value = String(v.mbps || 4);
  ($('#xvKey') as HTMLSelectElement).value = String(v.key);
  $('#xvFastRow').hidden = v.fmt !== 'mp4';
  ($('#xvFast') as HTMLInputElement).checked = v.fast !== false;
  ($('#xvSmall') as HTMLInputElement).checked = !!v.small;
  if ($('#xvNames') !== document.activeElement)
    ($('#xvNames') as HTMLInputElement).value =
      `${fileName(doc.name)}_${'0'.repeat(Math.max(4, String(n).length) - 1)}1.png`;
  // summaries for closed sections
  $('#xvSumFmt').textContent = codecName(v);
  $('#xvSumTime').textContent = `${v.part ? tc(a) + ' – ' + tc(b) : 'Whole'} · ${v.fps} fps`;
  $('#xvSumSize').textContent = `${W} × ${H}`;
  $('#xvSumComp').textContent =
    v.aim === 'q' ? `Quality ${v.q}` : v.aim === 'size' ? `${v.mb} MB at most` : `${v.mbps} Mbit/s`;
  // preview and footer
  syncTrack();
  const chip = (k: string, x: string) => `<span>${k} <b>${esc(x)}</b></span>`;
  $('#xvStats').innerHTML =
    chip('Output', `${W} × ${H}`) +
    chip('Frame rate', v.fps + ' fps') +
    chip('Frames', String(n)) +
    chip('Length', +(n / v.fps).toFixed(2) + ' s');
  if (!busy) {
    $('#xFileSize').textContent = last ? kb(last.blob.size) : '≈ ' + kb(estimate(v, W, H, n));
    $('#xFileSub').textContent =
      (last ? '' : 'estimate · ') +
      codecName(v) +
      (v.aim === 'q' && !seq ? ' · quality ' + v.q : '') +
      ` · ${W} × ${H} · ${v.fps} fps` +
      (last ? ' · saved' : '');
  }
  $('#xDlT').textContent = seq ? 'Export frames (.zip)' : 'Export .' + v.fmt;
  syncVideoEmbed();
  layoutStage();
}
function syncTrack() {
  const v = videoSettings(),
    dur = doc.dur || 1,
    [a, b] = span(v),
    t = S.time,
    pct = (t / dur) * 100;
  $('#xvT').textContent = tc(t);
  $('#xvOf').textContent = 'of ' + tc(doc.dur);
  $('#xvRange').textContent = v.part ? `Part: ${tc(a)} – ${tc(b)}` : 'Whole animation';
  const sp = $('#xvSpan') as HTMLElement;
  sp.style.left = (a / dur) * 100 + '%';
  sp.style.width = ((b - a) / dur) * 100 + '%';
  ($('#xvFromH') as HTMLElement).style.left = (a / dur) * 100 + '%';
  ($('#xvToH') as HTMLElement).style.left = (b / dur) * 100 + '%';
  ($('#xvLine') as HTMLElement).style.left = pct + '%';
  const flag = $('#xvFlag') as HTMLElement;
  flag.textContent = t.toFixed(2) + 's';
  flag.style.left = pct + '%';
  flag.style.transform = pct < 4 ? 'none' : pct > 96 ? 'translateX(-100%)' : 'translateX(-50%)';
  const sc = $('#xvScrub') as HTMLInputElement;
  sc.max = String(doc.dur);
  if (sc !== document.activeElement) sc.value = String(t);
  $('#xvRuler').innerHTML = rulerTicks(doc.dur)
    .map(x => {
      const p = (x / dur) * 100,
        tf = p < 2 ? 'none' : p > 98 ? 'translateX(-100%)' : 'translateX(-50%)';
      return `<span style="left:${p}%;transform:${tf}">${tickLabel(x)}</span>`;
    })
    .join('');
}
/** The page code: a muted, looping <video> with both formats and a poster. */
export function videoSnippet(base: string, w: number, h: number, webm: boolean, mp4: boolean, poster: boolean) {
  const f = base.replace(/[ #%'()&"]/g, encodeURIComponent);
  return (
    `<video autoplay muted loop playsinline\n       width="${w}" height="${h}"` +
    (poster ? `\n       poster="${f}-poster.webp"` : '') +
    '>\n' +
    (webm ? `  <source src="${f}.webm" type="video/webm">\n` : '') +
    (mp4 ? `  <source src="${f}.mp4" type="video/mp4">\n` : '') +
    '</video>'
  );
}
function setFormats(v: VideoSettings) {
  const both = v.other !== false && CAN.h264 && (CAN.vp9 || CAN.av1);
  return { webm: v.fmt === 'webm' || (both && v.fmt === 'mp4'), mp4: v.fmt === 'mp4' || (both && v.fmt === 'webm') };
}
function syncVideoEmbed() {
  const v = videoSettings(),
    seq = v.fmt === 'seq',
    [W, H] = frameSize(v),
    n = frameCount(v);
  if (seq) {
    $('#xvSnip').value = '';
    $('#xvEmbNote').textContent =
      'PNG frames are for video editors, not for web pages. Choose MP4 or WebM to embed the video.';
  } else {
    const f = setFormats(v);
    $('#xvSnip').value = videoSnippet(fileName(doc.name), doc.w, doc.h, f.webm, f.mp4, v.poster !== false);
    $('#xvEmbNote').textContent =
      'Browsers play videos on their own only when muted. playsinline keeps iPhones from opening it full screen. The poster shows until the video starts.';
  }
  $('#xvSnip').hidden = seq;
  const both = CAN.h264 && (CAN.vp9 || CAN.av1);
  $('#xvOtherRow').hidden = seq || !both;
  ($('#xvOther') as HTMLInputElement).checked = v.other !== false;
  $('#xvOtherT').textContent =
    v.fmt === 'mp4' ? 'Also a WebM (smaller, for browsers that play it)' : 'Also an MP4 (for older Apple devices)';
  const other: VideoSettings = { ...v, fmt: v.fmt === 'mp4' ? 'webm' : 'mp4' };
  $('#xvOtherKb').textContent = '≈ ' + kb(estimate(other, W, H, n));
  $('#xvPosterRow').hidden = seq;
  ($('#xvPoster') as HTMLInputElement).checked = v.poster !== false;
  $('#xvSetRow').hidden = seq;
}

function setBusy(on: boolean) {
  busy = on;
  $('#xOptsVid').classList.toggle('locked', on);
  $('#xProg').hidden = !on;
  for (const id of ['xFootSize', 'xFootSp', 'xDl']) ($('#' + id) as HTMLElement).hidden = on;
  $('#xvChip').hidden = !on;
  $('#xKind').classList.toggle('locked', on);
  layoutStage();
}
function progress(p: Progress) {
  const pct = Math.round((p.frame / p.frames) * 100);
  $('#xProgBar').style.width = pct + '%';
  $('#xProg').querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(pct));
  $('#xProgS').textContent =
    `frame ${p.frame} of ${p.frames}` + (p.left > 1 ? ` · about ${Math.ceil(p.left)} s left` : '');
  $('#xProgSo').textContent = kb(p.bytes) + ' so far';
  $('#xvChip').textContent = `Frame ${p.frame} of ${p.frames}`;
}
/** Encode with progress and Cancel; returns the file, or null when cancelled. */
async function run(v: VideoSettings, label: string) {
  stopPlay();
  const s = await source();
  cancel = false;
  $('#xProgT').textContent = label;
  setBusy(true);
  const keepT = S.time;
  try {
    return await makeVideo(s, v, progress, () => cancel);
  } finally {
    setBusy(false);
    seekPreview(keepT);
  }
}
async function exportVideo() {
  const v = videoSettings();
  try {
    const blob = await run(v, v.fmt === 'seq' ? 'Drawing the frames' : 'Encoding the video');
    if (!blob) return toast('Cancelled.');
    const name = fileName(doc.name) + (v.fmt === 'seq' ? '-frames.zip' : '.' + v.fmt);
    last = { blob, name };
    syncVideoUI();
    saveFile(name, blob, blob.type || 'application/octet-stream');
  } catch (e) {
    toast('The video could not be made: ' + String((e && (e as Error).message) || e));
  }
}
async function exportSet() {
  const v = videoSettings(),
    f = setFormats(v),
    base = fileName(doc.name),
    files: { name: string; data: Uint8Array; compress?: boolean }[] = [];
  try {
    for (const fmt of ['webm', 'mp4'] as const) {
      if (!f[fmt]) continue;
      const blob = await run({ ...v, fmt }, `Encoding the ${fmt.toUpperCase()}`);
      if (!blob) return toast('Cancelled.');
      files.push({ name: `${base}.${fmt}`, data: new Uint8Array(await blob.arrayBuffer()), compress: false });
    }
    if (v.poster !== false) {
      const s = await source(),
        cv = document.createElement('canvas'),
        [a] = span(v);
      cv.width = doc.w * 2;
      cv.height = doc.h * 2;
      const x = cv.getContext('2d')!;
      const art = await rasterFrame(s, a, cv.width, cv.height, v.alpha ? null : bgFill(v));
      x.drawImage(art, 0, 0);
      const b = await encodeCanvas(cv, 'webp', { q: 80 });
      files.push({ name: `${base}-poster.webp`, data: new Uint8Array(await b.arrayBuffer()), compress: false });
    }
    saveFile(base + '.zip', await makeZip(files), 'application/zip');
  } catch (e) {
    toast('The video could not be made: ' + String((e && (e as Error).message) || e));
  }
}

/* the preview plays the animation itself (its player), the playhead follows */
function seekPreview(t: number) {
  const svg = $('#xvArt svg') as any;
  if (svg && svg.player) svg.player.seekTo(clamp(t, 0, doc.dur) * 1000);
}
function stopPlay() {
  if (playId) cancelAnimationFrame(playId);
  playId = 0;
  $('#xvPlay').classList.remove('on');
  $('#xvPlay').setAttribute('aria-label', 'Play');
}
function togglePlayPreview() {
  if (playId) return stopPlay();
  const v = videoSettings(),
    [a, b] = span(v);
  let t = S.time >= b - 0.01 || S.time < a ? a : S.time,
    prev = performance.now();
  $('#xvPlay').classList.add('on');
  $('#xvPlay').setAttribute('aria-label', 'Pause');
  const step = (now: number) => {
    t += (now - prev) / 1000;
    prev = now;
    if (t >= b) {
      setTime(b);
      seekPreview(b);
      syncTrack();
      return stopPlay();
    }
    S.time = t;
    seekPreview(t);
    syncTrack();
    playId = requestAnimationFrame(step);
  };
  playId = requestAnimationFrame(step);
}

function changed(rerender = true) {
  last = null;
  save();
  syncVideoUI();
  if (rerender) seekPreview(S.time);
}
function open() {
  detectVideo().then(() => {
    syncVideoUI();
    source().then(() => {
      seekPreview(S.time);
      layoutStage();
    });
  });
  syncVideoUI();
}
function close() {
  cancel = true;
  stopPlay();
  if (src) src.dispose();
  src = null;
  srcP = null;
  last = null;
}

export function init(): void {
  registerKind('video', { open, close });
  detectVideo();
  const v = () => videoSettings();
  const seg = (sel: string, fn: (x: string) => void) =>
    $(sel).addEventListener('click', (e: MouseEvent) => {
      const b = (e.target as Element).closest('button') as HTMLElement | null;
      if (b && b.dataset.v && !busy) fn(b.dataset.v);
    });
  seg('#xvFmt', x => {
    v().fmt = x as VideoSettings['fmt'];
    changed();
  });
  seg('#xvCodec', x => {
    v().codec = x as VideoSettings['codec'];
    changed();
  });
  seg('#xvPart', x => {
    const s = v();
    s.part = x === 'part';
    if (s.part && !(s.to > s.from)) {
      s.from = Math.round(doc.dur * 0.17 * 100) / 100;
      s.to = Math.round(doc.dur * 0.83 * 100) / 100;
    }
    changed();
  });
  const time = (k: 'from' | 'to') => (e: Event) => {
    const t = parseTime((e.target as HTMLInputElement).value);
    if (t != null) v()[k] = clamp(t, 0, doc.dur);
    changed();
  };
  $('#xvFrom').addEventListener('change', time('from'));
  $('#xvTo').addEventListener('change', time('to'));
  $('#xvFps').addEventListener('change', (e: Event) => {
    v().fps = parseInt((e.target as HTMLSelectElement).value) || 30;
    changed(false);
  });
  $('#xvPreset').addEventListener('change', (e: Event) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val) v().preset = val as VideoSettings['preset'];
    changed();
  });
  const typed = (which: 'w' | 'h') => (e: Event) => {
    const s = v(),
      n = parseInt((e.target as HTMLInputElement).value),
      [W, H] = frameSize(s);
    if (!(n > 0)) return syncVideoUI();
    s.preset = 'c';
    s.w = which === 'w' ? n : W;
    s.h = which === 'h' ? n : H;
    changed();
  };
  $('#xvW').addEventListener('change', typed('w'));
  $('#xvH').addEventListener('change', typed('h'));
  seg('#xvFit', x => {
    v().fit = x as VideoSettings['fit'];
    changed();
  });
  $('#xvAlpha').addEventListener('change', (e: Event) => {
    v().alpha = (e.target as HTMLInputElement).checked;
    changed();
  });
  $('#xvBgPick').addEventListener('input', (e: Event) => {
    v().bgc = (e.target as HTMLInputElement).value.toUpperCase();
    changed();
  });
  $('#xvBgc').addEventListener('change', (e: Event) => {
    const x = (e.target as HTMLInputElement).value.trim();
    if (!x) delete v().bgc;
    else if (CSS.supports('color', x)) v().bgc = x;
    changed();
  });
  seg('#xvAim', x => {
    v().aim = x as VideoSettings['aim'];
    changed(false);
  });
  $('#xvQ').addEventListener('input', (e: Event) => ($('#xvQv').textContent = (e.target as HTMLInputElement).value));
  $('#xvQ').addEventListener('change', (e: Event) => {
    v().q = clamp(parseInt((e.target as HTMLInputElement).value) || 70, 0, 100);
    changed(false);
  });
  $('#xvMb').addEventListener('change', (e: Event) => {
    const x = parseFloat((e.target as HTMLInputElement).value);
    if (x > 0) v().mb = x;
    changed(false);
  });
  $('#xvMbps').addEventListener('change', (e: Event) => {
    const x = parseFloat((e.target as HTMLInputElement).value);
    if (x > 0) v().mbps = x;
    changed(false);
  });
  $('#xvKey').addEventListener('change', (e: Event) => {
    v().key = parseFloat((e.target as HTMLSelectElement).value) || 0;
    changed(false);
  });
  $('#xvFast').addEventListener('change', (e: Event) => {
    v().fast = (e.target as HTMLInputElement).checked;
    changed(false);
  });
  $('#xvSmall').addEventListener('change', (e: Event) => {
    v().small = (e.target as HTMLInputElement).checked;
    changed(false);
  });
  // the playhead and Play
  $('#xvScrub').addEventListener('input', (e: Event) => {
    stopPlay();
    setTime(parseFloat((e.target as HTMLInputElement).value) || 0);
    seekPreview(S.time);
    syncTrack();
  });
  $('#xvPlay').addEventListener('click', togglePlayPreview);
  // embed
  $('#xvOther').addEventListener('change', (e: Event) => {
    v().other = (e.target as HTMLInputElement).checked;
    changed(false);
  });
  $('#xvPoster').addEventListener('change', (e: Event) => {
    v().poster = (e.target as HTMLInputElement).checked;
    changed(false);
  });
  $('#xvSnipCopy').addEventListener('click', () => {
    track('embed_code_copied', { kind: 'video' });
    const ta = $('#xvSnip') as HTMLTextAreaElement;
    navigator.clipboard.writeText(ta.value).then(
      () => toast('Snippet copied.'),
      () => {
        ta.select();
        toast('Press Ctrl+C to copy the selected code.');
      },
    );
  });
  $('#xvSet').addEventListener('click', () => !busy && exportSet());
  // the shared footer
  $('#xDl').addEventListener('click', () => {
    if (exportKind() !== 'video' || busy) return;
    exportVideo();
  });
  $('#xCancel').addEventListener('click', () => (cancel = true));
  $('#xPrevZoom').addEventListener('click', (e: MouseEvent) => {
    if (exportKind() !== 'video') return;
    const b = (e.target as Element).closest('button') as HTMLElement | null;
    if (!b) return;
    zoom = b.dataset.v === 'actual' ? 'actual' : 'fit';
    layoutStage();
  });
  window.addEventListener(
    'resize',
    () => exportKind() === 'video' && !($('#mExport') as HTMLElement).hidden && layoutStage(),
  );
}
