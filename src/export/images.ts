// SVGcinema — export/images
import { isLocalFamily, prepareFonts, webFont } from '../render/fonts';
import { boot as bootExternal } from '../runtime/boot';
import type { Asset, Layer } from '../model/types';
import { $, byId, esc, fmt } from '../core/constants';
import { save } from '../core/history';
import { ASSETS, URLS, doc, randPre } from '../core/state';
import { buildExport } from './build';
import { syncExportUI } from './dialog';
import { exportPxScale, outDims, usedImageIds } from './size';
import { lastExport, renderSnippet, setLastExport } from './snippets';
import { exportKind, registerKind } from './kind';
import { syncSizeUI } from './size';
import { blobToData } from '../io/assets';
import { toast } from '../io/open';
import { ancestors, isHidden } from '../model/tree';
import { localMat } from '../tools/bones';
import { kb } from '../ui/inspector';

/** An image prepared for export. */
export interface OptImage {
  data: string;
  size: number;
  mime: string;
  tw: number;
  th: number;
  note?: string;
  orig?: boolean;
}
/** Encoders this browser supports (detected once). */
export const ENC: { webp?: boolean; avif?: boolean; done?: boolean } = {};
export function toBlobP(cv: HTMLCanvasElement, type?: string, q?: number) {
  return new Promise<Blob | null>(r => {
    const t = setTimeout(() => r(null), 8000);
    try {
      cv.toBlob(
        (b: Blob | null) => {
          clearTimeout(t);
          r(b);
        },
        type,
        q,
      );
    } catch (e) {
      clearTimeout(t);
      r(null);
    }
  });
}
export let encP: Promise<void> | null = null;
export function detectEnc() {
  return (
    encP ||
    (encP = Promise.race([detectEnc0(), new Promise<void>(r => setTimeout(r, 1500))]).then(() => {
      ENC.done = true;
    }))
  );
}
export async function detectEnc0() {
  if (ENC.done) return;
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  for (const t of ['webp', 'avif'] as const) {
    const b = await toBlobP(c, 'image/' + t, 0.8);
    ENC[t] = !!b && b.type === 'image/' + t;
  }
  ENC.done = true;
}
export function loadImg(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('decode'));
    im.src = src;
  });
}
export function drawScaled(img: HTMLImageElement, tw: number, th: number) {
  let src: CanvasImageSource = img,
    sw = img.naturalWidth,
    sh = img.naturalHeight;
  while (sw / 2 >= tw * 1.0001 && sh / 2 >= th) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw / 2));
    c.height = Math.max(1, Math.round(sh / 2));
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, c.width, c.height);
    src = c;
    sw = c.width;
    sh = c.height;
  }
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, tw, th);
  return c;
}
export function hasAlpha(cv: HTMLCanvasElement) {
  const x = cv.getContext('2d'),
    w = cv.width,
    h = cv.height,
    step = Math.max(1, Math.floor(Math.sqrt((w * h) / 250000)));
  for (let y = 0; y < h; y += step) {
    const row = x.getImageData(0, y, w, 1).data;
    for (let i = 3; i < row.length; i += 4 * step) if (row[i] < 250) return true;
  }
  return false;
}
export function worldMatAt(l: Layer, t: number) {
  let M = new DOMMatrix();
  [...ancestors(l).reverse(), l].forEach(x => {
    M = M.multiply(localMat(x, t));
    if (x.xf) {
      const el = byId('e-' + x.id + '-s'),
        c = el && el.transform && el.transform.baseVal.consolidate();
      if (c) {
        const m = c.matrix;
        M = M.multiply(new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]));
      }
    }
  });
  return M;
}
export function imageNeeds() {
  const k = exportPxScale() * (doc.ex.hi !== false ? 2 : 1),
    N = Math.max(24, Math.round(doc.dur * 20)),
    ts = new Set<number>();
  for (let i = 0; i <= N; i++) ts.add((i / N) * doc.dur);
  doc.layers.forEach(l => Object.values(l.t).forEach(tr => tr.forEach(q => ts.add(q[0]))));
  const need: Record<string, { w: number; h: number }> = {};
  doc.layers.forEach(l => {
    if (l.type !== 'image' || isHidden(l) || !ASSETS[l.geo.asset]) return;
    let mx = 0,
      my = 0;
    ts.forEach(t => {
      const M = worldMatAt(l, t);
      mx = Math.max(mx, Math.hypot(M.a, M.b));
      my = Math.max(my, Math.hypot(M.c, M.d));
    });
    const n = need[l.geo.asset] || (need[l.geo.asset] = { w: 0, h: 0 });
    // an animated size: the largest it gets
    const sz = (l.t.sz || []).map(q => q[1] as number[]),
      w = Math.max(l.geo.w, ...sz.map(v => v[0])),
      h = Math.max(l.geo.h, ...sz.map(v => v[1]));
    n.w = Math.max(n.w, w * mx * k);
    n.h = Math.max(n.h, h * my * k);
  });
  return need;
}
export const OPT = new Map<string, Promise<OptImage>>();
export function optimizeAsset(a: Asset, need: { w: number; h: number }, fmt: string, q: number): Promise<OptImage> {
  const f = Math.min(1, Math.max(need.w / a.w, need.h / a.h)),
    tw = Math.max(1, Math.round(a.w * f)),
    th = Math.max(1, Math.round(a.h * f)),
    key = [a.id, tw, th, fmt, q].join('|');
  if (OPT.has(key)) return OPT.get(key);
  const pr = (async (): Promise<OptImage> => {
    const orig: OptImage = { data: a.data, size: a.size, mime: a.mime, tw: a.w, th: a.h, orig: true };
    if (/gif|apng/.test(a.mime || '')) return Object.assign(orig, { note: 'animated, kept as is' });
    let img: HTMLImageElement;
    try {
      img = await loadImg(URLS[a.id] || a.data);
    } catch (e) {
      return Object.assign(orig, { note: 'could not be read' });
    }
    const cv = drawScaled(img, tw, th),
      alpha = hasAlpha(cv);
    let types =
      fmt === 'auto'
        ? [ENC.avif && 'image/avif', ENC.webp && 'image/webp', alpha ? 'image/png' : 'image/jpeg']
        : fmt === 'keep'
          ? [a.mime]
          : ['image/' + fmt];
    let note = '';
    if (alpha && types.includes('image/jpeg')) {
      types = types.filter(t => t !== 'image/jpeg');
      if (!types.length) types = [ENC.webp ? 'image/webp' : 'image/png'];
      note = 'has transparency, so not JPEG';
    }
    types = types.filter(Boolean);
    let best: Blob | null = null;
    for (const ty of types) {
      const b = await toBlobP(cv, ty, q / 100);
      if (b && b.type === ty && (!best || b.size < best.size)) best = b;
    }
    if (!best) best = await toBlobP(cv, 'image/png');
    if (!best || (a.size && best.size >= a.size && tw === a.w && th === a.h))
      return Object.assign(orig, { note: note || 'already as small as it gets' });
    return { data: await blobToData(best), size: best.size, mime: best.type, tw, th, note };
  })();
  OPT.set(key, pr);
  return pr;
}
export async function prepImages() {
  const ids = usedImageIds();
  if (!ids.length || doc.ex.opt === false) return null;
  await detectEnc();
  const need = imageNeeds(),
    out: Record<string, OptImage> = {};
  for (const id of ids)
    out[id] = await optimizeAsset(
      ASSETS[id],
      need[id] || { w: ASSETS[id].w, h: ASSETS[id].h },
      doc.ex.fmt || 'auto',
      doc.ex.q || 82,
    );
  return out;
}
export function fmtName(m: string) {
  return (m || '').replace('image/', '').replace('x-icon', 'ico').replace('jpeg', 'jpg').toUpperCase();
}
export function renderImgList(imgs: Record<string, OptImage> | null) {
  const ids = usedImageIds();
  if (!ids.length) return;
  const rows = ids.map(id => {
    const a = ASSETS[id],
      o = imgs && imgs[id];
    return `<div><b>${esc(a.name)}</b><br>${a.w}×${a.h} ${fmtName(a.mime)} ${kb(a.size || 0)}${o ? ` → <span class="ok">${o.tw}×${o.th} ${fmtName(o.mime)} ${kb(o.size || 0)}</span>${o.note ? ` · ${esc(o.note)}` : ''}` : ''}</div>`;
  });
  $('#xImgList').innerHTML = rows.join('');
  const before = ids.reduce((s, id) => s + (ASSETS[id].size || 0), 0),
    after = imgs ? ids.reduce((s, id) => s + (imgs[id].size || 0), 0) : before;
  $('#xImgSum').textContent = imgs
    ? `${ids.length} image${ids.length > 1 ? 's' : ''}: ${kb(before)} → ${kb(after)} (sized for ${Math.round(exportPxScale() * doc.w)}px wide${doc.ex.hi !== false ? ' at 2×' : ''})`
    : `${ids.length} image${ids.length > 1 ? 's' : ''}: ${kb(before)}`;
}
export let prevMode = 'fit';
export function sizePreview() {
  const box = $('#xprev'),
    svg = box.querySelector('svg');
  if (!svg) return;
  const ex = doc.ex,
    fixed = ex.size === 'fixed',
    [w, h] = outDims();
  const rw = fixed ? w : ex.maxW > 0 ? ex.maxW : doc.w,
    rh = fixed ? h : Math.round((rw * doc.h) / doc.w),
    actual = prevMode === 'actual';
  box.classList.add('actual');
  const s = actual ? 1 : Math.min(1, (box.clientWidth - 26) / rw, 400 / rh);
  svg.style.width = Math.round(rw * s) + 'px';
  svg.style.height = Math.round(rh * s) + 'px';
  const pct = Math.round(s * 100);
  $('#xPrevLbl').textContent = fixed
    ? `${w} × ${h} px · shown at ${pct}%`
    : `Responsive · fills its container · ${rw} px wide shown at ${pct}%`;
  $('#xPrevZoom')
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => b.classList.toggle('on', b.dataset.v === prevMode));
}
export let expSeq = 0;
export let expPending = Promise.resolve();
export function expReady() {
  return expPending;
}
export function updateExport() {
  expPending = runExport();
  return expPending;
}
export async function runExport() {
  const seq = ++expSeq;
  if (usedImageIds().length && doc.ex.opt !== false) $('#xStats').innerHTML = '<span>Optimizing images…</span>';
  let imgs: Record<string, OptImage> | null = null;
  try {
    imgs = await prepImages();
  } catch (e) {
    imgs = null;
  }
  const texts = doc.layers
    .filter(l => l.type === 'text' && !l.hid && (webFont(l.geo.family) || isLocalFamily(l.geo.family)))
    .map(l => l.geo);
  if (texts.length) {
    $('#xStats').innerHTML = '<span>Preparing fonts…</span>';
    await prepareFonts(texts, doc.ex.fonts === 'embed' ? 'embed' : 'outline');
  }
  if (seq !== expSeq) return;
  const r = buildExport(imgs);
  setLastExport(r.code);
  const box = $('#xprev'),
    old = box.querySelector('svg');
  if (old && old.player) old.player.destruct();
  box.innerHTML = r.code;
  const ext = doc.ex.mode !== 'css' && doc.ex.player === 'external';
  box.querySelectorAll('script').forEach((sc: HTMLScriptElement) => {
    // Player › External: the JSON and the loader aren't run here (the loader would fetch the player
    // from jsDelivr); the preview starts it with the editor's own copy of the player (runtime/boot)
    if (ext) return;
    const n = document.createElement('script');
    n.textContent = sc.textContent.replace('<![CDATA[', '').replace(']]>', '');
    sc.remove();
    document.body.appendChild(n);
    n.remove();
  });
  if (ext) {
    const sv = box.querySelector('svg');
    if (sv) bootExternal(sv as SVGSVGElement);
  }
  sizePreview();
  const [w, h] = outDims(),
    size = new Blob([r.code]).size;
  // CSS stores every frame of a shape change (morphs, pins): offer the much smaller JavaScript export
  let jsSize = 0;
  if (doc.ex.mode === 'css' && r.shapes) {
    doc.ex.mode = 'js';
    try {
      jsSize = new Blob([buildExport(imgs).code]).size;
    } finally {
      doc.ex.mode = 'css';
    }
  }
  const ratio = jsSize ? size / jsSize : 0,
    note = $('#xShapeNote');
  note.hidden = !(ratio >= 2);
  if (!note.hidden)
    $('#xShapeNoteT').textContent =
      `This animation changes shapes. CSS stores every frame of them, so the JavaScript export is about ${Math.round(ratio)} times smaller.`;
  $('#xFileSize').textContent = kb(size);
  $('#xFileSub').textContent =
    doc.ex.mode === 'css'
      ? 'CSS only' + (!note.hidden ? ` · as JavaScript ${kb(jsSize)}` : '')
      : `JavaScript · ${ext ? 'external player' : 'player inside'}`;
  const chip = (k: string, v: string | number) => `<span>${k} <b>${v}</b></span>`;
  $('#xStats').innerHTML =
    (doc.ex.size === 'fixed' ? chip('Output', `${w} × ${h}`) : '') +
    chip('Layers', doc.layers.filter(l => !isHidden(l)).length) +
    chip('Animated', r.anim) +
    chip('Animators', r.tracks) +
    (r.images ? chip('Images', r.images) : '') +
    chip('Length', `${fmt(doc.dur)}s`);
  renderImgList(imgs);
}
export function slug(s: unknown) {
  return (
    String(s || 'animation')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'animation'
  );
}
/** a file name as the person typed it (any language): only the characters file systems refuse are
 *  dropped, with control characters and leading / trailing dots and spaces */
export function fileName(s: unknown, fallback = 'animation') {
  return (
    String(s || '')
      .normalize('NFC')
      .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .slice(0, 120) || fallback
  );
}
export async function saveFile(name: string, data: BlobPart, type: string) {
  if ((window as any).claude && (window as any).claude.use) {
    let dl = null;
    try {
      dl = await (window as any).claude.use('downloads');
    } catch (e) {}
    if (dl) {
      try {
        await dl.save({ filename: name, data });
        toast('Saved ' + name);
      } catch (err) {
        if (err && err.code === 'declined') return;
        toast(
          err && err.code === 'rate_limited'
            ? 'A save is already waiting for your confirmation.'
            : 'Download is not available here. Use Copy code instead.',
        );
      }
      return;
    }
  }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) {
    toast('Download is not available here. Use Copy code instead.');
  }
}

export function init(): void {
  // Export › Animated SVG: the preview is built when the kind opens
  registerKind('svg', {
    open() {
      $('#xCopy').textContent = 'Copy SVG code';
      $('#xDlT').textContent = 'Download .svg';
      sizePreview();
      detectEnc().then(() => {
        syncSizeUI();
        updateExport();
      });
    },
    close() {},
  });
  $('#xPrevZoom').addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('button');
    if (!b || exportKind() !== 'svg') return;
    prevMode = b.dataset.v;
    sizePreview();
  });
  $('#xUseJS').addEventListener('click', () => {
    const b = $('#xMode').querySelector('[data-v="js"]') as HTMLElement;
    if (b) b.click();
  });
  $('#xMode').addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('button');
    if (!b) return;
    doc.ex.mode = b.dataset.v;
    save();
    syncExportUI();
    updateExport();
  });
  $('#xPlayer').addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('button');
    if (!b) return;
    doc.ex.player = b.dataset.v === 'external' ? 'external' : 'embed';
    save();
    syncExportUI();
    updateExport();
  });
  $('#xSize').addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('button');
    if (!b) return;
    doc.ex.size = b.dataset.v;
    save();
    syncExportUI();
    updateExport();
  });
  $('#xTrig').addEventListener('change', (e: Event) => {
    doc.ex.trigger = (e.target as any).value;
    save();
    syncExportUI();
    updateExport();
  });
  $('#xIt').addEventListener('change', (e: Event) => {
    doc.it = parseInt((e.target as any).value) || 0;
    save();
    updateExport();
  });
  $('#xDir').addEventListener('change', (e: Event) => {
    doc.dir = (e.target as any).value;
    save();
    updateExport();
  });
  $('#xIt').addEventListener('change', () => renderSnippet());
  $('#xProj').addEventListener('change', (e: Event) => {
    doc.ex.proj = (e.target as HTMLInputElement).checked || undefined;
    if (!doc.ex.proj) delete doc.ex.proj;
    save();
    syncExportUI();
    updateExport();
  });
  $('#xPre').addEventListener('change', (e: Event) => {
    doc.ex.prefix = (e.target as any).value.trim() || randPre();
    save();
    syncExportUI();
    updateExport();
  });
  $('#xCopy').addEventListener('click', async () => {
    if (exportKind() !== 'svg') return;
    await expReady();
    // without clipboard access, copy through a hidden text box
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = lastExport;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {}
      ta.remove();
      toast(ok ? 'SVG code copied.' : 'Copying isn’t allowed here. Use Download .svg instead.');
    };
    try {
      navigator.clipboard.writeText(lastExport).then(() => toast('SVG code copied.'), fallback);
    } catch (e) {
      fallback();
    }
  });
  $('#xDl').addEventListener('click', async () => {
    if (exportKind() !== 'svg') return;
    await expReady();
    saveFile(fileName(doc.name) + '.svg', lastExport, 'image/svg+xml');
  });
}
